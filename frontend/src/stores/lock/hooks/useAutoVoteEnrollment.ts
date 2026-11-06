import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";
import {
	getAutoVoteEnrollmentPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";

export type AutoVoteEnrollment = {
	owner: string;
	enrolledAt: number;
};

/**
 * Whether `lockAddress` is currently delegated to the Public Auto-Vote
 * keeper (see AutoVoteEnrollment in programs/vesolve/src/states/auto_vote.rs).
 * Returns null when not enrolled.
 */
export const useAutoVoteEnrollment = (lockAddress: PublicKey | undefined) => {
	const program = useVesolveProgram();

	return useQuery({
		queryKey: ["vesolve-auto-vote-enrollment", lockAddress?.toString()],
		queryFn: async (): Promise<AutoVoteEnrollment | null> => {
			if (!lockAddress) return null;
			const [enrollmentAddress] = getAutoVoteEnrollmentPDA(lockAddress);
			const enrollment = await vesolveAccount
				.autoVoteEnrollment(program)
				.fetchNullable(enrollmentAddress);
			if (!enrollment) return null;
			return {
				owner: enrollment.owner.toString(),
				enrolledAt: Number(enrollment.enrolledAt.toString()),
			};
		},
		enabled: lockAddress !== undefined,
	});
};
