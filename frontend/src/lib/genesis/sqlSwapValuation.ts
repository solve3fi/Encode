import type { SqlPool } from "./sqlLedger";

const MAX_NUMERIC_38 = BigInt("99999999999999999999999999999999999999");

type EventRow = { event_sha256: string; decoder_version: string };
type ReplayRow = { matches: boolean };

/** Records externally verified USD evidence; this adapter never chooses a price. */
export async function persistGenesisSwapValuation(input: {
	pool: SqlPool;
	campaignId: string;
	chainEventId: bigint;
	expectedEventSha256: string;
	decoderVersion: string;
	valueUsdCents: bigint;
	priceObservedAtSeconds: number;
	valuationSource: string;
	valuationVersion: string;
	priceEvidence: Record<string, unknown>;
}): Promise<{ written: boolean }> {
	const {
		pool,
		campaignId,
		chainEventId,
		expectedEventSha256,
		decoderVersion,
		valueUsdCents,
		priceObservedAtSeconds,
		valuationSource,
		valuationVersion,
		priceEvidence,
	} = input;
	if (
		!campaignId ||
		typeof chainEventId !== "bigint" ||
		chainEventId < BigInt(1) ||
		chainEventId > BigInt("9223372036854775807") ||
		!/^[0-9a-f]{64}$/.test(expectedEventSha256) ||
		!decoderVersion ||
		typeof valueUsdCents !== "bigint" ||
		valueUsdCents < BigInt(0) ||
		valueUsdCents > MAX_NUMERIC_38 ||
		!Number.isSafeInteger(priceObservedAtSeconds) ||
		priceObservedAtSeconds < 0 ||
		!valuationSource.trim() ||
		!valuationVersion.trim() ||
		!priceEvidence ||
		Array.isArray(priceEvidence) ||
		Object.getPrototypeOf(priceEvidence) !== Object.prototype ||
		Object.keys(priceEvidence).length === 0
	)
		throw new TypeError("Invalid Genesis swap valuation identity or evidence.");
	const evidenceJson = JSON.stringify(priceEvidence);
	if (!evidenceJson || evidenceJson === "{}")
		throw new TypeError("Genesis swap valuation evidence is empty.");
	const values = [
		campaignId,
		chainEventId.toString(),
		valueUsdCents.toString(),
		priceObservedAtSeconds,
		valuationSource,
		valuationVersion,
		evidenceJson,
	];
	const client = await pool.connect();
	let inTransaction = false;
	try {
		await client.query("BEGIN");
		inTransaction = true;
		const event = await client.query<EventRow>(
			`SELECT event_sha256, decoder_version FROM genesis.chain_events
			 WHERE campaign_id = $1 AND id = $2 AND event_kind = 'swap' FOR SHARE`,
			values.slice(0, 2),
		);
		if (
			event.rows.length !== 1 ||
			event.rows[0].event_sha256 !== expectedEventSha256 ||
			event.rows[0].decoder_version !== decoderVersion
		)
			throw new Error("Genesis swap event identity does not match valuation.");
		const inserted = await client.query(
			`INSERT INTO genesis.swap_valuations
			 (campaign_id, chain_event_id, value_usd_cents, price_observed_at,
			  valuation_source, valuation_version, price_evidence)
			 VALUES ($1, $2, $3, to_timestamp($4), $5, $6, $7::jsonb)
			 ON CONFLICT (campaign_id, chain_event_id) DO NOTHING
			 RETURNING chain_event_id`,
			values,
		);
		if (inserted.rowCount !== 1) {
			const replay = await client.query<ReplayRow>(
				`SELECT value_usd_cents = $3::numeric
				   AND price_observed_at = to_timestamp($4)
				   AND valuation_source = $5
				   AND valuation_version = $6
				   AND price_evidence = $7::jsonb AS matches
				 FROM genesis.swap_valuations
				 WHERE campaign_id = $1 AND chain_event_id = $2`,
				values,
			);
			if (replay.rows.length !== 1 || replay.rows[0].matches !== true)
				throw new Error("Conflicting Genesis swap valuation replay.");
		}
		await client.query("COMMIT");
		inTransaction = false;
		return { written: inserted.rowCount === 1 };
	} catch (error) {
		if (inTransaction) await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
