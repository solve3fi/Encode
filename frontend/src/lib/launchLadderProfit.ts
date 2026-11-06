// Pure helpers for taking profit off the launch ladder and redeploying it.
// No imports: the panel passes plain numbers/strings so this is testable
// without a wallet or RPC.

export type PositionStatus = "filled" | "active" | "unfilled";

/** Where the pool price sits relative to a position's range. A "filled"
 * position (price at or above its upper tick) holds only token B (USDC). */
export const classifyPosition = (
	currentTick: number,
	tickLower: number,
	tickUpper: number,
): PositionStatus => {
	if (currentTick >= tickUpper) return "filled";
	if (currentTick < tickLower) return "unfilled";
	return "active";
};

export type Split = { blueChip: bigint; solv3: bigint };

/** Splits a USDC base-unit amount by a whole-or-fractional percent going to
 * the blue-chip pool; the remainder goes to SOLV3/USDC so nothing is lost to
 * rounding. Percent is in basis points of 100% (0-10000 bps). */
export const splitUsdc = (total: bigint, blueChipBps: number): Split => {
	if (
		!Number.isInteger(blueChipBps) ||
		blueChipBps < 0 ||
		blueChipBps > 10000
	) {
		throw new Error("blue-chip share must be 0-100%");
	}
	if (total < BigInt(0)) throw new Error("amount must not be negative");
	const blueChip = (total * BigInt(blueChipBps)) / BigInt(10000);
	return { blueChip, solv3: total - blueChip };
};

const LN_TICK = Math.log(1.0001);

/** Tick range for "lowerPct below, upperPct above" the current price, snapped
 * inward to the tick spacing. Percents are positive numbers, e.g. 10 = 10%. */
export const rangeAroundTick = (
	currentTick: number,
	lowerPctBelow: number,
	upperPctAbove: number,
	tickSpacing: number,
): { tickLower: number; tickUpper: number } => {
	if (
		!(lowerPctBelow > 0 && lowerPctBelow < 100) ||
		!(upperPctAbove > 0) ||
		!(tickSpacing > 0)
	) {
		throw new Error("range percents must be positive (lower below 100%)");
	}
	const lowRaw = currentTick + Math.log(1 - lowerPctBelow / 100) / LN_TICK;
	const highRaw = currentTick + Math.log(1 + upperPctAbove / 100) / LN_TICK;
	const tickLower = Math.ceil(lowRaw / tickSpacing) * tickSpacing || 0;
	const tickUpper = Math.floor(highRaw / tickSpacing) * tickSpacing || 0;
	if (tickUpper <= tickLower) {
		throw new Error("range is narrower than one tick spacing");
	}
	return { tickLower, tickUpper };
};

export type AddCheckInput = {
	label: string;
	// Quote results, base units.
	tokenEstA: bigint;
	tokenEstB: bigint;
	tokenMaxA: bigint;
	tokenMaxB: bigint;
	// Wallet holdings, base units.
	walletA: bigint;
	walletB: bigint;
	// The USDC the user allotted to this pool and which side USDC is on.
	usdcIsA: boolean;
	usdcAllotted: bigint;
};

export type Check = { label: string; ok: boolean; detail: string };

/** Guards before signing an add-liquidity: it must not spend more USDC than
 * allotted and the wallet must hold everything the quote may pull. */
export const checkAddLiquidity = (i: AddCheckInput): Check[] => {
	const usdcMax = i.usdcIsA ? i.tokenMaxA : i.tokenMaxB;
	const otherMax = i.usdcIsA ? i.tokenMaxB : i.tokenMaxA;
	const walletUsdc = i.usdcIsA ? i.walletA : i.walletB;
	const walletOther = i.usdcIsA ? i.walletB : i.walletA;
	return [
		{
			label: `${i.label}: spends no more USDC than allotted`,
			ok: usdcMax <= i.usdcAllotted,
			detail: `max ${usdcMax} vs allotted ${i.usdcAllotted}`,
		},
		{
			label: `${i.label}: wallet holds the USDC`,
			ok: walletUsdc >= usdcMax,
			detail: `${walletUsdc} held, up to ${usdcMax} needed`,
		},
		{
			label: `${i.label}: wallet holds the paired token it may pull`,
			ok: walletOther >= otherMax,
			detail: `${walletOther} held, up to ${otherMax} needed`,
		},
	];
};

export const allPassed = (checks: Check[]) =>
	checks.length > 0 && checks.every((c) => c.ok);
