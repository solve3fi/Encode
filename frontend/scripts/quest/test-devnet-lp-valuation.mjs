import assert from "node:assert/strict";
import { test } from "node:test";
import {
	LP_SNAPSHOT_PREFIX,
	LP_VALUATION_SOURCE,
	LP_VALUATION_VERSION,
	runLpValuations,
	usdcLegRaw,
	valueLiquidityEvent,
} from "./devnet-lp-valuation.mjs";

const USDC = "FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up";
const SOLV3 = "DvGitpT8Qujq6sxXoq7M1vueGf97dGVpoPWY4ifYHCHu";
const OTHER = "6RydWWDfZ8bGmdr8kjjcJvC3FD6M3C4ZjTphWWqdka1f";
const base = { usdcMint: USDC, usdcDecimals: 6 };
const payload = (a, b) => ({ tokenAAmountRaw: String(a), tokenBAmountRaw: String(b) });

test("the devUSDC side is picked from whichever mint position it holds", () => {
	assert.deepEqual(usdcLegRaw({ payload: payload(5, 7), mintA: USDC, mintB: SOLV3, usdcMint: USDC }), {
		side: "tokenA",
		raw: 5n,
	});
	assert.deepEqual(usdcLegRaw({ payload: payload(5, 7), mintA: SOLV3, mintB: USDC, usdcMint: USDC }), {
		side: "tokenB",
		raw: 7n,
	});
	assert.equal(usdcLegRaw({ payload: payload(5, 7), mintA: SOLV3, mintB: OTHER, usdcMint: USDC }).side, "none");
});

test("a deposit adds the devUSDC leg, floored to the cent", () => {
	const out = valueLiquidityEvent({
		...base,
		kind: "liquidity_increase",
		payload: payload(497_198_504_509, 100_000_000),
		mintA: SOLV3,
		mintB: USDC,
		previousCents: 0n,
	});
	assert.equal(out.valueUsdCents, 10_000n);
	assert.equal(out.evidence.valuedSide, "tokenB");
	assert.equal(valueLiquidityEvent({ ...base, kind: "liquidity_increase", payload: payload(0, 19_999), mintA: SOLV3, mintB: USDC, previousCents: 0n }).valueUsdCents, 1n);
});

test("a withdrawal subtracts the leg rounded up, never below zero", () => {
	const dec = (previous, usdc) =>
		valueLiquidityEvent({ ...base, kind: "liquidity_decrease", payload: payload(0, usdc), mintA: SOLV3, mintB: USDC, previousCents: previous });
	assert.equal(dec(10_000n, 50_000_000).valueUsdCents, 5_000n);
	assert.equal(dec(10_000n, 50_000_001).valueUsdCents, 4_999n);
	const clamped = dec(100n, 5_000_000);
	assert.equal(clamped.valueUsdCents, 0n);
	assert.equal(clamped.evidence.clampedAtZero, true);
});

test("a pool without devUSDC is valued at zero and noted", () => {
	const out = valueLiquidityEvent({ ...base, kind: "liquidity_increase", payload: payload(10, 10), mintA: SOLV3, mintB: OTHER, previousCents: 0n });
	assert.equal(out.valueUsdCents, 0n);
	assert.equal(out.evidence.valuedSide, "none");
});

test("non-liquidity kinds and bad payloads are refused", () => {
	assert.throws(() => valueLiquidityEvent({ ...base, kind: "swap", payload: payload(1, 1), mintA: USDC, mintB: SOLV3, previousCents: 0n }));
	assert.throws(() => usdcLegRaw({ payload: { tokenAAmountRaw: "x", tokenBAmountRaw: "1" }, mintA: USDC, mintB: SOLV3, usdcMint: USDC }));
});

// A small SQL double: just enough of the statements runLpValuations issues.
function fakePool(events) {
	const snapshots = new Map();
	const inserts = [];
	const client = {
		release() {},
		async query(sql, params) {
			if (sql.includes("FROM genesis.chain_events e")) {
				return { rows: events.filter((e) => !snapshots.has(`${LP_SNAPSHOT_PREFIX}${e.id}`)) };
			}
			if (sql.includes("ORDER BY effective_at DESC")) {
				const rows = [...snapshots.values()].filter((s) => s.position_address === params[1]);
				return { rows: rows.length ? [{ value: rows.at(-1).value, sequence: rows.at(-1).sequence }] : [] };
			}
			if (sql.startsWith("INSERT INTO genesis.lp_value_snapshots")) {
				const key = params[1];
				if (snapshots.has(key)) return { rowCount: 0, rows: [] };
				const row = { key, position_address: params[2], wallet: params[3], sequence: params[6], value: params[7], event: params[8] };
				snapshots.set(key, row);
				inserts.push(row);
				return { rowCount: 1, rows: [{ id: 1 }] };
			}
			throw new Error(`unexpected SQL: ${sql.slice(0, 40)}`);
		},
	};
	return { pool: { connect: async () => client }, inserts, snapshots };
}
const row = (id, kind, position, usdc, extra = {}) => ({
	id: String(id),
	event_kind: kind,
	wallet: "4j3VFftvWC4R2KxbF4R8bJKz2Mxk3m6a2RjkEu8ySVPs",
	pool_address: "6ybsFQhg2Rj9ceQM9T978fNArMNr7TRJkXGphJwaiknY",
	position_address: position,
	payload: payload(0, usdc),
	block_seconds: "1790000000",
	...extra,
});
const resolve = async () => ({ mintA: SOLV3, mintB: USDC });

test("events are valued in order with a running per-position value, and replays write nothing", async () => {
	const { pool, inserts } = fakePool([
		row(1, "liquidity_increase", "P1", 200_000_000),
		row(2, "liquidity_decrease", "P1", 50_000_000),
		row(3, "liquidity_increase", "P2", 30_000_000),
	]);
	const first = await runLpValuations({ pool, campaignId: "c", resolvePoolMints: resolve, ...base });
	assert.equal(first.valued, 3);
	assert.deepEqual(inserts.map((r) => [r.position_address, r.sequence, r.value]), [
		["P1", "0", "20000"],
		["P1", "1", "15000"],
		["P2", "0", "3000"],
	]);
	const second = await runLpValuations({ pool, campaignId: "c", resolvePoolMints: resolve, ...base });
	assert.equal(second.valued, 0);
	assert.equal(inserts.length, 3);
	assert.equal(LP_VALUATION_SOURCE, "devnet-usdc-leg");
	assert.equal(LP_VALUATION_VERSION, "devnet-usdc-leg-lp-v1");
});

test("an unresolvable pool blocks only that position's later events", async () => {
	const { pool, inserts } = fakePool([
		row(1, "liquidity_increase", "P1", 100_000_000, { pool_address: "BAD" }),
		row(2, "liquidity_decrease", "P1", 10_000_000, { pool_address: "BAD" }),
		row(3, "liquidity_increase", "P2", 40_000_000),
	]);
	const out = await runLpValuations({
		pool,
		campaignId: "c",
		resolvePoolMints: async (address) => {
			if (address === "BAD") throw new Error("gone");
			return { mintA: SOLV3, mintB: USDC };
		},
		...base,
	});
	assert.equal(out.valued, 1);
	assert.equal(out.unresolved, 1);
	assert.deepEqual(inserts.map((r) => r.position_address), ["P2"]);
});
