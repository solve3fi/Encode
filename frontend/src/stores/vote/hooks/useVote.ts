import { poll } from "@/lib/poll";
import type { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import type BN from "bn.js";
import {
	getEpochPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import type { ClusterNetwork } from "@/providers/ClusterProvider";

export type EpochVoteSnapshot = {
	votes: BN;
	votePools: PublicKey[];
	votePowers: BN[];
};

// Singular useVote: fetches the aggregate gauge-weight snapshot for one
// epoch. Not to be confused with the Zustand selector of the same name
// exported from stores/vote/VoteProvider — components disambiguate by
// import path.
export const useVote = (network: ClusterNetwork, epoch: number) => {
	const program = useVesolveProgram();

	return useQuery({
		queryKey: ["vesolve-epoch", network, epoch],
		queryFn: async (): Promise<EpochVoteSnapshot | null> => {
			const [epochAddress] = getEpochPDA(epoch);
			const epochAccount = await vesolveAccount
				.epoch(program)
				.fetchNullable(epochAddress);
			if (!epochAccount) return null;

			return {
				votes: epochAccount.totalVotingPower,
				votePools: epochAccount.gaugeWeights.map((gw) => gw.gauge),
				votePowers: epochAccount.gaugeWeights.map((gw) => gw.weight),
			};
		},
		enabled: epoch > 0,
		refetchInterval: poll(15_000),
	});
};
