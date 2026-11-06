"use client";

import { useLingui } from "@lingui/react";
import {
	type Address,
	DecimalUtil,
	Percentage,
} from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import BN from "bn.js";
import type Decimal from "decimal.js";
import type { BestTrade } from "@/hooks/useBestTrade";
import { useSwapFees } from "@/hooks/useSwapFees";
import { swapQuoteMetrics } from "@/lib/swapQuoteMetrics";
import { Field, TradeState } from "@/stores/swap";
import { useSwap } from "@/stores/swap/SwapProvider";
import { SwapField } from "./SwapField";
import { SwapHandle } from "./SwapHandle";
import { SwapInfo } from "./SwapInfo";
import { formatSwapAmount, type SwapSummary } from "./swapResult";
import { SwitchTokens } from "./SwitchTokens";

export type SwapAssetPanelProps = {
	trade: BestTrade;
	allowedSlippage: Percentage;
	parsedAmount: Decimal | undefined;
	currencies: {
		INPUT?: TokenInfo | null | undefined;
		OUTPUT?: TokenInfo | null | undefined;
	};
	recipientAddress: Address | null;
	swapInputError: React.ReactNode;
	isExactIn: boolean;
};

export const SwapAssetPanel: React.FC<SwapAssetPanelProps> = ({
	trade,
	allowedSlippage,
	parsedAmount,
	currencies,
	swapInputError,
	isExactIn,
}) => {
	const { i18n } = useLingui();
	const independentField = useSwap((state) => state.independentField);
	const parsedAmounts = (() => ({
		[Field.INPUT]:
			independentField === Field.INPUT
				? parsedAmount
				: DecimalUtil.fromBN(
						trade?.routers?.totalAmountIn ?? new BN(0),
						currencies[Field.INPUT]?.decimals ?? 0,
					),
		[Field.OUTPUT]:
			independentField === Field.OUTPUT
				? parsedAmount
				: DecimalUtil.fromBN(
						trade?.routers?.totalAmountOut ?? new BN(0),
						currencies[Field.OUTPUT]?.decimals ?? 0,
					),
	}))();

	const [routeNotFound, routeIsLoading, routeIsSyncing] = (() => [
		!trade?.routers,
		trade.state === TradeState.LOADING,
		trade.state === TradeState.SYNCING,
	])();

	const dependentField: Field =
		independentField === Field.INPUT ? Field.OUTPUT : Field.INPUT;

	const formattedAmounts = (() => ({
		[independentField]: parsedAmounts[independentField],
		[dependentField]: parsedAmounts[dependentField],
	}))();

	const { data: networkFee } = useSwapFees(trade, allowedSlippage);

	const metrics = trade.request && trade.routers
		? swapQuoteMetrics(trade.request, trade.routers, allowedSlippage)
		: undefined;
	const thresholdCurrency = currencies[isExactIn ? Field.OUTPUT : Field.INPUT];
	const swapAmountThreshold = metrics
		? DecimalUtil.fromBN(metrics.threshold, thresholdCurrency?.decimals ?? 0)
		: undefined;

	const summary: SwapSummary = {
		fromSymbol: currencies[Field.INPUT]?.symbol ?? "",
		toSymbol: currencies[Field.OUTPUT]?.symbol ?? "",
		paid: formatSwapAmount(formattedAmounts[Field.INPUT]),
		got: formatSwapAmount(formattedAmounts[Field.OUTPUT]),
		impact: metrics?.priceImpact ? metrics.priceImpact.toNumber() : null,
		fee: networkFee,
	};

	return (
		<>
			<SwapField
				field={Field.INPUT}
				currency={currencies[Field.INPUT] ?? null}
				value={formattedAmounts[Field.INPUT]}
				loading={routeIsLoading || routeIsSyncing}
			/>
			<SwitchTokens />
			<SwapField
				field={Field.OUTPUT}
				currency={currencies[Field.OUTPUT] ?? null}
				value={formattedAmounts[Field.OUTPUT]}
				loading={routeIsLoading || routeIsSyncing}
			/>
			<SwapInfo
				networkFee={networkFee}
				slippage={allowedSlippage}
				loading={routeIsLoading || routeIsSyncing}
				swapAmountThreshold={swapAmountThreshold}
				caculatePriceImpact={metrics?.priceImpact}
				isExactIn={isExactIn}
				thresholdSymbol={thresholdCurrency?.symbol}
				from={currencies[Field.INPUT]}
				to={currencies[Field.OUTPUT]}
				swapAmountIn={formattedAmounts[Field.INPUT]}
				swapAmountOut={formattedAmounts[Field.OUTPUT]}
			/>
			<SwapHandle
				summary={summary}
				trade={trade}
				slippage={allowedSlippage}
				errorMessage={
					swapInputError || (routeNotFound && i18n._("No route found"))
				}
				isLoading={routeIsLoading || routeIsSyncing}
			/>
		</>
	);
};
