import assert from "node:assert/strict";
import test from "node:test";
import { filterStockPools } from "../src/lib/stockPools.ts";
import { STOCK_ASSETS } from "../src/configs/stockAssets.ts";

const pool = (a, b, symbol = "AAPLx") => ({
	symbol,
	getData: () => ({ tokenMintA: { toString: () => a }, tokenMintB: { toString: () => b } }),
});
const assets = [{ chainId: 101, mint: "approved-stock", symbol: "TEST", issuer: "Test fixture" }];

test("stock category matches approved mint on either side, not a ticker name", () => {
	const a = pool("approved-stock", "usdc");
	const b = pool("usdc", "approved-stock");
	const fake = pool("unapproved", "usdc");
	assert.deepEqual(filterStockPools([a, b, fake], 101, assets), [a, b]);
});
test("mainnet stock approvals cannot classify devnet pools", () => {
	assert.deepEqual(filterStockPools([pool("approved-stock", "usdc")], 102, assets), []);
});
test("unavailable pool data returns an empty category", () => {
	assert.deepEqual(filterStockPools(undefined, 101, assets), []);
});
test("this UI release enables no real or mock stock assets", () => {
	assert.equal(STOCK_ASSETS.length, 0);
	assert.deepEqual(filterStockPools([pool("approved-stock", "usdc")], 101, STOCK_ASSETS), []);
});
