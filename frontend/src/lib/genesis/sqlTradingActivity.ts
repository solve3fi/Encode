import { summarizeTradingActivity, type TradingActivity } from "./activity.ts";
import type { SqlPool } from "./sqlLedger";

type CampaignRow = { status: string; has_start: boolean; has_end: boolean };
type CursorRow = {
	next_slot: string;
	reconciled_through_slot: string | null;
};
type ValuedSwapRow = {
	signature: string;
	instruction_index: number;
	event_index: number;
	wallet: string;
	decoder_version: string;
	block_time_seconds: string;
	exact_second: boolean;
	value_usd_cents: string | null;
	price_fresh: boolean | null;
};

function nonNegativeInteger(value: string, label: string): bigint {
	if (!/^(0|[1-9][0-9]*)$/.test(value))
		throw new Error(`Invalid stored Genesis ${label}.`);
	return BigInt(value);
}

/**
 * Read only: a missing or stale valuation invalidates the whole wallet result.
 * An independently approved price source and reconciliation worker must fill
 * the backing tables before this can be used for campaign progress.
 */
export async function readGenesisWalletTradingActivity(input: {
	pool: SqlPool;
	campaignId: string;
	wallet: string;
	programId: string;
	decoderVersion: string;
	computedThroughSlot: number;
	minimumSwapUsdCents: bigint;
	maximumPriceAgeSeconds: number;
}): Promise<TradingActivity> {
	const {
		pool,
		campaignId,
		wallet,
		programId,
		decoderVersion,
		computedThroughSlot,
		minimumSwapUsdCents,
		maximumPriceAgeSeconds,
	} = input;
	if (
		!campaignId ||
		!wallet ||
		!programId ||
		!decoderVersion ||
		!Number.isSafeInteger(computedThroughSlot) ||
		computedThroughSlot < 0 ||
		typeof minimumSwapUsdCents !== "bigint" ||
		minimumSwapUsdCents <= BigInt(0) ||
		!Number.isSafeInteger(maximumPriceAgeSeconds) ||
		maximumPriceAgeSeconds < 0
	)
		throw new TypeError("Invalid Genesis trading metric policy or watermark.");
	const client = await pool.connect();
	let inTransaction = false;
	try {
		await client.query(
			"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
		);
		inTransaction = true;
		const campaign = await client.query<CampaignRow>(
			`SELECT status, starts_at IS NOT NULL AS has_start,
                    ends_at IS NOT NULL AS has_end
             FROM genesis.campaigns WHERE id = $1`,
			[campaignId],
		);
		if (
			campaign.rows.length !== 1 ||
			campaign.rows[0].status === "draft" ||
			!campaign.rows[0].has_start ||
			!campaign.rows[0].has_end
		)
			throw new Error("Genesis campaign window is not published.");
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
			nonNegativeInteger(cursor.rows[0].next_slot, "next slot") <= watermark ||
			nonNegativeInteger(
				cursor.rows[0].reconciled_through_slot,
				"reconciliation slot",
			) < watermark
		)
			throw new Error(
				"Genesis swaps are not reconciled through the requested slot.",
			);
		const result = await client.query<ValuedSwapRow>(
			`SELECT e.signature, e.instruction_index, e.event_index, e.wallet,
                    e.decoder_version,
                    trunc(EXTRACT(EPOCH FROM e.block_time))::bigint::text AS block_time_seconds,
                    EXTRACT(EPOCH FROM e.block_time) =
                      trunc(EXTRACT(EPOCH FROM e.block_time)) AS exact_second,
                    v.value_usd_cents::text,
                    ABS(EXTRACT(EPOCH FROM (e.block_time - v.price_observed_at)))
                      <= $4::numeric AS price_fresh
             FROM genesis.chain_events e
             JOIN genesis.campaigns c ON c.id = e.campaign_id
             LEFT JOIN genesis.swap_valuations v
               ON v.campaign_id = e.campaign_id AND v.chain_event_id = e.id
             WHERE e.campaign_id = $1 AND e.wallet = $2
               AND e.event_kind = 'swap' AND e.slot <= $3
               AND e.block_time >= c.starts_at AND e.block_time < c.ends_at
             ORDER BY e.slot, e.id`,
			[campaignId, wallet, computedThroughSlot, maximumPriceAgeSeconds],
		);
		const swaps = result.rows.map((row) => {
			if (
				!row.signature ||
				row.wallet !== wallet ||
				row.decoder_version !== decoderVersion ||
				!Number.isSafeInteger(row.instruction_index) ||
				row.instruction_index < 0 ||
				!Number.isSafeInteger(row.event_index) ||
				row.event_index < 0 ||
				row.exact_second !== true ||
				row.value_usd_cents === null ||
				row.price_fresh !== true
			)
				throw new Error(
					"Genesis swap has missing, stale, or inconsistent valuation evidence.",
				);
			const occurredAt = nonNegativeInteger(
				row.block_time_seconds,
				"swap time",
			);
			if (occurredAt > BigInt(Number.MAX_SAFE_INTEGER))
				throw new RangeError("Genesis swap time exceeds the supported range.");
			return {
				eventKey: JSON.stringify([
					row.signature,
					row.instruction_index,
					row.event_index,
				]),
				wallet,
				finality: "finalized" as const,
				occurredAtSeconds: Number(occurredAt),
				qualifyingVolumeUsdCents: nonNegativeInteger(
					row.value_usd_cents,
					"swap valuation",
				),
			};
		});
		const activity = summarizeTradingActivity(
			swaps,
			wallet,
			minimumSwapUsdCents,
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
