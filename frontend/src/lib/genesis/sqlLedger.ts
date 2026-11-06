import type { GenesisLedger, IndexedGenesisEvent } from "./indexer";

export type SqlConnection = {
	query<Row extends Record<string, unknown> = Record<string, unknown>>(
		statement: string,
		values?: unknown[],
	): Promise<{ rows: Row[]; rowCount: number | null }>;
	release(): void;
};

export type SqlPool = { connect(): Promise<SqlConnection> };

export class GenesisReplayConflict extends Error {
	readonly existingEventId: string;
	readonly observedHash: string;
	readonly decoderVersion: string;

	constructor(
		existingEventId: string,
		observedHash: string,
		decoderVersion: string,
	) {
		super("Conflicting finalized Genesis event replay.");
		this.existingEventId = existingEventId;
		this.observedHash = observedHash;
		this.decoderVersion = decoderVersion;
	}
}

type CursorRow = { next_slot: string };
type EventRow = { id: string; event_sha256: string };

const eventIdentity = (event: IndexedGenesisEvent) =>
	JSON.stringify([
		event.record.campaignId,
		event.record.cluster,
		event.record.signature,
		event.record.instructionIndex,
		event.record.eventIndex,
	]);

/** PostgreSQL adapter; the caller supplies a server-only, least-privilege pool. */
export function createGenesisSqlLedger(pool: SqlPool): GenesisLedger {
	return {
		async readNextSlot(campaignId, programId, decoderVersion) {
			const client = await pool.connect();
			try {
				const result = await client.query<CursorRow>(
					`SELECT next_slot::text FROM genesis.indexer_cursors
                     WHERE campaign_id = $1 AND program_id = $2 AND decoder_version = $3`,
					[campaignId, programId, decoderVersion],
				);
				if (result.rows.length !== 1)
					throw new Error("Genesis indexer cursor is not initialized.");
				const slot = Number(result.rows[0].next_slot);
				if (!Number.isSafeInteger(slot) || slot < 0)
					throw new Error("Invalid Genesis indexer cursor.");
				return slot;
			} finally {
				client.release();
			}
		},
		async commitRange({
			campaignId,
			programId,
			decoderVersion,
			startSlot,
			nextSlot,
			events,
		}) {
			if (
				!Number.isSafeInteger(startSlot) ||
				!Number.isSafeInteger(nextSlot) ||
				nextSlot <= startSlot
			) {
				throw new RangeError("Invalid Genesis slot range.");
			}
			const uniqueEvents = new Map<string, IndexedGenesisEvent>();
			let duplicates = 0;
			for (const event of events) {
				if (
					event.record.campaignId !== campaignId ||
					event.decoderVersion !== decoderVersion ||
					event.record.slot < startSlot ||
					event.record.slot >= nextSlot ||
					!/^[0-9a-f]{64}$/.test(event.eventSha256)
				) {
					throw new Error("Genesis event does not match the committed range.");
				}
				const key = eventIdentity(event);
				const previous = uniqueEvents.get(key);
				if (previous) {
					if (previous.eventSha256 !== event.eventSha256) {
						throw new Error(
							"Conflicting Genesis events within one decoded range.",
						);
					}
					duplicates += 1;
					continue;
				}
				uniqueEvents.set(key, event);
			}
			const client = await pool.connect();
			let inTransaction = false;
			try {
				await client.query("BEGIN");
				inTransaction = true;
				const cursor = await client.query<CursorRow>(
					`SELECT next_slot::text FROM genesis.indexer_cursors
                     WHERE campaign_id = $1 AND program_id = $2 AND decoder_version = $3
                     FOR UPDATE`,
					[campaignId, programId, decoderVersion],
				);
				if (
					cursor.rows.length !== 1 ||
					Number(cursor.rows[0].next_slot) !== startSlot
				) {
					throw new Error("Genesis cursor moved during range fetch.");
				}
				let inserted = 0;
				for (const event of uniqueEvents.values()) {
					const record = event.record;
					const values = [
						campaignId,
						record.cluster,
						record.signature,
						record.instructionIndex,
						record.eventIndex,
						record.eventKind,
						record.slot,
						record.blockTimeSeconds,
						record.wallet,
						record.poolAddress,
						record.positionAddress,
						JSON.stringify(record.payload),
						event.eventSha256,
						decoderVersion,
					];
					const write = await client.query<{ id: string }>(
						`INSERT INTO genesis.chain_events
                         (campaign_id, cluster, signature, instruction_index, event_index,
                          event_kind, slot, block_time, wallet, pool_address, position_address,
                          payload, event_sha256, decoder_version, verified_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8), $9, $10, $11,
                                 $12::jsonb, $13, $14, now())
                         ON CONFLICT (campaign_id, cluster, signature, instruction_index, event_index)
                         DO NOTHING RETURNING id::text`,
						values,
					);
					if (write.rows.length === 1) {
						inserted += 1;
						continue;
					}
					const existing = await client.query<EventRow>(
						`SELECT id::text, event_sha256 FROM genesis.chain_events
                         WHERE campaign_id = $1 AND cluster = $2 AND signature = $3
                           AND instruction_index = $4 AND event_index = $5`,
						values.slice(0, 5),
					);
					if (existing.rows.length !== 1)
						throw new Error("Genesis replay lookup failed.");
					if (existing.rows[0].event_sha256 !== event.eventSha256) {
						throw new GenesisReplayConflict(
							existing.rows[0].id,
							event.eventSha256,
							decoderVersion,
						);
					}
					duplicates += 1;
				}
				await client.query(
					`UPDATE genesis.indexer_cursors SET next_slot = $4, updated_at = now()
                     WHERE campaign_id = $1 AND program_id = $2 AND decoder_version = $3`,
					[campaignId, programId, decoderVersion, nextSlot],
				);
				await client.query("COMMIT");
				inTransaction = false;
				return { inserted, duplicates };
			} catch (error) {
				if (inTransaction) await client.query("ROLLBACK");
				if (error instanceof GenesisReplayConflict) {
					await client.query(
						`INSERT INTO genesis.ingest_conflicts
                         (existing_event_id, observed_event_sha256, observed_decoder_version)
                         VALUES ($1, $2, $3)
                         ON CONFLICT (existing_event_id, observed_event_sha256, observed_decoder_version)
                         DO NOTHING`,
						[error.existingEventId, error.observedHash, error.decoderVersion],
					);
				}
				throw error;
			} finally {
				client.release();
			}
		},
	};
}
