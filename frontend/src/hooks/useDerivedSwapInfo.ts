import { useLingui } from "@lingui/react";
import {
	type Address,
	AddressUtil,
	DecimalUtil,
	Percentage,
} from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { SwapUtils } from "@solve3fi/sdk";
import type Decimal from "decimal.js";
import type { ReactNode } from "react";
import { useAnchor } from "@/providers/DappProvider";
import { Field } from "@/stores/swap";
import { useSwap } from "@/stores/swap/SwapProvider";
import { type BestTrade, useBestTrade } from "./useBestTrade";
import { useCurrencyBalances } from "./useCurrencyBalanace";
import { useToken } from "./useToken";
import { useUserSlippageToleranceWithDefault } from "./useUserSlippage";

export function useDerivedSwapInfo(): {
	currencies: { [field in Field]?: TokenInfo | null };
	currencyBalances: { [field in Field]: Decimal | undefined };
	parsedAmount: Decimal | undefined;
	inputError?: ReactNode;
	allowedSlippage: Percentage;
	recipientAddress: Address | null;
	trade: BestTrade;
	isExactIn: boolean;
} {
	const { i18n } = useLingui();
	const { publicKey } = useAnchor();
	const from = useSwap((state) => state.from);
	const to = useSwap((state) => state.to);
	const independentField = useSwap((state) => state.independentField);
	const typedValue = useSwap((state) => state.typedValue);
	const recipient = useSwap((state) => state.recipient);

	const inputCurrency = useToken(from.toString());
	const outputCurrency = useToken(to.toString());
	const recipientAddress: Address | null =
		(!recipient ? publicKey : recipient) ?? null;

	const relevantTokenBalances = useCurrencyBalances([
		inputCurrency ?? undefined,
		outputCurrency ?? undefined,
	]);

	const isExactIn: boolean = independentField === Field.INPUT;
	const parsedAmount = DecimalUtil.fromNumber(
		Number.isNaN(Number(typedValue)) ? 0 : Number(typedValue),
	);

	const currencyBalances = (() => ({
		[Field.INPUT]: relevantTokenBalances[0],
		[Field.OUTPUT]: relevantTokenBalances[1],
	}))();

	const currencies: { [field in Field]?: TokenInfo | null } = (() => ({
		[Field.INPUT]: inputCurrency,
		[Field.OUTPUT]: outputCurrency,
	}))();

	const allowedSlippage = useUserSlippageToleranceWithDefault(
		Percentage.fromFraction(50, 10_000),
	);

	const trade = useBestTrade(
		inputCurrency,
		outputCurrency,
		Number.isNaN(Number(typedValue)) ? 0 : Number(typedValue),
		isExactIn,
	);

	const inputError = (() => {
		let inputError: ReactNode | undefined;

		if (!publicKey) {
			inputError = i18n._("Connect Wallet");
		}

		if (!currencies[Field.INPUT] || !currencies[Field.OUTPUT]) {
			inputError = inputError ?? i18n._("Select a token");
		}

		if (parsedAmount.lessThanOrEqualTo(DecimalUtil.fromNumber(0))) {
			inputError = inputError ?? i18n._("Enter an amount");
		}

		if (
			currencyBalances[Field.INPUT] &&
			trade.routers?.totalAmountIn &&
			currencyBalances[Field.INPUT].lessThan(
				DecimalUtil.fromBN(
					!isExactIn && trade.request
						? SwapUtils.calculateSwapAmountsFromQuote(
							trade.request.tradeAmount, trade.routers.totalAmountIn,
							trade.routers.totalAmountOut, allowedSlippage, false,
						).otherAmountThreshold
						: trade.routers.totalAmountIn,
					inputCurrency?.decimals,
				),
			)
		) {
			inputError = i18n._("Insufficient {amountIn} balance", {
				amountIn: currencies[Field.INPUT]?.symbol,
			});
		}

		try {
			const formattedTo = AddressUtil.toPubKey(recipientAddress?.toString());
			if (!recipientAddress || !formattedTo) {
				inputError = inputError ?? i18n._("Enter a recipient");
			}
		} catch {
			inputError = inputError ?? i18n._("Enter a recipient");
		}

		return inputError;
	})();

	return {
		currencies,
		currencyBalances,
		parsedAmount,
		inputError,
		trade,
		allowedSlippage,
		recipientAddress,
		isExactIn,
	};
}
