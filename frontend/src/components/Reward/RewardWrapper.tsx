"use client";

import { useLingui } from "@lingui/react";
import { DecimalUtil } from "@solve3fi/common";
import BN from "bn.js";
import { useMemo } from "react";
import { SOLVE } from "@/configs/tokens";
import { useTokens } from "@/hooks/useToken";
import { useTotalClaimableRewards } from "@/hooks/useTotalClaimableRewards";
import { useUSDCPrice } from "@/hooks/useUSDCPrice";
import { useVoteRewards } from "@/hooks/useVoteRewards";
import { useCluster } from "@/providers/ClusterProvider";
import { useLocks } from "@/stores/lock/hooks/useLocks";
import { RewardMethods } from "@/stores/reward";
import { useReward } from "@/stores/reward/RewardProvider";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { ProtocolMetrics } from "../ProtocolMetrics";
import { WalletSummary } from "./WalletSummary";
import { TokenBalance } from "../Token/TokenBalance";
import classes from "./Reward.module.css";
import { RewardClaimLockMerge } from "./RewardClaimLockMerge";
import { RewardClaimToken } from "./RewardClaimToken";
import { RewardFilter } from "./RewardFilter";
import { RewardLists } from "./RewardLists";
import { RewardMethod } from "./RewardMethod";
import { RewardVoteLists } from "./RewardVoteLists";

export const RewardWrapper: React.FC<{ wallet?: boolean }> = ({ wallet = false }) => {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const method = useReward((state) => state.method);
	const { data: voteConfig } = useVoteConfig(network);
	const { data: locks } = useLocks();

	const { amountsByMint: lpAmounts, isLoading: lpLoading } =
		useTotalClaimableRewards();
	const { data: voteRows, isLoading: voteLoading } = useVoteRewards();
	const rewardsLoading = lpLoading || voteLoading;
	// "Claim All Rewards" claims liquidity fees/emissions AND every claimable voting reward, so the headline
	// total counts both. Voting fees and bribes are shown net of the Auto-Vote fee the program takes on them;
	// the SOLV3 emission share carries no fee.
	const amountsByMint = useMemo(() => {
		const merged: Record<string, BN> = { ...lpAmounts };
		const add = (mint: string, amount: BN) => {
			if (amount.isZero()) return;
			merged[mint] = (merged[mint] ?? new BN(0)).add(amount);
		};
		const net = (amount: BN, feeBps: number) =>
			amount.muln(10_000 - feeBps).divn(10_000);
		for (const row of voteRows ?? []) {
			add(row.rewardMint.toString(), row.rewardAmount);
			add(
				row.tokenMintA.toString(),
				net(row.poolRewardAmountA, row.autoVoteFeeBps),
			);
			add(
				row.tokenMintB.toString(),
				net(row.poolRewardAmountB, row.autoVoteFeeBps),
			);
			for (const bribe of row.bribes)
				add(bribe.mint.toString(), net(bribe.amount, row.autoVoteFeeBps));
		}
		return merged;
	}, [lpAmounts, voteRows]);
	const mints = Object.keys(amountsByMint);
	const tokens = useTokens(mints);

	const priceAddresses = useMemo(() => {
		const addresses: Record<string, number> = {};
		mints.forEach((mint, index) => {
			const decimals = tokens?.[index]?.decimals;
			if (typeof decimals !== "number") return;
			addresses[mint] = DecimalUtil.fromBN(
				amountsByMint[mint],
				decimals,
			).toNumber();
		});
		return addresses;
		// biome-ignore lint/correctness/useExhaustiveDependencies: mints derives from amountsByMint.
	}, [amountsByMint, tokens]);

	const {
		totalUsdcValue,
		isLoading: pricesLoading,
		isComplete,
	} = useUSDCPrice(priceAddresses);
	const claimableReady =
		isComplete &&
		mints.every(
			(mint, index) => amountsByMint[mint].isZero() || tokens?.[index],
		);

	const lpEmissions = lpAmounts[SOLVE.address]
		? DecimalUtil.fromBN(lpAmounts[SOLVE.address], SOLVE.decimals).toNumber()
		: 0;
	// Votes cast this epoch settle at N+1: locks that already voted in the current epoch.
	const votedLocks = (locks ?? []).filter((lock) => lock.used).length;

	return (
		<div className={classes.page}>
			<header className={classes.head}>
				<h1>{wallet ? "Wallet" : i18n._("Rewards")}</h1>
				<p>
					{wallet ? "Your balances, liquidity positions and locks, and everything you can claim." : i18n._(
						"Liquidity positions earn LP fees or SOLV3 emissions according to the pool. Voting locks earn funded trading fees and voting incentives from the gauges they backed.",
					)}
				</p>
			</header>

			{!wallet && <ProtocolMetrics />}

			<div className={classes.summary}>
				<div className={`${classes.tile} ${classes.primaryTile}`}>
					<span className={classes.eyebrow}>
						{i18n._("Total claimable rewards")}
					</span>
					<span className={classes.big}>
						<TokenBalance
							value={claimableReady ? totalUsdcValue.toNumber() : undefined}
							loading={rewardsLoading || pricesLoading}
							prefix="$"
						/>
					</span>
					<span className={classes.sub}>
						{i18n._(
							"Liquidity fees and emissions plus claimable voting rewards.",
						)}
					</span>
					<RewardClaimToken />
					<RewardClaimLockMerge />
				</div>
				<div className={classes.tile}>
					<span className={classes.eyebrow}>
						{i18n._("Pending (settles at N+1)")}
					</span>
					<span className={classes.big}>
						{votedLocks}{" "}
						<small>
							{votedLocks === 1 ? i18n._("lock voted") : i18n._("locks voted")}
						</small>
					</span>
					<span className={classes.sub}>
						{voteConfig
							? i18n._("Votes from epoch {epoch} claim from epoch {claim}.", {
									epoch: voteConfig.epoch.toNumber(),
									claim: voteConfig.epoch.toNumber() + 1,
								})
							: i18n._("Votes from the current epoch.")}
					</span>
				</div>
				<div className={classes.tile}>
					<span className={classes.eyebrow}>{i18n._("LP emissions")}</span>
					<span className={classes.big}>
						<TokenBalance
							value={lpEmissions}
							loading={rewardsLoading}
							decimalScale={2}
						/>{" "}
						<small>SOLV3</small>
					</span>
					<span className={classes.sub}>
						{i18n._("SOLV3 from your pool positions.")}
					</span>
				</div>
			</div>

			{wallet && <WalletSummary />}

			<div className={classes.controls}>
				<RewardMethod />
				<div className={classes.search}>
					<RewardFilter />
				</div>
			</div>

			{method === RewardMethods.LIQUIDITY ? (
				<RewardLists />
			) : (
				<RewardVoteLists />
			)}
		</div>
	);
};
