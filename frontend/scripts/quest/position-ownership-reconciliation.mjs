import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
	createPositionOwnershipBlockReader,
	verifyOwnershipRangeAnchor,
} from "./position-ownership-block-range.mjs";
import {
	publishOwnershipCoverage,
	readOwnershipCoverage,
} from "./position-ownership-coverage.mjs";

const digest = (value) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function ownershipReconciliationRow(
	{ sourceKey, evidenceSha256, record: r },
	anchorSha256,
) {
	return {
		source_key: sourceKey,
		evidence_sha256: evidenceSha256,
		evidence_record: r,
		network: r.network,
		program_id: r.programId,
		decoder_version: "position-ownership-v1",
		anchor_sha256: anchorSha256,
		signature: r.signature,
		instruction_index: String(r.instructionIndex),
		position_address: r.positionAddress,
		position_mint: r.positionMint,
		slot: String(r.slot),
		transaction_index: String(r.transactionIndex),
		block_time_seconds: String(r.blockTimeSeconds),
		event_kind: r.eventKind,
	};
}

/** Fresh complete block comparison; never a watermark or XP authorization. */
export function createPositionOwnershipReconciler({
	pool,
	connection,
	anchor,
}) {
	return createEngine({ pool, connection, anchor }, false);
}

/** Fresh comparison and prefix publication in the same campaign-locked transaction. */
export function createPositionOwnershipCoveragePublisher(configuration) {
	const engine = createEngine(configuration, true);
	return { publish: engine.reconcile };
}

