import type { TokenInfo } from "@solana/spl-token-registry";
import { PoolUtil, PriceMath, type Solve, TickUtil } from "@solve3fi/sdk";
import { type FeeAmount, TICK_SPACINGS } from "@/stores/pool";
import { usePoolActions } from "@/stores/pool/PoolProvider";

export enum Rounding {
	ROUND_DOWN = 0,
	ROUND_HALF_UP = 1,
	ROUND_UP = 2,
}

export function usePoolActionHooks(
	baseCurrency: TokenInfo | undefined,
	quoteCurrency: TokenInfo | undefined,
	feeAmount: FeeAmount | undefined,
	tickLower: number | undefined,
	tickUpper: number | undefined,
	pool?: Solve | undefined | null,
) {
	const { setLowerPrice, setUpperPrice } = usePoolActions();

	const [mintA] =
		baseCurrency && quoteCurrency
			? PoolUtil.orderMints(baseCurrency.address, quoteCurrency.address)
			: [undefined, undefined];
	const isSorted =
		baseCurrency?.address.toLowerCase() === mintA?.toString().toLowerCase();

	const setDecrementLower = () => {
		if (
			baseCurrency &&
			quoteCurrency &&
			typeof tickLower === "number" &&
			typeof tickUpper === "number" &&
			feeAmount
		) {
			const newPrice = PriceMath.tickIndexToPrice(
				isSorted
					? tickLower - TICK_SPACINGS[feeAmount]
					: TickUtil.invertTick(tickUpper) - TICK_SPACINGS[feeAmount],
				baseCurrency.decimals,
				quoteCurrency.decimals,
			);

			setLowerPrice(newPrice.toSignificantDigits(8).toNumber());
		}

		if (
			!(typeof tickLower === "number") &&
			baseCurrency &&
			quoteCurrency &&
			feeAmount &&
			pool
		) {
			const newPrice = PriceMath.tickIndexToPrice(
				pool.getData().tickCurrentIndex - TICK_SPACINGS[feeAmount],
				baseCurrency.decimals,
				quoteCurrency.decimals,
			);
			setLowerPrice(newPrice.toSignificantDigits(8).toNumber());
		}
	};

	const setIncrementLower = () => {
		if (
			baseCurrency &&
			quoteCurrency &&
			typeof tickLower === "number" &&
			typeof tickUpper === "number" &&
			feeAmount
		) {
			const newPrice = PriceMath.tickIndexToPrice(
				isSorted
					? tickLower + TICK_SPACINGS[feeAmount]
					: TickUtil.invertTick(tickUpper) + TICK_SPACINGS[feeAmount],
				baseCurrency.decimals,
				quoteCurrency.decimals,
			);
			setLowerPrice(newPrice.toSignificantDigits(8).toNumber());
		}

		if (
			!(typeof tickLower === "number") &&
			baseCurrency &&
			quoteCurrency &&
			feeAmount &&
			pool
		) {
			const newPrice = PriceMath.tickIndexToPrice(
				pool.getData().tickCurrentIndex + TICK_SPACINGS[feeAmount],
				baseCurrency.decimals,
				quoteCurrency.decimals,
			);
			setLowerPrice(newPrice.toSignificantDigits(8).toNumber());
		}
	};

	const setDecrementUpper = () => {
		if (
			baseCurrency &&
			quoteCurrency &&
			typeof tickUpper === "number" &&
			typeof tickLower === "number" &&
			feeAmount
		) {
			const newPrice = PriceMath.tickIndexToPrice(
				isSorted
					? tickUpper - TICK_SPACINGS[feeAmount]
					: TickUtil.invertTick(tickLower) - TICK_SPACINGS[feeAmount],
				baseCurrency.decimals,
				quoteCurrency.decimals,
			);
			setUpperPrice(newPrice.toSignificantDigits(8).toNumber());
		}

		if (
			!(typeof tickUpper === "number") &&
			baseCurrency &&
			quoteCurrency &&
			feeAmount &&
			pool
		) {
			const newPrice = PriceMath.tickIndexToPrice(
				pool.getData().tickCurrentIndex - TICK_SPACINGS[feeAmount],
				baseCurrency.decimals,
				quoteCurrency.decimals,
			);
			setUpperPrice(newPrice.toSignificantDigits(8).toNumber());
		}
	};

	const setIncrementUpper = () => {
		if (
			baseCurrency &&
			quoteCurrency &&
			typeof tickUpper === "number" &&
			typeof tickLower === "number" &&
			feeAmount
		) {
			const newPrice = PriceMath.tickIndexToPrice(
				isSorted
					? tickUpper + TICK_SPACINGS[feeAmount]
					: TickUtil.invertTick(tickLower) + TICK_SPACINGS[feeAmount],
				baseCurrency.decimals,
				quoteCurrency.decimals,
			);
			setUpperPrice(newPrice.toSignificantDigits(8).toNumber());
		}
		if (
			!(typeof tickUpper === "number") &&
			baseCurrency &&
			quoteCurrency &&
			feeAmount &&
			pool
		) {
			const newPrice = PriceMath.tickIndexToPrice(
				pool.getData().tickCurrentIndex + TICK_SPACINGS[feeAmount],
				baseCurrency.decimals,
				quoteCurrency.decimals,
			);
			setUpperPrice(newPrice.toSignificantDigits(8).toNumber());
		}
	};

	return {
		setDecrementLower,
		setIncrementLower,
		setDecrementUpper,
		setIncrementUpper,
	};
}
