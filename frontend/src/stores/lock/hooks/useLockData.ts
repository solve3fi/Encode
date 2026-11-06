import { poll } from "@/lib/poll";
import { useQuery } from "@tanstack/react-query";
import type BN from "bn.js";
import type { PublicKey } from "@solana/web3.js";
import {
	getLockPDA,
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { useCluster } from "@/providers/ClusterProvider";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";

export type LockData = {
	address: PublicKey;
	owner: PublicKey;
	identifier: BN;
	lockNftMint: PublicKey;
	lockTokenMint: PublicKey;
	tokenAmount: BN;
	lockPower: BN;
	unlockTime: BN;
	lastVoteEpoch: BN;
};

export const useLockData = (lockId: number | undefined) => {
	const program = useVesolveProgram();
	const { network } = useCluster();
	const { data: voteConfig } = useVoteConfig(network);

	return useQuery({
		// Keep the lock-id prefix used by split/merge/exit invalidations.
		queryKey: ["vesolve-lock", lockId, network, voteConfig?.epoch.toString()],
		queryFn: async (): Promise<LockData | null> => {
			if (lockId === undefined) return null;
			const [lockAddress] = getLockPDA(lockId);
			const [protocolAddress] = getProtocolPDA();

			const [lock, protocol] = await Promise.all([
				vesolveAccount.lock(program).fetchNullable(lockAddress),
				vesolveAccount.protocol(program).fetchNullable(protocolAddress),
			]);
			if (!lock || !protocol) return null;

			return {
				address: lockAddress,
				owner: lock.owner,
				identifier: lock.veTokenId,
				lockNftMint: lock.veMint,
				lockTokenMint: protocol.tokenMint,
				tokenAmount: lock.amount,
				lockPower: lock.votingPower,
				unlockTime: lock.unlockTime,
				lastVoteEpoch: lock.lastVoteEpoch,
			};
		},
		enabled: lockId !== undefined,
		refetchInterval: poll(15_000),
		staleTime: 10_000,
	});
};
