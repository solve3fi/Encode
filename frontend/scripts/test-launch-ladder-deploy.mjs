import assert from "node:assert/strict";
import test from "node:test";
import {
	allPassed,
	checkPlan,
	evaluateReadback,
	tickArrayStartOf,
} from "../src/lib/launchLadderDeploy.ts";

const A = "SolvA";
const B = "UsdcB";
const plan = () => ({
	pool: {
		tokenMintA: A,
		tokenMintB: B,
		feeRate: 10000,
		tickSpacing: 128,
		initialTickIndex: -64001,
	},
	tickArrayStartIndices: [-67584, -56320, -45056],
	positions: [
		{ band: "thin", tickLowerIndex: -64000, tickUpperIndex: -62720, tokenAAmount: "400000000000000", tokenMaxB: "0", expectedLiquidity: "1000000" },
		{ band: "medium", tickLowerIndex: -62720, tickUpperIndex: -58240, tokenAAmount: "1200000000000000", tokenMaxB: "0", expectedLiquidity: "2000000" },
		{ band: "heavy", tickLowerIndex: -58240, tickUpperIndex: -55040, tokenAAmount: "2400000000000000", tokenMaxB: "0", expectedLiquidity: "3000000" },
	],
	floorPosition: null,
});
const chainFor = (p) => ({
	mintA: A,
	mintB: B,
	tickSpacing: 128,
	tickCurrentIndex: -64001,
	sqrtPrice: 123n,
	expectedSqrtPrice: 123n,
	poolLiquidity: 0n,
	vaultA: 4_000_000_000_000_000n,
	vaultB: 0n,
	positions: p.positions.map((b, i) => ({
		mint: `pos${i}`,
		tickLower: b.tickLowerIndex,
		tickUpper: b.tickUpperIndex,
		liquidity: BigInt(b.expectedLiquidity),
	})),
});

test("tickArrayStartOf handles negatives", () => {
	assert.equal(tickArrayStartOf(-64000, 128), -67584);
	assert.equal(tickArrayStartOf(0, 128), 0);
	assert.equal(tickArrayStartOf(-1, 128), -11264);
});

test("a good plan passes", () => {
	const checks = checkPlan(plan());
	assert.ok(allPassed(checks), JSON.stringify(checks.filter((c) => !c.ok)));
});

test("misaligned tick fails", () => {
	const p = plan();
	p.positions[1].tickLowerIndex = -62721;
	assert.equal(allPassed(checkPlan(p)), false);
});

test("gap between bands fails", () => {
	const p = plan();
	p.positions[1].tickLowerIndex = -62592;
	assert.equal(allPassed(checkPlan(p)), false);
});

test("init tick at or above first band fails", () => {
	const p = plan();
	p.pool.initialTickIndex = -64000;
	assert.equal(allPassed(checkPlan(p)), false);
});

test("nonzero token_max_b fails", () => {
	const p = plan();
	p.positions[0].tokenMaxB = "1";
	assert.equal(allPassed(checkPlan(p)), false);
});

test("missing tick array fails", () => {
	const p = plan();
	p.tickArrayStartIndices = [-67584];
	assert.equal(allPassed(checkPlan(p)), false);
});

test("floor in plan is refused", () => {
	const p = plan();
	p.floorPosition = { tickLowerIndex: -70000, tickUpperIndex: -64000, tokenBAmount: "1", tokenMaxA: "0", expectedLiquidity: "1" };
	assert.equal(allPassed(checkPlan(p)), false);
});

test("matching readback passes", () => {
	const p = plan();
	assert.ok(allPassed(evaluateReadback(p, chainFor(p))));
});

test("USDC in vault B fails", () => {
	const p = plan();
	const c = chainFor(p);
	c.vaultB = 1n;
	assert.equal(allPassed(evaluateReadback(p, c)), false);
});

test("missing or extra position fails", () => {
	const p = plan();
	const c = chainFor(p);
	c.positions.pop();
	assert.equal(allPassed(evaluateReadback(p, c)), false);
	const c2 = chainFor(p);
	c2.positions.push({ mint: "x", tickLower: 0, tickUpper: 128, liquidity: 1n });
	assert.equal(allPassed(evaluateReadback(p, c2)), false);
});

test("wrong liquidity or wrong price fails", () => {
	const p = plan();
	const c = chainFor(p);
	c.positions[2].liquidity = 3_100_000n;
	assert.equal(allPassed(evaluateReadback(p, c)), false);
	const c2 = chainFor(p);
	c2.sqrtPrice = 124n;
	assert.equal(allPassed(evaluateReadback(p, c2)), false);
});

test("inverted mint order fails", () => {
	const p = plan();
	const c = chainFor(p);
	c.mintA = B;
	c.mintB = A;
	assert.equal(allPassed(evaluateReadback(p, c)), false);
});
