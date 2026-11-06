import { useLingui } from "@lingui/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { IGNORE_CACHE, PDAUtil, SolveIx, toTx } from "@solve3fi/sdk";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID, PROGRAM_CONFIG } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";
import { getProtocolPDA, useVesolveProgram } from "@/hooks/useVesolveProgram";

export type InitializeFeeTierInput = {
	tickSpacing: number;
	/** Hundredths of a basis point (3000 = 0.30%). */
	defaultFeeRate: number;
};

/**
 * Creates a fee-tier account on the DEX so pools can be opened at that tier.
 * Only the DEX fee authority can sign it (same check as useSetProtocolFeeRate).
 */
export const useInitializeFeeTier = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["dex-initialize-fee-tier"],
		mutationFn: async ({ tickSpacing, defaultFeeRate }: InitializeFeeTierInput) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));
			const dexConfigAddress = PROGRAM_CONFIG[network];
			const config = await ctx.fetcher.getConfig(dexConfigAddress, IGNORE_CACHE);
			if (!config) throw new Error(i18n._("DEX configuration not found."));
			const [protocol] = getProtocolPDA();
			const managed = config.feeAuthority.equals(protocol);
			if (!managed && !config.feeAuthority.equals(publicKey)) {
				throw new Error(
					i18n._("Connect the DEX fee-authority wallet {address} to enable fee tiers.", {
						address: config.feeAuthority.toBase58(),
					}),
				);
			}
			const feeTierPda = PDAUtil.getFeeTier(
				DEX_PROGRAM_ID[network],
				dexConfigAddress,
				tickSpacing,
			);
			if (managed) {
				return program.methods.dexInitializeFeeTier(tickSpacing, defaultFeeRate).accounts({
					admin: publicKey, protocol, solvesConfig: dexConfigAddress, target: feeTierPda.publicKey,
					solveProgram: DEX_PROGRAM_ID[network], systemProgram: SystemProgram.programId,
				}).rpc({ commitment: "confirmed" });
			}
			const ix = SolveIx.initializeFeeTierIx(ctx.program, {
				solvesConfig: dexConfigAddress,
				feeTierPda,
				tickSpacing,
				defaultFeeRate,
				feeAuthority: publicKey,
				funder: publicKey,
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
			await queryClient.invalidateQueries({ queryKey: ["enabled-fee-tiers"] });
			notification.success({
				title: i18n._("Fee tiers"),
				message: i18n._("Fee tier enabled on-chain."),
			});
		},
		onError: (error) => {
			notification.error({
				title: i18n._("Fee tiers"),
				message: error instanceof Error ? error.message : i18n._("Transaction failed"),
			});
		},
	});
};
