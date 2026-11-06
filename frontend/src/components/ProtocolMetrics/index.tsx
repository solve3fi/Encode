"use client";

import Decimal from "decimal.js";
import { useAllPools } from "@/hooks/useAllPools";
import { usePools } from "@/hooks/usePools";
import { useUSDCPrice } from "@/hooks/useUSDCPrice";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { formatTokenAmount } from "@/lib/format";
import styles from "./ProtocolMetrics.module.css";

const metrics = [
	{
		label: "Total Value Locked",
		value: "—",
		accent: "violet",
	},
	{
		label: "Total Volume",
		value: "—",
		accent: "cyan",
	},
	{
		label: "Total Fees",
		value: "—",
		accent: "lime",
	},
] as const;

export const ProtocolMetrics: React.FC = () => {
	const { network } = useCluster();
	const addresses = useAllPools();
	const pools = usePools(addresses.data);
	const amounts: Record<string, number> = {};
	for (const pool of pools.data ?? []) {
		for (const [mint, vault] of [[pool.getTokenAInfo(), pool.getTokenVaultAInfo()], [pool.getTokenBInfo(), pool.getTokenVaultBInfo()]] as const) {
			const address = mint.mint.toString();
			const amount = new Decimal(vault.amount.toString()).div(new Decimal(10).pow(mint.decimals)).toNumber();
			amounts[address] = (amounts[address] ?? 0) + amount;
		}
	}
	const valuation = useUSDCPrice(amounts);
	const poolsComplete = addresses.data !== undefined && !addresses.isError && !pools.isError && (addresses.data.length === 0 || pools.data?.length === addresses.data.length);
	const tvl = poolsComplete && valuation.isComplete && !valuation.isLoading
		? `$${formatTokenAmount(valuation.totalUsdcValue.toNumber(), { decimals: 2 })}` : "—";
	return (
		<section className={styles.section} aria-label="Protocol metrics">
			<div className={styles.heading}>
				<div>
					<p className={styles.eyebrow}>Protocol snapshot</p>
					<p className={styles.note}>{network === ClusterNetwork.Devnet ? "Devnet estimates · devUSDC = $1 · pool spot prices, not real market values" : "Estimated value of listed pools"}. Historical volume and fees are not indexed.</p>
				</div>
			</div>
			<div className={styles.rail}>
				{metrics.map(({ label, value, accent }) => (
					<div className={`${styles.metric} ${styles[accent]}`} key={label}>
						<div>
							<strong>{label === "Total Value Locked" ? tvl : value}</strong>
							<span>{label}</span>
						</div>
					</div>
				))}
			</div>
		</section>
	);
};
