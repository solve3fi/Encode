import {
	LAUNCH_FEE_TIERS,
	LAUNCH_TOKEN_A_DECIMALS,
	LAUNCH_TOKEN_A_MINT,
	LAUNCH_TOKEN_B_DECIMALS,
	LAUNCH_TOKEN_B_MINT,
	type LaunchLadderInputs,
	MAX_TICK_INDEX,
	TICK_ARRAY_SIZE,
} from "@/configs/launchLadder";

// Whirlpool tick math in plain floats. Precision here is for planning —
// the deploy script takes the exact sqrt_price_x64 from the SDK's
// tickIndex → sqrtPrice helper; only the tick indices in the exported
// JSON are authoritative.
const LN_TICK = Math.log(1.0001);
const DECIMAL_SHIFT = 10 ** (LAUNCH_TOKEN_B_DECIMALS - LAUNCH_TOKEN_A_DECIMALS);
const TOKEN_A_UNIT = 10 ** LAUNCH_TOKEN_A_DECIMALS;
const TOKEN_B_UNIT = 10 ** LAUNCH_TOKEN_B_DECIMALS;

// UI price (USDC per SOLV3) <-> raw pool price (token B units per token A unit).
const rawPrice = (ui: number) => ui * DECIMAL_SHIFT;
const uiPrice = (raw: number) => raw / DECIMAL_SHIFT;
export const tickIndexOfPrice = (ui: number) =>
	Math.floor(Math.log(rawPrice(ui)) / LN_TICK);
export const priceOfTickIndex = (tick: number) => uiPrice(1.0001 ** tick);
const sqrtPriceOfTick = (tick: number) => 1.0001 ** (tick / 2);

export type LadderBandKey = "thin" | "medium" | "heavy";

export type LadderBand = {
	key: LadderBandKey;
	tickLower: number;
	tickUpper: number;
	// Tick-aligned prices, not the typed targets.
	priceLower: number;
	priceUpper: number;
	targetLower: number;
	targetUpper: number;
	percent: number;
	tokens: number;
	// On-chain liquidity value (raw units) the position will report.
	liquidity: number;
	sqrtLower: number;
	sqrtUpper: number;
	// USDC collected if the whole band is bought through.
	proceedsUsdc: number;
	// = sqrt(priceLower * priceUpper): the sale price of the band's tokens
	// regardless of how much liquidity they're spread over.
	averageFillPrice: number;
	// USDC needed to push price +1% at the band's geometric midpoint —
	// the number that makes "thin" and "heavy" concrete.
	usdcPerOnePercent: number;
};

export type LadderFloor = {
	tickLower: number;
	tickUpper: number;
	priceLower: number;
	priceUpper: number;
	usdc: number;
	liquidity: number;
	// SOLV3 the floor would buy if price fell all the way through it.
	absorbsTokens: number;
	usdcPerOnePercent: number;
};

export type LadderModel = {
	inputs: LaunchLadderInputs;
	tickSpacing: number;
	feeRate: number;
	// The pool initializes strictly below the thin band's lower tick so all
	// three positions are token A only; the first buy crosses the empty gap
	// for free.
	initTickIndex: number;
	initPrice: number;
	initSqrtPriceX64Approx: bigint;
	bands: LadderBand[];
	floor: LadderFloor | null;
	// Every tick array start index a swap could traverse, floor included —
	// all of them must exist before the first swap.
	tickArrayStartIndices: number[];
	totalProceedsUsdc: number;
	topPrice: number;
	percentTotal: number;
	deployedTokens: number;
};

const snapToSpacing = (tick: number, spacing: number) =>
	Math.round(tick / spacing) * spacing;

