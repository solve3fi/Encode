import { useLingui } from "@lingui/react";
import {
	AddressUtil,
	DecimalUtil,
	Percentage,
} from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { PublicKey } from "@solana/web3.js";
import {
	type IncreaseLiquidityQuote,
	MAX_TICK_INDEX,
	MIN_TICK_INDEX,
	PoolUtil,
	type Position,
	PriceMath,
	type Solve,
	TickUtil,
} from "@solve3fi/sdk";
import BN from "bn.js";
import type Decimal from "decimal.js";
import type { ReactNode } from "react";
import { useAnchor } from "@/providers/DappProvider";
import {
	type FeeAmount,
	Field,
	PriceInputs,
	TICK_SPACINGS,
} from "@/stores/pool";
import { usePool } from "@/stores/pool/PoolProvider";
import { useCurrencyBalances } from "./useCurrencyBalanace";
import { useIncreaseLiquidityQuote } from "./useIncreaseLiquidityQuote";
import { PoolState, usePoolState } from "./usePoolState";
import { useUserSlippageToleranceWithDefault } from "./useUserSlippage";

export type DerivedMintInfo = {
	dependentField: Field;
	currencies: {
		[field in Field]: TokenInfo | undefined;
	};
	pool: Solve | null;
	quote?: IncreaseLiquidityQuote;
	poolState: PoolState;
	currencyBalances: {
		[field in Field]: Decimal | undefined;
	};
	parsedAmounts: {
		[field in Field]: Decimal | undefined;
	};
	ticks: {
		[field in PriceInputs]: number | undefined;
	};
	price: Decimal | undefined;
	pricesAtTicks: {
		[field in PriceInputs]: Decimal | undefined;
	};
	noLiquidity: boolean;
	errorMessage: ReactNode;
	invalidPool: boolean;
	invalidRange: boolean;
	outOfRange: boolean;
	depositADisabled: boolean;
	depositBDisabled: boolean;
	invertPrice: boolean;
	ticksAtLimit: {
		[field in PriceInputs]: boolean | undefined;
	};
	tickCurrentIndex: number | undefined;
	inputTokenAmount: BN | undefined;
	inputTokenMint: string | undefined;
	slippageTolerance: Percentage;
};

