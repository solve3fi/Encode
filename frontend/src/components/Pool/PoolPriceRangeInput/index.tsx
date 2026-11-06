import { useLingui } from "@lingui/react";
import {
	CheckIcon,
	Group,
	Paper,
	Radio,
	SimpleGrid,
	Stack,
	Text,
	UnstyledButton,
} from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import { PriceMath } from "@solve3fi/sdk";
import type Decimal from "decimal.js";
import { useEffect, useRef } from "react";
import { usePoolRanges } from "@/hooks/usePoolRanges";
import { type PoolRangeTypes, PriceRange } from "@/stores/pool";
import { usePool, usePoolActions } from "@/stores/pool/PoolProvider";
import classes from "./PoolPriceRangeInput.module.css";
import { Points } from "./svg";

export type PoolPriceRangeInputProps = {
	currencyA?: TokenInfo | null;
	currencyB?: TokenInfo | null;
	price: Decimal | undefined;
	invertPrice: boolean;
};

export const PoolPriceRangeInput: React.FC<PoolPriceRangeInputProps> = ({
	currencyA,
	currencyB,
	price,
	invertPrice,
}) => {
	const { i18n } = useLingui();
	const ranges: PoolRangeTypes[] = usePoolRanges();
	const range = usePool((state) => state.range);
	const { setRange, setLowerPrice, setUpperPrice } = usePoolActions();
	// Price the active preset was last computed from: a preset chosen before the pool price settled
	// would otherwise stay centred on a stale price.
	const appliedPrice = useRef<Decimal | undefined>(undefined);
	const handleSetRange = (range: PoolRangeTypes) => {
		if (!price) return;

		appliedPrice.current = price;
		setRange(range);
		if (range.demission === null) {
			setLowerPrice(true);
			setUpperPrice(true);
			return;
		}

		const newPriceLower = price.div(range.demission.toDecimal());
		const newPriceUpper = price.mul(range.demission.toDecimal());

		if (invertPrice) {
			setLowerPrice(
				PriceMath.invertPrice(
					newPriceUpper,
					currencyA?.decimals ?? 8,
					currencyB?.decimals ?? 8,
				)
					.toSignificantDigits(8)
					.toNumber(),
			);
			setUpperPrice(
				PriceMath.invertPrice(
					newPriceLower,
					currencyA?.decimals ?? 8,
					currencyB?.decimals ?? 8,
				)
					.toSignificantDigits(8)
					.toNumber(),
			);
			return;
		}

		setLowerPrice(newPriceLower.toNumber());
		setUpperPrice(newPriceUpper.toNumber());
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: only a real price move should re-centre the preset
	useEffect(() => {
		if (!price || !appliedPrice.current || range.demission === null) return;
		if (price.div(appliedPrice.current).minus(1).abs().lt(0.01)) return;
		handleSetRange(range);
	}, [price?.toString()]);

	return (
		<SimpleGrid cols={2}>
			{ranges.map((item) => (
				<UnstyledButton key={item.active} onClick={() => handleSetRange(item)}>
					<Paper
						px="md"
						py="sm"
						withBorder
						className={classes.item}
						mod={{
							selected:
								range.type === item.type ||
								(!range?.type && item.type === PriceRange.FULL_RANGE),
						}}
					>
						<Group gap={10}>
							<Radio
								icon={CheckIcon}
								checked={
									range.type === item.type ||
									(!range?.type && item.type === PriceRange.FULL_RANGE)
								}
								onChange={() => {}}
								tabIndex={-1}
								size="md"
								classNames={{
									root: classes.root,
									label: classes.label,
									radio: classes.radio,
								}}
								aria-hidden
							/>
							<Text fz="lg" fw="bold">
								{item.label}
							</Text>
						</Group>
						<Stack gap={0} mt={10}>
							<Group align="center" justify="space-between">
								<Text fz="sm">{i18n._("Risk")}</Text>
								<Points
									total={5}
									active={item.active}
									height={10}
									width={10}
									activeColor="var(--negative)"
									inactiveColor={
										range.demission === item.demission ? "var(--accent-muted)" : "var(--color-404040)"
									}
									space={3}
								/>
							</Group>

							<Group align="center" justify="space-between" mt={-5}>
								<Text fz="sm">{i18n._("Profit")}</Text>
								<Points
									total={5}
									active={item.active}
									height={10}
									width={10}
									activeColor="var(--color-14b8a9)"
									inactiveColor={
										range.demission === item.demission ? "var(--accent-muted)" : "var(--color-404040)"
									}
									space={3}
								/>
							</Group>
						</Stack>
					</Paper>
				</UnstyledButton>
			))}
		</SimpleGrid>
	);
};