export function computeLadder(inputs: LaunchLadderInputs): LadderModel {
	const spacing = inputs.tickSpacing;
	const feeRate =
		LAUNCH_FEE_TIERS.find((tier) => tier.tickSpacing === spacing)?.feeRate ?? 0;
	const targets = [
		inputs.launchPrice,
		inputs.thinTop,
		inputs.mediumTop,
		inputs.heavyTop,
	];
	const ticks = targets.map((price) =>
		Math.min(MAX_TICK_INDEX, snapToSpacing(tickIndexOfPrice(price), spacing)),
	);
	// Two targets can snap onto the same tick at coarse spacings; keep the
	// bands strictly ordered rather than producing a zero-width position.
	for (let i = 1; i < ticks.length; i++) {
		if (ticks[i] <= ticks[i - 1]) ticks[i] = ticks[i - 1] + spacing;
	}
	const launchTick = tickIndexOfPrice(inputs.launchPrice);
	const initTickIndex = launchTick < ticks[0] ? launchTick : ticks[0] - 1;

	const percents: Record<LadderBandKey, number> = {
		thin: inputs.thinPercent,
		medium: inputs.mediumPercent,
		heavy: inputs.heavyPercent,
	};
	const bands = (["thin", "medium", "heavy"] as const).map((key, i) => {
		const tickLower = ticks[i];
		const tickUpper = ticks[i + 1];
		const tokens = (inputs.floatTokens * percents[key]) / 100;
		const sqrtLower = sqrtPriceOfTick(tickLower);
		const sqrtUpper = sqrtPriceOfTick(tickUpper);
		// Token A held by a position entirely above the current price:
		// x = L (1/√Pa − 1/√Pb)  ⇒  L = x √Pa √Pb / (√Pb − √Pa)
		const liquidity =
			(tokens * TOKEN_A_UNIT * sqrtLower * sqrtUpper) / (sqrtUpper - sqrtLower);
		// Token B collected crossing the whole range: y = L (√Pb − √Pa)
		const proceedsUsdc = (liquidity * (sqrtUpper - sqrtLower)) / TOKEN_B_UNIT;
		const priceLower = priceOfTickIndex(tickLower);
		const priceUpper = priceOfTickIndex(tickUpper);
		const midRaw = rawPrice(Math.sqrt(priceLower * priceUpper));
		const usdcPerOnePercent =
			(liquidity * (Math.sqrt(midRaw * 1.01) - Math.sqrt(midRaw))) /
			TOKEN_B_UNIT;
		return {
			key,
			tickLower,
			tickUpper,
			priceLower,
			priceUpper,
			targetLower: targets[i],
			targetUpper: targets[i + 1],
			percent: percents[key],
			tokens,
			liquidity,
			sqrtLower,
			sqrtUpper,
			proceedsUsdc,
			averageFillPrice:
				tokens > 0 ? proceedsUsdc / tokens : Math.sqrt(priceLower * priceUpper),
			usdcPerOnePercent,
		} satisfies LadderBand;
	});

	let floor: LadderFloor | null = null;
	if (
		inputs.floorUsdc > 0 &&
		inputs.floorBottomPrice > 0 &&
		inputs.floorBottomPrice < inputs.launchPrice
	) {
		// A token-B-only position needs current_tick >= tick_upper, so the
		// floor stops one spacing under the thin band rather than touching it.
		const tickUpper = ticks[0] - spacing;
		let tickLower = snapToSpacing(
			tickIndexOfPrice(inputs.floorBottomPrice),
			spacing,
		);
		if (tickLower >= tickUpper) tickLower = tickUpper - spacing;
		const sqrtLower = sqrtPriceOfTick(tickLower);
		const sqrtUpper = sqrtPriceOfTick(tickUpper);
		const liquidity =
			(inputs.floorUsdc * TOKEN_B_UNIT) / (sqrtUpper - sqrtLower);
		const priceLower = priceOfTickIndex(tickLower);
		const priceUpper = priceOfTickIndex(tickUpper);
		const midRaw = rawPrice(Math.sqrt(priceLower * priceUpper));
		floor = {
			tickLower,
			tickUpper,
			priceLower,
			priceUpper,
			usdc: inputs.floorUsdc,
			liquidity,
			absorbsTokens:
				(liquidity * (1 / sqrtLower - 1 / sqrtUpper)) / TOKEN_A_UNIT,
			usdcPerOnePercent:
				(liquidity * (Math.sqrt(midRaw) - Math.sqrt(midRaw * 0.99))) /
				TOKEN_B_UNIT,
		};
	}

	const arraySpan = TICK_ARRAY_SIZE * spacing;
	const arrayStart = (tick: number) => Math.floor(tick / arraySpan) * arraySpan;
	const tickArrayStartIndices: number[] = [];
	const lowest = floor ? floor.tickLower : initTickIndex;
	for (
		let start = arrayStart(lowest);
		start <= arrayStart(ticks[3]);
		start += arraySpan
	) {
		tickArrayStartIndices.push(start);
	}

	const percentTotal =
		inputs.thinPercent + inputs.mediumPercent + inputs.heavyPercent;
	return {
		inputs,
		tickSpacing: spacing,
		feeRate,
		initTickIndex,
		initPrice: priceOfTickIndex(initTickIndex),
		initSqrtPriceX64Approx: BigInt(
			Math.round(sqrtPriceOfTick(initTickIndex) * 2 ** 64),
		),
		bands,
		floor,
		tickArrayStartIndices,
		totalProceedsUsdc: bands.reduce((sum, band) => sum + band.proceedsUsdc, 0),
		topPrice: bands[2].priceUpper,
		percentTotal,
		deployedTokens: (inputs.floatTokens * percentTotal) / 100,
	};
}

