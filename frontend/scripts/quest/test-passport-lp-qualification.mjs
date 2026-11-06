import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPassportLpQualification, rangeIntervals, validateLpPolicy } from "./passport-lp-qualification.mjs";

const POOL = "6ybsFQhg2Rj9ceQM9T978fNArMNr7TRJkXGphJwaiknY";
const OTHER_POOL = "GnL1XHwMcZYDANw9BJRxMDhp1QqyUutZ351u16rnszD";
const W1 = "4j3VFftvWC4R2KxbF4R8bJKz2Mxk3m6a2RjkEu8ySVPs";
const W2 = "HRmz8NhLJDXYiSyR6STzBkofJZGb9ZMbbEh3rMHRVXNV";
const PASS_A = "11111111-1111-4111-8111-111111111111";
const PASS_B = "22222222-2222-4222-8222-222222222222";
const policy = {
	featuredPools: [POOL],
	minimumLpUsdCents: "1000",
	minimumDwellSeconds: 3600,
	valuationSource: "devnet-usdc-leg",
	valuationVersion: "devnet-usdc-leg-lp-v1",
};
const T = (s) => s * 1000;
const CAPTURED = T(1000);

let counter = 0;
function lp(position, wallet, t, value, { pool = POOL, kind = "liquidity_increase", seq = 0 } = {}) {
	const eventId = String(++counter);
	return {
		event: { eventId, kind, poolAddress: pool, positionAddress: position },
		snapshot: {
			eventId,
			positionAddress: position,
			poolAddress: pool,
			wallet,
			effectiveMs: T(t),
			sequence: String(seq),
			valueUsdCents: String(value),
			valuationSource: policy.valuationSource,
			valuationVersion: policy.valuationVersion,
		},
	};
}
const link = (wallet, passportId, start, end = null) => ({
	wallet,
	links: [{ passportId, linkedMs: T(start), unlinkedMs: end === null ? null : T(end) }],
});
const run = (items, histories, overrides = {}) =>
	projectPassportLpQualification({
		events: items.map((i) => i.event),
		snapshots: items.map((i) => i.snapshot),
		histories,
		policy,
		capturedAtMs: CAPTURED,
		...overrides,
	});
const intervals = (out, passportId) =>
	out.passports.find((p) => p.passportId === passportId)?.pools[0].intervals;

test("historical NFT transfer changes ownership without another liquidity transaction", () => {
	const out = run([lp("P1", W1, 100, 10_000)], [link(W1, PASS_A, 50), link(W2, PASS_B, 50)], {
		ownershipIntervals: [{ positionAddress: "P1", intervals: [
			{ startMs: T(100), endMs: T(400), wallet: W1 },
			{ startMs: T(400), endMs: T(700), wallet: W2 },
			{ startMs: T(700), endMs: CAPTURED, wallet: null },
		] }],
	});
	assert.deepEqual(intervals(out, PASS_A), [[T(100), T(400)]]);
	assert.deepEqual(intervals(out, PASS_B), [[T(400), T(700)]]);
	assert.equal(out.ownershipCoverage, "HISTORICAL_COVERAGE");
});

test("missing or overlapping ownership coverage refuses LP qualification", () => {
	const items = [lp("P1", W1, 100, 10_000)];
	assert.throws(() => run(items, [link(W1, PASS_A, 50)], { ownershipIntervals: [] }), /complete historical/);
	assert.throws(() => run(items, [], { ownershipIntervals: [{ positionAddress: "P1", intervals: [
		{ startMs: T(100), endMs: T(500), wallet: W1 },
		{ startMs: T(400), endMs: T(700), wallet: W2 },
	] }] }), /invalid ownership/);
});

test("a linked wallet holding at least the minimum qualifies until capture", () => {
	const out = run([lp("P1", W1, 100, 10_000)], [link(W1, PASS_A, 50)]);
	assert.deepEqual(intervals(out, PASS_A), [[T(100), CAPTURED]]);
	assert.equal(out.awardEligible, false);
	assert.equal(out.ownershipCoverage, "TRANSACTION_ONLY");
});

