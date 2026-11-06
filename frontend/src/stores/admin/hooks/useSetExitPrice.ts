import { useLingui } from "@lingui/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { SystemProgram } from "@solana/web3.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import BN from "bn.js";
import { notification } from "@/components/Notifications";
import { getExitConfigPDA, useVesolveProgram } from "@/hooks/useVesolveProgram";

export type SetExitPriceInput = {
	/** Lamports per whole SOLV3, not per base unit. */
	lamportsPerSolv3: BN;
};

/**
 * Publishes the SOLV3-per-SOL rate exit_lock charges its fee against
 * (programs/vesolve/src/instructions/exit_lock.rs::set_exit_price). Admin-gated
 * on-chain via is_admin_key(); this is an administrator input, not an oracle
 * reading — SOLV3 has no price feed and its pools carry no liquidity.
 */
export const useSetExitPrice = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["vesolve-set-exit-price"],
		mutationFn: async ({ lamportsPerSolv3 }: SetExitPriceInput) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));

			const [exitConfigAddress] = getExitConfigPDA();
			const signature = await program.methods
				.setExitPrice(lamportsPerSolv3)
				.accounts({
					admin: publicKey,
					exitConfig: exitConfigAddress,
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
				title: i18n._("Exit Price"),
				message: i18n._("Rate published"),
			});
			await queryClient.invalidateQueries({
				queryKey: ["vesolve-exit-config"],
			});
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Exit Price"),
				message:
					error instanceof Error && error.message
						? error.message
						: i18n._("Failed to publish rate!"),
			});
		},
	});
};
