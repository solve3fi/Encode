import { useLingui } from "@lingui/react";
import { Button, Group, Stack, Text } from "@mantine/core";
import type { Percentage } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import {
	type IncreaseLiquidityQuote,
	PriceMath,
	type Solve,
} from "@solve3fi/sdk";
import type BN from "bn.js";
import type Decimal from "decimal.js";
import type { ReactNode } from "react";
import { PoolState } from "@/hooks/usePoolState";
import type { FeeAmount, Field, PriceInputs } from "@/stores/pool";
import { usePool, usePoolActions } from "@/stores/pool/PoolProvider";
import { CardLayout } from "../Layout/CardLayout";
import { PoolAmountPanel } from "./PoolAmountPanel";
import { PoolHandlePosition } from "./PoolHandlePosition";
import { PoolPriceChart } from "./PoolPriceChart";
import { PoolPriceRangeInput } from "./PoolPriceRangeInput";
import { PoolDesiredAmount } from "./PoolPriceRangeInput/PoolDesiredAmount";
import { PoolPrices } from "./PoolPriceRangeInput/PoolPrices";

export type PoolPriceRangeProps = {
	baseCurrency: TokenInfo | null | undefined;
	quoteCurrency: TokenInfo | null | undefined;
	price: Decimal | undefined;
	invertPrice: boolean;
	feeTier: FeeAmount;
	ticksAtLimit: { [bound in PriceInputs]?: boolean | undefined };
	pool: Solve | null;
	quote: IncreaseLiquidityQuote | undefined;
	poolState: PoolState;
	outOfRange: boolean;
	noLiquidity: boolean;
	errorMessage: ReactNode | undefined;
	parsedAmounts: { [field in Field]?: Decimal };
	tickLower: number | undefined;
	tickUpper: number | undefined;
	priceLower: Decimal | undefined;
	priceUpper: Decimal | undefined;
	tickCurrentIndex: number | undefined;
	inputTokenAmount: BN | undefined;
	inputTokenMint: string | undefined;
	slippageTolerance: Percentage;
	/** The Summary card hosts the action instead (wide layout). */
	hideAction?: boolean;
};

export const PoolPriceRange: React.FC<PoolPriceRangeProps> = ({
	baseCurrency,
	quoteCurrency,
	price,
	invertPrice,
	feeTier,
	ticksAtLimit,
	pool,
	quote,
	poolState,
	outOfRange,
	noLiquidity,
	errorMessage,
	parsedAmounts,
	tickLower,
	tickUpper,
	priceLower,
	priceUpper,
	tickCurrentIndex,
	inputTokenAmount,
	inputTokenMint,
	slippageTolerance,
	hideAction = false,
}) => {
	const { i18n } = useLingui();

	const desiredAmount = usePool((state) => state.desiredAmount);
	const { reset } = usePoolActions();

	return (
		<CardLayout w="100%">
			<Stack gap="md">
				<Group align="center" justify="space-between">
					<Text fz="xl">{i18n._("Select Price Range")}</Text>
					<Button variant="light" c="gray" onClick={reset}>
						{i18n._("Reset")}
					</Button>
				</Group>
				<PoolPriceRangeInput
					currencyA={baseCurrency}
					currencyB={quoteCurrency}
					price={price}
					invertPrice={invertPrice}
				/>
				<PoolPriceChart
					currencyA={baseCurrency}
					currencyB={quoteCurrency}
					feeAmount={feeTier}
					ticksAtLimit={ticksAtLimit}
					price={
						price
							? invertPrice
								? PriceMath.invertPrice(
										price,
										baseCurrency?.decimals ?? 8,
										quoteCurrency?.decimals ?? 8,
									)
										.toSignificantDigits(5)
										.toNumber()
								: price.toSignificantDigits(5).toNumber()
							: undefined
					}
					priceLower={priceLower}
					priceUpper={priceUpper}
					interactive={Boolean(pool && poolState === PoolState.EXISTS)}
				/>
				<PoolDesiredAmount
					currencyA={baseCurrency}
					currencyB={quoteCurrency}
					desiredAmount={desiredAmount}
					existPool={Boolean(pool && poolState === PoolState.EXISTS)}
					feeAmount={feeTier}
				/>
				<PoolPrices
					priceLower={priceLower}
					priceUpper={priceUpper}
					tickLower={tickLower}
					tickUpper={tickUpper}
					ticksAtLimit={ticksAtLimit}
					currencyA={baseCurrency}
					currencyB={quoteCurrency}
					pool={pool}
					feeAmount={feeTier}
				/>

				<PoolAmountPanel
					currencyA={baseCurrency}
					currencyB={quoteCurrency}
					parsedAmounts={parsedAmounts}
				/>

				{!hideAction && (
				<PoolHandlePosition
					currencyA={baseCurrency}
					currencyB={quoteCurrency}
					parsedAmounts={parsedAmounts}
					errorMessage={errorMessage}
					outOfRange={outOfRange}
					noLiquidity={noLiquidity}
					tickLower={tickLower}
					tickUpper={tickUpper}
					quote={quote}
					pool={pool}
					tickCurrentIndex={tickCurrentIndex}
					inputTokenAmount={inputTokenAmount}
					inputTokenMint={inputTokenMint}
					slippageTolerance={slippageTolerance}
				/>
				)}
			</Stack>
		</CardLayout>
	);
};