export type LadderWalkResult = {
	price: number;
	tokensSold: number;
	bandIndex: number;
	// Fraction of the way through that band's price range (0–1).
	bandProgress: number;
	exhausted: boolean;
};

// Where price lands and how much of the float has been sold after `usdc`
// of net buying walks up the ladder from the init tick.
export function walkLadder(model: LadderModel, usdc: number): LadderWalkResult {
	let remaining = usdc * TOKEN_B_UNIT;
	let tokensSold = 0;
	for (let i = 0; i < model.bands.length; i++) {
		const band = model.bands[i];
		const capacity = band.liquidity * (band.sqrtUpper - band.sqrtLower);
		if (remaining >= capacity - 1e-9) {
			remaining -= capacity;
			tokensSold += band.tokens;
			continue;
		}
		const sqrtPrice = band.sqrtLower + remaining / band.liquidity;
		const sold =
			(band.liquidity * (1 / band.sqrtLower - 1 / sqrtPrice)) / TOKEN_A_UNIT;
		const price = uiPrice(sqrtPrice * sqrtPrice);
		return {
			price,
			tokensSold: tokensSold + sold,
			bandIndex: i,
			bandProgress:
				(price - band.priceLower) / (band.priceUpper - band.priceLower),
			exhausted: false,
		};
	}
	return {
		price: model.topPrice,
		tokensSold,
		bandIndex: model.bands.length - 1,
		bandProgress: 1,
		exhausted: true,
	};
}

const rawAmount = (whole: number, unit: number) =>
	BigInt(Math.round(whole * unit)).toString();

// What the deploy script consumes. Amounts are base-unit strings so nothing
// is lost to JSON number precision; liquidity is the expected on-chain
// value to assert against after increase_liquidity.
export function ladderDeployJson(model: LadderModel) {
	return {
		pool: {
			tokenMintA: LAUNCH_TOKEN_A_MINT,
			tokenMintB: LAUNCH_TOKEN_B_MINT,
			feeRate: model.feeRate,
			tickSpacing: model.tickSpacing,
			initialTickIndex: model.initTickIndex,
			initialPriceUi: Number(model.initPrice.toFixed(6)),
			initialSqrtPriceX64Approx: model.initSqrtPriceX64Approx.toString(),
		},
		tickArrayStartIndices: model.tickArrayStartIndices,
		positions: model.bands.map((band) => ({
			band: band.key,
			tickLowerIndex: band.tickLower,
			tickUpperIndex: band.tickUpper,
			priceLowerUi: Number(band.priceLower.toFixed(6)),
			priceUpperUi: Number(band.priceUpper.toFixed(6)),
			tokenAAmount: rawAmount(band.tokens, TOKEN_A_UNIT),
			tokenMaxB: "0",
			expectedLiquidity: BigInt(Math.round(band.liquidity)).toString(),
			expectedProceedsUsdc: Number(band.proceedsUsdc.toFixed(2)),
		})),
		floorPosition: model.floor
			? {
					tickLowerIndex: model.floor.tickLower,
					tickUpperIndex: model.floor.tickUpper,
					tokenBAmount: rawAmount(model.floor.usdc, TOKEN_B_UNIT),
					tokenMaxA: "0",
					expectedLiquidity: BigInt(
						Math.round(model.floor.liquidity),
					).toString(),
				}
			: null,
	};
}
