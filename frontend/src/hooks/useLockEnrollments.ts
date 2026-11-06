import { useQuery } from "@tanstack/react-query";
import type { LockAccount } from "@/stores/lock/hooks/useLocks";
import {
	getAutoVoteEnrollmentPDA,
	useVesolveProgram,
	vesolveAccount,
} from "./useVesolveProgram";

/** For each lock, whether it is currently enrolled in the public Auto-Vote (keyed by lock address). */
export const useLockEnrollments = (locks: LockAccount[] | undefined) => {
	const program = useVesolveProgram();
	const addresses = (locks ?? []).map((lock) => lock.address.toBase58());
	return useQuery({
		queryKey: ["partner-lock-enrollments", addresses.join(",")],
		enabled: addresses.length > 0,
		queryFn: async (): Promise<Record<string, boolean>> => {
			const found = await vesolveAccount
				.autoVoteEnrollment(program)
				.fetchMultiple((locks ?? []).map((lock) => getAutoVoteEnrollmentPDA(lock.address)[0]));
			return Object.fromEntries(addresses.map((address, index) => [address, Boolean(found[index])]));
		},
	});
};
