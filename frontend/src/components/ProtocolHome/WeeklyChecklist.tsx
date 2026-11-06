"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { WalletConnect } from "@/components/Wallet";
import { useVoteRewards } from "@/hooks/useVoteRewards";
import { useCluster } from "@/providers/ClusterProvider";
import { useLocks } from "@/stores/lock/hooks/useLocks";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import styles from "./EpochOverview.module.css";

export function WeeklyChecklist() {
	const { publicKey } = useWallet();
	return (
		<section aria-label="Your weekly checklist">
			<div className={styles.caption}>
				<h3>Your weekly checklist</h3>
				{!publicKey && <WalletConnect />}
			</div>
			{publicKey ? (
				<ConnectedChecklist />
			) : (
				<p>
					Connect your wallet to see your locks, this epoch’s voting status and
					claimable voter rewards.
				</p>
			)}
		</section>
	);
}

function ConnectedChecklist() {
	const { network } = useCluster();
	const config = useVoteConfig(network);
	const locks = useLocks();
	const rewards = useVoteRewards();
	const voted = locks.data?.filter((lock) => lock.used).length ?? 0;
	const eligible =
		rewards.data?.filter((row) =>
			[
				row.rewardAmount,
				row.poolRewardAmountA,
				row.poolRewardAmountB,
				...row.bribes.map((bribe) => bribe.amount),
			].some((amount) => !amount.isZero()),
		).length ?? 0;
	const locksReady = !locks.isError && locks.data !== undefined;
	const voteReady = locksReady && !config.isError && !!config.data;
	const lockStatus = locks.isError
		? "Unable to read locks"
		: !locksReady
			? "Checking locks…"
			: locks.data!.length
				? `${locks.data!.length} permanent lock(s) ready`
				: "Create your first permanent lock";
	const voteStatus =
		locks.isError || config.isError
			? "Unable to verify votes"
			: !voteReady
				? "Checking this epoch…"
				: !locks.data!.length
					? "A lock is required to vote"
					: `${voted} of ${locks.data!.length} locks voted in epoch ${config.data!.epoch}`;
	const claimStatus = rewards.isError
		? "Unable to read voter rewards"
		: !rewards.data
			? "Checking claimable voter rewards…"
			: eligible
				? `${eligible} gauge/epoch reward entries available`
				: "No claimable voter rewards found";
	return (
		<ol className={styles.journey} style={{ listStyle: "none", padding: 0 }}>
			<li>
				<Link href="/lock">
					<b>{locksReady && locks.data!.length ? "✓" : "01"} · Create a lock</b>
					<small>{lockStatus}</small>
				</Link>
			</li>
			<li>
				<Link href="/arena">
					<b>
						{voteReady && locks.data!.length > 0 && voted === locks.data!.length
							? "✓"
							: "02"}{" "}
						· Allocate your vote
					</b>
					<small>{voteStatus}</small>
				</Link>
			</li>
			<li>
				<Link href="/rewards">
					<b>03 · Claim available rewards</b>
					<small>{claimStatus}</small>
				</Link>
			</li>
		</ol>
	);
}
