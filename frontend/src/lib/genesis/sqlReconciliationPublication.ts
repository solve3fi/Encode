import { reconcileGenesisRange } from "./reconciliation.ts";
import type { SqlPool } from "./sqlLedger";
import {
	readGenesisReconciliationEvidence,
	reconciliationInteger,
} from "./sqlReconciliation.ts";

type PublicationCursor = {
	next_slot: string;
	reconciliation_start_slot: string | null;
	reconciled_through_slot: string | null;
	campaign_cluster: string;
};

/**
 * Dormant server-side publication gate. Requires Genesis migration 003.
 * RPC decoding finishes before the cursor is locked. Comparison and publication
 * share the lock; event/conflict triggers invalidate later contradictory evidence.
 */
export async function reconcileAndPublishGenesisRange<Transaction>(
	input: Omit<
		Parameters<typeof reconcileGenesisRange<Transaction>>[0],
		"reader"
	> & { pool: SqlPool },
) {
	const client = await input.pool.connect();
	let inTransaction = false;
	let throughSlot = -1;
	let written = false;
	try {
		const result = await reconcileGenesisRange({
			...input,
			reader: {
				async readSnapshot({
					campaignId,
					cluster,
					programId,
					decoderVersion,
					startSlot,
					endSlot,
				}) {
					// READ COMMITTED sees inserts that committed before the row lock was acquired.
					await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
					inTransaction = true;
					const cursor = await client.query<PublicationCursor>(
						`SELECT cursor.next_slot::text, cursor.reconciliation_start_slot::text,
						 cursor.reconciled_through_slot::text, campaign.cluster AS campaign_cluster
						 FROM genesis.indexer_cursors AS cursor
						 JOIN genesis.campaigns AS campaign ON campaign.id = cursor.campaign_id
						 WHERE cursor.campaign_id = $1 AND cursor.program_id = $2 AND cursor.decoder_version = $3
						 FOR UPDATE OF cursor`,
						[campaignId, programId, decoderVersion],
					);
					if (
						cursor.rows.length !== 1 ||
						cursor.rows[0].campaign_cluster !== cluster
					) {
						throw new Error(
							"Genesis publication cursor or campaign cluster does not match.",
						);
					}
					const row = cursor.rows[0];
					if (row.reconciliation_start_slot === null) {
						throw new Error(
							"Genesis reconciliation starting slot is not pinned.",
						);
					}
					const anchor = reconciliationInteger(
						row.reconciliation_start_slot,
						"reconciliation starting slot",
					);
					const nextSlot = reconciliationInteger(row.next_slot, "next slot");
					const previous =
						row.reconciled_through_slot === null
							? null
							: reconciliationInteger(
									row.reconciled_through_slot,
									"reconciled slot",
								);
					if (
						anchor > nextSlot ||
						(previous !== null && (previous < anchor || previous >= nextSlot))
					) {
						throw new Error(
							"Genesis stored reconciliation bounds are inconsistent.",
						);
					}
					if (
						startSlot < anchor ||
						startSlot > (previous === null ? anchor : previous + 1)
					) {
						throw new Error(
							"Genesis reconciliation range leaves a gap or precedes its starting slot.",
						);
					}
					throughSlot = Math.max(previous ?? -1, endSlot);
					written = previous === null || throughSlot > previous;
					return {
						nextSlot,
						...(await readGenesisReconciliationEvidence(
							client,
							campaignId,
							startSlot,
							endSlot,
						)),
					};
				},
			},
		});
		if (written) {
			const update = await client.query(
				`UPDATE genesis.indexer_cursors SET reconciled_through_slot = $4, updated_at = now()
				 WHERE campaign_id = $1 AND program_id = $2 AND decoder_version = $3`,
				[
					input.campaignId,
					input.decoder.programId,
					input.decoder.version,
					throughSlot,
				],
			);
			if (update.rowCount !== 1)
				throw new Error("Genesis reconciliation publication failed.");
		}
		await client.query("COMMIT");
		inTransaction = false;
		return { ...result, reconciledThroughSlot: throughSlot, written };
	} catch (error) {
		if (inTransaction) await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
