import { useLingui } from "@lingui/react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
	ComputeBudgetProgram,
	PublicKey,
	SystemProgram,
} from "@solana/web3.js";
import { IGNORE_CACHE } from "@solve3fi/sdk";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID, PROGRAM_CONFIG } from "@/configs/addresses";
import {
	getGaugePDA,
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { getPairPDA, sortedMints } from "@/lib/gaugeStatus";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export type CreateGaugeInput = {
	poolAddress: PublicKey;
	tokenMintA: PublicKey;
	tokenMintB: PublicKey;
	tickSpacing: number;
};

export const useCreateGauge = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);

	return useMutation({
		mutationKey: ["vesolve-create-gauge"],
		mutationFn: async ({
			poolAddress,
			tokenMintA,
			tokenMintB,
			tickSpacing,
		}: CreateGaugeInput) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));
			// Normalize SDK-bundled PublicKeys before passing them to Anchor.
			poolAddress = new PublicKey(poolAddress.toString());
			tokenMintA = new PublicKey(tokenMintA.toString());
			tokenMintB = new PublicKey(tokenMintB.toString());
			const dexConfigAddress = PROGRAM_CONFIG[network];
			const config = await ctx.fetcher.getConfig(
				dexConfigAddress,
				IGNORE_CACHE,
			);
			if (!config) throw new Error(i18n._("DEX configuration not found."));
			const pool = await ctx.fetcher.getPool(poolAddress, IGNORE_CACHE);
			if (
				!pool ||
				!pool.solvesConfig.equals(dexConfigAddress) ||
				!pool.tokenMintA.equals(tokenMintA) ||
				!pool.tokenMintB.equals(tokenMintB) ||
				pool.tickSpacing !== tickSpacing
			) {
				throw new Error(
					i18n._(
						"Pool details changed or do not match this DEX. Refresh and try again.",
					),
				);
			}
			const [protocolAddress] = getProtocolPDA();
			const [gaugeAddress] = getGaugePDA(protocolAddress, poolAddress);
			// A new gauge starts inactive. Scheduling its activation in the same
			// transaction queues the switch for the start of the next epoch; the
			// Gauge status card then runs the switch (fee split + emissions).
			const [lo, hi] = sortedMints(tokenMintA, tokenMintB);
			const pair = getPairPDA(program.programId, lo, hi);
			const pairState = await vesolveAccount
				.pairCanonical(program)
				.fetchNullable(pair);
			const holder =
				pairState && !pairState.gauge.equals(PublicKey.default)
					? pairState.gauge
					: null;
			const schedule = await program.methods
				.scheduleGaugeActivation(lo, hi)
				.accountsPartial({
					admin: publicKey,
					protocol: protocolAddress,
					gauge: gaugeAddress,
					pool: poolAddress,
					pair,
					// Anchor needs an explicit null for an optional account with no holder; the
					// untyped Program accounts type cannot express that, hence the cast.
					occupant: holder && !holder.equals(gaugeAddress) ? holder : null,
					systemProgram: SystemProgram.programId,
				} as never)
				.instruction();

			// The pair already has another pool's gauge. Scheduling this one would fail (one canonical
			// gauge per pair), so create it inactive; "Move gauge to another pool" then switches the pair
			// to it at the next epoch.
			const pairTaken = Boolean(holder && !holder.equals(gaugeAddress));
			const builder = program.methods
				.createGauge(poolAddress, tokenMintA, tokenMintB, tickSpacing)
				.accounts({
					admin: publicKey,
					protocol: protocolAddress,
					gauge: gaugeAddress,
					systemProgram: SystemProgram.programId,
				})
				.preInstructions([
					ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
				]);
			// Both instructions succeed or both roll back.
			const signature = await (pairTaken
				? builder
				: builder.postInstructions([schedule])
			).rpc({ commitment: "confirmed" });

			return { signature, scheduled: !pairTaken };
		},
		onSuccess: async ({ scheduled }) => {
			notification.success({
				title: i18n._("Add Gauge"),
				message: scheduled
					? i18n._(
							"Gauge created and scheduled. It switches on from the start of the next epoch: open Gauge status then and run the switch.",
						)
					: i18n._(
							"Gauge created but not scheduled: the pair already has an active gauge. Use Move gauge to another pool to switch the pair to it.",
						),
			});
			await queryClient.invalidateQueries({ queryKey: ["vesolve-all-gauges"] });
			await Promise.all(
				["poolInfo", "pools", "allPools", "poolRouter", "bestTrade"].map(
					(key) => queryClient.invalidateQueries({ queryKey: [key] }),
				),
			);
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Add Gauge"),
				message:
					error instanceof Error && error.message
						? error.message
						: i18n._("Create gauge failed!"),
			});
		},
	});
};
