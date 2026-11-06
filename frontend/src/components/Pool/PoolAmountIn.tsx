import { Avatar, Group, NumberInput, Paper, Stack, Text } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import type Decimal from "decimal.js";
import type { Field } from "@/stores/pool";
import { usePoolActions } from "@/stores/pool/PoolProvider";
import { TokenPrice } from "../Token/TokenPrice";
import classes from "./PoolAmount.module.css";
import { CurrencyShortfall } from "../Fund/FundShortfall";
import { PoolTokenBalance } from "./PoolTokenBalance";

export type PoolAmountInProps = {
	currency?: TokenInfo | null;
	method: Field;
	value?: Decimal;
};

export const PoolAmountIn: React.FC<PoolAmountInProps> = ({
	currency,
	method,
	value,
}) => {
	const { setTypedValue, setIndependentField } = usePoolActions();

	const handleChangeAmount = (value: string | number) => {
		setTypedValue(Number.parseFloat(value.toString()));
		setIndependentField(method);
	};

	return (
		<Paper p="md" shadow="sm" bg="dark.10">
			<Stack gap={0}>
				<Group align="center" justify="space-between">
					<NumberInput
						size="lg"
						placeholder="0.00"
						hideControls
						fw="bold"
						value={value?.toNumber()}
						onChange={handleChangeAmount}
						classNames={{
							input: classes.amountinput,
						}}
						thousandSeparator=","
						decimalSeparator="."
					/>
					<Group align="center" justify="space-between" gap={5}>
						<Avatar
							size={24}
							src={currency?.logoURI}
							alt={currency?.symbol}
							radius="xl"
						/>
						<Text fz="lg" fw="bold">
							{currency?.symbol}
						</Text>
					</Group>
				</Group>
				<Group align="center" justify="space-between">
					<Text fz="sm" c="gray">
						<TokenPrice
							prefix="$"
							addresses={
								currency?.address
									? { [currency?.address]: value?.toNumber() ?? 0 }
									: {}
							}
						/>
					</Text>
					<PoolTokenBalance currency={currency} method={method} />
				</Group>
				<CurrencyShortfall currency={currency} amount={value?.toNumber()} />
			</Stack>
		</Paper>
	);
};
