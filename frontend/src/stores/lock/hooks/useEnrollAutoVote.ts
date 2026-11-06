import { useLingui } from "@lingui/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { SystemProgram } from "@solana/web3.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BN } from "@coral-xyz/anchor";
import { notification } from "@/components/Notifications";
import {
	getAutoVoteEnrollmentPDA,
	getLockPDA,
	useVesolveProgram,
} from "@/hooks/useVesolveProgram";

export type EnrollAutoVoteInput = {
	veTokenId: number;
};

/**
 * Delegates this lock's vote() to the Public Auto-Vote keeper
 * (programs/vesolve/src/instructions/auto_vote.rs). The lock stays in the
 * owner's wallet the whole time — this only authorizes a keeper-signed vote
 * on its behalf and a 15% fee on its future voting rewards, both revocable
 * any time via useRevokeAutoVote.
 */
export const useEnrollAutoVote = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["vesolve-enroll-auto-vote"],
		mutationFn: async ({ veTokenId }: EnrollAutoVoteInput) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));

			const [lockAddress] = getLockPDA(veTokenId);
			const [enrollmentAddress] = getAutoVoteEnrollmentPDA(lockAddress);

			const signature = await program.methods
				.enrollAutoVote(new BN(veTokenId))
				.accounts({
					owner: publicKey,
					lock: lockAddress,
					enrollment: enrollmentAddress,
					systemProgram: SystemProgram.programId,
				})
				.rpc();

			await program.provider.connection.confirmTransaction(signature, "confirmed");
			return { signature };
		},
		onSuccess: async (_, { veTokenId }) => {
			notification.success({
				title: i18n._("Public Auto-Vote"),
				message: i18n._("Enrolled — the keeper will vote this lock going forward"),
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
						: i18n._("Enrollment failed"),
			});
		},
	});
};