test("below the minimum does not qualify; exactly the minimum does", () => {
	assert.equal(run([lp("P1", W1, 100, 999)], [link(W1, PASS_A, 0)]).passports.length, 0);
	assert.equal(run([lp("P1", W1, 100, 1000)], [link(W1, PASS_A, 0)]).passports.length, 1);
});

test("a partial withdrawal below the minimum ends the interval at that moment", () => {
	const out = run(
		[lp("P1", W1, 100, 10_000), lp("P1", W1, 300, 500, { kind: "liquidity_decrease", seq: 1 })],
		[link(W1, PASS_A, 0)],
	);
	assert.deepEqual(intervals(out, PASS_A), [[T(100), T(300)]]);
});

test("deposit before the link only counts from the link time; unlink ends it", () => {
	const out = run([lp("P1", W1, 100, 10_000)], [link(W1, PASS_A, 200, 400)]);
	assert.deepEqual(intervals(out, PASS_A), [[T(200), T(400)]]);
});

test("a wallet that is never linked earns nothing", () => {
	assert.equal(run([lp("P1", W1, 100, 50_000)], []).passports.length, 0);
});

test("positions of several wallets linked to one Passport add up", () => {
	const out = run(
		[lp("P1", W1, 100, 600), lp("P2", W2, 150, 600)],
		[link(W1, PASS_A, 0), link(W2, PASS_A, 0)],
	);
	assert.deepEqual(intervals(out, PASS_A), [[T(150), CAPTURED]]);
});

test("two Passports are independent", () => {
	const out = run(
		[lp("P1", W1, 100, 5_000), lp("P2", W2, 100, 5_000)],
		[link(W1, PASS_A, 0), link(W2, PASS_B, 0)],
	);
	assert.deepEqual(out.passports.map((p) => p.passportId), [PASS_A, PASS_B]);
});

test("non-featured pools are ignored and need no snapshots", () => {
	const other = lp("P9", W1, 100, 99_999, { pool: OTHER_POOL });
	const out = projectPassportLpQualification({
		events: [other.event],
		snapshots: [],
		histories: [link(W1, PASS_A, 0)],
		policy,
		capturedAtMs: CAPTURED,
	});
	assert.equal(out.passports.length, 0);
});

test("a featured-pool event without a snapshot refuses the whole projection", () => {
	const item = lp("P1", W1, 100, 5_000);
	assert.throws(
		() =>
			projectPassportLpQualification({
				events: [item.event],
				snapshots: [],
				histories: [],
				policy,
				capturedAtMs: CAPTURED,
			}),
		/complete valuations required/,
	);
});

test("snapshots with other valuation pins, repeats or after capture are refused", () => {
	const item = lp("P1", W1, 100, 5_000);
	const bad = { ...item.snapshot, valuationVersion: "other" };
	assert.throws(() => run([{ event: item.event, snapshot: bad }], []), /pins differ/);
	assert.throws(
		() => run([{ event: item.event, snapshot: { ...item.snapshot, effectiveMs: CAPTURED + 1 } }], []),
		/after capture/,
	);
});

test("a policy without featured pools or a positive minimum is refused", () => {
	const item = lp("P1", W1, 100, 5_000);
	for (const broken of [
		{ ...policy, featuredPools: [] },
		{ ...policy, minimumLpUsdCents: "0" },
		{ ...policy, minimumLpUsdCents: "10.5" },
		{ ...policy, minimumDwellSeconds: -1 },
		{ ...policy, minimumDwellSeconds: 1.5 },
		{ ...policy, minimumDwellSeconds: undefined },
	])
		assert.throws(() => run([item], [], { policy: broken }), /featured-pool policy/);
});

test("output is deterministic regardless of input order", () => {
	const a = lp("P1", W1, 100, 5_000);
	const b = lp("P2", W2, 200, 5_000);
	const histories = [link(W1, PASS_A, 0), link(W2, PASS_B, 0)];
	assert.deepEqual(run([a, b], histories), run([b, a], histories.reverse()));
});

