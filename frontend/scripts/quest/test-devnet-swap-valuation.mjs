import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";
import { parsePoolMints, valueSwapEvent } from "./devnet-swap-valuation.mjs";

const USDC = "FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up";
const SOL = "So11111111111111111111111111111111111111112";
const OTHER = "6RydWWDfZ8bGmdr8kjjcJvC3FD6M3C4ZjTphWWqdka1f";
const base = { usdcMint: USDC, usdcDecimals: 6 };
const payload = (aToB, input, output) => ({
	aToB,
	inputAmountRaw: String(input),
	outputAmountRaw: String(output),
});
const value = (mintA, mintB, body) =>
	valueSwapEvent({ ...base, mintA, mintB, payload: body });

test("a swap into devUSDC is valued at the output amount", () => {
	const { valueUsdCents, evidence } = value(
		SOL,
		USDC,
		payload(true, 1_000_000_000, 150_250_000),
	);
	assert.equal(valueUsdCents, BigInt(15025));
	assert.equal(evidence.valuedSide, "output");
});

test("a swap out of devUSDC is valued at the input amount", () => {
	const { valueUsdCents, evidence } = value(
		SOL,
		USDC,
		payload(false, 2_000_000, 13_000_000),
	);
	assert.equal(valueUsdCents, BigInt(200));
	assert.equal(evidence.valuedSide, "input");
});

test("fractions of a cent round down and tiny swaps are worth zero", () => {
	assert.equal(
		value(SOL, USDC, payload(false, 19_999, 1)).valueUsdCents,
		BigInt(1),
	);
	assert.equal(
		value(SOL, USDC, payload(false, 9_999, 1)).valueUsdCents,
		BigInt(0),
	);
});

test("a pool without devUSDC is valued at zero with that recorded", () => {
	const { valueUsdCents, evidence } = value(
		SOL,
		OTHER,
		payload(true, 5_000_000_000, 9_999_999_999),
	);
	assert.equal(valueUsdCents, BigInt(0));
	assert.equal(evidence.valuedSide, "none");
});

test("amounts beyond 2^53 keep exact integer precision", () => {
	const { valueUsdCents } = value(
		SOL,
		USDC,
		payload(false, "90071992547409930000000", 1),
	);
	assert.equal(valueUsdCents, BigInt("9007199254740993000"));
});

test("malformed payloads are refused", () => {
	for (const bad of [
		null,
		{},
		{ aToB: "yes", inputAmountRaw: "1", outputAmountRaw: "1" },
		{ aToB: true, inputAmountRaw: "-1", outputAmountRaw: "1" },
		{ aToB: true, inputAmountRaw: "1.5", outputAmountRaw: "1" },
	])
		assert.throws(() => value(SOL, USDC, bad), /payload/);
	assert.throws(
		() =>
			valueSwapEvent({
				usdcMint: USDC,
				usdcDecimals: 99,
				mintA: SOL,
				mintB: USDC,
				payload: payload(true, 1, 1),
			}),
		/decimals/,
	);
});

test("pool mints are read from the Solve account layout and other accounts are refused", () => {
	const data = Buffer.alloc(653);
	createHash("sha256")
		.update("account:Solve")
		.digest()
		.subarray(0, 8)
		.copy(data, 0);
	new PublicKey(SOL).toBuffer().copy(data, 101);
	new PublicKey(USDC).toBuffer().copy(data, 181);
	assert.deepEqual(parsePoolMints(data, PublicKey), {
		mintA: SOL,
		mintB: USDC,
	});
	assert.throws(() => parsePoolMints(Buffer.alloc(653), PublicKey), /Not a Solve pool/);
	assert.throws(() => parsePoolMints(Buffer.alloc(10), PublicKey), /Not a Solve pool/);
});
