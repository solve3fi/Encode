import { fingerprintGenesisEvent } from "./eventFingerprint.ts";
import type { FinalizedSource, VerifiedGenesisDecoder } from "./indexer";
import { indexGenesisRange } from "./indexer.ts";
import type { SqlConnection, SqlPool } from "./sqlLedger";
import { createGenesisSqlLedger } from "./sqlLedger.ts";
import { reconciliationInteger } from "./sqlReconciliation.ts";
import { reconcileAndPublishGenesisRange } from "./sqlReconciliationPublication.ts";

type WorkerCursor = {
	next_slot: string;
	reconciliation_start_slot: string | null;
	reconciled_through_slot: string | null;
	campaign_cluster: string;
};

export type GenesisWorkerReport = {
	status: "idle" | "batch_complete" | "paused";
	reason:
		| "FINALIZED_HEAD_REACHED"
		| "CYCLE_LIMIT_REACHED"
		| "CURSOR_REFUSED"
		| "INDEX_FAILED"
		| "RECONCILIATION_FAILED";
	cyclesCompleted: number;
	indexedEvents: number;
	duplicateEvents: number;
	reconciledEvents: number;
	cursor: { nextSlot: number; reconciledThroughSlot: number | null } | null;
};

/** The startup wrapper owns this dedicated connection; adapters only borrow it. */
function singleConnectionPool(
	connection: Pick<SqlConnection, "query">,
): SqlPool {
	let leased = false;
	return {
		async connect() {
			if (leased)
				throw new Error("Genesis dedicated connection is already leased.");
			leased = true;
			return {
				query: connection.query.bind(connection),
				release() {
					leased = false;
				},
			};
		},
	};
}

export function validateGenesisWorkerBounds(
	maxCycles: number,
	maxSlots: number,
	startSlot: number,
) {
	if (
		!Number.isSafeInteger(maxCycles) ||
		maxCycles < 1 ||
		maxCycles > 16 ||
		!Number.isSafeInteger(maxSlots) ||
		maxSlots < 1 ||
		maxSlots > 512 ||
		!Number.isSafeInteger(startSlot) ||
		startSlot < 0
	) {
		throw new RangeError(
			"Invalid Genesis worker cycle, range or starting-slot bound.",
		);
	}
}

/**
 * Low-level bounded engine. Only call from the verified Devnet startup wrapper.
 * It neither opens a connection nor retries, schedules work, awards XP or logs errors.
 */
