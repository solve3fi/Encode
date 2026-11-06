import { useLingui } from "@lingui/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { IGNORE_CACHE, SolveIx, toTx } from "@solve3fi/sdk";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID, PROGRAM_CONFIG } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";
import { getProtocolPDA, getGaugePDA, useVesolveProgram, vesolveAccount } from "@/hooks/useVesolveProgram";

export type SetProtocolFeeRateInput = {
	poolAddress: string;
	/** Basis points of 10_000: the share of each swap fee the protocol keeps. */
	protocolFeeRate: number;
};

/**
 * Sets a pool's on-chain protocolFeeRate — the fee split behind the soft-
 * launch LP incentive program (Admin › LP Incentives). Only the DEX fee
 * authority can sign this; the same permission check as useCreateGauge.
 */
export const useSetProtocolFeeRate = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["dex-set-protocol-fee-rate"],
		mutationFn: async ({ poolAddress, protocolFeeRate }: SetProtocolFeeRateInput) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));
			const dexConfigAddress = PROGRAM_CONFIG[network];
			const config = await ctx.fetcher.getConfig(dexConfigAddress, IGNORE_CACHE);
			if (!config) throw new Error(i18n._("DEX configuration not found."));
			const [protocol] = getProtocolPDA();
			const managed = config.feeAuthority.equals(protocol);
			if (!managed && !config.feeAuthority.equals(publicKey)) {
				throw new Error(
					i18n._("Connect the DEX fee-authority wallet {address} to change a pool's fee share.", {
						address: config.feeAuthority.toBase58(),
					}),
				);
			}
			const pool = new PublicKey(poolAddress);
			const poolData = await ctx.fetcher.getPool(pool, IGNORE_CACHE);
			if (!poolData?.solvesConfig.equals(dexConfigAddress)) {
				throw new Error(i18n._("Pool does not belong to this DEX configuration."));
			}
			if (managed) {
				const [gauge] = getGaugePDA(protocol, pool);
				const state = await vesolveAccount.gauge(program).fetchNullable(gauge);
				const target = state?.isActive ? 10_000 : 500;
				if (protocolFeeRate !== target) throw new Error("Pool fee shares follow gauge status: active gauges route fees to voters; other pools keep 95% for LPs.");
				if (poolData.protocolFeeRate === target) return "already-synced";
				if (!poolData.protocolFeeOwedA.isZero() || !poolData.protocolFeeOwedB.isZero())
					throw new Error("Settle this pool's accrued protocol fees before changing its fee share.");
				return program.methods.syncPoolFeeRate().accounts({
					caller: publicKey, protocol, solvesConfig: dexConfigAddress, pool, gauge, solveProgram: DEX_PROGRAM_ID[network],
				}).rpc({ commitment: "confirmed" });
			}
			const ix = SolveIx.setProtocolFeeRateIx(ctx.program, {
				solve: pool,
				solvesConfig: dexConfigAddress,
				feeAuthority: publicKey,
				protocolFeeRate,
			});
			const transaction = new Transaction();
			for (const instruction of toTx(ctx, ix).compressIx(false).instructions) {
				transaction.add(instruction as unknown as TransactionInstruction);
			}
			const signature = await ctx.provider.sendAndConfirm(transaction);
			const latestBlockhash = await ctx.connection.getLatestBlockhash();
			await ctx.connection.confirmTransaction({ signature, ...latestBlockhash }, "confirmed");
			return signature;
		},
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["poolInfo"] }),
				queryClient.invalidateQueries({ queryKey: ["allPools"] }),
			]);
			notification.success({
				title: i18n._("Fee share"),
				message: i18n._("Pool fee share updated on-chain."),
			});
		},
		onError: (error) => {
			notification.error({
				title: i18n._("Fee share"),
				message: error instanceof Error ? error.message : i18n._("Transaction failed"),
			});
		},
	});
};
