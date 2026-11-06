"use client";

import { useLingui } from "@lingui/react";
import { Drawer, Button, NumberFormatter } from "@mantine/core";
import { DecimalUtil, Percentage } from "@solve3fi/common";
import type { Solve } from "@solve3fi/sdk";
import BN from "bn.js";
import sortBy from "lodash/sortBy";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
	GENESIS_PUBLIC_ENABLED,
	isGenesisRestrictedTokenMint,
} from "@/configs/genesis";
import { DEX_ONLY } from "@/configs/launchPhase";
import { STOCK_ASSETS } from "@/configs/stockAssets";
import { useAcceleratedPools } from "@/hooks/useAcceleratedPools";
import { useAllPools } from "@/hooks/useAllPools";
import { useLpIncentives } from "@/hooks/useLpIncentives";
import { usePools } from "@/hooks/usePools";
import { useAllTokens } from "@/hooks/useToken";
import { formatAddress } from "@/lib/format";
import { filterStockPools } from "@/lib/stockPools";
import { useChainId, useCluster } from "@/providers/ClusterProvider";
import { LiquidityTypes } from "@/stores/liquidity";
import { useLiquidity } from "@/stores/liquidity/LiquidityProvider";
import { AcceleratorBadge } from "../Pool/AcceleratorBadge";
import { RewardEmissionApr } from "../Reward/RewardEmissionApr";
import { CurrencyLogo } from "../Token/CurrencyLogo";
import { TokenBalance } from "../Token/TokenBalance";
import { TokenPrice } from "../Token/TokenPrice";
import { LiquidityDataWrapper } from "./LiquidityDataWrapper";
import classes from "./LiquidityTable.module.css";
import { PoolBonusApr } from "./PoolBonusApr";
import { usePoolGaugeStatus } from "@/hooks/usePoolGaugeStatus";
import { PoolDetails } from "./PoolDetails";
import { PoolFeeShare } from "./PoolFeeShare";
import { PoolWeeklyEmissions } from "./PoolWeeklyEmissions";
import { TokenSocialBadges } from "./TokenSocialBadges";

export const filterPositions = (
	pools: Solve[] | undefined,
	type: string,
) => {
	return pools?.filter((position: Solve) => {
		if (
			isGenesisRestrictedTokenMint(position.getData().tokenMintA.toString()) ||
			isGenesisRestrictedTokenMint(position.getData().tokenMintB.toString())
		)
			return false;
		// "all", or one fee tier expressed as its on-chain feeRate.
		if (type !== LiquidityTypes.ALL) {
			return position.getData().feeRate === Number(type);
		}

		return true;
	});
};

export const filterBySearch = (
	pools: Solve[] | undefined,
	search: string,
	tokenMap: ReturnType<typeof useAllTokens>,
) => {
	const query = search.trim().toLowerCase();
	if (!query) return pools;
	return pools?.filter((position: Solve) => {
		const data = position.getData();
		const mintA = data.tokenMintA.toString();
		const mintB = data.tokenMintB.toString();
		const symbolA = tokenMap[mintA]?.symbol ?? "";
		const symbolB = tokenMap[mintB]?.symbol ?? "";
		return (
			`${symbolA}/${symbolB}`.toLowerCase().includes(query) ||
			mintA.toLowerCase().includes(query) ||
			mintB.toLowerCase().includes(query)
		);
	});
};

export type LiquidityListsProps = {
	type: string;
	stocksOnly?: boolean;
};

