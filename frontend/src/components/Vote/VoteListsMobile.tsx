import { useLingui } from "@lingui/react";
import Link from "next/link";
import { AcceleratorBadge } from "@/components/Pool/AcceleratorBadge";
import { RewardEmissionApr } from "@/components/Reward/RewardEmissionApr";
import { useAcceleratedPools } from "@/hooks/useAcceleratedPools";
import { formatPercentage } from "@/lib/format";
import { votingPowerUnits, votingShare } from "@/lib/voteDisplay";
import { useCluster } from "@/providers/ClusterProvider";
import type { VoteInfo } from "@/stores/vote/hooks/useVotes";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { CurrencyLogo } from "../Token/CurrencyLogo";
import { TokenBalance } from "../Token/TokenBalance";
import classes from "./Vote.module.css";
import { estimateGaugeSolv3 } from "./voteEstimate";
import { VotePercentHandle } from "./VotePercentHandle";
import { BribesReward, units } from "./VoteReward";

/** One gauge per card; the layout is responsive, so desktop and phone share it. */
export const VoteListsMobile: React.FC<{
	records: VoteInfo[];
	disabled?: boolean;
}> = ({ records, disabled = false }) => {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const acceleratedPools = useAcceleratedPools(network);
	const { data: voteConfig } = useVoteConfig(network);
	const epoch = voteConfig?.epoch.toNumber() ?? 0;

	return (
		<div className={classes.gauges}>
			{records.map((record) => {
				const { tokenAInfo, tokenBInfo, feeTier, votes, total } = record;
				const share = votingShare(votes, total);
				const accelerated = acceleratedPools.get(record.getAddress().toString());
				const bribes = record.vote?.bribesInfos ?? [];
				const feeA = units(record.vote?.tradingFeesA, tokenAInfo.decimals);
				const feeB = units(record.vote?.tradingFeesB, tokenBInfo.decimals);
				const money = (value: number) =>
					value > 0 ? (
						<TokenBalance value={value} loading={false} prefix="$" />
					) : (
						"—"
					);

				return (
					<article
						key={record.getAddress().toString()}
						className={classes.gauge}
					>
						<div className={classes.gaugeHead}>
							<span className={classes.gaugeLogos}>
								<CurrencyLogo currency={tokenAInfo} size={40} />
								<CurrencyLogo currency={tokenBInfo} size={40} />
							</span>
							<div style={{ minWidth: 0 }}>
								<div className={classes.gaugeName}>
									{`${tokenAInfo.symbol}/${tokenBInfo.symbol}`}
									{accelerated && <AcceleratorBadge info={accelerated} />}
								</div>
								<div className={classes.gaugeMeta}>
									{formatPercentage(feeTier.fee / 10_000)} {i18n._("fee tier")} ·{" "}
									{i18n._("TVL")} {money(record.tvlUsd)}
								</div>
							</div>
						</div>

						<div className={classes.col}>
							<span className={classes.colLabel}>{i18n._("Votes")}</span>
							<span className={classes.colValue}>
								<TokenBalance
									value={share}
									loading={false}
									decimalScale={2}
									suffix="%"
								/>
							</span>
							<div className={classes.meter}>
								<div
									className={classes.meterFill}
									style={{ width: `${Math.min(100, share)}%` }}
								/>
							</div>
							<span className={classes.subtle}>
								<TokenBalance value={votingPowerUnits(votes)} loading={false} />{" "}
								veSOLV3
							</span>
						</div>

						<div className={classes.col}>
							<span className={classes.colLabel}>{i18n._("APR")}</span>
							<span className={`${classes.colValue} ${classes.cyan}`}>
								<RewardEmissionApr poolAddress={record.getAddress().toString()} />
							</span>
						</div>

						<div className={classes.col}>
							<span className={classes.colLabel}>{i18n._("Est. SOLV3")}</span>
							<span className={classes.colValue}>
								<TokenBalance
									value={epoch > 0 ? estimateGaugeSolv3(epoch, share) : undefined}
									loading={epoch === 0}
									decimalScale={0}
								/>
							</span>
						</div>

						<div className={`${classes.col} ${classes.voteCol}`}>
							<span className={classes.colLabel}>{i18n._("Your vote")}</span>
							<VotePercentHandle data={record} disabled={disabled} />
						</div>

						<div className={classes.rewards}>
							<div className={classes.col}>
								<span className={classes.colLabel}>{i18n._("Incentives")}</span>
								<span className={classes.colValue}>{money(record.bribesUsd)}</span>
								{bribes.length > 0 && <BribesReward data={bribes} />}
								<Link
									className={classes.link}
									href={`/bribes?pool=${record.getAddress().toString()}`}
								>
									{i18n._("Add incentives")} →
								</Link>
							</div>
							<div className={classes.col}>
								<span className={classes.colLabel}>{i18n._("Fees")}</span>
								<span className={classes.colValue}>{money(record.feesUsd)}</span>
								<span className={classes.subtle}>
									{feeA.toLocaleString("en-US", { maximumFractionDigits: 6 })}{" "}
									{tokenAInfo.symbol}
								</span>
								<span className={classes.subtle}>
									{feeB.toLocaleString("en-US", { maximumFractionDigits: 6 })}{" "}
									{tokenBInfo.symbol}
								</span>
							</div>
							<div className={classes.col}>
								<span className={classes.colLabel}>{i18n._("Total rewards")}</span>
								<span className={classes.colValue}>{money(record.rewardsUsd)}</span>
								<span className={classes.subtle}>{i18n._("Fees + incentives")}</span>
							</div>
						</div>
					</article>
				);
			})}
		</div>
	);
};
