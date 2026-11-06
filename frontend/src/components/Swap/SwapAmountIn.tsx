import { useLingui } from "@lingui/react";
import { Group, NumberInput, Paper, Stack, Text } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import type Decimal from "decimal.js";
import { Field } from "@/stores/swap";
import { useSwapActions } from "@/stores/swap/SwapProvider";
import classes from "./SwapAmount.module.css";
import { SwapCurrency } from "./SwapCurrency";
import { SwapTokenBalance } from "./SwapTokenBalance";

export type SwapAmountInProps = {
	currency: TokenInfo | null;
	value: Decimal | undefined;
	loading: boolean;
};

export const SwapAmountIn: React.FC<SwapAmountInProps> = ({
	currency,
	value,
}) => {
	const { i18n } = useLingui();
	const { setTypedValue, setIndependentField } = useSwapActions();

	return (
		<Paper p="md" shadow="sm" bg="var(--mantine-color-dark-10)">
			<Stack gap={15}>
				<Group align="center" justify="space-between">
					<Text tt="uppercase" fw={600}>
						{i18n._("From")}
					</Text>
					<SwapCurrency token={currency} method="from" />
				</Group>

				<Group align="center" justify="space-between">
					<Text c="gray" size="sm">
						{i18n._("Amount")}
					</Text>
					<NumberInput
						size="lg"
						placeholder="0.00"
						value={value?.toSignificantDigits(6).toString()}
						onChange={(value) => {
							setTypedValue(Number(value));
							setIndependentField(Field.INPUT);
						}}
						hideControls
						fw="bold"
						classNames={{
							input: classes.amountinput,
						}}
						thousandSeparator=","
						decimalSeparator="."
						fixedDecimalScale
					/>
				</Group>

				<SwapTokenBalance currency={currency} method="from" />
			</Stack>
		</Paper>
	);
};
