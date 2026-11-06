import { useLingui } from "@lingui/react";
import { Stack, Text } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import type Decimal from "decimal.js";
import { Field } from "@/stores/pool";
import { PoolAmountIn } from "./PoolAmountIn";
import { PoolAmountOut } from "./PoolAmountOut";

export type PoolDepositAmountProps = {
	parsedAmounts?: { [field in Field]?: Decimal };
	currencyA: TokenInfo | null | undefined;
	currencyB: TokenInfo | null | undefined;
};

export const PoolAmountPanel: React.FC<PoolDepositAmountProps> = ({
	currencyA,
	currencyB,
	parsedAmounts,
}) => {
	const { i18n } = useLingui();

	return (
		<Stack gap={10}>
			<Text fz="lg" fw="bold">
				{i18n._("Deposit Amounts")}
			</Text>
			<PoolAmountIn
				currency={currencyA}
				method={Field.CURRENCY_A}
				value={parsedAmounts?.[Field.CURRENCY_A]}
			/>
			<PoolAmountOut
				currency={currencyB}
				method={Field.CURRENCY_B}
				value={parsedAmounts?.[Field.CURRENCY_B]}
			/>
		</Stack>
	);
};
