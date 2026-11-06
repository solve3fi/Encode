import { useLingui } from "@lingui/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { SystemProgram } from "@solana/web3.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import BN from "bn.js";
import { notification } from "@/components/Notifications";
import { getExitFeeConfigPDA, useVesolveProgram } from "@/hooks/useVesolveProgram";

export type SetExitFeeInput = {
	/** Basis points, 0 to 10,000. */
	feeBps: number;
};

/**
 * Schedules a new exit fee percentage
 * (programs/vesolve/src/instructions/exit_lock.rs::set_exit_fee_bps). It never
 * applies to the current epoch; it takes effect when the next epoch starts.
 */
export const useSetExitFee = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["vesolve-set-exit-fee"],
		mutationFn: async ({ feeBps }: SetExitFeeInput) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));

			const [exitFeeConfig] = getExitFeeConfigPDA();
			const signature = await program.methods
				.setExitFeeBps(new BN(feeBps))
				.accounts({
					admin: publicKey,
					exitFeeConfig,
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
				title: i18n._("Exit Fee"),
				message: i18n._("Fee scheduled for the next epoch"),
			});
			await queryClient.invalidateQueries({
				queryKey: ["vesolve-exit-fee-config"],
			});
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Exit Fee"),
				message:
					error instanceof Error && error.message
						? error.message
						: i18n._("Failed to schedule fee!"),
			});
		},
	});
};
