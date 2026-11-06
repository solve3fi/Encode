import { useQuery } from "@tanstack/react-query";
import { PARTNER_VOTER } from "@/configs/partnerVoter";
import { type LockAutoState, lockAutoState } from "@/lib/partnerLockState";
import type { LockAccount } from "@/stores/lock/hooks/useLocks";
import {
	getAutoVoteDelegatePDA,
	getAutoVoteEnrollmentPDA,
	useVesolveProgram,
	vesolveAccount,
} from "./useVesolveProgram";

export type PartnerLock = {
	lock: LockAccount;
	state: LockAutoState;
};

/**
 * Each of the connected wallet's veSOLV3 locks with how it stands for auto-voting: off, enrolled in the public
 * Auto-Vote (standard fee), or enrolled with the shared partner voter chosen (free, voted only for the partner's own
 * gauge). The locks come from the connected wallet, which the partner space only lets in when it is registered.
 */
export const usePartnerLockStates = (locks: LockAccount[] | undefined) => {
	const program = useVesolveProgram();
	const addresses = (locks ?? []).map((lock) => lock.address.toBase58());
	return useQuery({
		queryKey: [
			"partner-lock-states",
			addresses.join(","),
			PARTNER_VOTER?.toBase58() ?? "",
		],
		enabled: addresses.length > 0,
		queryFn: async (): Promise<PartnerLock[]> => {
			const list = locks ?? [];
			const [enrollments, delegates] = await Promise.all([
				vesolveAccount
					.autoVoteEnrollment(program)
					.fetchMultiple(
						list.map((lock) => getAutoVoteEnrollmentPDA(lock.address)[0]),
					),
				vesolveAccount
					.autoVoteDelegate(program)
					.fetchMultiple(
						list.map((lock) => getAutoVoteDelegatePDA(lock.address)[0]),
					),
			]);
			return list.map((lock, index) => ({
				lock,
				state: lockAutoState({
					enrolled: Boolean(enrollments[index]),
					enrolledAt: enrollments[index]?.enrolledAt.toString(),
					delegateVoter: delegates[index]?.voter.toBase58() ?? null,
					delegateSetAt: delegates[index]?.setAt.toString(),
					partnerVoter: PARTNER_VOTER?.toBase58() ?? null,
				}),
			}));
		},
	});
};
