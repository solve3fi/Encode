"use client";

import { DecimalUtil } from "@solve3fi/common";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { EpochClock } from "@/components/EpochClock";
import { PoolWeeklyEmissions } from "@/components/Liquidity/PoolWeeklyEmissions";
import { SOLVE } from "@/configs/tokens";
import { useAllTokens } from "@/hooks/useToken";
import {
	getEpochEmissionPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { useCluster } from "@/providers/ClusterProvider";
import { usePools } from "@/stores/pool/hooks/usePools";
import { useVote } from "@/stores/vote/hooks/useVote";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { useVotes } from "@/stores/vote/hooks/useVotes";
import { EpochHistory } from "./EpochHistory";
import { WeeklyChecklist } from "./WeeklyChecklist";
import styles from "./EpochOverview.module.css";

const amount = (value: number) =>
	value.toLocaleString("en-US", { maximumSignificantDigits: 8 });

export const EpochJourney = WeeklyChecklist;

export function EpochOverview() {
	const { network } = useCluster();
	const program = useVesolveProgram();
	const tokens = useAllTokens();
	const symbol = (mint: string) =>
		tokens[mint]?.symbol ?? `${mint.slice(0, 4)}…`;
	const config = useVoteConfig(network);
	const epoch = config.data?.epoch.toNumber() ?? 0;
	const weights = useVote(network, epoch);
	const gauges = useVotes(network, epoch);
	const pools = usePools(
		network,
		gauges.data?.map((gauge) => gauge.pool.toBase58()) ?? [],
	);
	const emissions = useQuery({
		queryKey: ["protocol-home-emissions", network, epoch],
		enabled: epoch > 0,
		queryFn: () =>
			vesolveAccount
				.epochEmission(program)
				.fetchNullable(getEpochEmissionPDA(epoch)[0]),
		refetchInterval: 15_000,
	});
	const total = weights.data?.votes;
	const gaugeRows = gauges.data
		?.map((gauge) => {
			const pool = pools.data?.find((item) =>
				item.getAddress().equals(gauge.pool),
			);
			const index =
				weights.data?.votePools.findIndex((key) => key.equals(gauge.gauge)) ??
				-1;
			const weight = weights.data?.votePowers[index];
			const share = total
				? total.isZero()
					? 0
					: (Number(weight?.toString() ?? 0) / Number(total.toString())) * 100
				: undefined;
			return { gauge, pool, share };
		})
		.sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
	const error =
		config.isError ||
		weights.isError ||
		gauges.isError ||
		pools.isError ||
		emissions.isError;

	return (
		<section
			id="this-epoch"
			className={styles.board}
			aria-labelledby="epoch-title"
		>
			<div className={styles.masthead}>
				<div>
					<small>VE(3,3) / SOLVE3</small>
					<h2 id="epoch-title">This epoch</h2>
				</div>
				<EpochClock variant="inline" />
			</div>
			<div className={styles.totals}>
				<div>
					<small>Gauge emissions budget · current epoch</small>
					<strong>
						{emissions.data
							? `${amount(DecimalUtil.fromBN(emissions.data.gaugeBudget, SOLVE.decimals).toNumber())} SOLV3`
							: "—"}
					</strong>
				</div>
				<div>
					<small>Voting power cast · current vote</small>
					<strong>
						{total
							? `${amount(DecimalUtil.fromBN(total, SOLVE.decimals).toNumber())} veSOLV3`
							: "—"}
					</strong>
				</div>
			</div>
			<EpochJourney />
			<div className={styles.caption}>
				<h3>Where votes are going</h3>
				<Link href="/arena">Open the Arena →</Link>
			</div>
			<p>
				These votes direct next epoch’s emissions. Active gauges route trading
				fees to voters, and LPs earn allocated SOLV3 emissions.
			</p>
			{error && (
				<p role="status">
					Some on-chain data is unavailable. Missing values appear as a dash.
				</p>
			)}
			{!error && !gaugeRows && (
				<p role="status">
					{config.isFetched && !config.data
						? "No protocol epoch is available."
						: "Reading active gauges…"}
				</p>
			)}
			{gaugeRows?.length === 0 && <p>No active gauges this epoch.</p>}
			{gaugeRows?.map(({ gauge, pool, share }) => {
				const incentives = gauge.bribesInfos.filter(
					(bribe) => !bribe.vaultInfo.amount.isZero(),
				);
				const tokenA = pool?.getTokenAInfo();
				const tokenB = pool?.getTokenBInfo();
				const fees =
					tokenA && tokenB
						? ([
								[gauge.tradingFeesA, tokenA],
								[gauge.tradingFeesB, tokenB],
							] as const)
						: [];
				return (
					<article className={styles.gauge} key={gauge.gauge.toBase58()}>
						<div>
							<b>
								{tokenA && tokenB
									? `${symbol(tokenA.mint.toBase58())} / ${symbol(tokenB.mint.toBase58())}`
									: gauge.pool.toBase58().slice(0, 8)}
							</b>
							<small>Active gauge</small>
							{pool && (
								<Link
									href={`/liquidity/create?currencyA=${pool.getData().tokenMintA}&currencyB=${pool.getData().tokenMintB}&pool=manual&fee=${pool.getData().feeRate}`}
								>
									Provide liquidity
								</Link>
							)}
						</div>
						<div>
							<strong>{share === undefined ? "—" : `${amount(share)}%`}</strong>
							<small>Vote share</small>
							<div className={styles.track} aria-hidden="true">
								<span style={{ width: `${Math.min(100, share ?? 0)}%` }} />
							</div>
						</div>
						<div>
							<small>Current LP emissions</small>
							{pool ? <PoolWeeklyEmissions pool={pool} /> : "—"}
						</div>
						<div>
							<small>Funded voter fees</small>
							{fees.length
								? fees
										.map(
											([raw, token]) =>
												`${amount(DecimalUtil.fromBN(raw, token.decimals).toNumber())} ${symbol(token.mint.toBase58())}`,
										)
										.join(" + ")
								: "—"}
						</div>
						<div>
							<small>Voting incentives</small>
							{incentives.length
								? incentives
										.map((bribe) =>
											bribe.decimalsUnavailable
												? `${tokens[bribe.mint.toBase58()]?.symbol ?? bribe.mintInfo.symbol} (amount unavailable)`
												: `${amount(DecimalUtil.fromBN(bribe.vaultInfo.amount, bribe.mintInfo.decimals).toNumber())} ${tokens[bribe.mint.toBase58()]?.symbol ?? bribe.mintInfo.symbol}`,
										)
										.join(" + ")
								: "None funded"}
						</div>
					</article>
				);
			})}
		{epoch > 0 && <EpochHistory currentEpoch={epoch} />}
		</section>
	);
}
