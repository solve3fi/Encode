"use client";

import { DecimalUtil } from "@solve3fi/common";
import type { Solve } from "@solve3fi/sdk";
import BN from "bn.js";
import { useId, useState } from "react";
import { useUSDCPrice } from "@/hooks/useUSDCPrice";
import { formatApr } from "@/lib/format";

export function FeeAprScenario({ pool }: { pool: Solve }) {
	const id = useId();
	const [dailyVolume, setDailyVolume] = useState("");
	const a = pool.getTokenAInfo();
	const b = pool.getTokenBInfo();
	const valuation = useUSDCPrice({
		[a.mint.toString()]: DecimalUtil.fromBN(
			new BN(pool.getTokenVaultAInfo().amount.toString()),
			a.decimals,
		).toNumber(),
		[b.mint.toString()]: DecimalUtil.fromBN(
			new BN(pool.getTokenVaultBInfo().amount.toString()),
			b.decimals,
		).toNumber(),
	});
	const tvl =
		valuation.isComplete && !valuation.isLoading && !valuation.isError
			? valuation.totalUsdcValue.toNumber()
			: undefined;
	const { feeRate, protocolFeeRate } = pool.getData();
	const daily = Number(dailyVolume);
	const valid = dailyVolume !== "" && Number.isFinite(daily) && daily >= 0;
	const apr =
		tvl && valid
			? ((daily *
					(feeRate / 1_000_000) *
					(1 - protocolFeeRate / 10_000) *
					365) /
					tvl) *
				100
			: undefined;
	return (
		<section aria-labelledby={id + "-title"}>
			<h3 id={id + "-title"}>LP fee APR scenario</h3>
			<p>
				Historical swap fees are not indexed. Enter an assumed daily volume to
				estimate the pool’s annualized LP fee yield using its current fee split
				and TVL.
			</p>
			<p>
				Estimated pool TVL:{" "}
				{tvl === undefined
					? "Unavailable"
					: tvl.toLocaleString("en-US", { style: "currency", currency: "USD" })}
			</p>
			<label htmlFor={id}>Assumed daily volume (USD)</label>{" "}
			<input
				id={id}
				type="number"
				min="0"
				step="any"
				inputMode="decimal"
				value={dailyVolume}
				onChange={(event) => setDailyVolume(event.target.value)}
			/>
			<p aria-live="polite">
				<strong>
					Scenario APR:{" "}
					{apr === undefined || !Number.isFinite(apr) ? "—" : formatApr(apr)}
				</strong>
			</p>
			<small>
				Pool-wide estimate. Actual position earnings depend on trading activity,
				active liquidity and your range.
			</small>
		</section>
	);
}
