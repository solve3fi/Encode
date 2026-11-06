import Decimal from "decimal.js";

// Pure accrual math for the soft-launch LP incentive program. No RPC, no
// filesystem: scripts/lp-incentives-keeper.mjs feeds it chain snapshots and
// persists what comes back. Shapes mirror src/configs/lpIncentives.ts
// (duplicated rather than imported: this runs outside Next's module
// resolution, the same reason auto-vote-keeper.mjs copies decryptSecret).
//
// Rule: each sample credits the protocol fees that accrued since the previous
// sample to the positions in range at this sample, pro-rata by liquidity —
// the same way the CLMM itself accrues swap fees to in-range liquidity.
// Credit is never invented: no previous sample, no price, or no in-range
// liquidity means fees are recorded but nothing is credited.

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_DOWN });
const WEEK_SECONDS = 7 * 24 * 60 * 60;
export const TRAILING_WINDOW_SECONDS = WEEK_SECONDS;

const ZERO = "0";
const str = (value) => new D(value).toFixed();

export const weekStartSeconds = (ts) => Math.floor(ts / WEEK_SECONDS) * WEEK_SECONDS;
export const weekKeyFor = (ts) =>
	new Date(weekStartSeconds(ts) * 1000).toISOString().slice(0, 10);

/**
 * Fees taken since the previous sample, per side, in raw base units.
 * A decrease means the fee authority collected in between; what is owed now
 * accrued after that collection, so it is counted and the rest is lost
 * (bounded by one sample interval — run collections right after a sample).
 */
export function feeDelta(prevOwed, nowOwed) {
	const prev = new D(prevOwed);
	const now = new D(nowOwed);
	return {
		delta: now.gte(prev) ? now.minus(prev) : now,
		collected: now.lt(prev),
	};
}

/** Raw base-unit amount → USD using a per-whole-token price. */
export const toUsd = (rawAmount, decimals, price) =>
	new D(rawAmount).div(new D(10).pow(decimals)).mul(price);

/**
 * Splits one sample's fee take among in-range positions.
 *
 * positions: [{ owner, liquidity, tickLowerIndex, tickUpperIndex }]
 * Returns { creditUsd, creditSolv3, unallocatedUsd, wallets: { owner: {creditUsd, creditSolv3, share} } }
 * with every amount as a decimal string.
 */
export function accrueSample({
	feesUsd,
	multiplier,
	veSolv3Usd,
	positions,
	tickCurrentIndex,
	weeklyCapSolv3,
	weekCreditSolv3SoFar = ZERO,
}) {
	const fees = new D(feesUsd);
	const price = new D(veSolv3Usd);
	if (!price.gt(0)) throw new Error("veSolv3Usd must be positive");
	const empty = { creditUsd: ZERO, creditSolv3: ZERO, unallocatedUsd: str(fees), wallets: {} };
	if (!fees.gt(0)) return { ...empty, unallocatedUsd: ZERO };

	const inRange = positions.filter(
		(position) =>
			position.owner &&
			new D(position.liquidity).gt(0) &&
			position.tickLowerIndex <= tickCurrentIndex &&
			tickCurrentIndex < position.tickUpperIndex,
	);
	const totalLiquidity = inRange.reduce((sum, position) => sum.plus(position.liquidity), new D(0));
	if (!totalLiquidity.gt(0)) return empty;

	let creditUsd = fees.mul(multiplier);
	let creditSolv3 = creditUsd.div(price);
	if (weeklyCapSolv3 !== undefined && weeklyCapSolv3 !== null) {
		const room = D.max(0, new D(weeklyCapSolv3).minus(weekCreditSolv3SoFar));
		if (creditSolv3.gt(room)) {
			creditSolv3 = room;
			creditUsd = room.mul(price);
		}
	}

	// Aggregate by owner first so a wallet with several positions gets one line.
	const byOwner = new Map();
	for (const position of inRange) {
		byOwner.set(position.owner, (byOwner.get(position.owner) ?? new D(0)).plus(position.liquidity));
	}
	const wallets = {};
	for (const [owner, liquidity] of byOwner) {
		const share = liquidity.div(totalLiquidity);
		wallets[owner] = {
			share: share.toFixed(12),
			creditUsd: str(creditUsd.mul(share)),
			creditSolv3: str(creditSolv3.mul(share)),
		};
	}
	return { creditUsd: str(creditUsd), creditSolv3: str(creditSolv3), unallocatedUsd: ZERO, wallets };
}

const emptyWeek = () => ({ feesUsd: ZERO, creditSolv3: ZERO, unallocatedUsd: ZERO, samples: 0, wallets: {} });
const emptyTrailing = () => ({ feesUsd: ZERO, creditSolv3: ZERO, creditUsd: ZERO, windowSeconds: 0, samples: 0 });

export const emptyLedger = () => ({ version: 1, updatedAt: 0, pools: {}, wallets: {} });

