"use client";

import { DecimalUtil } from "@solve3fi/common";
import type { Solve } from "@solve3fi/sdk";
import Link from "next/link";
import { usePoolGaugeStatus } from "@/hooks/usePoolGaugeStatus";
import { useAllTokens } from "@/hooks/useToken";
import { useCluster } from "@/providers/ClusterProvider";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { useVote } from "@/stores/vote/hooks/useVote";
import { useVotes } from "@/stores/vote/hooks/useVotes";
import { PoolEpochHistory } from "./PoolEpochHistory";
import { FeeAprScenario } from "./FeeAprScenario";
import { PoolWeeklyEmissions } from "./PoolWeeklyEmissions";
import styles from "./PoolDetails.module.css";

const display = (value: number) =>
	value.toLocaleString("en-US", { maximumSignificantDigits: 7 });

export function PoolDetails({ pool }: { pool: Solve }) {
	const { network } = useCluster();
	const tokens = useAllTokens();
	const config = useVoteConfig(network);
	const epoch = config.data?.epoch.toNumber() ?? 0;
	const status = usePoolGaugeStatus(pool.getAddress());
	const weights = useVote(network, epoch);
	const gauges = useVotes(network, epoch);
	const gauge = gauges.data?.find((row) => row.pool.equals(pool.getAddress()));
	const data = pool.getData();
	const symbol = (mint: string) =>
		tokens[mint]?.symbol ?? `${mint.slice(0, 4)}…`;
	const pair = `${symbol(data.tokenMintA.toBase58())} / ${symbol(data.tokenMintB.toBase58())}`;
	const active = status.data?.isActive;
	const index = gauge
		? (weights.data?.votePools.findIndex((key) => key.equals(gauge.gauge)) ??
			-1)
		: -1;
	const share =
		weights.data && gauge
			? weights.data.votes.isZero()
				? 0
				: (Number(weights.data.votePowers[index]?.toString() ?? 0) /
						Number(weights.data.votes.toString())) *
					100
			: undefined;
	const gaugeLabel = status.isError
		? "Gauge status unavailable"
		: !status.data
			? "Reading gauge…"
			: ({
					0: "Created",
					1: "Activation pending",
					2: "Active",
					3: "Removal pending",
					4: "Removed",
				}[status.data.status ?? -1] ?? "No gauge");
	const depositHref = `/liquidity/create?currencyA=${data.tokenMintA}&currencyB=${data.tokenMintB}&pool=manual&fee=${data.feeRate}`;
	const lpShare = (10000 - data.protocolFeeRate) / 100;
	const fees = gauge
		? ([
				[
					DecimalUtil.fromBN(
						gauge.tradingFeesA,
						pool.getTokenAInfo().decimals,
					).toNumber(),
					symbol(data.tokenMintA.toBase58()),
				],
				[
					DecimalUtil.fromBN(
						gauge.tradingFeesB,
						pool.getTokenBInfo().decimals,
					).toNumber(),
					symbol(data.tokenMintB.toBase58()),
				],
			] as const)
		: [];
	return (
		<div className={styles.root}>
			<h2>{pair}</h2>
			<p>
				{data.feeRate / 10000}% swap fee · {gaugeLabel}
			</p>
			<small className={styles.address}>
				Pool {pool.getAddress().toBase58()}
			</small>
			<h3>{config.data ? `Epoch ${epoch}` : "Epoch unavailable"}</h3>
			<dl className={styles.metrics}>
				<div>
					<dt>Current vote share · next epoch’s allocation</dt>
					<dd>{share === undefined ? "—" : `${display(share)}%`}</dd>
				</div>
				<div>
					<dt>Current weekly LP emissions allocation</dt>
					<dd>
						<PoolWeeklyEmissions pool={pool} />
					</dd>
				</div>
				<div>
					<dt>Funded voter fees · current epoch</dt>
					<dd>
						{fees.length
							? fees
									.map(([amount, name]) => `${display(amount)} ${name}`)
									.join(" + ")
							: "—"}
					</dd>
				</div>
				<div>
					<dt>Funded voting incentives · current epoch</dt>
					<dd>
						{gauge
							? gauge.bribesInfos
									.filter((bribe) => !bribe.vaultInfo.amount.isZero())
									.map(
										(bribe) =>
											`${bribe.decimalsUnavailable ? "Amount unavailable" : display(DecimalUtil.fromBN(bribe.vaultInfo.amount, bribe.mintInfo.decimals).toNumber())} ${symbol(bribe.mint.toBase58())}`,
									)
									.join(" + ") || "None funded"
							: "—"}
					</dd>
				</div>
			</dl>
			<section aria-label="How earnings work" className={styles.earnings}>
				<h3>How earnings work in this pool</h3>
				{!status.data ? (
					<p>Fee routing is unavailable until gauge status can be read.</p>
				) : active ? (
					<>
						<div>
							<b>Provide liquidity</b>
							<span aria-hidden="true">↓</span>
							<p>
								Earn this pool’s allocated SOLV3 emissions through your eligible
								liquidity position.
							</p>
						</div>
						<div>
							<b>Lock SOLV3 & vote for this gauge</b>
							<span aria-hidden="true">↓</span>
							<p>Earn your share of trading fees + funded voting incentives.</p>
						</div>
						<small>
							Voting rewards become claimable the following epoch. Amounts
							depend on participation and available rewards.
						</small>
					</>
				) : (
					<div>
						<b>Provide liquidity</b>
						<span aria-hidden="true">↓</span>
						<p>
							{lpShare}% of swap fees accrue to LPs. The remaining{" "}
							{data.protocolFeeRate / 100}% follows the pool’s protocol fee
							policy.
						</p>
						<small>Gauge voter rewards require an active gauge.</small>
					</div>
				)}
			</section>
			{status.data && !status.isError && !active && <FeeAprScenario pool={pool} />}
			<nav className={styles.actions} aria-label="Pool actions">
				<Link href={depositHref}>Provide liquidity</Link>
				{active && <Link href="/arena">Compare & vote</Link>}
			</nav>
			{epoch > 1 && status.data?.status != null && <PoolEpochHistory pool={pool} epoch={epoch} />}
		</div>
	);
}
