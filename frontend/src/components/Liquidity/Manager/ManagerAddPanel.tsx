import { useLingui } from "@lingui/react";
import { Stack, Text } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import type { IncreaseLiquidityQuote, Position, Solve } from "@solve3fi/sdk";
import type Decimal from "decimal.js";
import type { ReactNode } from "react";
import { PoolAmountIn } from "@/components/Pool/PoolAmountIn";
import { PoolAmountOut } from "@/components/Pool/PoolAmountOut";
import { PoolHandlePosition } from "@/components/Pool/PoolHandlePosition";
import { Field } from "@/stores/pool";

export type ManagerAddPanelProps = {
	parsedAmounts: { [field in Field]?: Decimal | undefined };
	pool: Solve | null;
	baseCurrency?: TokenInfo | null;
	quoteCurrency?: TokenInfo | null;
	position?: Position;
	outOfRange?: boolean;
	noLiquidity?: boolean;
	errorMessage?: ReactNode | undefined;
	quote?: IncreaseLiquidityQuote;
	tickLower?: number;
	tickUpper?: number;
	tickCurrentIndex?: number;
};

export const ManagerAddPanel: React.FC<ManagerAddPanelProps> = ({
	parsedAmounts,
	pool,
	baseCurrency,
	quoteCurrency,
	outOfRange,
	noLiquidity,
	errorMessage,
	quote,
	tickLower,
	tickUpper,
	tickCurrentIndex,
}) => {
	const { i18n } = useLingui();
	return (
		<>
			<Stack gap={10}>
				<Text fz="lg" fw="bold" tt="capitalize">
					{i18n._("Add Liquidity")}
				</Text>
				<PoolAmountIn
					currency={baseCurrency}
					method={Field.CURRENCY_A}
					value={parsedAmounts?.[Field.CURRENCY_A]}
				/>
				<PoolAmountOut
					currency={quoteCurrency}
					method={Field.CURRENCY_B}
					value={parsedAmounts?.[Field.CURRENCY_B]}
				/>
			</Stack>
			<PoolHandlePosition
				pool={pool}
				currencyA={baseCurrency}
				currencyB={quoteCurrency}
				parsedAmounts={parsedAmounts}
				outOfRange={outOfRange}
				noLiquidity={noLiquidity}
				errorMessage={errorMessage}
				quote={quote}
				tickLower={tickLower}
				tickUpper={tickUpper}
				tickCurrentIndex={tickCurrentIndex}
			>
				{i18n._("Add Liquidity")}
			</PoolHandlePosition>
		</>
	);
};
