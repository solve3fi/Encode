"use client";

import { useLingui } from "@lingui/react";
import { NumberInput } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import type Decimal from "decimal.js";
import { Field } from "@/stores/swap";
import { useSwapActions } from "@/stores/swap/SwapProvider";
import classes from "./Swap.module.css";
import { CurrencyShortfall } from "../Fund/FundShortfall";
import { SwapCurrency } from "./SwapCurrency";
import { SwapTokenBalance } from "./SwapTokenBalance";

export type SwapFieldProps = {
	currency: TokenInfo | null;
	value: Decimal | undefined;
	loading: boolean;
	field: Field;
};

/** One side of the swap card: label, balance + MAX, amount input and token picker. */
export const SwapField: React.FC<SwapFieldProps> = ({
	currency,
	value,
	field,
}) => {
	const { i18n } = useLingui();
	const { setTypedValue, setIndependentField } = useSwapActions();
	const isInput = field === Field.INPUT;
	const method = isInput ? "from" : "to";

	return (
		<div className={classes.field}>
			<div className={classes.fieldTop}>
				<span className={classes.eyebrow}>
					{isInput ? i18n._("You pay") : i18n._("You receive")}
				</span>
				<SwapTokenBalance currency={currency} method={method} />
			</div>
			<div className={classes.fieldMain}>
				<NumberInput
					aria-label={
						isInput ? i18n._("Amount to pay") : i18n._("Amount to receive")
					}
					placeholder="0"
					value={value?.toSignificantDigits(6).toString()}
					onChange={(next) => {
						setTypedValue(Number(next));
						setIndependentField(field);
					}}
					hideControls
					variant="unstyled"
					classNames={{ root: classes.amount, input: classes.amount }}
					thousandSeparator=","
					decimalSeparator="."
				/>
				<SwapCurrency token={currency} method={method} />
			</div>
			{isInput && <CurrencyShortfall currency={currency} amount={value ? value.toNumber() : undefined} />}
		</div>
	);
};
