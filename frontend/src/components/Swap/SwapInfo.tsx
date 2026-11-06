import { useLingui } from "@lingui/react";
import { NumberFormatter } from "@mantine/core";
import { Percentage } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import type Decimal from "decimal.js";
import { TokenBalance } from "../Token/TokenBalance";
import classes from "./Swap.module.css";

export type SwapInfoProps = {
	slippage: Percentage;
	caculatePriceImpact?: Decimal;
	swapAmountThreshold?: Decimal;
	loading: boolean;
	networkFee?: number;
	isExactIn?: boolean;
	thresholdSymbol?: string;
	from?: TokenInfo | null;
	to?: TokenInfo | null;
	swapAmountIn?: Decimal;
	swapAmountOut?: Decimal;
};

export const SwapInfo: React.FC<SwapInfoProps> = ({
	slippage,
	caculatePriceImpact,
	swapAmountThreshold,
	loading,
	networkFee,
	isExactIn = true,
	thresholdSymbol,
	from,
	to,
	swapAmountIn,
	swapAmountOut,
}) => {
	const { i18n } = useLingui();
	const hasRate =
		from && to && swapAmountIn?.gt(0) && swapAmountOut?.gt(0);
	const impactClass = caculatePriceImpact?.gt(0)
		? classes.neg
		: caculatePriceImpact?.lt(0)
			? classes.pos
			: undefined;

	return (
		<dl className={classes.details}>
			<dt>{i18n._("Rate")}</dt>
			<dd>
				{hasRate ? (
					<NumberFormatter
						prefix={`1 ${from?.symbol} = `}
						suffix={` ${to?.symbol}`}
						value={swapAmountOut?.div(swapAmountIn ?? 1).toString()}
						thousandSeparator=","
						decimalSeparator="."
						decimalScale={6}
					/>
				) : (
					"—"
				)}
			</dd>
			<dt>{isExactIn ? i18n._("Minimum received") : i18n._("Maximum spent")}</dt>
			<dd>
				<TokenBalance
					loading={loading}
					value={swapAmountThreshold?.toString()}
					decimalScale={6}
					suffix={thresholdSymbol ? ` ${thresholdSymbol}` : ""}
					thousandSeparator=","
					decimalSeparator="."
					fixedDecimalScale
				/>
			</dd>
			<dt>{i18n._("Network fee")}</dt>
			<dd>
				<TokenBalance loading={loading} value={networkFee} suffix=" SOL" />
			</dd>
			<dt>{i18n._("Slippage")}</dt>
			<dd>
				<NumberFormatter
					value={Percentage.fromFraction(slippage.numerator, slippage.denominator)
						.toDecimal()
						.mul(100)
						.toString()}
					thousandSeparator=","
					decimalSeparator="."
					fixedDecimalScale
					decimalScale={2}
					suffix="%"
				/>
			</dd>
			<dt>{i18n._("Price impact")}</dt>
			<dd className={impactClass}>
				<TokenBalance
					loading={loading}
					value={caculatePriceImpact?.abs().toNumber()}
					thousandSeparator=","
					decimalSeparator="."
					fixedDecimalScale
					decimalScale={2}
					suffix="%"
					prefix={
						caculatePriceImpact && caculatePriceImpact.abs().gte(0.01)
							? caculatePriceImpact.gt(0)
								? "-"
								: caculatePriceImpact.lt(0)
									? "+"
									: ""
							: ""
					}
					allowNegative={false}
				/>
			</dd>
		</dl>
	);
};
