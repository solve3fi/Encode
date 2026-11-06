import { useLingui } from "@lingui/react";
import { Box, Flex, Group, Paper, Text } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import { IconHelpCircle } from "@tabler/icons-react";
import type Decimal from "decimal.js";
import type React from "react";
import type { FeeAmount, PriceInputs } from "@/stores/pool";
import { TokenBalance } from "../Token/TokenBalance";

import { PoolChartRangInput } from "./PoolChartRangeInput";

export type PoolPriceChartProps = {
	currencyA?: TokenInfo | null;
	currencyB?: TokenInfo | null;
	feeAmount: FeeAmount;
	ticksAtLimit: { [bound in PriceInputs]?: boolean | undefined };
	price: number | undefined;
	priceLower?: Decimal;
	priceUpper?: Decimal;
	interactive: boolean;
};

export const PoolPriceChart: React.FC<PoolPriceChartProps> = ({
	currencyA,
	currencyB,
	feeAmount,
	ticksAtLimit,
	price,
	priceLower,
	priceUpper,
	interactive,
}) => {
	const { i18n } = useLingui();

	return interactive ? (
		<Box>
			<Group align="center" justify="space-between">
				<Text fz="lg">{i18n._("Current Price")}</Text>
				<Text fz="lg">
					<TokenBalance value={price} loading={false} decimalScale={6} />{" "}
					<Text span inherit fw="bold">
						{currencyB?.symbol}
					</Text>{" "}
					{"per"}
					<Text span inherit fw="bold">
						{" "}
						{currencyA?.symbol}
					</Text>
				</Text>
			</Group>
			<Box h="100%">
				<PoolChartRangInput
					currencyA={currencyA}
					currencyB={currencyB}
					price={price}
					ticksAtLimit={ticksAtLimit}
					priceLower={priceLower}
					priceUpper={priceUpper}
					interactive={interactive}
					feeAmount={feeAmount}
				/>
			</Box>
		</Box>
	) : (
		<Paper p={10} bg="error.6">
			<Flex align="top" gap={5}>
				<Box flex={1} mt={2}>
					<IconHelpCircle />
				</Box>
				<Text>
					{i18n._(
						"This pool must be initialized before you can add liquidity. To initialize, select a starting price for the pool. Then, enter your liquidity price range and deposit amount. Gas fees will be highter than usual due to the intialization transaction.",
					)}
				</Text>
			</Flex>
		</Paper>
	);
};