/**
 * Applies one sample to the ledger for `poolAddress` and returns a NEW ledger
 * (the input is not mutated). Idempotent: a sample at or before the recorded
 * slot is ignored. The first sample of a pool only records the baseline.
 *
 * sample: { slot, ts, owedA, owedB, decimalsA, decimalsB, priceA, priceB,
 *           positions, tickCurrentIndex }
 * config: { multiplier, veSolv3Usd, weeklyCapSolv3 }
 */
export function applySample(ledger, poolAddress, sample, config) {
	const previous = ledger.pools[poolAddress];
	if (previous && sample.slot <= previous.lastSample.slot) {
		return { ledger, applied: false, reason: "stale-slot" };
	}
	const lastSample = { slot: sample.slot, ts: sample.ts, owedA: str(sample.owedA), owedB: str(sample.owedB) };
	const next = structuredClone(ledger);
	if (!previous) {
		next.pools[poolAddress] = { lastSample, recent: [], weeks: {}, trailing7d: emptyTrailing() };
		next.updatedAt = sample.ts;
		return { ledger: next, applied: true, reason: "baseline" };
	}

	const deltaA = feeDelta(previous.lastSample.owedA, sample.owedA);
	const deltaB = feeDelta(previous.lastSample.owedB, sample.owedB);
	const feesUsd = toUsd(deltaA.delta, sample.decimalsA, sample.priceA).plus(
		toUsd(deltaB.delta, sample.decimalsB, sample.priceB),
	);

	const weekKey = weekKeyFor(sample.ts);
	const pool = next.pools[poolAddress];
	const week = pool.weeks[weekKey] ?? emptyWeek();
	const result = accrueSample({
		feesUsd,
		multiplier: config.multiplier,
		veSolv3Usd: config.veSolv3Usd,
		positions: sample.positions,
		tickCurrentIndex: sample.tickCurrentIndex,
		weeklyCapSolv3: config.weeklyCapSolv3,
		weekCreditSolv3SoFar: week.creditSolv3,
	});

	week.feesUsd = str(new D(week.feesUsd).plus(feesUsd));
	week.creditSolv3 = str(new D(week.creditSolv3).plus(result.creditSolv3));
	week.unallocatedUsd = str(new D(week.unallocatedUsd).plus(result.unallocatedUsd));
	week.samples += 1;
	for (const [wallet, credit] of Object.entries(result.wallets)) {
		const entry = week.wallets[wallet] ?? { creditSolv3: ZERO, creditUsd: ZERO, samples: 0 };
		entry.creditSolv3 = str(new D(entry.creditSolv3).plus(credit.creditSolv3));
		entry.creditUsd = str(new D(entry.creditUsd).plus(credit.creditUsd));
		entry.samples += 1;
		week.wallets[wallet] = entry;

		const summary = next.wallets[wallet] ?? { totalSolv3: ZERO, byPool: {} };
		summary.totalSolv3 = str(new D(summary.totalSolv3).plus(credit.creditSolv3));
		summary.byPool[poolAddress] = str(new D(summary.byPool[poolAddress] ?? ZERO).plus(credit.creditSolv3));
		next.wallets[wallet] = summary;
	}
	pool.weeks[weekKey] = week;
	pool.lastSample = lastSample;
	pool.recent = [
		...pool.recent.filter((entry) => entry.ts > sample.ts - TRAILING_WINDOW_SECONDS),
		{ ts: sample.ts, feesUsd: str(feesUsd), creditUsd: result.creditUsd, creditSolv3: result.creditSolv3 },
	];
	pool.trailing7d = trailingSummary(pool.recent, sample.ts);
	next.updatedAt = sample.ts;
	return {
		ledger: next,
		applied: true,
		reason: "credited",
		feesUsd: str(feesUsd),
		creditSolv3: result.creditSolv3,
		collected: deltaA.collected || deltaB.collected,
	};
}

/** Sums the credited samples inside the trailing window ending at `nowTs`. */
export function trailingSummary(recent, nowTs) {
	const inWindow = recent.filter((entry) => entry.ts > nowTs - TRAILING_WINDOW_SECONDS);
	if (!inWindow.length) return emptyTrailing();
	const sum = (key) => inWindow.reduce((total, entry) => total.plus(entry[key]), new D(0));
	const oldest = Math.min(...inWindow.map((entry) => entry.ts));
	// Each credited sample covers the interval that ended at it, so the window
	// starts one average interval before the oldest sample in it.
	const span = nowTs - oldest;
	const interval = inWindow.length > 1 ? span / (inWindow.length - 1) : 0;
	return {
		feesUsd: str(sum("feesUsd")),
		creditUsd: str(sum("creditUsd")),
		creditSolv3: str(sum("creditSolv3")),
		windowSeconds: Math.min(TRAILING_WINDOW_SECONDS, span + interval),
		samples: inWindow.length,
	};
}
