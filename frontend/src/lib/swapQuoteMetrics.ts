import { RouterUtils, SwapUtils, type Trade, type TradeRoute } from "@solve3fi/sdk";
import type { Percentage } from "@solve3fi/common";

// Price impact is execution versus the route's pre-trade spot price, excluding
// swap fees. Slippage is a separate execution limit, not a price-impact estimate.
export function swapQuoteMetrics(trade: Trade, route: TradeRoute, slippage: Percentage) {
	const impact = RouterUtils.getPriceImpactForRoute(trade, route);
	return {
		priceImpact: impact.isFinite() ? impact : undefined,
		threshold: SwapUtils.calculateSwapAmountsFromQuote(
			trade.tradeAmount, route.totalAmountIn, route.totalAmountOut,
			slippage, trade.amountSpecifiedIsInput,
		).otherAmountThreshold,
	};
}
