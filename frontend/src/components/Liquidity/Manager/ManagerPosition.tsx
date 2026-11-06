import { useLingui } from "@lingui/react";
import { Button, Group, Stack, Title } from "@mantine/core";
import { DecimalUtil } from "@solve3fi/common";
import { type Position, PriceMath, TickUtil, type Solve } from "@solve3fi/sdk";
import { IconChevronLeft } from "@tabler/icons-react";
import BN from "bn.js";
import type Decimal from "decimal.js";
import Link from "next/link";
import { CardLayout } from "@/components/Layout/CardLayout";
import { useToken } from "@/hooks/useToken";
import { PriceInputs } from "@/stores/pool";
import { calcDepositRatio } from "@/utils/calcDepositRatio";
import { ManagerPositionAmount } from "./ManagerPositionAmount";
import { ManagerPositionFee } from "./ManagerPositionFee";
import { ManagerStatus } from "./ManagerStatus";
import { ManagerSwapToken } from "./ManagerSwapToken";

export type ManagerPositionProps = {
	pool: Solve | undefined;
	position: Position;
	feeAmount: number;
	sorted: boolean;
};

export const ManagerPosition: React.FC<ManagerPositionProps> = ({
	position,
	feeAmount,
	sorted,
	pool,
}) => {
	const { i18n } = useLingui();

	const currency0 = useToken(position.getSolveData().tokenMintA.toString());
	const currency1 = useToken(position.getSolveData().tokenMintB.toString());
	// This pane describes the existing on-chain position, not the add form's
	// editable prices or selected token order.
	const toPrice = (sqrt: BN) => currency0 && currency1
		? PriceMath.sqrtPriceX64ToPrice(sqrt, currency0.decimals, currency1.decimals)
		: undefined;
	const price = toPrice(position.getSolveData().sqrtPrice);
	const priceLower = toPrice(PriceMath.tickIndexToSqrtPriceX64(position.getData().tickLowerIndex));
	const priceUpper = toPrice(PriceMath.tickIndexToSqrtPriceX64(position.getData().tickUpperIndex));

	const outOfRange: boolean = position
		? position.getSolveData().tickCurrentIndex <
				position.getData().tickLowerIndex ||
			position.getSolveData().tickCurrentIndex >=
				position.getData().tickUpperIndex
		: false;

	const removed = position.getData().liquidity.eq(new BN(0));

	const [minTick, maxTick] = TickUtil.getFullRangeTickIndex(position.getSolveData().tickSpacing);
	const atLower = position.getData().tickLowerIndex === minTick;
	const atUpper = position.getData().tickUpperIndex === maxTick;
	const tickAtLimit = {
		[PriceInputs.LOWER]: sorted ? atUpper : atLower,
		[PriceInputs.UPPER]: sorted ? atLower : atUpper,
	};
	const invert = (value?: Decimal) => value?.gt(0) ? DecimalUtil.fromNumber(1).div(value) : undefined;
	const currentPrice = sorted ? invert(price) : price;
	const lowerPrice = sorted ? invert(priceUpper) : priceLower;
	const upperPrice = sorted ? invert(priceLower) : priceUpper;

	const lowerSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(
		position.getData().tickLowerIndex,
	);
	const upperSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(
		position.getData().tickUpperIndex,
	);
	const [ratioA, ratioB] = calcDepositRatio(
		position.getSolveData().sqrtPrice,
		lowerSqrtPrice,
		upperSqrtPrice,
		currency0?.decimals ?? 0,
		currency1?.decimals ?? 0,
	);
	return (
		<CardLayout w="100%">
			<Stack gap="md">
				<Group align="center" justify="space-between">
					<Title fs="xl">{i18n._("Manage Position")}</Title>
					<Button
						variant="light"
						c="gray"
						component={Link}
						href={"/liquidity?method=all"}
						leftSection={
							<IconChevronLeft color="var(--mantine-color-gray-8)" />
						}
					>
						{i18n._("Back to All Pools")}
					</Button>
				</Group>
				<ManagerStatus
					currencyA={currency0}
					currencyB={currency1}
					feeAmount={feeAmount}
					removed={removed}
					outOfRange={outOfRange}
				/>
				<ManagerSwapToken
					currency0={currency0}
					currency1={currency1}
					sorted={sorted}
					position={position}
					tickAtLimit={tickAtLimit}
					currentPrice={currentPrice}
					lowerPrice={lowerPrice}
					upperPrice={upperPrice}
					lowerSqrtPrice={lowerSqrtPrice}
					upperSqrtPrice={upperSqrtPrice}
					ratioA={ratioA}
					ratioB={ratioB}
					outOfRange={outOfRange}
				/>
				<ManagerPositionAmount
					currencyA={currency0}
					currencyB={currency1}
					pool={pool}
					position={position}
					ratioA={ratioA}
					ratioB={ratioB}
				/>
				<ManagerPositionFee
					currencyA={currency0}
					currencyB={currency1}
					position={position}
				/>
			</Stack>
		</CardLayout>
	);
};
