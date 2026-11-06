import { useLingui } from "@lingui/react";
import { Flex, Paper, rem, Stack, Text } from "@mantine/core";
import { DecimalUtil } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { PoolUtil, type Position, PriceMath, type Solve } from "@solve3fi/sdk";
import BN from "bn.js";
import Decimal from "decimal.js";
import { TokenPrice } from "@/components/Token/TokenPrice";
import { ManagerPositionPooled } from "./ManagerPositionPooled";

export type ManagerPositionAmountProps = {
	currencyA?: TokenInfo | null;
	currencyB?: TokenInfo | null;
	pool?: Solve | null;
	position?: Position | null;
	ratioA?: number;
	ratioB?: number;
};

export const ManagerPositionAmount: React.FC<ManagerPositionAmountProps> = ({
	currencyA,
	currencyB,
	pool,
	ratioA,
	ratioB,
	position,
}) => {
	const lowerSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(
		position?.getData().tickLowerIndex ?? 0,
	);
	const upperSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(
		position?.getData().tickUpperIndex ?? 0,
	);
	const { tokenA, tokenB } = PoolUtil.getTokenAmountsFromLiquidity(
		position?.getData().liquidity ?? new BN(0),
		position?.getSolveData().sqrtPrice ?? new BN(0),
		lowerSqrtPrice,
		upperSqrtPrice,
		false,
	);

	const tokenAAmount =
		DecimalUtil.fromBN(tokenA, currencyA?.decimals) || new Decimal(0);
	const tokenBAmount =
		DecimalUtil.fromBN(tokenB, currencyB?.decimals) || new Decimal(0);

	const { i18n } = useLingui();
	return (
		<Paper p="md" shadow="sm">
			<Flex
				gap={12}
				justify="space-between"
				direction={{ base: "column", md: "row" }}
			>
				<Flex
					gap={4}
					direction={{ base: "row", md: "column" }}
					justify="space-between"
				>
					<Text fz="sm" c="gray.10" fw={600}>
						{i18n._("Position amount")}
					</Text>
					<Text fz={rem(24)} fw={600}>
						<TokenPrice
							addresses={
								currencyA && currencyB
									? {
											[currencyA?.address]: tokenAAmount.toNumber(),
											[currencyB?.address]: tokenBAmount.toNumber(),
										}
									: {}
							}
							prefix="$"
							decimalScale={2}
						/>
					</Text>
				</Flex>

				<Stack gap={8}>
					<ManagerPositionPooled
						symbol={currencyA?.symbol}
						amount={tokenAAmount.toNumber()}
						percent={ratioA}
					/>
					<ManagerPositionPooled
						symbol={currencyB?.symbol}
						amount={tokenBAmount.toNumber()}
						percent={ratioB}
					/>
				</Stack>
			</Flex>
		</Paper>
	);
};