export const LiquidityLists: React.FC<LiquidityListsProps> = ({
	type,
	stocksOnly = false,
}) => {
	const { i18n } = useLingui();
	const [selectedPool, setSelectedPool] = useState<Solve | null>(null);
	const { network } = useCluster();
	const acceleratedPools = useAcceleratedPools(network);
	const chainId = useChainId();
	const tokenMap = useAllTokens();
	const filter = useLiquidity((state) => state.filter);
	const { data: allPools, isLoading: poolsLoading, isError: discoveryFailed, refetch: retryDiscovery } = useAllPools();
	const { data: pools, isLoading: positionsLoading, isError: poolReadFailed, refetch: retryPools } = usePools(allPools);
	const loadFailed = discoveryFailed || poolReadFailed;
	const loading = poolsLoading || positionsLoading;
	const { hasActive: hasIncentives } = useLpIncentives();
	// Gauge-driven columns are hidden for the DEX-only soft launch (no
	// emissions flow before veSOLV3 voting opens); the bonus column shows only
	// while at least one pool is enrolled in the LP incentive.
	const showGauge = !DEX_ONLY && !GENESIS_PUBLIC_ENABLED;
	const gridTemplate = [
		"minmax(250px, 2.2fr)",
		...(showGauge ? ["minmax(110px, 0.9fr)"] : []),
		...(hasIncentives ? ["minmax(110px, 0.9fr)"] : []),
		"minmax(170px, 1.5fr)",
		...(showGauge ? ["minmax(130px, 1fr)"] : []),
		"minmax(100px, 0.9fr)",
		"minmax(100px, 0.9fr)",
		"120px",
	].join(" ");

	// biome-ignore lint/correctness/useExhaustiveDependencies: useAllTokens returns a fresh map each render, so tokenMap cannot be a dependency.
	const records = useMemo(
		() =>
			sortBy(
				filterBySearch(
					filterPositions(
						stocksOnly ? filterStockPools(pools, chainId, STOCK_ASSETS) : pools,
						type,
					),
					filter,
					tokenMap,
				) ?? [],
				"tokenAInfo.address",
			),
		[pools, type, stocksOnly, chainId, filter],
	);

	return (
		<div className={classes.wrap}>
			<div role="table" aria-label={i18n._("Liquidity pools")} className={classes.table}>
				<div role="row" className={`${classes.grid} ${classes.head}`} style={{ gridTemplateColumns: gridTemplate }}>
					<span role="columnheader">{i18n._("Pair")}</span>
					{showGauge && <span role="columnheader" className={classes.right}>{i18n._("Pool APR")}</span>}
					{hasIncentives && <span role="columnheader" className={classes.right}>{i18n._("Bonus APR")}</span>}
					<span role="columnheader" className={classes.right}>{i18n._("TVL")}</span>
					{showGauge && <span role="columnheader" className={classes.right}>{i18n._("Weekly Emissions")}</span>}
					<span role="columnheader" className={classes.right}>{i18n._("Volume 24h")}</span>
					<span role="columnheader" className={classes.right}>{i18n._("Fees 24h")}</span>
					<span role="columnheader" />
				</div>

				{records.map((record: Solve) => {
					const data = record.getData();
					const accelerated = acceleratedPools.get(record.getAddress().toString());
					return (
						<LiquidityDataWrapper
							key={`${data.tokenMintA}-${data.tokenMintB}-${data.feeRate}`}
							data={record}
						>
							{({ currencyA, currencyB }) => (
								<div role="row" className={`${classes.grid} ${classes.row}`} style={{ gridTemplateColumns: gridTemplate }}>
									<div role="cell" className={classes.pair}>
										<span className={classes.logos}>
											<CurrencyLogo currency={currencyA} size={40} />
											<CurrencyLogo currency={currencyB} size={40} />
										</span>
										<div className={classes.pairText}>
											<span className={classes.pairName}>
												{`${currencyA?.symbol ?? formatAddress(data.tokenMintA.toString())}/${currencyB?.symbol ?? formatAddress(data.tokenMintB.toString())}`}
											</span>
											<div className={classes.pills}>
												<span className={classes.pill}>
													<NumberFormatter
														value={Percentage.fromFraction(data.feeRate, 10000)
															.toDecimal()
															.toString()}
														suffix={`% ${i18n._("fee")}`}
													/>
												</span>
												{accelerated && <AcceleratorBadge info={accelerated} />}
											</div>
											<PoolFeeShare pool={record} />
											<TokenSocialBadges token={currencyA} />
										</div>
									</div>

									{showGauge && (
										<div role="cell" className={classes.cell} data-label={i18n._("Pool APR")}>
											<PoolApr pool={record} onDetails={() => setSelectedPool(record)} />
										</div>
									)}
									{hasIncentives && (
										<div role="cell" className={classes.cell} data-label={i18n._("Bonus APR")}>
											<span className={`${classes.big} ${classes.cyan}`}>
												<PoolBonusApr pool={record} />
											</span>
											<span className={classes.sub}>{i18n._("veSOLV3 bonus")}</span>
										</div>
									)}

									<div role="cell" className={classes.cell} data-label={i18n._("TVL")}>
										<span className={classes.big}>
											<TokenPrice
												addresses={
													currencyA && currencyB
														? {
																[currencyA.address]: DecimalUtil.fromBN(
																	new BN(record.getTokenVaultAInfo().amount ?? 0),
																	currencyA.decimals,
																).toNumber(),
																[currencyB.address]: DecimalUtil.fromBN(
																	new BN(record.getTokenVaultBInfo().amount ?? 0),
																	currencyB.decimals,
																).toNumber(),
															}
														: {}
												}
												prefix="$"
												decimalScale={2}
											/>
										</span>
										<span className={classes.sub}>
											<TokenBalance
												balance={DecimalUtil.fromBN(
													new BN(record.getTokenVaultAInfo().amount ?? 0),
													currencyA?.decimals,
												).toNumber()}
												loading={false}
												decimalScale={2}
											/>{" "}
											{currencyA?.symbol} ·{" "}
											<TokenBalance
												balance={DecimalUtil.fromBN(
													new BN(record.getTokenVaultBInfo().amount ?? 0),
													currencyB?.decimals,
												).toNumber()}
												loading={false}
												decimalScale={2}
											/>{" "}
											{currencyB?.symbol}
										</span>
									</div>

									{showGauge && (
										<div role="cell" className={classes.cell} data-label={i18n._("Weekly Emissions")}>
											<PoolWeeklyEmissions pool={record} />
										</div>
									)}

									<div role="cell" className={`${classes.cell} ${classes.muted}`} data-label={i18n._("Volume 24h")}>
										<span className={classes.plain}>—</span>
										<span className={classes.sub}>{i18n._("Not indexed")}</span>
									</div>

									<div role="cell" className={`${classes.cell} ${classes.muted}`} data-label={i18n._("Fees 24h")}>
										<span className={classes.plain}>—</span>
										<span className={classes.sub}>{i18n._("Not indexed")}</span>
									</div>

									<div role="cell" className={classes.action}>
										{showGauge && <Button variant="subtle" size="xs" onClick={() => setSelectedPool(record)}>Pool details</Button>}
										<Link className={classes.deposit} href={`/liquidity/create?currencyA=${data.tokenMintA.toString()}&currencyB=${data.tokenMintB.toString()}&pool=manual&fee=${data.feeRate}`}>
											{i18n._("Deposit")}
										</Link>
									</div>
								</div>
							)}
						</LiquidityDataWrapper>
					);
				})}

				{loadFailed && (
					<div className={classes.empty} role="alert">
						<p>Pool data is temporarily unavailable. Retry to load the current balances.</p>
						<button type="button" className={classes.deposit} onClick={() => {
							void retryDiscovery(); void retryPools();
						}}>Retry pool data</button>
					</div>
				)}
				{loading && records.length === 0 && (
					<div className={classes.empty} role="status">{i18n._("Loading pools…")}</div>
				)}
				{!loading && !loadFailed && records.length === 0 && (
					<div className={classes.empty}>{i18n._("No pools match these filters.")}</div>
				)}

				<Drawer opened={!!selectedPool} onClose={() => setSelectedPool(null)} position="right" size={520} title="Pool details" styles={{ content: { background: "#131125" }, header: { background: "#131125", color: "#f4f1ff" } }}>{selectedPool && <PoolDetails pool={selectedPool} />}</Drawer>
				<div className={classes.foot} style={loadFailed && records.length === 0 ? { display: "none" } : undefined}>
					<span>
						{i18n._("Showing {shown} of {total} pools", {
							shown: records.length,
							total: allPools?.length ?? records.length,
						})}
					</span>
					<span>{i18n._("Sorted by pair")}</span>
				</div>
			</div>
		</div>
	);
};

function PoolApr({ pool, onDetails }: { pool: Solve; onDetails: () => void }) {
	const gauge = usePoolGaugeStatus(pool.getAddress());
	if (!gauge.data || gauge.isError) return <span>—</span>;
	return gauge.data.isActive ? <>
		<RewardEmissionApr poolAddress={pool.getAddress().toString()} />
		<span className={classes.sub}>Emissions APR</span>
	</> : <Button size="compact-xs" variant="subtle" onClick={onDetails}>Estimate fee APR</Button>;
}
