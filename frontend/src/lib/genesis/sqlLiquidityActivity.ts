import {
	type LiquidityValueSnapshot,
	summarizeWalletLiquidityParticipation,
} from "./activity.ts";
import type { SqlPool } from "./sqlLedger";

type CampaignRow = { valid_window: boolean };
type CursorRow = { next_slot: string; reconciled_through_slot: string | null };
type CoverageRow = {
	snapshot_count: string;
	valuation_source: string;
	valuation_version: string;
};
type SnapshotRow = {
	snapshot_key: string;
	position_address: string;
	wallet: string;
	sequence: string;
	effective_at_seconds: string;
	exact_second: boolean;
	value_usd_cents: string;
	valuation_source: string;
	valuation_version: string;
	has_price_evidence: boolean;
	chain_event_id: string | null;
	event_slot: string | null;
	event_decoder_version: string | null;
	event_position_address: string | null;
};

function storedInteger(value: string, label: string): bigint {
	if (!/^(0|[1-9][0-9]*)$/.test(value))
		throw new Error(`Invalid stored Genesis ${label}.`);
	return BigInt(value);
}

/** Requires a trusted, immutable coverage assertion; never infers zero from missing rows. */
export async function readGenesisWalletLiquidityActivity(input: {
	pool: SqlPool;
	campaignId: string;
	wallet: string;
	programId: string;
	decoderVersion: string;
	computedThroughSlot: number;
	startSeconds: number;
	endSeconds: number;
	minimumWalletUsdCents: bigint;
}): Promise<{ qualifyingSeconds: bigint; usdCentSeconds: bigint }> {
	const {
		pool,
		campaignId,
		wallet,
		programId,
		decoderVersion,
		computedThroughSlot,
		startSeconds,
		endSeconds,
		minimumWalletUsdCents,
	} = input;
	if (
		!campaignId ||
		!wallet ||
		!programId ||
		!decoderVersion ||
		!Number.isSafeInteger(computedThroughSlot) ||
		computedThroughSlot < 0 ||
		!Number.isSafeInteger(startSeconds) ||
		startSeconds < 0 ||
		!Number.isSafeInteger(endSeconds) ||
		endSeconds <= startSeconds ||
		typeof minimumWalletUsdCents !== "bigint" ||
		minimumWalletUsdCents <= BigInt(0)
	)
		throw new TypeError("Invalid Genesis liquidity metric policy or interval.");
	const client = await pool.connect();
	let inTransaction = false;
	try {
		await client.query(
			"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
		);
		inTransaction = true;
		const campaign = await client.query<CampaignRow>(
			`SELECT status <> 'draft' AND starts_at = to_timestamp($2)
			   AND ends_at >= to_timestamp($3) AS valid_window
			 FROM genesis.campaigns WHERE id = $1`,
			[campaignId, startSeconds, endSeconds],
		);
		if (campaign.rows.length !== 1 || campaign.rows[0].valid_window !== true)
			throw new Error("Genesis liquidity campaign window is not published.");
		const cursor = await client.query<CursorRow>(
			`SELECT next_slot::text, reconciled_through_slot::text
			 FROM genesis.indexer_cursors
			 WHERE campaign_id = $1 AND program_id = $2 AND decoder_version = $3`,
			[campaignId, programId, decoderVersion],
		);
		const watermark = BigInt(computedThroughSlot);
		if (
			cursor.rows.length !== 1 ||
			cursor.rows[0].reconciled_through_slot === null ||
			storedInteger(cursor.rows[0].next_slot, "next slot") <= watermark ||
			storedInteger(
				cursor.rows[0].reconciled_through_slot,
				"reconciliation slot",
			) < watermark
		)
			throw new Error("Genesis LP chain range is not reconciled.");
		const coverage = await client.query<CoverageRow>(
			`SELECT snapshot_count::text, valuation_source, valuation_version
			 FROM genesis.lp_snapshot_coverage
			 WHERE campaign_id = $1 AND wallet = $2 AND through_slot = $3
			   AND through_at = to_timestamp($4)`,
			[campaignId, wallet, computedThroughSlot, endSeconds],
		);
		if (coverage.rows.length !== 1)
			throw new Error("Genesis wallet LP snapshot coverage is unavailable.");
		const result = await client.query<SnapshotRow>(
			`SELECT s.snapshot_key, s.position_address, s.wallet, s.sequence::text,
			 trunc(EXTRACT(EPOCH FROM s.effective_at))::bigint::text AS effective_at_seconds,
			 EXTRACT(EPOCH FROM s.effective_at) =
			   trunc(EXTRACT(EPOCH FROM s.effective_at)) AS exact_second,
			 s.value_usd_cents::text, s.valuation_source, s.valuation_version,
			 s.price_evidence <> '{}'::jsonb AS has_price_evidence,
			 s.chain_event_id::text, e.slot::text AS event_slot,
			 e.decoder_version AS event_decoder_version,
			 e.position_address AS event_position_address
			 FROM genesis.lp_value_snapshots s
			 LEFT JOIN genesis.chain_events e
			   ON e.campaign_id = s.campaign_id AND e.id = s.chain_event_id
			 WHERE s.campaign_id = $1 AND s.wallet = $2
			   AND s.effective_at <= to_timestamp($3)
			 ORDER BY s.position_address, s.effective_at, s.sequence`,
			[campaignId, wallet, endSeconds],
		);
		const marker = coverage.rows[0];
		if (
			storedInteger(marker.snapshot_count, "LP coverage count") !==
			BigInt(result.rows.length)
		)
			throw new Error(
				"Genesis wallet LP snapshots changed after reconciliation.",
			);
		const positions = new Map<
			string,
			{ positionAddress: string; snapshots: LiquidityValueSnapshot[] }
		>();
		for (const row of result.rows) {
			if (
				!row.snapshot_key ||
				!row.position_address ||
				row.wallet !== wallet ||
				row.exact_second !== true ||
				row.valuation_source !== marker.valuation_source ||
				row.valuation_version !== marker.valuation_version ||
				(row.chain_event_id !== null &&
					(row.event_slot === null ||
						storedInteger(row.event_slot, "LP event slot") > watermark ||
						row.event_decoder_version !== decoderVersion ||
						row.event_position_address !== row.position_address))
			)
				throw new Error("Genesis wallet LP snapshot evidence is inconsistent.");
			const value = storedInteger(row.value_usd_cents, "LP value");
			if (value > BigInt(0) && row.has_price_evidence !== true)
				throw new Error("Genesis wallet LP value lacks price evidence.");
			const at = storedInteger(row.effective_at_seconds, "LP snapshot time");
			if (at > BigInt(Number.MAX_SAFE_INTEGER))
				throw new RangeError(
					"Genesis LP snapshot time exceeds the supported range.",
				);
			let position = positions.get(row.position_address);
			if (!position) {
				position = { positionAddress: row.position_address, snapshots: [] };
				positions.set(row.position_address, position);
			}
			position.snapshots.push({
				eventKey: row.snapshot_key,
				sequence: storedInteger(row.sequence, "LP sequence"),
				atSeconds: Number(at),
				usdCents: value,
			});
		}
		const activity = summarizeWalletLiquidityParticipation(
			[...positions.values()],
			startSeconds,
			endSeconds,
			minimumWalletUsdCents,
		);
		await client.query("COMMIT");
		inTransaction = false;
		return activity;
	} catch (error) {
		if (inTransaction) await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