// ---------------------------------------------------------------------------------------------------
// Range-aware mode: a position counts only while the pool's price is inside its tick range.
// ---------------------------------------------------------------------------------------------------
const rangePolicy = { ...policy, requireInRange: true, maxSampleGapSeconds: 600 };
const GAP = 600_000;
const sample = (t, tick, pool = POOL) => ({ poolAddress: pool, tMs: T(t), tick });
function ranged(position, wallet, t, value, lower, upper, extra = {}) {
	const item = lp(position, wallet, t, value, extra);
	item.event.tickLower = lower;
	item.event.tickUpper = upper;
	return item;
}
const runRange = (items, histories, tickSamples, overrides = {}) =>
	projectPassportLpQualification({
		events: items.map((i) => i.event),
		snapshots: items.map((i) => i.snapshot),
		histories,
		policy: rangePolicy,
		capturedAtMs: CAPTURED,
		tickSamples,
		...overrides,
	});
// A pool observed every 5 minutes with the given tick.
const everyFive = (from, to, tick) => {
	const out = [];
	for (let t = from; t <= to; t += 300) out.push(sample(t, tick));
	return out;
};

test("rangeIntervals: counts a stretch only when both ends are inside, and never trusts more than the gap", () => {
	const inside = (tMs, tick) => ({ tMs, tick });
	// inside, inside, inside: one run
	assert.deepEqual(rangeIntervals([inside(0, 0), inside(300_000, 5), inside(600_000, -5)], -10, 10, GAP, 10_000_000), [
		[0, 600_000],
		[600_000, 600_000 + GAP],
	].reduce((merged, [a, b]) => {
		const last = merged.at(-1);
		if (last && last[1] === a) last[1] = b;
		else merged.push([a, b]);
		return merged;
	}, []));
	// inside then outside: the stretch in between is not credited at all
	assert.deepEqual(rangeIntervals([inside(0, 0), inside(300_000, 99)], -10, 10, GAP, 10_000_000), []);
	// outside then inside: only the time after the inside sample counts
	assert.deepEqual(rangeIntervals([inside(0, 99), inside(300_000, 0), inside(600_000, 0)], -10, 10, GAP, 10_000_000), [
		[300_000, 600_000 + GAP],
	]);
	// a long silence after a sample is capped at the gap
	assert.deepEqual(rangeIntervals([inside(0, 0), inside(5_000_000, 0)], -10, 10, GAP, 10_000_000), [
		[0, GAP],
		[5_000_000, 5_000_000 + GAP],
	]);
	// the upper bound is exclusive and the lower bound inclusive
	assert.deepEqual(rangeIntervals([inside(0, 10), inside(1000, 10)], -10, 10, GAP, 10_000_000), []);
	assert.deepEqual(rangeIntervals([inside(0, -10), inside(1000, -10)], -10, 10, GAP, 10_000_000).length, 1);
	// samples after capture are ignored, and capture caps the last interval
	assert.deepEqual(rangeIntervals([inside(0, 0), inside(20_000_000, 0)], -10, 10, GAP, 100_000), [[0, 100_000]]);
	assert.deepEqual(rangeIntervals([], -10, 10, GAP, 100_000), []);
});

test("range-aware: only the time the price is inside the range qualifies", () => {
	// price inside until t=700, outside from t=800
	const samples = [...everyFive(100, 700, 0), ...everyFive(800, 1100, 500)];
	const out = runRange([ranged("P1", W1, 100, 10_000, -100, 100)], [link(W1, PASS_A, 0)], samples);
	const got = intervals(out, PASS_A);
	assert.equal(got.length, 1);
	assert.equal(got[0][0], T(100));
	assert.ok(got[0][1] <= T(700) + GAP, "the last inside sample is trusted for at most the gap");
	assert.ok(got[0][1] >= T(700));
});

test("range-aware: a position that is out of range the whole time earns nothing", () => {
	const out = runRange([ranged("P1", W1, 100, 10_000, -100, 100)], [link(W1, PASS_A, 0)], everyFive(100, 1000, 500));
	assert.equal(out.passports.length, 0);
});

test("range-aware: no samples at all means no time is credited, not an error", () => {
	const out = runRange([ranged("P1", W1, 100, 10_000, -100, 100)], [link(W1, PASS_A, 0)], []);
	assert.equal(out.passports.length, 0);
});

