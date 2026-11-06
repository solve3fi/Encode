import { poll } from "@/lib/poll";
import { useQuery } from "@tanstack/react-query";
import BN from "bn.js";
import {
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import type { ClusterNetwork } from "@/providers/ClusterProvider";

export type VoteConfig = {
	epoch: BN;
	epochStartTime: number;
	nextEpochTime: number;
	chainTime: number;
	localTimeAtFetch: number;
};

export const useVoteConfig = (network: ClusterNetwork) => {
	const program = useVesolveProgram();

	return useQuery({
		queryKey: ["vesolve-protocol", network],
		queryFn: async (): Promise<VoteConfig | null> => {
			const requestStartedAt = Date.now();
			const [protocolAddress] = getProtocolPDA();
			const [protocol, slot] = await Promise.all([
				vesolveAccount.protocol(program).fetchNullable(protocolAddress),
				program.provider.connection.getSlot("confirmed"),
			]);
			if (!protocol) return null;
			const blockTime = await program.provider.connection.getBlockTime(slot);
			if (blockTime === null) {
				throw new Error("Solana did not return a confirmed block time");
			}
			const localTimeAtFetch = Math.round((requestStartedAt + Date.now()) / 2);

			return {
				epoch: new BN(protocol.currentEpoch.toString()),
				epochStartTime: protocol.epochStartTime.toNumber(),
				nextEpochTime:
					protocol.epochStartTime.toNumber() +
					protocol.epochResetTime.toNumber(),
				chainTime: blockTime,
				localTimeAtFetch,
			};
		},
		refetchInterval: poll(15_000),
		staleTime: 10_000,
	});
};
