import { DecimalUtil } from "@solve3fi/common";
import { getMint } from "@solana/spl-token";
import { useQuery } from "@tanstack/react-query";
import BN from "bn.js";
import {
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { useAnchor } from "@/providers/DappProvider";

/**
 * Protocol-wide lock stats: how many veSOLV3 positions (Lock accounts)
 * exist, and how many of those have cast at least one vote — computed by
 * enumerating every Lock account on-chain, not a placeholder.
 */
export const useLockStats = () => {
	const program = useVesolveProgram();
	const { connection } = useAnchor();

	return useQuery({
		queryKey: ["vesolve-lock-stats"],
		queryFn: async () => {
			const [protocolAddress] = getProtocolPDA();
			const [protocol, locks] = await Promise.all([
				vesolveAccount.protocol(program).fetchNullable(protocolAddress),
				vesolveAccount.lock(program).all(),
			]);

			const totalLocked = locks.length;
			const usedToVote = locks.filter(
				({ account }) => !account.lastVoteEpoch.isZero(),
			).length;

			let totalLockedAmount = 0;
			if (protocol) {
				const mintInfo = await getMint(connection, protocol.tokenMint).catch(
					() => null,
				);
				const total = locks.reduce(
					(sum, { account }) => sum.add(account.amount),
					new BN(0),
				);
				totalLockedAmount = DecimalUtil.fromBN(
					total,
					mintInfo?.decimals ?? 9,
				).toNumber();
			}

			return { totalLocked, usedToVote, totalLockedAmount };
		},
	});
};
