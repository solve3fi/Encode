import { createHash } from "node:crypto";
import { persistGenesisSwapValuation } from "../../src/lib/genesis/sqlSwapValuation.ts";

// TEST-ONLY Devnet valuation policy (not an approved oracle): the project's own devUSDC mint is
// treated as exactly one US dollar, and a swap is worth the devUSDC amount that moved on its
// pool. Pools without a devUSDC side are valued at zero, so they never qualify. Every value is
// stored with its evidence so a reviewer can recompute it, and the rule is versioned.
export const DEVNET_VALUATION_SOURCE = "devnet-usdc-leg";
export const DEVNET_VALUATION_VERSION = "devnet-usdc-leg-v1";

// Solve pool account: Anchor discriminator, then tokenMintA at byte 101 and tokenMintB at byte 181
// (verified against the three live Devnet pools; the layout is the Whirlpool-style fork's).
const POOL_DISCRIMINATOR = createHash("sha256")
	.update("account:Solve")
	.digest()
	.subarray(0, 8);
const MINT_A_OFFSET = 101;
const MINT_B_OFFSET = 181;

export function parsePoolMints(data, PublicKey) {
	if (
		!data ||
		data.length < MINT_B_OFFSET + 32 ||
		!Buffer.from(data.subarray(0, 8)).equals(POOL_DISCRIMINATOR)
	)
		throw new Error("Not a Solve pool account.");
	return {
		mintA: new PublicKey(data.subarray(MINT_A_OFFSET, MINT_A_OFFSET + 32)).toBase58(),
		mintB: new PublicKey(data.subarray(MINT_B_OFFSET, MINT_B_OFFSET + 32)).toBase58(),
	};
}

/** Pure: the test USD value (in cents, floor) of one Traded event. */
export function valueSwapEvent({ payload, mintA, mintB, usdcMint, usdcDecimals }) {
	if (
		!payload ||
		typeof payload.aToB !== "boolean" ||
		!/^[0-9]+$/.test(String(payload.inputAmountRaw)) ||
		!/^[0-9]+$/.test(String(payload.outputAmountRaw))
	)
		throw new TypeError("Invalid swap payload.");
	if (!Number.isInteger(usdcDecimals) || usdcDecimals < 0 || usdcDecimals > 18)
		throw new RangeError("Invalid devUSDC decimals.");
	const inputMint = payload.aToB ? mintA : mintB;
	const outputMint = payload.aToB ? mintB : mintA;
	let side = "none";
	let raw = BigInt(0);
	if (inputMint === usdcMint) {
		side = "input";
		raw = BigInt(payload.inputAmountRaw);
	} else if (outputMint === usdcMint) {
		side = "output";
		raw = BigInt(payload.outputAmountRaw);
	}
	const cents = (raw * BigInt(100)) / BigInt(10) ** BigInt(usdcDecimals);
	return {
		valueUsdCents: cents,
		evidence: {
			rule: "1 devUSDC = 1 USD (Devnet test policy, not an oracle)",
			usdcMint,
			usdcDecimals,
			valuedSide: side,
			rawUsdcAmount: raw.toString(),
			poolMintA: mintA,
			poolMintB: mintB,
		},
	};
}

/**
 * Values every swap event that has no valuation yet. Idempotent and replay-safe: the persistence
 * adapter refuses a conflicting replay. Returns counts; an event whose pool cannot be read is left
 * unvalued and reported, never guessed.
 */
export async function runSwapValuations({
	pool,
	campaignId,
	resolvePoolMints,
	usdcMint,
	usdcDecimals,
	limit = 500,
}) {
	const client = await pool.connect();
	let pending;
	try {
		pending = (
			await client.query(
				`SELECT e.id::text AS id, e.event_sha256, e.decoder_version, e.pool_address, e.payload,
				 extract(epoch FROM e.block_time)::bigint::text AS block_time_seconds
				 FROM genesis.chain_events e
				 LEFT JOIN genesis.swap_valuations v ON v.campaign_id = e.campaign_id AND v.chain_event_id = e.id
				 WHERE e.campaign_id = $1 AND e.event_kind = 'swap' AND v.chain_event_id IS NULL
				 ORDER BY e.id LIMIT $2`,
				[campaignId, limit],
			)
		).rows;
	} finally {
		client.release();
	}
	const result = { valued: 0, unresolved: 0, pending: pending.length };
	for (const row of pending) {
		let mints;
		try {
			mints = await resolvePoolMints(row.pool_address);
		} catch {
			result.unresolved++;
			continue;
		}
		const { valueUsdCents, evidence } = valueSwapEvent({
			payload: row.payload,
			mintA: mints.mintA,
			mintB: mints.mintB,
			usdcMint,
			usdcDecimals,
		});
		const observed = Number(row.block_time_seconds);
		await persistGenesisSwapValuation({
			pool,
			campaignId,
			chainEventId: BigInt(row.id),
			expectedEventSha256: row.event_sha256,
			decoderVersion: row.decoder_version,
			valueUsdCents,
			priceObservedAtSeconds: observed,
			valuationSource: DEVNET_VALUATION_SOURCE,
			valuationVersion: DEVNET_VALUATION_VERSION,
			priceEvidence: evidence,
		});
		result.valued++;
	}
	return result;
}