test("range-aware: a sampler that stopped credits only the trusted gap after its last sample", () => {
	const out = runRange([ranged("P1", W1, 100, 10_000, -100, 100)], [link(W1, PASS_A, 0)], everyFive(100, 400, 0));
	assert.deepEqual(intervals(out, PASS_A), [[T(100), T(400) + GAP]]);
});

test("range-aware: a price that moves back into range resumes crediting", () => {
	const samples = [...everyFive(100, 400, 0), sample(500, 999), ...everyFive(600, 900, 0)];
	const out = runRange([ranged("P1", W1, 100, 10_000, -100, 100)], [link(W1, PASS_A, 0)], samples);
	const got = intervals(out, PASS_A);
	assert.equal(got.length, 2);
	assert.equal(got[0][0], T(100));
	assert.equal(got[1][0], T(600));
});

test("range-aware: the dollar minimum is still required on top of being in range", () => {
	const out = runRange([ranged("P1", W1, 100, 999, -100, 100)], [link(W1, PASS_A, 0)], everyFive(100, 1000, 0));
	assert.equal(out.passports.length, 0);
});

test("range-aware: two positions of one wallet add up only while each is in range", () => {
	// each is worth $6, so $12 together qualifies, but P2's range is exited at t=500
	const items = [ranged("P1", W1, 100, 600, -100, 100), ranged("P2", W1, 100, 600, -50, 50)];
	const samples = [...everyFive(100, 500, 0), ...everyFive(800, 1000, 75)];
	const out = runRange(items, [link(W1, PASS_A, 0)], samples);
	const got = intervals(out, PASS_A);
	assert.equal(got.length, 1);
	assert.ok(got[0][1] <= T(500) + GAP, "once P2 is out of range the wallet drops below the $10 minimum");
});

test("range-aware: samples of a pool that is not featured are ignored", () => {
	const out = runRange(
		[ranged("P1", W1, 100, 10_000, -100, 100)],
		[link(W1, PASS_A, 0)],
		[...everyFive(100, 1000, 500), ...everyFive(100, 1000, 0).map((x) => ({ ...x, poolAddress: OTHER_POOL }))],
	);
	assert.equal(out.passports.length, 0);
});

test("range-aware: an unknown or inconsistent position range is refused, never guessed", () => {
	assert.throws(() => runRange([lp("P1", W1, 100, 10_000)], [link(W1, PASS_A, 0)], []), /position range required/);
	assert.throws(
		() => runRange([ranged("P1", W1, 100, 10_000, 100, 100)], [link(W1, PASS_A, 0)], []),
		/position range required/,
	);
	assert.throws(
		() =>
			runRange(
				[ranged("P1", W1, 100, 10_000, -100, 100), ranged("P1", W1, 200, 10_000, -100, 200, { seq: 1 })],
				[link(W1, PASS_A, 0)],
				[],
			),
		/position range changed/,
	);
	assert.throws(() => runRange([ranged("P1", W1, 100, 10_000, -1, 1)], [link(W1, PASS_A, 0)], undefined), /tick samples required/);
	assert.throws(
		() => runRange([ranged("P1", W1, 100, 10_000, -1, 1)], [link(W1, PASS_A, 0)], [sample(100, 99_999_999)]),
		/invalid tick sample/,
	);
});

test("range-aware: the wallet-link rule and the link time still apply", () => {
	// linked only from t=300: in-range time before that does not count
	const out = runRange([ranged("P1", W1, 100, 10_000, -100, 100)], [link(W1, PASS_A, 300)], everyFive(100, 700, 0));
	assert.equal(intervals(out, PASS_A)[0][0], T(300));
});

test("range-aware policy validation", () => {
	assert.doesNotThrow(() => validateLpPolicy(rangePolicy));
	assert.doesNotThrow(() => validateLpPolicy({ ...policy, requireInRange: false }));
	for (const bad of [
		{ ...rangePolicy, requireInRange: "yes" },
		{ ...rangePolicy, maxSampleGapSeconds: undefined },
		{ ...rangePolicy, maxSampleGapSeconds: 10 },
		{ ...rangePolicy, maxSampleGapSeconds: 7200 },
		{ ...rangePolicy, maxSampleGapSeconds: 60.5 },
	])
		assert.throws(() => validateLpPolicy(bad), /explicit featured-pool policy required/);
});