export async function runVerifiedGenesisDevnetCycles<Transaction>(input: {
	connection: Pick<SqlConnection, "query">;
	campaignId: string;
	startSlot: number;
	source: FinalizedSource<Transaction>;
	decoder: VerifiedGenesisDecoder<Transaction>;
	maxCycles?: number;
	maxSlots?: number;
}): Promise<GenesisWorkerReport> {
	const { connection, campaignId, startSlot, source, decoder } = input;
	const maxCycles = input.maxCycles ?? 1;
	const maxSlots = input.maxSlots ?? 32;
	validateGenesisWorkerBounds(maxCycles, maxSlots, startSlot);
	if (!campaignId || !decoder.programId || !decoder.version)
		throw new TypeError("Missing Genesis worker identity.");
	const pool = singleConnectionPool(connection);
	const ledger = createGenesisSqlLedger(pool);
	const report: GenesisWorkerReport = {
		status: "batch_complete",
		reason: "CYCLE_LIMIT_REACHED",
		cyclesCompleted: 0,
		indexedEvents: 0,
		duplicateEvents: 0,
		reconciledEvents: 0,
		cursor: null,
	};
	let phase: GenesisWorkerReport["reason"] = "CURSOR_REFUSED";
	async function readCursor() {
		phase = "CURSOR_REFUSED";
		const result = await connection.query<WorkerCursor>(
			`SELECT cursor.next_slot::text, cursor.reconciliation_start_slot::text,
			 cursor.reconciled_through_slot::text, campaign.cluster AS campaign_cluster
			 FROM genesis.indexer_cursors AS cursor
			 JOIN genesis.campaigns AS campaign ON campaign.id = cursor.campaign_id
			 WHERE cursor.campaign_id = $1 AND cursor.program_id = $2 AND cursor.decoder_version = $3`,
			[campaignId, decoder.programId, decoder.version],
		);
		if (result.rows.length !== 1)
			throw new Error("Devnet worker cursor is missing.");
		const row = result.rows[0];
		if (
			row.campaign_cluster !== "devnet" ||
			row.reconciliation_start_slot === null
		) {
			throw new Error("Unpinned Devnet worker cursor.");
		}
		const anchor = reconciliationInteger(
			row.reconciliation_start_slot,
			"worker starting slot",
		);
		const nextSlot = reconciliationInteger(row.next_slot, "worker next slot");
		const reconciledThroughSlot =
			row.reconciled_through_slot === null
				? null
				: reconciliationInteger(
						row.reconciled_through_slot,
						"worker reconciled slot",
					);
		if (
			anchor !== startSlot ||
			nextSlot < anchor ||
			(reconciledThroughSlot !== null &&
				(reconciledThroughSlot < anchor || reconciledThroughSlot >= nextSlot))
		) {
			throw new Error(
				"Genesis worker cursor bounds do not match deployment input.",
			);
		}
		const cursor = { nextSlot, reconciledThroughSlot };
		report.cursor = cursor;
		return cursor;
	}
	async function reconcile(start: number, end: number) {
		phase = "RECONCILIATION_FAILED";
		const result = await reconcileAndPublishGenesisRange({
			pool,
			campaignId,
			cluster: "devnet",
			startSlot: start,
			endSlot: end,
			source,
			decoder,
			fingerprint: fingerprintGenesisEvent,
		});
		report.reconciledEvents += result.checkedEvents;
	}
	try {
		for (let cycle = 0; cycle < maxCycles; cycle++) {
			const cursor = await readCursor();
			const unreconciledStart =
				cursor.reconciledThroughSlot === null
					? startSlot
					: cursor.reconciledThroughSlot + 1;
			if (unreconciledStart < cursor.nextSlot) {
				// Never ingest further while a committed range still lacks reconciliation.
				await reconcile(
					unreconciledStart,
					Math.min(cursor.nextSlot - 1, unreconciledStart + maxSlots - 1),
				);
			} else {
				phase = "INDEX_FAILED";
				const indexed = await indexGenesisRange({
					campaignId,
					cluster: "devnet",
					source,
					decoder,
					ledger: {
						...ledger,
						async readNextSlot(id, program, version) {
							const next = await ledger.readNextSlot(id, program, version);
							if (next !== cursor.nextSlot)
								throw new Error("Genesis worker cursor moved before ingest.");
							return next;
						},
					},
					fingerprint: fingerprintGenesisEvent,
					maxSlots,
				});
				report.indexedEvents += indexed.inserted;
				report.duplicateEvents += indexed.duplicates;
				if (indexed.nextSlot === indexed.startSlot) {
					const fresh = await readCursor();
					const pending =
						fresh.reconciledThroughSlot === null
							? startSlot
							: fresh.reconciledThroughSlot + 1;
					if (pending < fresh.nextSlot) continue;
					return {
						...report,
						status: "idle",
						reason: "FINALIZED_HEAD_REACHED",
					};
				}
				await reconcile(indexed.startSlot, indexed.nextSlot - 1);
			}
			report.cyclesCompleted++;
		}
		await readCursor();
		return report;
	} catch {
		// Health codes never contain raw RPC/SQL messages, URLs, signatures or secrets.
		const failure = phase;
		try {
			await readCursor();
		} catch {
			report.cursor = null;
		}
		return { ...report, status: "paused", reason: failure };
	}
}
