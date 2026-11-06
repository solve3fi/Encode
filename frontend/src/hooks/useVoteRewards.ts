import { poll } from "@/lib/poll";
import { useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import BN from "bn.js";
import {
	getEpochPDA,
	getLockPDA,
	getProtocolPDA,
	getPartnerVoterPDA,
	getUserBribeRewardsPDA,
	getUserPoolRewardsPDA,
	getUserRewardsPDA,
	getUserVotePDA,
	getVoteLockRecordPDA,
	getVaultPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { useCluster } from "@/providers/ClusterProvider";
import {
	AUTO_VOTE_FEE_BPS,
	isPartnerVoterExempt,
	lastClaimableVoteEpoch,
	voteRewardFeeBps,
} from "@/lib/voteRewardPolicy";

export type ClaimableBribe = { mint: PublicKey; amount: BN };

// One row per (epoch, gauge) a connected lock voted for and hasn't fully
// claimed yet -- only gauges are represented here (claim_reward/
// claim_pool_reward/claim_bribe_reward are all gauge-scoped; there's no
// per-pool voting reward for a pool without a gauge).
export type ClaimableVoteReward = {
	key: string;
	epoch: number;
	epochAddress: PublicKey;
	gauge: PublicKey;
	poolAddress: PublicKey;
	tokenMintA: PublicKey;
	tokenMintB: PublicKey;
	rewardMint: PublicKey;
	veTokenId: number;
	rewardAmount: BN;
	poolRewardAmountA: BN;
	poolRewardAmountB: BN;
	bribes: ClaimableBribe[];
	/** Auto-vote fee the program takes from this lock's trading-fee and bribe claims (0 when not enrolled). */
	autoVoteFeeBps: number;
	/** Canonical flag for the wallet that cast this vote, passed to fee claims. */
	partnerVoter: PublicKey;
};

/** AUTO_VOTE_FEE_BPS in the vesolve program: 15% of an enrolled lock's trading-fee and bribe claims. */
export { AUTO_VOTE_FEE_BPS };

async function fetchInBatches<T>(
	addresses: PublicKey[],
	fetch: (batch: PublicKey[]) => Promise<T[]>,
): Promise<T[]> {
	const results: T[] = [];
	for (let i = 0; i < addresses.length; i += 100)
		results.push(...(await fetch(addresses.slice(i, i + 100))));
	return results;
}

/**
 * Every unclaimed voting reward (SOLV3 emission share, swept trading fees,
 * third-party bribes) a connected wallet's locks have earned from voting,
 * across every epoch old enough to be claimable
 * (Epoch::voting_rewards_claimable -- when the next epoch begins).
 * Distinct from LP-side fees/emissions (useTotalClaimableRewards) --
 * this is the voter's share, not the liquidity provider's.
 */
export const useVoteRewards = () => {
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const { network } = useCluster();

	return useQuery({
		queryKey: ["vesolve-vote-rewards", publicKey?.toBase58(), network],
		queryFn: async (): Promise<ClaimableVoteReward[]> => {
			if (!publicKey) return [];

			const [protocolAddress] = getProtocolPDA();
			const [protocol, locks, claimedRewards, claimedPoolRewards] =
				await Promise.all([
					vesolveAccount.protocol(program).fetchNullable(protocolAddress),
					vesolveAccount
						.lock(program)
						.all([{ memcmp: { offset: 8, bytes: publicKey.toBase58() } }]),
					vesolveAccount
						.claimedRewards(program)
						.all([{ memcmp: { offset: 8, bytes: publicKey.toBase58() } }]),
					vesolveAccount
						.claimedPoolRewards(program)
						.all([{ memcmp: { offset: 8, bytes: publicKey.toBase58() } }]),
				]);

			if (!protocol || locks.length === 0) return [];
			const currentEpoch = protocol.currentEpoch.toNumber();

			// Votes and claims are per lock: look up each owned lock's vote record
			// for every epoch old enough to be claimable.
			const lastClaimableEpoch = lastClaimableVoteEpoch(currentEpoch);
			if (lastClaimableEpoch < 0) return [];
			const voteSlots = locks.flatMap(({ account }) => {
				const veTokenId = account.veTokenId.toNumber();
				const [lockAddress] = getLockPDA(veTokenId);
				return Array.from({ length: lastClaimableEpoch + 1 }, (_, epoch) => ({
					veTokenId,
					lockAddress,
					epoch,
					address: getUserVotePDA(lockAddress, epoch)[0],
				}));
			});
			const [voteAccounts, voteRecords] = await Promise.all([
				fetchInBatches(
					voteSlots.map((slot) => slot.address),
					(batch) => vesolveAccount.userVote(program).fetchMultiple(batch),
				),
				fetchInBatches(
					voteSlots.map(
						(slot) => getVoteLockRecordPDA(slot.lockAddress, slot.epoch)[0],
					),
					(batch) =>
						vesolveAccount.voteLockRecord(program).fetchMultiple(batch),
				),
			]);
			const claimableVotes = voteSlots.flatMap((slot, i) => {
				const userVote = voteAccounts[i];
				const voteRecord = voteRecords[i];
				if (
					userVote &&
					(!voteRecord ||
						!voteRecord.lock.equals(slot.lockAddress) ||
						voteRecord.epoch.toNumber() !== slot.epoch ||
						voteRecord.veTokenId.toNumber() !== slot.veTokenId)
				)
					throw new Error("Unable to verify the wallet that cast this vote");
				return userVote && userVote.epoch.toNumber() === slot.epoch
					? [{ ...slot, userVote, voter: voteRecord!.user }]
					: [];
			});

			const claimedRewardKeys = new Set(
				claimedRewards.map(({ publicKey: key }) => key.toBase58()),
			);
			const claimedPoolRewardAccounts = new Map(
				claimedPoolRewards.map(
					({ publicKey: key, account }) => [key.toBase58(), account] as const,
				),
			);

			if (claimableVotes.length === 0) return [];

			const epochNumbers = [
				...new Set(claimableVotes.map((entry) => entry.epoch)),
			];
			const epochEntries = await Promise.all(
				epochNumbers.map(async (epochNumber) => {
					const [epochAddress] = getEpochPDA(epochNumber);
					const epochAccount = await vesolveAccount
						.epoch(program)
						.fetchNullable(epochAddress);
					return [epochNumber, { epochAddress, epochAccount }] as const;
				}),
			);
			const epochByNumber = new Map(epochEntries);

			const voters = [
				...new Map(
					claimableVotes.map(({ voter }) => [voter.toBase58(), voter]),
				).values(),
			];
			const flags = await fetchInBatches(
				voters.map((voter) => getPartnerVoterPDA(voter)[0]),
				(batch) => program.provider.connection.getMultipleAccountsInfo(batch),
			);
			const exemptVoters = new Set(
				voters
					.filter((voter, i) =>
						isPartnerVoterExempt(flags[i], voter, program.programId),
					)
					.map((voter) => voter.toBase58()),
			);

			const rows: ClaimableVoteReward[] = [];
			for (const {
				userVote,
				voter,
				veTokenId,
				lockAddress,
				epoch: epochNumber,
			} of claimableVotes) {
				const epochEntry = epochByNumber.get(epochNumber);
				if (!epochEntry?.epochAccount) continue;
				const { epochAddress, epochAccount } = epochEntry;

				for (const vote of userVote.votes) {
					if (vote.weight.isZero()) continue;
					const gaugeWeight = epochAccount.gaugeWeights.find((gw) =>
						gw.gauge.equals(vote.gauge),
					);
					if (!gaugeWeight || gaugeWeight.weight.isZero()) continue;

					const gaugeAccount = await vesolveAccount
						.gauge(program)
						.fetchNullable(vote.gauge);
					if (!gaugeAccount) continue;

					const [vaultAddress] = getVaultPDA(epochNumber, vote.gauge);
					const vault = await vesolveAccount
						.vault(program)
						.fetchNullable(vaultAddress);

					const [userRewardsPDA] = getUserRewardsPDA(
						lockAddress,
						epochAddress,
						vote.gauge,
					);
					const [userPoolRewardsPDA] = getUserPoolRewardsPDA(
						lockAddress,
						epochAddress,
						vote.gauge,
					);
					const alreadyClaimedReward = claimedRewardKeys.has(
						userRewardsPDA.toBase58(),
					);
					const poolClaim = claimedPoolRewardAccounts.get(
						userPoolRewardsPDA.toBase58(),
					);

					const share = (amount: BN) =>
						amount.mul(vote.weight).div(gaugeWeight.weight);
					const feeBps = voteRewardFeeBps(
						userVote.user,
						voter,
						exemptVoters.has(voter.toBase58()),
					);
					// Same rounding as the program: fee = floor(claimable * bps / 10000).
					const net = (amount: BN) =>
						amount.sub(amount.muln(feeBps).divn(10_000));

					const rewardAmount =
						!alreadyClaimedReward && vault && vault.rewards.gt(new BN(0))
							? share(vault.rewards)
							: new BN(0);
					const poolRewardAmountA =
						!poolClaim?.claimedA && vault
							? net(share(vault.poolRewardsA))
							: new BN(0);
					const poolRewardAmountB =
						!poolClaim?.claimedB && vault
							? net(share(vault.poolRewardsB))
							: new BN(0);

					const bribes: ClaimableBribe[] = [];
					for (const bribe of epochAccount.bribes) {
						if (!bribe.gauge.equals(vote.gauge)) continue;
						const [userBribePDA] = getUserBribeRewardsPDA(
							lockAddress,
							epochAddress,
							vote.gauge,
							bribe.tokenMint,
						);
						// Bribe claims reuse the ClaimedRewards struct/set --
						// disambiguated by PDA address, not content.
						if (claimedRewardKeys.has(userBribePDA.toBase58())) continue;
						const amount = net(share(bribe.amount));
						if (amount.isZero()) continue;
						bribes.push({ mint: bribe.tokenMint, amount });
					}

					if (
						rewardAmount.isZero() &&
						poolRewardAmountA.isZero() &&
						poolRewardAmountB.isZero() &&
						bribes.length === 0
					) {
						continue;
					}

					rows.push({
						key: `${veTokenId}-${epochNumber}-${vote.gauge.toBase58()}`,
						epoch: epochNumber,
						epochAddress,
						gauge: vote.gauge,
						poolAddress: gaugeAccount.poolAddress,
						tokenMintA: gaugeAccount.tokenMintA,
						tokenMintB: gaugeAccount.tokenMintB,
						rewardMint: protocol.tokenMint,
						veTokenId,
						rewardAmount,
						poolRewardAmountA,
						poolRewardAmountB,
						bribes,
						autoVoteFeeBps: feeBps,
						partnerVoter: getPartnerVoterPDA(voter)[0],
					});
				}
			}

			return rows;
		},
		enabled: !!publicKey,
		refetchInterval: poll(30_000),
	});
};
