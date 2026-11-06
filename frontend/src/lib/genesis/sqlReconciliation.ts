import type {
	GenesisReconciliationReader,
	StoredGenesisEvent,
} from "./reconciliation";
import type { SqlConnection, SqlPool } from "./sqlLedger";

type CursorRow = { next_slot: string };
type EventRow = {
	cluster: StoredGenesisEvent["cluster"];
	signature: string;
	instruction_index: number;
	event_index: number;
	slot: string;
	block_time_seconds: string;
	exact_second: boolean;
	decoder_version: string;
	event_sha256: string;
};
type ConflictRow = { open_conflict_count: string };

export function reconciliationInteger(
	value: string | number,
	label: string,
): number {
	const result = Number(value);
	if (
		!/^(0|[1-9][0-9]*)$/.test(String(value)) ||
		!Number.isSafeInteger(result) ||
		result < 0
	) {
		throw new Error(`Invalid Genesis ${label}.`);
	}
	return result;
}

/** Caller owns transaction and, for publication, the cursor row lock. */
export async function readGenesisReconciliationEvidence(
	client: SqlConnection,
	campaignId: string,
	startSlot: number,
	endSlot: number,
) {
	const events = await client.query<EventRow>(
		`SELECT cluster, signature, instruction_index, event_index, slot::text,
		 trunc(EXTRACT(EPOCH FROM block_time))::bigint::text AS block_time_seconds,
		 EXTRACT(EPOCH FROM block_time) = trunc(EXTRACT(EPOCH FROM block_time)) AS exact_second,
		 decoder_version, event_sha256 FROM genesis.chain_events
		 WHERE campaign_id = $1 AND slot BETWEEN $2 AND $3 ORDER BY slot, id`,
		[campaignId, startSlot, endSlot],
	);
	const conflicts = await client.query<ConflictRow>(
		`SELECT count(*)::text AS open_conflict_count FROM genesis.ingest_conflicts AS conflict
		 JOIN genesis.chain_events AS event ON event.id = conflict.existing_event_id
		 WHERE event.campaign_id = $1 AND event.slot BETWEEN $2 AND $3
		 AND conflict.resolution = 'open'`,
		[campaignId, startSlot, endSlot],
	);
	if (conflicts.rows.length !== 1)
		throw new Error("Genesis conflict count is unavailable.");
	return {
		openConflictCount: reconciliationInteger(
			conflicts.rows[0].open_conflict_count,
			"conflict count",
		),
		events: events.rows.map((row): StoredGenesisEvent => {
			if (row.exact_second !== true)
				throw new Error("Genesis block time is not an exact second.");
			return {
				cluster: row.cluster,
				signature: row.signature,
				instructionIndex: reconciliationInteger(
					row.instruction_index,
					"instruction index",
				),
				eventIndex: reconciliationInteger(row.event_index, "event index"),
				slot: reconciliationInteger(row.slot, "event slot"),
				blockTimeSeconds: reconciliationInteger(
					row.block_time_seconds,
					"block time",
				),
				decoderVersion: row.decoder_version,
				eventSha256: row.event_sha256,
			};
		}),
	};
}

/** One stable PostgreSQL snapshot. The supplied pool must use a server-only read role. */
export function createGenesisSqlReconciliationReader(
	pool: SqlPool,
): GenesisReconciliationReader {
	return {
		async readSnapshot({
			campaignId,
			programId,
			decoderVersion,
			startSlot,
			endSlot,
		}) {
			const client = await pool.connect();
			let inTransaction = false;
			try {
				await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
				inTransaction = true;
				const cursor = await client.query<CursorRow>(
					`SELECT next_slot::text FROM genesis.indexer_cursors
					 WHERE campaign_id = $1 AND program_id = $2 AND decoder_version = $3`,
					[campaignId, programId, decoderVersion],
				);
				if (cursor.rows.length !== 1)
					throw new Error("Genesis reconciliation cursor is not initialized.");
				const nextSlot = reconciliationInteger(
					cursor.rows[0].next_slot,
					"reconciliation cursor",
				);
				const snapshot = {
					nextSlot,
					...(await readGenesisReconciliationEvidence(
						client,
						campaignId,
						startSlot,
						endSlot,
					)),
				};
				await client.query("COMMIT");
				inTransaction = false;
				return snapshot;
			} catch (error) {
				if (inTransaction) await client.query("ROLLBACK");
				throw error;
			} finally {
				client.release();
			}
		},
	};
}
