import { poll } from "@/lib/poll";
import { useQuery } from "@tanstack/react-query";
import type BN from "bn.js";
import type { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import {
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
	type RawLock,
} from "@/hooks/useVesolveProgram";
import { useCluster } from "@/providers/ClusterProvider";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";

// Shaped to match what the (pre-existing) Lock/Vote UI components expect —
// mirrors @solve33/common's LockInfo field names, since that's what this UI
// was originally written against, even though the data now comes from the
// vesolve program's Lock account instead.
export type LockAccount = {
	address: PublicKey;
	owner: PublicKey;
	identifier: BN;
	lockNftMint: PublicKey;
	lockTokenMint: PublicKey;
	tokenAmount: BN;
	lockPower: BN;
	unlockTime: BN;
	// Whether this lock has already voted in the current epoch.
	used: boolean;
};

export const useLocks = () => {
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const { network } = useCluster();
	const { data: voteConfig } = useVoteConfig(network);

	return useQuery({
		// A lock's lastVoteEpoch is historical; "used" is only true when it
		// matches the current on-chain epoch. Refetch on rollover, not merely
		// when this page mounts or the wallet reconnects.
		queryKey: [
			"vesolve-locks",
			publicKey?.toBase58(),
			network,
			voteConfig?.epoch.toString(),
		],
		queryFn: async (): Promise<LockAccount[]> => {
			if (!publicKey) return [];

			const [protocolAddress] = getProtocolPDA();
			const [accounts, protocol] = await Promise.all([
				vesolveAccount.lock(program).all([
					{ memcmp: { offset: 8, bytes: publicKey.toBase58() } },
				]),
				vesolveAccount.protocol(program).fetchNullable(protocolAddress),
			]);

			return accounts.map(
				({
					publicKey: address,
					account,
				}: {
					publicKey: PublicKey;
					account: RawLock;
				}) => ({
					address,
					owner: account.owner,
					identifier: account.veTokenId,
					lockNftMint: account.veMint,
					lockTokenMint: protocol?.tokenMint ?? account.veMint,
					tokenAmount: account.amount,
					lockPower: account.votingPower,
					unlockTime: account.unlockTime,
					used: Boolean(
						protocol &&
							!account.lastVoteEpoch.isZero() &&
							account.lastVoteEpoch.eq(protocol.currentEpoch),
					),
				}),
			);
		},
		enabled: !!publicKey,
		refetchInterval: poll(15_000),
		staleTime: 10_000,
	});
};