export const useDerivedMintInfo = (
	currencyA: TokenInfo | undefined,
	currencyB: TokenInfo | undefined,
	feeAmount: FeeAmount,
	baseCurrency?: TokenInfo,
	existingPosition?: Position,
): DerivedMintInfo => {
	const { i18n } = useLingui();
	const { publicKey } = useAnchor();

	const independentField = usePool((state) => state.independentField);
	const typedValue = usePool((state) => state.typedValue);
	const desiredAmount = usePool((state) => state.desiredAmount);
	const lowerPrice = usePool((state) => state.lowerPrice);
	const upperPrice = usePool((state) => state.upperPrice);

	const dependentField =
		independentField === Field.CURRENCY_A ? Field.CURRENCY_B : Field.CURRENCY_A;

	const currencies = {
		[Field.CURRENCY_A]: currencyA,
		[Field.CURRENCY_B]: currencyB,
	};

	const [tokenA, tokenB, baseToken] = [currencyA, currencyB, baseCurrency];

	const [token0, token1] = (() => {
		if (!tokenA || !tokenB) return [undefined, undefined];
		const [tokenAddressA, tokenAddressB] = PoolUtil.orderMints(
			tokenA.address,
			tokenB.address,
		);

		return [
			AddressUtil.toPubKey(tokenAddressA).equals(
				AddressUtil.toPubKey(tokenA.address),
			)
				? tokenA
				: tokenB,
			AddressUtil.toPubKey(tokenAddressB).equals(
				AddressUtil.toPubKey(tokenB.address),
			)
				? tokenB
				: tokenA,
		];
	})();

	const balances = useCurrencyBalances([
		currencies[Field.CURRENCY_A],
		currencies[Field.CURRENCY_B],
	]);

	const currencyBalances = {
		[Field.CURRENCY_A]: balances[0],
		[Field.CURRENCY_B]: balances[1],
	};

	const [poolState, pool] = usePoolState(
		currencies[Field.CURRENCY_A],
		currencies[Field.CURRENCY_B],
		feeAmount,
	);

	const noLiquidity = poolState === PoolState.NOT_EXISTS;
	const invertPrice = Boolean(
		baseToken &&
			token0 &&
			!AddressUtil.toPubKey(baseToken.address).equals(
				AddressUtil.toPubKey(token0.address),
			),
	);

	const tokenADecimals =
		(invertPrice ? token1?.decimals : token0?.decimals) || 0;
	const tokenBDecimals =
		(invertPrice ? token0?.decimals : token1?.decimals) || 0;

	const price = (() => {
		if (!token0 || !token1) return undefined;

		if (noLiquidity) {
			const initSqrt = PriceMath.priceToSqrtPriceX64(
				DecimalUtil.fromNumber(desiredAmount || 1),
				tokenADecimals,
				tokenBDecimals,
			);

			const price = PriceMath.sqrtPriceX64ToPrice(
				initSqrt,
				tokenADecimals,
				tokenBDecimals,
			);
			return invertPrice
				? PriceMath.invertPrice(price, tokenADecimals, tokenBDecimals)
				: price;
		}

		if (!pool) return undefined;
		const sqrt_price_x64 = pool.getData().sqrtPrice;

		return PriceMath.sqrtPriceX64ToPrice(
			sqrt_price_x64,
			token0?.decimals,
			token1?.decimals,
		);
	})();

	const invalidPrice = price === undefined;

	const tickSpaceLimits = (() => ({
		[PriceInputs.LOWER]: feeAmount
			? TickUtil.getInitializableTickIndex(
					MIN_TICK_INDEX,
					TICK_SPACINGS[feeAmount],
				)
			: undefined,
		[PriceInputs.UPPER]: feeAmount
			? TickUtil.getInitializableTickIndex(
					MAX_TICK_INDEX,
					TICK_SPACINGS[feeAmount],
				)
			: undefined,
	}))();

	// Dragging a brush handle near the Full Range extremes can produce a price
	// just past what's representable at this fee tier's tick spacing (the
	// chart's own scale is a narrow linear window around the current price,
	// not the full log-scale domain, so an inverted/extrapolated pixel
	// position can overshoot MIN/MAX_TICK_INDEX slightly). priceToInitializable
	// TickIndex throws in that case; clamp to the nearest valid limit instead
	// of letting that exception crash the whole page.
	const safeTickIndex = (
		priceValue: number,
		fallback: number | undefined,
	): number | undefined => {
		try {
			return PriceMath.priceToInitializableTickIndex(
				DecimalUtil.fromNumber(priceValue),
				tokenADecimals,
				tokenBDecimals,
				TICK_SPACINGS[feeAmount],
			);
		} catch {
			return fallback;
		}
	};

	const ticks = {
		[PriceInputs.LOWER]:
			typeof existingPosition?.getData().tickLowerIndex === "number"
				? existingPosition.getData().tickLowerIndex
				: (invertPrice && typeof upperPrice === "boolean") ||
						(!invertPrice && typeof lowerPrice === "boolean")
					? tickSpaceLimits[PriceInputs.LOWER]
					: invertPrice
						? (() => {
								const tick = safeTickIndex(
									Number(upperPrice),
									tickSpaceLimits[PriceInputs.UPPER],
								);
								return typeof tick === "number"
									? TickUtil.invertTick(tick)
									: tickSpaceLimits[PriceInputs.LOWER];
							})()
						: safeTickIndex(
								Number(lowerPrice),
								tickSpaceLimits[PriceInputs.LOWER],
							),

		[PriceInputs.UPPER]:
			typeof existingPosition?.getData().tickUpperIndex === "number"
				? existingPosition.getData().tickUpperIndex
				: (invertPrice && typeof upperPrice === "boolean") ||
						(!invertPrice && typeof lowerPrice === "boolean")
					? tickSpaceLimits[PriceInputs.UPPER]
					: invertPrice
						? (() => {
								const tick = safeTickIndex(
									Number(lowerPrice),
									tickSpaceLimits[PriceInputs.LOWER],
								);
								return typeof tick === "number"
									? TickUtil.invertTick(tick)
									: tickSpaceLimits[PriceInputs.UPPER];
							})()
						: safeTickIndex(
								Number(upperPrice),
								tickSpaceLimits[PriceInputs.UPPER],
							),
	};

	const { [PriceInputs.LOWER]: tickLower, [PriceInputs.UPPER]: tickUpper } =
		ticks || {};

	const ticksAtLimit = (() => ({
		[PriceInputs.LOWER]: feeAmount && tickLower === tickSpaceLimits.LOWER,
		[PriceInputs.UPPER]: feeAmount && tickUpper === tickSpaceLimits.UPPER,
	}))();

	const invalidRange = Boolean(
		typeof tickLower === "number" &&
			typeof tickUpper === "number" &&
			tickLower >= tickUpper,
	);

	const pricesAtTicks = (() => {
		return {
			[PriceInputs.LOWER]: ticks[PriceInputs.LOWER]
				? invertPrice
					? PriceMath.tickIndexToPrice(
							ticks[PriceInputs.LOWER],
							tokenBDecimals,
							tokenADecimals,
						)
					: PriceMath.tickIndexToPrice(
							ticks[PriceInputs.LOWER],
							tokenADecimals,
							tokenBDecimals,
						)
				: undefined,
			[PriceInputs.UPPER]: ticks[PriceInputs.UPPER]
				? invertPrice
					? PriceMath.tickIndexToPrice(
							ticks[PriceInputs.UPPER],
							tokenBDecimals,
							tokenADecimals,
						)
					: PriceMath.tickIndexToPrice(
							ticks[PriceInputs.UPPER],
							tokenADecimals,
							tokenBDecimals,
						)
				: undefined,
		};
	})();

	const {
		[PriceInputs.LOWER]: lowerPriceRange,
		[PriceInputs.UPPER]: upperPriceRange,
	} = pricesAtTicks;
	const outOfRange = Boolean(
		!invalidRange &&
			price &&
			lowerPriceRange &&
			upperPriceRange &&
			(price.lessThan(lowerPriceRange) || price.greaterThan(upperPriceRange)),
	);

	const independentAmount = DecimalUtil.fromNumber(
		Number.isNaN(Number(typedValue)) ? 0 : Number(typedValue),
	);
	// A 0/0 fraction here (rather than 0/10_000) divides by zero inside the
	// SDK's getSlippageBoundForSqrtPrice (Decimal 0/0 -> NaN -> new BN("NaN")),
	// throwing "Invalid character" — this was the site/liquidity/create crash.
	const slippageTolerance = useUserSlippageToleranceWithDefault(
		outOfRange
			? Percentage.fromFraction(0, 10_000)
			: Percentage.fromFraction(50, 10_000),
	);
	const tickCurrentIndex = pool
		? pool.getData().tickCurrentIndex
		: desiredAmount
			? invertPrice
				? TickUtil.invertTick(
						PriceMath.priceToInitializableTickIndex(
							DecimalUtil.fromNumber(desiredAmount),
							tokenADecimals,
							tokenBDecimals,
							TICK_SPACINGS[feeAmount],
						),
					)
				: PriceMath.priceToInitializableTickIndex(
						DecimalUtil.fromNumber(desiredAmount),
						tokenADecimals,
						tokenBDecimals,
						TICK_SPACINGS[feeAmount],
					)
			: undefined;

	// For a new pool the quote must use the price the pool will really start at, in the pool's own
	// token order: the same (already inverted) starting tick that createPool receives. Converting
	// the typed price directly produced the reciprocal when the base token is not the pool's
	// first token, which inflated the paired deposit by about a million.
	const sqrtPrice = pool
		? pool.getData().sqrtPrice
		: typeof tickCurrentIndex === "number"
			? PriceMath.tickIndexToSqrtPriceX64(tickCurrentIndex)
			: new BN(0);

	const inputTokenAmount = DecimalUtil.toBN(
		independentAmount,
		currencies[independentField]?.decimals,
	);
	const inputTokenMint = currencies[independentField]?.address;

	const quote = useIncreaseLiquidityQuote(
		inputTokenAmount,
		inputTokenMint,
		token0?.address,
		token1?.address,
		tickCurrentIndex,
		sqrtPrice,
		tickLower,
		tickUpper,
		slippageTolerance,
	);

	const dependentAmount = (() => {
		const dependentAmounts = {
			[Field.CURRENCY_A]: quote?.tokenEstA,
			[Field.CURRENCY_B]: quote?.tokenEstB,
		};

		if (invertPrice) {
			if (independentField === Field.CURRENCY_A) {
				return DecimalUtil.fromBN(
					dependentAmounts[Field.CURRENCY_A] ?? new BN(0),
					tokenBDecimals,
				);
			}
			return DecimalUtil.fromBN(
				dependentAmounts[Field.CURRENCY_B] ?? new BN(0),
				tokenADecimals,
			);
		}

		if (independentField === Field.CURRENCY_A) {
			return DecimalUtil.fromBN(
				dependentAmounts[Field.CURRENCY_B] ?? new BN(0),
				tokenBDecimals,
			);
		}
		return DecimalUtil.fromBN(
			dependentAmounts[Field.CURRENCY_A] ?? new BN(0),
			tokenADecimals,
		);
	})();

	const parsedAmounts: {
		[field in Field]: Decimal | undefined;
	} = (() => {
		return {
			[Field.CURRENCY_A]:
				independentField === Field.CURRENCY_A
					? independentAmount
					: dependentAmount,
			[Field.CURRENCY_B]:
				independentField === Field.CURRENCY_A
					? dependentAmount
					: independentAmount,
		};
	})();

	const deposit0Disabled = Boolean(
		typeof tickUpper === "number" &&
			pool &&
			pool.getData().tickCurrentIndex >= tickUpper,
	);
	const deposit1Disabled = Boolean(
		typeof tickLower === "number" &&
			pool &&
			pool.getData().tickCurrentIndex <= tickLower,
	);

	const depositADisabled =
		invalidRange ||
		Boolean(
			(deposit0Disabled &&
				pool &&
				token0 &&
				pool.getData().tokenMintA.equals(new PublicKey(token0.address))) ||
				(deposit1Disabled &&
					pool &&
					token0 &&
					pool.getData().tokenMintB.equals(new PublicKey(token0.address))),
		);
	const depositBDisabled =
		invalidRange ||
		Boolean(
			(deposit0Disabled &&
				pool &&
				tokenB &&
				pool.getData().tokenMintB.equals(new PublicKey(tokenB.address))) ||
				(deposit1Disabled &&
					pool &&
					tokenB &&
					pool.getData().tokenMintA.equals(new PublicKey(tokenB.address))),
		);

	const invalidPool = poolState === PoolState.INVALID;

	let errorMessage: ReactNode | undefined;
	if (!publicKey) {
		errorMessage = i18n.t("Connect Wallet");
	}

	if (poolState === PoolState.INVALID) {
		errorMessage = errorMessage ?? i18n.t("Invalid pair");
	}

	if (invalidPrice) {
		errorMessage = errorMessage ?? i18n.t("Invalid price input");
	}

	// Deliberately not an error: a range entirely above or below the current
	// price is a valid single-sided position (a "range order") that simply
	// sits inactive, earning nothing, until price moves into it. The
	// deposit0Disabled/deposit1Disabled checks above already zero out and
	// disable the wrong side's input for this case, and the "Enter an
	// amount" check below already only requires the side that's still
	// enabled.

	if (
		noLiquidity &&
		DecimalUtil.fromNumber(desiredAmount || 0).lessThanOrEqualTo(0)
	) {
		errorMessage = errorMessage ?? i18n.t("Enter an desired amount");
	}

	if (
		(!parsedAmounts[Field.CURRENCY_A] && !depositADisabled) ||
		(!parsedAmounts[Field.CURRENCY_B] && !depositBDisabled)
	) {
		errorMessage = errorMessage ?? i18n.t("Enter an amount");
	}

	const {
		[Field.CURRENCY_A]: currencyAAmount,
		[Field.CURRENCY_B]: currencyBAmount,
	} = parsedAmounts;

	if (
		currencies?.[Field.CURRENCY_A] &&
		currencyAAmount &&
		currencyBalances?.[Field.CURRENCY_A] &&
		currencyBalances?.[Field.CURRENCY_A].lessThan(currencyAAmount)
	) {
		errorMessage = i18n.t("Insufficient {symbol} balance", {
			symbol: currencies[Field.CURRENCY_A]?.symbol,
		});
	}

	if (
		currencies?.[Field.CURRENCY_B] &&
		currencyBAmount &&
		currencyBalances?.[Field.CURRENCY_B] &&
		currencyBalances?.[Field.CURRENCY_B].lessThan(currencyBAmount)
	) {
		errorMessage = i18n.t("Insufficient {symbol} balance", {
			symbol: currencies[Field.CURRENCY_B]?.symbol,
		});
	}

	return {
		dependentField,
		currencies,
		pool,
		quote,
		poolState,
		currencyBalances,
		parsedAmounts,
		ticks,
		price,
		pricesAtTicks,
		noLiquidity,
		errorMessage,
		invalidPool,
		invalidRange,
		outOfRange,
		depositADisabled,
		depositBDisabled,
		invertPrice,
		ticksAtLimit,
		tickCurrentIndex,
		inputTokenAmount,
		inputTokenMint,
		slippageTolerance,
	};
};
