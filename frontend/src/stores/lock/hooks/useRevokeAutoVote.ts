import { useLingui } from "@lingui/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BN } from "@coral-xyz/anchor";
import { notification } from "@/components/Notifications";
import {
	getAutoVoteEnrollmentPDA,
	getLockPDA,
	useVesolveProgram,
} from "@/hooks/useVesolveProgram";

export type RevokeAutoVoteInput = {
	veTokenId: number;
};

/**
 * Revokes a lock's Public Auto-Vote delegation (see useEnrollAutoVote). The
 * enrollment PDA is closed on-chain and the keeper immediately loses
 * authority to vote this lock — it does not affect any vote already cast.
 */
export const useRevokeAutoVote = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["vesolve-revoke-auto-vote"],
		mutationFn: async ({ veTokenId }: RevokeAutoVoteInput) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));

			const [lockAddress] = getLockPDA(veTokenId);
			const [enrollmentAddress] = getAutoVoteEnrollmentPDA(lockAddress);

			const signature = await program.methods
				.revokeAutoVote(new BN(veTokenId))
				.accounts({
					owner: publicKey,
					lock: lockAddress,
					enrollment: enrollmentAddress,
				})
				.rpc();

			await program.provider.connection.confirmTransaction(signature, "confirmed");
			return { signature };
		},
		onSuccess: async (_, { veTokenId }) => {
			notification.success({
				title: i18n._("Public Auto-Vote"),
				message: i18n._("Revoked — this lock votes only when you vote it yourself"),
			});
			const [lockAddress] = getLockPDA(veTokenId);
			await queryClient.invalidateQueries({
				queryKey: ["vesolve-auto-vote-enrollment", lockAddress.toString()],
			});
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Public Auto-Vote"),
				message:
					error instanceof Error && error.message
						? error.message
						: i18n._("Revoke failed"),
			});
		},
	});
};
