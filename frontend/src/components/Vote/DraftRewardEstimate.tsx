"use client";

import { DecimalUtil } from "@solve3fi/common";
import type BN from "bn.js";
import Decimal from "decimal.js";
import { useCluster } from "@/providers/ClusterProvider";
import type { VoteState } from "@/stores/vote";
import { useUserVote } from "@/stores/vote/hooks/useUserVote";
import { useVote } from "@/stores/vote/hooks/useVote";
import classes from "./Vote.module.css";

export function DraftRewardEstimate({
	epoch,
	lockId,
	power,
	draft,
}: {
	epoch: number;
	lockId: number;
	power: BN;
	draft: VoteState[];
}) {
	const { network } = useCluster();
	const current = useUserVote(network, epoch, lockId);
	const weights = useVote(network, epoch);
	const ready =
		!current.isError &&
		!weights.isError &&
		current.data !== undefined &&
		weights.data !== undefined;
	return (
		<section
			className={classes.rules}
			aria-label="Draft voting reward estimate"
		>
			<div className={classes.rule}>
				<strong>Estimated share of funded voter rewards</strong>
				<p>
					Uses current epoch funding and replaces this lock’s prior weight.
					Other votes, new funding and applicable fees can change the final
					amount.
				</p>
				{!ready ? (
					<p>
						{current.isError || weights.isError
							? "Vote weights unavailable."
							: "Reading current vote weights…"}
					</p>
				) : (
					<ul>
						{draft
							.filter((item) => item.vote && item.votePercent > 0)
							.map((item) => {
								const gauge = item.vote!;
								const index =
									weights.data?.votePools.findIndex((key) =>
										key.equals(gauge.gauge),
									) ?? -1;
								const total = new Decimal(
									weights.data?.votePowers[index]?.toString() ?? 0,
								);
								const previous = new Decimal(
									current.data?.votes
										.find((entry) => entry.gauge.equals(gauge.gauge))
										?.weight.toString() ?? 0,
								);
								const next = new Decimal(power.toString())
									.mul(item.votePercent)
									.div(100)
									.floor();
								if (previous.gt(total))
									return (
										<li key={gauge.gauge.toString()}>
											Vote weights are updating. Check again shortly.
										</li>
									);
								const denominator = total.minus(previous).plus(next);
								const share = denominator.gt(0)
									? next.div(denominator)
									: new Decimal(0);
								const funded = [
									{
										raw: gauge.tradingFeesA,
										decimals: item.getTokenAInfo().decimals,
										symbol: item.tokenAInfo.symbol,
									},
									{
										raw: gauge.tradingFeesB,
										decimals: item.getTokenBInfo().decimals,
										symbol: item.tokenBInfo.symbol,
									},
									...gauge.bribesInfos.map((bribe) => ({
										raw: bribe.vaultInfo.amount,
										decimals: bribe.decimalsUnavailable
											? undefined
											: bribe.mintInfo.decimals,
										symbol: bribe.mintInfo.symbol,
									})),
								].filter(({ raw }) => !raw.isZero());
								return (
									<li key={gauge.gauge.toString()}>
										{item.tokenAInfo.symbol}/{item.tokenBInfo.symbol}:{" "}
										{share.mul(100).toFixed(2)}% ·{" "}
										{funded.length
											? funded
													.map(({ raw, decimals, symbol }) =>
														decimals === undefined
															? `${symbol} amount unavailable`
															: `${DecimalUtil.fromBN(raw, decimals).mul(share).toSignificantDigits(5).toString()} ${symbol}`,
													)
													.join(" + ")
											: "No fees or incentives funded yet"}
									</li>
								);
							})}
					</ul>
				)}
			</div>
		</section>
	);
}
