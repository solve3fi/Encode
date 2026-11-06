import { useQuery } from "@tanstack/react-query";
import { useVesolveProgram, vesolveAccount } from "@/hooks/useVesolveProgram";
import { formatAddress } from "@/lib/format";

/** Every wallet that owns a veSOLV3 lock, for the admin wallet picker. */
export const useLockHolders = () => {
	const program = useVesolveProgram();
	return useQuery({
		queryKey: ["vesolve-lock-holders"],
		staleTime: 30_000,
		queryFn: async () => {
			const locks = await vesolveAccount.lock(program).all();
			const counts = new Map<string, number>();
			for (const { account } of locks) {
				const owner = account.owner.toString();
				counts.set(owner, (counts.get(owner) ?? 0) + 1);
			}
			return [...counts.entries()].map(([value, count]) => ({
				value,
				label: `${formatAddress(value)} · ${count} lock${count === 1 ? "" : "s"}`,
			}));
		},
	});
};
