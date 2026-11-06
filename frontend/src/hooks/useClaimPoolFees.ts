import { useLingui } from "@lingui/react";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import {
	getPoolFeePositionPDA,
	getPoolFeeVaultPDA,
	useVesolveProgram,
} from "./useVesolveProgram";

export type ClaimPoolFeesInput = {
	poolAddress: PublicKey;
	positionAddress: PublicKey;
	positionMint: PublicKey;
	tokenMintA: PublicKey;
	tokenMintB: PublicKey;
};

/**
 * Claims a registered position's accrued share of its pool's swept fee
 * vault. The on-chain instruction syncs the position against current
 * fee_owed/in-range status first, so this always claims the latest amount
 * rather than whatever was accrued as of the last sync.
 *
 * Gauge-eligible pools are classic-SPL-only (see native_gauge.rs's
 * activation guard), so this vault's token accounts are too — no Token-2022
 * handling needed here.
 */
export const useClaimPoolFees = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["claim-pool-fees"],
		mutationFn: async ({
			poolAddress,
			positionAddress,
			positionMint,
			tokenMintA,
			tokenMintB,
		}: ClaimPoolFeesInput) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));

			const [vaultAddress] = getPoolFeeVaultPDA(poolAddress);
			const [poolFeePositionAddress] = getPoolFeePositionPDA(positionMint);
			const ownerPositionToken = getAssociatedTokenAddressSync(
				positionMint,
				publicKey,
			);
			const vaultTokenAccountA = getAssociatedTokenAddressSync(
				tokenMintA,
				vaultAddress,
				true,
			);
			const vaultTokenAccountB = getAssociatedTokenAddressSync(
				tokenMintB,
				vaultAddress,
				true,
			);
			const ownerTokenAccountA = getAssociatedTokenAddressSync(
				tokenMintA,
				publicKey,
			);
			const ownerTokenAccountB = getAssociatedTokenAddressSync(
				tokenMintB,
				publicKey,
			);

			const signature = await program.methods
				.claimPoolFees()
				.accounts({
					owner: publicKey,
					pool: poolAddress,
					poolFeeVault: vaultAddress,
					position: positionAddress,
					poolFeePosition: poolFeePositionAddress,
					positionMint,
					ownerPositionToken,
					tokenMintA,
					vaultTokenAccountA,
					ownerTokenAccountA,
					tokenMintB,
					vaultTokenAccountB,
					ownerTokenAccountB,
					tokenProgram: TOKEN_PROGRAM_ID,
					associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
					systemProgram: SystemProgram.programId,
				})
				.rpc();
			await program.provider.connection.confirmTransaction(
				signature,
				"confirmed",
			);
			return signature;
		},
		onSuccess: async () => {
			notification.success({
				title: i18n._("Pool Fees"),
				message: i18n._("Swept fees claimed"),
			});
			await queryClient.invalidateQueries({
				queryKey: ["pool-fee-vault-position"],
			});
		},
		onError: (error) => {
			notification.error({
				title: i18n._("Pool Fees"),
				message:
					error instanceof Error ? error.message : i18n._("Claim failed"),
			});
		},
	});
};
