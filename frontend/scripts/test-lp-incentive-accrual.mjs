import assert from "node:assert/strict";
import { test } from "node:test";
import {
	accrueSample,
	applySample,
	emptyLedger,
	feeDelta,
	weekKeyFor,
} from "./lib/lp-incentive-accrual.mjs";

const config = { multiplier: 1.5, veSolv3Usd: 0.3 };
const usdc = { decimalsA: 9, decimalsB: 6, priceA: 0.2, priceB: 1 };
const positions = [
	{ owner: "alice", liquidity: "300", tickLowerIndex: -100, tickUpperIndex: 100 },
	{ owner: "bob", liquidity: "100", tickLowerIndex: -100, tickUpperIndex: 100 },
	{ owner: "carol", liquidity: "1000", tickLowerIndex: 100, tickUpperIndex: 200 }, // out of range at tick 0
];

test("week keys start on Thursday 00:00 UTC", () => {
	assert.equal(weekKeyFor(Date.UTC(2026, 8, 18, 12) / 1000), "2026-09-17");
	assert.equal(weekKeyFor(Date.UTC(2026, 8, 17, 0) / 1000), "2026-09-17");
	assert.equal(weekKeyFor(Date.UTC(2026, 8, 16, 23, 59) / 1000), "2026-09-10");
});

test("fee delta counts growth and survives a collection", () => {
	assert.equal(feeDelta("100", "150").delta.toFixed(), "50");
	assert.equal(feeDelta("100", "150").collected, false);
	const collected = feeDelta("100", "20");
	assert.equal(collected.delta.toFixed(), "20");
	assert.equal(collected.collected, true);
});

test("in-range positions split credit pro-rata; upper tick is exclusive", () => {
	const result = accrueSample({ feesUsd: "10", ...config, positions, tickCurrentIndex: 0 });
	assert.equal(result.creditUsd, "15");
	assert.equal(result.creditSolv3, "50");
	assert.equal(result.unallocatedUsd, "0");
	assert.equal(result.wallets.alice.creditSolv3, "37.5");
	assert.equal(result.wallets.bob.creditSolv3, "12.5");
	assert.equal(result.wallets.carol, undefined);
	const atUpper = accrueSample({ feesUsd: "10", ...config, positions, tickCurrentIndex: 100 });
	assert.deepEqual(Object.keys(atUpper.wallets), ["carol"]);
});

test("fees with no in-range liquidity are recorded as unallocated", () => {
	const result = accrueSample({ feesUsd: "10", ...config, positions, tickCurrentIndex: 5000 });
	assert.equal(result.creditSolv3, "0");
	assert.equal(result.unallocatedUsd, "10");
	assert.deepEqual(result.wallets, {});
});

test("weekly cap scales the sample down and never goes negative", () => {
	const capped = accrueSample({
		feesUsd: "10", ...config, positions, tickCurrentIndex: 0,
		weeklyCapSolv3: 60, weekCreditSolv3SoFar: "40",
	});
	assert.equal(capped.creditSolv3, "20");
	assert.equal(capped.creditUsd, "6");
	assert.equal(capped.wallets.alice.creditSolv3, "15");
	const exhausted = accrueSample({
		feesUsd: "10", ...config, positions, tickCurrentIndex: 0,
		weeklyCapSolv3: 60, weekCreditSolv3SoFar: "70",
	});
	assert.equal(exhausted.creditSolv3, "0");
});

test("first sample is a baseline; later samples credit and are idempotent per slot", () => {
	const t0 = Date.UTC(2026, 8, 18, 12) / 1000;
	const pool = "Pool111";
	const base = { ...usdc, positions, tickCurrentIndex: 0 };
	const first = applySample(emptyLedger(), pool, { ...base, slot: 10, ts: t0, owedA: "0", owedB: "0" }, config);
	assert.equal(first.reason, "baseline");
	assert.deepEqual(first.ledger.wallets, {});

	// 5 SOLV3 (9 dp) at $0.20 + 2 USDC = $3 of fees taken.
	const second = applySample(
		first.ledger, pool,
		{ ...base, slot: 20, ts: t0 + 600, owedA: "5000000000", owedB: "2000000" },
		config,
	);
	assert.equal(second.reason, "credited");
	assert.equal(second.feesUsd, "3");
	assert.equal(second.creditSolv3, "15");
	assert.equal(second.ledger.wallets.alice.totalSolv3, "11.25");
	assert.equal(second.ledger.wallets.bob.byPool[pool], "3.75");
	const week = second.ledger.pools[pool].weeks["2026-09-17"];
	assert.equal(week.samples, 1);
	assert.equal(week.feesUsd, "3");
	assert.equal(second.ledger.pools[pool].trailing7d.creditSolv3, "15");

	const replay = applySample(second.ledger, pool, { ...base, slot: 20, ts: t0 + 600, owedA: "5000000000", owedB: "2000000" }, config);
	assert.equal(replay.applied, false);
	assert.strictEqual(replay.ledger, second.ledger);

	// Fee authority collected between samples: only the post-collection remainder counts.
	const third = applySample(
		second.ledger, pool,
		{ ...base, slot: 30, ts: t0 + 1200, owedA: "1000000000", owedB: "0" },
		config,
	);
	assert.equal(third.collected, true);
	assert.equal(third.feesUsd, "0.2");
	assert.equal(third.ledger.wallets.alice.totalSolv3, "12");
	// Input ledger was not mutated.
	assert.equal(second.ledger.wallets.alice.totalSolv3, "11.25");
});

test("trailing window drops samples older than 7 days", () => {
	const t0 = Date.UTC(2026, 8, 1) / 1000;
	const pool = "Pool222";
	const base = { ...usdc, positions, tickCurrentIndex: 0 };
	let { ledger } = applySample(emptyLedger(), pool, { ...base, slot: 1, ts: t0, owedA: "0", owedB: "0" }, config);
	({ ledger } = applySample(ledger, pool, { ...base, slot: 2, ts: t0 + 600, owedA: "0", owedB: "1000000" }, config));
	({ ledger } = applySample(ledger, pool, { ...base, slot: 3, ts: t0 + 8 * 86400, owedA: "0", owedB: "3000000" }, config));
	const trailing = ledger.pools[pool].trailing7d;
	assert.equal(trailing.samples, 1);
	assert.equal(trailing.feesUsd, "2");
	// Both weeks are still in the per-week history.
	assert.equal(Object.keys(ledger.pools[pool].weeks).length, 2);
});
