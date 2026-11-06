import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { IGNORE_CACHE } from "@solve3fi/sdk";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import {
	getGaugePDA,
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { getPairPDA, sortedMints } from "@/lib/gaugeStatus";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

type Action =
	| { kind: "schedule"; poolAddress: string }
	| { kind: "remove"; poolAddress: string }
	| { kind: "migrate"; oldPoolAddress: string; newPoolAddress: string };

/**
 * Admin lifecycle steps that take effect at the next epoch: schedule
 * activation, request removal, migrate the pair's canonical gauge. The switch
 * itself is the existing configure step, available once the epoch arrives.
 */
export function useGaugeLifecycle() {
	const { publicKey } = useWallet();
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	const program = useVesolveProgram();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (action: Action) => {
			if (!publicKey) throw new Error("Connect the protocol Admin wallet.");
			const [protocol] = getProtocolPDA();
			if (action.kind === "remove") {
				const [gauge] = getGaugePDA(
					protocol,
					new PublicKey(action.poolAddress),
				);
				return program.methods
					.requestGaugeRemoval()
					.accounts({ admin: publicKey, protocol, gauge })
					.rpc({ commitment: "confirmed" });
			}
			if (action.kind === "schedule") {
				const pool = new PublicKey(action.poolAddress);
				const [gauge] = getGaugePDA(protocol, pool);
				const gaugeState = await vesolveAccount.gauge(program).fetch(gauge);
				const [lo, hi] = sortedMints(
					gaugeState.tokenMintA,
					gaugeState.tokenMintB,
				);
				const pair = getPairPDA(program.programId, lo, hi);
				const pairState = await vesolveAccount
					.pairCanonical(program)
					.fetchNullable(pair);
				const holder =
					pairState && !pairState.gauge.equals(PublicKey.default)
						? pairState.gauge
						: null;
				return program.methods
					.scheduleGaugeActivation(lo, hi)
					.accountsPartial({
						admin: publicKey,
						protocol,
						gauge,
						pool,
						pair,
						// Anchor needs an explicit null for an optional account with no holder; the
						// untyped Program accounts type cannot express that, hence the cast.
						occupant: holder && !holder.equals(gauge) ? holder : null,
						systemProgram: SystemProgram.programId,
					} as never)
					.rpc({ commitment: "confirmed" });
			}
			const oldPool = new PublicKey(action.oldPoolAddress);
			const newPool = new PublicKey(action.newPoolAddress);
			const [oldGauge] = getGaugePDA(protocol, oldPool);
			const [newGauge] = getGaugePDA(protocol, newPool);
			const [oldState, poolData] = await Promise.all([
				vesolveAccount.gauge(program).fetch(oldGauge),
				ctx.fetcher.getPool(newPool, IGNORE_CACHE),
			]);
			if (!poolData) throw new Error("New pool not found.");
			const [lo, hi] = sortedMints(oldState.tokenMintA, oldState.tokenMintB);
			return program.methods
				.scheduleGaugeMigration(lo, hi)
				.accounts({
					admin: publicKey,
					protocol,
					oldGauge,
					newGauge,
					newPool,
					pair: getPairPDA(program.programId, lo, hi),
				})
				.rpc({ commitment: "confirmed" });
		},
		onSuccess: async () => {
			notification.success({
				title: "Gauge change scheduled",
				message: "It takes effect at the next epoch.",
			});
			await Promise.all(
				[
					"vesolve-all-gauges",
					"vesolve-protocol",
					"vesolve-protocol-account",
				].map((key) =>
					queryClient.invalidateQueries({ queryKey: [key] }),
				),
			);
		},
		onError: (error) =>
			notification.error({
				title: "Gauge unchanged",
				message:
					error instanceof Error ? error.message : "The transaction failed.",
			}),
	});
}
