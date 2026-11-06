import { poll } from "@/lib/poll";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import {
	getLockPDA,
	getUserVotePDA,
	type RawUserVote,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import type { ClusterNetwork } from "@/providers/ClusterProvider";

// The selected lock's already-submitted vote for the current epoch, if any.
// Votes are per lock. A fresh `vote()` call replaces that lock's record
// wholesale (it's one Vec<GaugeVote> field, not per-gauge storage) — so any
// gauge omitted from a new vote call silently loses its prior allocation. This
// is read on the Vote page to hydrate the in-progress vote draft with what's
// already on-chain, so re-voting can't drop an existing gauge's weight without
// the user seeing it.
export const useUserVote = (
	network: ClusterNetwork,
	epoch: number,
	lockId: number,
) => {
	const program = useVesolveProgram();
	const { publicKey } = useWallet();

	return useQuery({
		queryKey: [
			"vesolve-user-vote",
			network,
			epoch,
			lockId,
			publicKey?.toString(),
		],
		queryFn: async (): Promise<RawUserVote | null> => {
			if (!publicKey || !lockId) return null;
			const [lockAddress] = getLockPDA(lockId);
			const [userVoteAddress] = getUserVotePDA(lockAddress, epoch);
			return await vesolveAccount
				.userVote(program)
				.fetchNullable(userVoteAddress);
		},
		enabled: epoch > 0 && !!publicKey && lockId > 0,
		refetchInterval: poll(15_000),
		staleTime: 10_000,
	});
};
