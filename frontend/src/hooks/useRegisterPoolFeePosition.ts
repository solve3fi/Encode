import { useLingui } from "@lingui/react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
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

export type RegisterPoolFeePositionInput = {
	poolAddress: PublicKey;
	positionAddress: PublicKey;
	positionMint: PublicKey;
};

/**
 * Opts an existing LP position into its pool's (Gauge-less) shared fee
 * vault. Never touches custody of the position — it stays in the owner's
 * wallet the whole time, same as before registering.
 */
export const useRegisterPoolFeePosition = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["register-pool-fee-position"],
		mutationFn: async ({
			poolAddress,
			positionAddress,
			positionMint,
		}: RegisterPoolFeePositionInput) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));

			const [vaultAddress] = getPoolFeeVaultPDA(poolAddress);
			const [poolFeePositionAddress] = getPoolFeePositionPDA(positionMint);
			const ownerPositionToken = getAssociatedTokenAddressSync(
				positionMint,
				publicKey,
			);

			const signature = await program.methods
				.registerPoolFeePosition()
				.accounts({
					owner: publicKey,
					pool: poolAddress,
					poolFeeVault: vaultAddress,
					position: positionAddress,
					positionMint,
					ownerPositionToken,
					poolFeePosition: poolFeePositionAddress,
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
				message: i18n._("Registered — you'll now earn a share of swept fees"),
			});
			await queryClient.invalidateQueries({
				queryKey: ["pool-fee-vault-position"],
			});
		},
		onError: (error) => {
			notification.error({
				title: i18n._("Pool Fees"),
				message:
					error instanceof Error
						? error.message
						: i18n._("Registration failed"),
			});
		},
	});
};
