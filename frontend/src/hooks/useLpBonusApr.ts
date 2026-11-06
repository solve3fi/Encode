import { DecimalUtil } from "@solve3fi/common";
import type { Solve } from "@solve3fi/sdk";
import BN from "bn.js";
import Decimal from "decimal.js";
import { useMemo } from "react";
import { BONUS_APR_MIN_WINDOW_SECONDS } from "@/configs/lpIncentives";
import { useLpIncentives } from "./useLpIncentives";
import { useUSDCPrice } from "./useUSDCPrice";

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export type LpBonusAprState =
	| "none" // pool is not incentivized
	| "accruing" // incentivized, but fewer than a day of keeper samples
	| "ready"
	| "loading";

/**
 * Bonus APR for the soft-launch LP incentive: the veSOLV3 credit issued to a
 * pool's LPs over the trailing keeper window (valued at the configured
 * veSOLV3 price), annualized and divided by the pool's TVL — the same TVL
 * pricing useEmissionApr uses. Fee-linked, so it tracks real swap volume.
 */
export const useLpBonusApr = (pool: Solve | null | undefined) => {
	const { pools, veSolv3Usd, isLoading } = useLpIncentives();
	const address = pool?.getAddress().toString();
	const incentive = address ? pools.get(address) : undefined;

	const priceAddresses = useMemo(() => {
		const addresses: Record<string, number> = {};
		if (!pool || !incentive) return addresses;
		const tokenAInfo = pool.getTokenAInfo();
		const tokenBInfo = pool.getTokenBInfo();
		addresses[tokenAInfo.mint.toString()] = DecimalUtil.fromBN(
			new BN(pool.getTokenVaultAInfo().amount ?? 0),
			tokenAInfo.decimals,
		).toNumber();
		addresses[tokenBInfo.mint.toString()] = DecimalUtil.fromBN(
			new BN(pool.getTokenVaultBInfo().amount ?? 0),
			tokenBInfo.decimals,
		).toNumber();
		return addresses;
	}, [pool, incentive]);

	const { breakdown, isLoading: pricesLoading, isComplete } = useUSDCPrice(priceAddresses);

	return useMemo(() => {
		if (isLoading) return { state: "loading" as LpBonusAprState, apr: new Decimal(0), incentive: null };
		if (!incentive || !pool) return { state: "none" as LpBonusAprState, apr: new Decimal(0), incentive: null };
		const trailing = incentive.trailing7d;
		if (!trailing || trailing.windowSeconds < BONUS_APR_MIN_WINDOW_SECONDS) {
			return { state: "accruing" as LpBonusAprState, apr: new Decimal(0), incentive };
		}
		if (!isComplete || pricesLoading) {
			return { state: "loading" as LpBonusAprState, apr: new Decimal(0), incentive };
		}
		const priceOf = (mint: string) =>
			new Decimal(breakdown.find((entry) => entry.address === mint)?.price ?? 0);
		const tokenAInfo = pool.getTokenAInfo();
		const tokenBInfo = pool.getTokenBInfo();
		const tvlUsd = priceOf(tokenAInfo.mint.toString())
			.mul(priceAddresses[tokenAInfo.mint.toString()] ?? 0)
			.add(priceOf(tokenBInfo.mint.toString()).mul(priceAddresses[tokenBInfo.mint.toString()] ?? 0));
		if (tvlUsd.isZero()) return { state: "ready" as LpBonusAprState, apr: new Decimal(0), incentive };
		const creditUsd = new Decimal(trailing.creditSolv3).mul(veSolv3Usd);
		const annualized = creditUsd.mul(SECONDS_PER_YEAR).div(trailing.windowSeconds);
		return { state: "ready" as LpBonusAprState, apr: annualized.div(tvlUsd).mul(100), incentive };
	}, [isLoading, incentive, pool, isComplete, pricesLoading, breakdown, priceAddresses, veSolv3Usd]);
};
