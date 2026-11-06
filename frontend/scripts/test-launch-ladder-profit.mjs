import assert from "node:assert/strict";
import test from "node:test";
import {
	allPassed,
	checkAddLiquidity,
	classifyPosition,
	rangeAroundTick,
	splitUsdc,
} from "../src/lib/launchLadderProfit.ts";

test("classifyPosition", () => {
	assert.equal(classifyPosition(100, 0, 100), "filled");
	assert.equal(classifyPosition(101, 0, 100), "filled");
	assert.equal(classifyPosition(50, 0, 100), "active");
	assert.equal(classifyPosition(0, 0, 100), "active");
	assert.equal(classifyPosition(-1, 0, 100), "unfilled");
});

test("splitUsdc conserves the total", () => {
	const s = splitUsdc(1_000_001n, 5000);
	assert.equal(s.blueChip + s.solv3, 1_000_001n);
	assert.equal(s.blueChip, 500_000n);
	assert.deepEqual(splitUsdc(10n, 0), { blueChip: 0n, solv3: 10n });
	assert.deepEqual(splitUsdc(10n, 10000), { blueChip: 10n, solv3: 0n });
});

test("splitUsdc rejects bad input", () => {
	assert.throws(() => splitUsdc(10n, -1));
	assert.throws(() => splitUsdc(10n, 10001));
	assert.throws(() => splitUsdc(10n, 50.5));
	assert.throws(() => splitUsdc(-1n, 5000));
});

test("rangeAroundTick is aligned, ordered and brackets the price", () => {
	const r = rangeAroundTick(-20000, 10, 10, 64);
	assert.ok(r.tickLower % 64 === 0);
	assert.ok(r.tickUpper % 64 === 0);
	assert.ok(r.tickLower < -20000 && r.tickUpper > -20000);
	// ~ -10% and +10% in price, within one spacing
	const lowPct = 1.0001 ** (r.tickLower + 20000) - 1;
	const highPct = 1.0001 ** (r.tickUpper + 20000) - 1;
	assert.ok(Math.abs(lowPct + 0.1) < 0.02, String(lowPct));
	assert.ok(Math.abs(highPct - 0.1) < 0.02, String(highPct));
});

test("rangeAroundTick rejects bad ranges", () => {
	assert.throws(() => rangeAroundTick(0, 100, 10, 64));
	assert.throws(() => rangeAroundTick(0, 0, 10, 64));
	assert.throws(() => rangeAroundTick(0, 0.0001, 0.0001, 64));
});

const base = {
	label: "SOL/USDC",
	tokenEstA: 0n,
	tokenEstB: 500n,
	tokenMaxA: 0n,
	tokenMaxB: 505n,
	walletA: 0n,
	walletB: 1000n,
	usdcIsA: false,
	usdcAllotted: 510n,
};

test("add-liquidity guards", () => {
	assert.ok(allPassed(checkAddLiquidity(base)));
	assert.equal(allPassed(checkAddLiquidity({ ...base, usdcAllotted: 500n })), false);
	assert.equal(allPassed(checkAddLiquidity({ ...base, walletB: 100n })), false);
	assert.equal(
		allPassed(checkAddLiquidity({ ...base, tokenMaxA: 7n, walletA: 6n })),
		false,
	);
});
