"use client";

import { useLingui } from "@lingui/react";
import {
	Group,
	NumberFormatter,
	Paper,
	SegmentedControl,
	Stack,
	Text,
} from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import type { Position } from "@solve3fi/sdk";
import {
	IconChevronLeft,
	IconChevronRight,
	IconPoint,
} from "@tabler/icons-react";
import type BN from "bn.js";
import type Decimal from "decimal.js";
import { Field, PriceInputs } from "@/stores/pool";
import { usePoolActions } from "@/stores/pool/PoolProvider";
import { usePoolManagerActions } from "@/stores/pool-manager/PoolManagaerProvider";
import { formatTickPrice } from "@/utils/formatTickPrice";
import { ManagerRangeBar } from "./ManagerRangeBar";

export type ManagerSwapTokenProps = {
	position: Position;
	currency0?: TokenInfo | null;
	currency1?: TokenInfo | null;
	sorted: boolean;
	tickAtLimit: {
		LOWER: boolean | undefined;
		UPPER: boolean | undefined;
	};
	currentPrice: Decimal | undefined;
	lowerPrice: Decimal | undefined;
	upperPrice: Decimal | undefined;
	lowerSqrtPrice: BN;
	upperSqrtPrice: BN;
	ratioA: number;
	ratioB: number;
	outOfRange: boolean;
};

export const ManagerSwapToken: React.FC<ManagerSwapTokenProps> = ({
	currency0,
	currency1,
	sorted,
	tickAtLimit,
	currentPrice,
	lowerPrice,
	upperPrice,
	ratioA,
	ratioB,
	outOfRange,
}) => {
	const { i18n } = useLingui();
	const { setSorted } = usePoolManagerActions();
	const { setIndependentField } = usePoolActions();

	const handleSortedChange = (value: string) => {
		setSorted(value === Field.CURRENCY_B);
		setIndependentField(
			value === Field.CURRENCY_B ? Field.CURRENCY_B : Field.CURRENCY_A,
		);
	};

	return (
		<Paper p="md" shadow="sm">
			<Stack>
				<SegmentedControl
					bg="var(--color-000)"
					color="gray.17"
					size="sm"
					styles={{ label: { whiteSpace: "normal", overflowWrap: "anywhere" } }}
					fullWidth
					flex={1}
					value={sorted ? Field.CURRENCY_B : Field.CURRENCY_A}
					onChange={handleSortedChange}
					data={[
						{
							label: i18n._("{currencyB} per {currencyA}", {
								currencyA: currency0?.symbol,
								currencyB: currency1?.symbol,
							}),
							value: Field.CURRENCY_A,
						},
						{
							label: i18n._("{currencyA} per {currencyB}", {
								currencyA: currency0?.symbol,
								currencyB: currency1?.symbol,
							}),
							value: Field.CURRENCY_B,
						},
					]}
				/>
				<Group flex={1} wrap="nowrap" justify="space-between" gap={0}>
					<Stack gap={4}>
						<Text fz="sm" fw={600} c="gray.4" ta="center">
							{i18n._("Min Price")}
						</Text>
						<Text fz="lg" fw={600} ta="center">
							{formatTickPrice(lowerPrice, tickAtLimit, PriceInputs.LOWER)}
						</Text>
						<Text fz="xs" fw={600} c="gray.4">
							100% {sorted ? currency1?.symbol : currency0?.symbol}
						</Text>
					</Stack>
					<IconChevronLeft width={20} />
					<Stack gap={4} justify="center" align="center">
						<Text fz="sm" fw={600} c="gray.4">
							{i18n._("Current Price")}
						</Text>
						<Text fz="lg" fw={600} title={currentPrice?.toString()}>
							{currentPrice?.toSignificantDigits(6).toString() ?? "—"}
						</Text>
						<Group gap={0}>
							<Text fz="xs" fw={600} c="gray.4">
								<NumberFormatter value={ratioA} suffix="%" decimalScale={2} />{" "}
								{currency0?.symbol}
							</Text>
							<IconPoint width={12} />
							<Text fz="xs" fw={600} c="gray.4">
								<NumberFormatter value={ratioB} suffix="%" decimalScale={2} />{" "}
								{currency1?.symbol}
							</Text>
						</Group>
					</Stack>
					<IconChevronRight width={20} />
					<Stack gap={4}>
						<Text fz="sm" fw={600} c="gray.4" ta="center">
							{i18n._("Max Price")}
						</Text>
						<Text fz="lg" fw={600} ta="center">
							{formatTickPrice(upperPrice, tickAtLimit, PriceInputs.UPPER)}
						</Text>
						<Text fz="xs" fw={600} c="gray.4">
							100% {sorted ? currency0?.symbol : currency1?.symbol}
						</Text>
					</Stack>
				</Group>
				<ManagerRangeBar
					currentPrice={currentPrice}
					lowerPrice={lowerPrice}
					upperPrice={upperPrice}
					unbounded={Boolean(tickAtLimit.LOWER || tickAtLimit.UPPER)}
					outOfRange={outOfRange}
				/>
			</Stack>
		</Paper>
	);
};