function createEngine({ pool, connection, anchor }, publish) {
	const p = verifyOwnershipRangeAnchor(anchor);
	anchor = p.bundle;
	const reader = createPositionOwnershipBlockReader({ connection, anchor });
	if (typeof pool?.connect !== "function")
		throw new Error("Ownership reconciliation: dedicated pool required");
	return {
		async reconcile({ startSlot, endSlot }) {
			const range = await reader.read({ startSlot, endSlot });
			const expected = range.observations.map((e) =>
				ownershipReconciliationRow(e, p.evidenceSetSha256),
			);
			const client = await pool.connect();
			let begun = false,
				failed = false;
			try {
				await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
				begun = true;
				await client.query(
					"SELECT pg_advisory_xact_lock(hashtextextended($1,61746))",
					[anchor.campaignId],
				);
				const environment = await client.query(
					"SELECT network,genesis_hash,manifest_sha256,namespace FROM quest.environment_identity WHERE singleton=true",
				);
				const e = environment?.rows?.[0];
				if (
					environment?.rows?.length !== 1 ||
					e.network !== anchor.network ||
					e.genesis_hash !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" ||
					e.manifest_sha256 !== anchor.manifestSha256 ||
					e.namespace !== "quest"
				)
					throw new Error(
						"Ownership reconciliation: database identity differs",
					);
				const storedAnchor = await client.query(
					"SELECT evidence_bundle,evidence_set_sha256,inventory_sha256,network,program_id,layout_version,anchor_slot::text,manifest_sha256,position_count FROM quest.position_baseline_anchors WHERE campaign_id=$1",
					[anchor.campaignId],
				);
				const a = storedAnchor?.rows?.[0];
				if (
					storedAnchor?.rows?.length !== 1 ||
					!isDeepStrictEqual(a.evidence_bundle, anchor) ||
					a.evidence_set_sha256 !== p.evidenceSetSha256 ||
					a.inventory_sha256 !== p.inventorySha256 ||
					a.network !== anchor.network ||
					a.program_id !== anchor.programId ||
					a.layout_version !== anchor.layoutVersion ||
					a.anchor_slot !== String(anchor.anchorSlot) ||
					a.manifest_sha256 !== anchor.manifestSha256 ||
					a.position_count !== anchor.inventory.length
				)
					throw new Error("Ownership reconciliation: stored anchor differs");
				const selected = await client.query(
					`SELECT source_key,evidence_sha256,evidence_record,network,program_id,decoder_version,anchor_sha256,signature,instruction_index::text,position_address,position_mint,slot::text,transaction_index::text,block_time_seconds::text,event_kind FROM quest.position_ownership_evidence WHERE campaign_id=$1 AND slot BETWEEN $2 AND $3 ORDER BY source_key COLLATE "C" LIMIT 4097`,
					[anchor.campaignId, String(startSlot), String(endSlot)],
				);
				if (!Array.isArray(selected?.rows) || selected.rows.length > 4096)
					throw new Error(
						"Ownership reconciliation: bounded complete stored range required",
					);
				const stored = new Map();
				for (const row of selected.rows) {
					if (typeof row.source_key !== "string" || stored.has(row.source_key))
						throw new Error(
							"Ownership reconciliation: duplicate or invalid stored source",
						);
					stored.set(row.source_key, row);
				}
				// Canonicalize property order for deterministic conflict retry hashes (jsonb order differs).
				const keys = Object.keys(
					ownershipReconciliationRow(
						{ sourceKey: "", evidenceSha256: "", record: {} },
						"",
					),
				);
				const storedCanonical = selected.rows
					.map((row) => Object.fromEntries(keys.map((key) => [key, row[key]])))
					.sort((a, b) =>
						a.source_key < b.source_key
							? -1
							: a.source_key > b.source_key
								? 1
								: 0,
					);
				// JSON object order is not evidence: canonical hashing sorts every object recursively.
				const canonical = (value) =>
					Array.isArray(value)
						? value.map(canonical)
						: value && typeof value === "object"
							? Object.fromEntries(
									Object.keys(value)
										.sort()
										.map((key) => [key, canonical(value[key])]),
								)
							: value;
				let reason;
				for (const row of expected) {
					const found = stored.get(row.source_key);
					if (!found) {
						reason = "MISSING_SOURCE";
						break;
					}
					if (!isDeepStrictEqual(found, row)) {
						reason = "CHANGED_SOURCE";
						break;
					}
				}
				if (!reason && stored.size !== expected.length) reason = "EXTRA_SOURCE";
				const storedRangeSha256 = digest(canonical(storedCanonical));
				const coverage = publish
					? await readOwnershipCoverage(client, anchor, p.evidenceSetSha256)
					: null;
				if (
					!reason &&
					coverage?.last_range_start === String(startSlot) &&
					coverage.last_range_end === String(endSlot) &&
					(coverage.last_range_sha256 !== range.rangeSha256 ||
						coverage.last_stored_sha256 !== storedRangeSha256)
				)
					reason = "CHANGED_SOURCE";
				let conflictInserted = false;
				if (reason) {
					const inserted = await client.query(
						`INSERT INTO quest.position_ownership_conflicts
     (campaign_id,anchor_sha256,decoder_version,start_slot,end_slot,reason_code,observed_range_sha256,stored_range_sha256,observed_count,stored_count)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING reason_code`,
						[
							anchor.campaignId,
							p.evidenceSetSha256,
							range.decoderVersion,
							String(startSlot),
							String(endSlot),
							reason,
							range.rangeSha256,
							storedRangeSha256,
							expected.length,
							stored.size,
						],
					);
					if (!Array.isArray(inserted?.rows) || inserted.rows.length > 1)
						throw new Error(
							"Ownership reconciliation: invalid conflict insert result",
						);
					conflictInserted = inserted.rows.length === 1;
				}
				const conflicts = await client.query(
					"SELECT EXISTS(SELECT 1 FROM quest.position_ownership_conflicts WHERE campaign_id=$1) AS quarantined",
					[anchor.campaignId],
				);
				if (
					conflicts?.rows?.length !== 1 ||
					typeof conflicts.rows[0].quarantined !== "boolean" ||
					(reason && !conflicts.rows[0].quarantined)
				)
					throw new Error(
						"Ownership reconciliation: incomplete quarantine state",
					);
				let publication = { watermarkPublished: false };
				if (publish && !reason && !conflicts.rows[0].quarantined)
					publication = await publishOwnershipCoverage(client, {
						anchor,
						anchorSha256: p.evidenceSetSha256,
						range,
						storedRangeSha256,
						coverage,
					});
				await client.query("COMMIT");
				begun = false;
				return {
					state: publication.watermarkPublished
						? "TEST_ONLY_OWNERSHIP_COVERAGE_PUBLISHED"
						: reason
							? "TEST_ONLY_OWNERSHIP_RANGE_MISMATCH"
							: "TEST_ONLY_OWNERSHIP_RANGE_MATCHED",
					awardEligible: false,
					...publication,
					campaignId: anchor.campaignId,
					startSlot,
					endSlot,
					checkedObservations: expected.length,
					storedObservations: stored.size,
					rangeSha256: range.rangeSha256,
					storedRangeSha256,
					reasonCode: reason ?? null,
					conflictInserted,
					quarantined: conflicts.rows[0].quarantined,
				};
			} catch (error) {
				failed = true;
				if (begun) {
					try {
						await client.query("ROLLBACK");
					} catch {
						/* discard below */
					}
				}
				throw error;
			} finally {
				client.release(
					failed
						? new Error("Ownership reconciliation transaction failed")
						: undefined,
				);
			}
		},
	};
}
