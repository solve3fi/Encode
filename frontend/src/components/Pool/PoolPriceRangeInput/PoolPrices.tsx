"use client";

import { Flex } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import { PoolUtil, PriceMath, type Solve } from "@solve3fi/sdk";
import type Decimal from "decimal.js";
import { useMemo } from "react";
import { usePoolActionHooks } from "@/hooks/usePoolActionHooks";
import { PriceInputs } from "@/stores/pool";
import { PoolPriceCustom } from "./PoolPriceCustom";

export type PoolPricesProps = {
	priceLower?: Decimal;
	priceUpper?: Decimal;
	tickLower?: number;
	tickUpper?: number;
	currencyA?: TokenInfo | null;
	currencyB?: TokenInfo | null;
	feeAmount?: number;
	ticksAtLimit?: { [bound in PriceInputs]?: boolean | undefined };
	pool?: Solve | undefined | null;
};

export const PoolPrices: React.FC<PoolPricesProps> = ({
	currencyA,
	currencyB,
	priceLower,
	priceUpper,
	tickLower,
	tickUpper,
	feeAmount,
	ticksAtLimit,
	pool,
}) => {
	const [mintA] =
		currencyA && currencyB
			? PoolUtil.orderMints(currencyA.address, currencyB.address)
			: [undefined, undefined];
	const isSorted =
		currencyA?.address.toLowerCase() === mintA?.toString().toLowerCase();

	const leftPrice = useMemo(() => {
		if (isSorted) return priceLower;
		if (
			!priceUpper ||
			priceUpper.isZero() ||
			!currencyA?.decimals ||
			!currencyB?.decimals
		)
			return undefined;

		try {
			return PriceMath.invertPrice(
				priceUpper,
				currencyA.decimals,
				currencyB.decimals,
			);
		} catch {
			return undefined;
		}
	}, [
		isSorted,
		priceLower,
		priceUpper,
		currencyA?.decimals,
		currencyB?.decimals,
	]);

	const rightPrice = useMemo(() => {
		if (isSorted) return priceUpper;
		if (
			!priceLower ||
			priceLower.isZero() ||
			!currencyA?.decimals ||
			!currencyB?.decimals
		)
			return undefined;

		try {
			return PriceMath.invertPrice(
				priceLower,
				currencyA.decimals,
				currencyB.decimals,
			);
		} catch {
			return undefined;
		}
	}, [
		isSorted,
		priceUpper,
		priceLower,
		currencyA?.decimals,
		currencyB?.decimals,
	]);

	const {
		setDecrementLower,
		setIncrementLower,
		setDecrementUpper,
		setIncrementUpper,
	} = usePoolActionHooks(
		currencyA || undefined,
		currencyB || undefined,
		feeAmount,
		tickLower,
		tickUpper,
		pool,
	);

	return (
		<Flex
			gap={16}
			direction={{ base: "column", md: "row" }}
			justify="space-between"
		>
			<PoolPriceCustom
				label="Min"
				value={
					ticksAtLimit?.[isSorted ? PriceInputs.LOWER : PriceInputs.UPPER]
						? "0"
						: (leftPrice?.toSignificantDigits(5).toNumber() ?? "")
				}
				tokenA={currencyA?.symbol}
				tokenB={currencyB?.symbol}
				setDecrement={setDecrementLower}
				setIncrement={setIncrementLower}
			/>
			<PoolPriceCustom
				label="Max"
				value={
					ticksAtLimit?.[isSorted ? PriceInputs.UPPER : PriceInputs.LOWER]
						? "∞"
						: (rightPrice?.toSignificantDigits(5).toNumber() ?? "")
				}
				tokenA={currencyA?.symbol}
				tokenB={currencyB?.symbol}
				setDecrement={setDecrementUpper}
				setIncrement={setIncrementUpper}
			/>
		</Flex>
	);
};
