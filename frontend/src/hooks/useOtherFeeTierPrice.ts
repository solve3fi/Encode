import { AddressUtil } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { PoolUtil, PriceMath } from "@solve3fi/sdk";
import type Decimal from "decimal.js";
import { type FeeAmount, TICK_SPACINGS } from "@/stores/pool";
import { PoolState, usePoolsState } from "./usePoolState";

export type OtherFeeTierPrice = { price: Decimal; feeAmount: FeeAmount };

const ALL_FEE_AMOUNTS = Object.keys(TICK_SPACINGS).map(Number) as FeeAmount[];

// A pair having no pool at the SELECTED fee tier doesn't mean the pair has
// no on-chain price — a sibling pool at a different fee tier for the exact
// same two mints commonly already exists and trades. Checking every other
// tier here (rather than only the one the user currently has selected) is
// what makes that price available as a starting-price suggestion instead of
// forcing a manual guess for a pair solve3 already prices elsewhere.
export const useOtherFeeTierPrice = (
	currencyA: TokenInfo | undefined,
	currencyB: TokenInfo | undefined,
	excludeFeeAmount: FeeAmount | undefined,
): OtherFeeTierPrice | undefined => {
	const candidates = ALL_FEE_AMOUNTS.filter((fee) => fee !== excludeFeeAmount);
	const results = usePoolsState(
		candidates.map((fee) => [currencyA, currencyB, fee]),
	);

	if (!currencyA || !currencyB) return undefined;

	const [token0Address] = PoolUtil.orderMints(
		currencyA.address,
		currencyB.address,
	);
	const currencyAIsToken0 = AddressUtil.toPubKey(token0Address).equals(
		AddressUtil.toPubKey(currencyA.address),
	);
	const decimals0 = currencyAIsToken0 ? currencyA.decimals : currencyB.decimals;
	const decimals1 = currencyAIsToken0 ? currencyB.decimals : currencyA.decimals;

	for (let i = 0; i < candidates.length; i += 1) {
		const [state, pool] = results[i];
		if (state !== PoolState.EXISTS || !pool) continue;

		// sqrtPriceX64ToPrice yields token1 per token0; PoolDesiredAmount wants
		// currencyB per currencyA (the same convention JupiterPriceFeed's
		// onUsePrice already uses), so invert only when currencyA is token1.
		const rawPrice = PriceMath.sqrtPriceX64ToPrice(
			pool.getData().sqrtPrice,
			decimals0,
			decimals1,
		);
		const price = currencyAIsToken0
			? rawPrice
			: PriceMath.invertPrice(rawPrice, decimals0, decimals1);

		return { price, feeAmount: candidates[i] };
	}

	return undefined;
};
