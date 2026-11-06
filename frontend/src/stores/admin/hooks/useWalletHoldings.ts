import { DecimalUtil } from "@solve3fi/common";
import { getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { AIRDROP_TOKEN_MINT } from "@/configs/airdrop";
import {
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { useAnchor } from "@/providers/DappProvider";

export type WalletLockPosition = {
	address: string;
	veTokenId: number;
	amount: number;
	votingPower: number;
	usedToVote: boolean;
};

export type WalletHoldings = {
	solv3Balance: number;
	lockPositions: WalletLockPosition[];
	totalLockedAmount: number;
	totalVotingPower: number;
};

/**
 * Live SOLV3 (liquid) + veSOLV3 (locked, via vesolve Lock accounts) holdings
 * for an arbitrary Solana wallet — not just the connected one. Used by the
 * admin wallet-lookup and tokenomics-wallet sections.
 */
export const useWalletHoldings = (walletAddress: string | undefined) => {
	const program = useVesolveProgram();
	const { connection } = useAnchor();

	return useQuery({
		queryKey: ["admin-wallet-holdings", walletAddress],
		queryFn: async (): Promise<WalletHoldings> => {
			const owner = new PublicKey(walletAddress ?? "");

			const [mintInfo, locks] = await Promise.all([
				getMint(connection, AIRDROP_TOKEN_MINT).catch(() => null),
				vesolveAccount.lock(program).all([
					{ memcmp: { offset: 8, bytes: owner.toBase58() } },
				]),
			]);

			let solv3Balance = 0;
			if (mintInfo) {
				const ata = getAssociatedTokenAddressSync(AIRDROP_TOKEN_MINT, owner);
				const ataInfo = await connection.getAccountInfo(ata);
				if (ataInfo) {
					const balance = await connection.getTokenAccountBalance(ata);
					solv3Balance = balance.value.uiAmount ?? 0;
				}
			}

			const decimals = mintInfo?.decimals ?? 9;
			const lockPositions: WalletLockPosition[] = locks.map(
				({ publicKey, account }) => ({
					address: publicKey.toString(),
					veTokenId: account.veTokenId.toNumber(),
					amount: DecimalUtil.fromBN(account.amount, decimals).toNumber(),
					votingPower: DecimalUtil.fromBN(
						account.votingPower,
						decimals,
					).toNumber(),
					usedToVote: !account.lastVoteEpoch.isZero(),
				}),
			);

			const totalLockedAmount = lockPositions.reduce(
				(sum, p) => sum + p.amount,
				0,
			);
			const totalVotingPower = lockPositions.reduce(
				(sum, p) => sum + p.votingPower,
				0,
			);

			return { solv3Balance, lockPositions, totalLockedAmount, totalVotingPower };
		},
		enabled: (() => {
			if (!walletAddress) return false;
			try {
				new PublicKey(walletAddress);
				return true;
			} catch {
				return false;
			}
		})(),
		retry: false,
	});
};
