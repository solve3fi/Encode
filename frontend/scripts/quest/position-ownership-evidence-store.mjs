import { isDeepStrictEqual } from "node:util";
import { preparePositionBaselineAnchor } from "./position-baseline-anchor.mjs";
import { decodePositionClosureEvidence } from "./position-closure-evidence.mjs";
import { decodePositionNftTransferEvidence } from "./position-nft-transfer-evidence.mjs";

function verifyAnchor(anchor) {
	const prepared = preparePositionBaselineAnchor({
		...anchor,
		snapshots: anchor?.evidence?.map((entry) => entry.raw),
	});
	if (!isDeepStrictEqual(anchor, prepared.bundle))
		throw new Error("Ownership store: canonical verified anchor required");
	return prepared;
}
function prepare(
	prepared,
	{
		slot,
		blockTimeSeconds,
		transferTransactions = [],
		closureTransactions = [],
	},
) {
	const { bundle: anchor } = prepared;
	if (
		!Number.isSafeInteger(slot) ||
		slot <= anchor.anchorSlot ||
		!Array.isArray(transferTransactions) ||
		!Array.isArray(closureTransactions) ||
		transferTransactions.length + closureTransactions.length > 2048
	)
		throw new Error(
			"Ownership store: bounded post-anchor transactions required",
		);
	const indices = new Map(),
		signatures = new Map();
	for (const transaction of [...transferTransactions, ...closureTransactions]) {
		const signature = transaction?.transaction?.signatures?.[0],
			index = transaction?.transactionIndex;
		if (
			typeof signature !== "string" ||
			signature.length < 1 ||
			signature.length > 128 ||
			!Number.isSafeInteger(index) ||
			index < 0
		)
			throw new Error("Ownership store: valid source identity required");
		if (
			(indices.has(index) && indices.get(index) !== signature) ||
			(signatures.has(signature) && signatures.get(signature) !== index)
		)
			throw new Error("Ownership store: contradictory full-block ordering");
		indices.set(index, signature);
		signatures.set(signature, index);
	}
	const pins = {
		network: anchor.network,
		finality: "finalized",
		campaignId: anchor.campaignId,
		programId: anchor.programId,
		inventory: anchor.inventory,
		slot,
		blockTimeSeconds,
	};
	const transfer = decodePositionNftTransferEvidence({
		...pins,
		transactions: transferTransactions,
	});
	const closure = decodePositionClosureEvidence({
		...pins,
		transactions: closureTransactions,
	});
	const rows = new Map();
	for (const evidence of [...transfer.transfers, ...closure.closures]) {
		const { record } = evidence;
		const identity = JSON.stringify([
			record.signature,
			record.instructionIndex,
			record.positionMint,
		]);
		if (rows.has(identity) && !isDeepStrictEqual(rows.get(identity), evidence))
			throw new Error("Ownership store: contradictory source kinds");
		rows.set(identity, evidence);
	}
	const observations = [...rows.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([, row]) => row);
	if (
		observations.length > 4096 ||
		Buffer.byteLength(JSON.stringify(observations)) > 4194304
	)
		throw new Error("Ownership store: observation batch too large");
	return {
		state: "TEST_ONLY_POSITION_OWNERSHIP_EVIDENCE",
		awardEligible: false,
		coverage: "PROVIDED_TRANSACTIONS_ONLY",
		decoderVersion: "position-ownership-v1",
		anchorSha256: prepared.evidenceSetSha256,
		observations,
	};
}

/** Re-decodes RPC observations, not caller-produced observation/hash objects. */
export function preparePositionOwnershipEvidence({ anchor, ...input }) {
	return prepare(verifyAnchor(anchor), input);
}

/** Dormant adapter: dedicated verified pool and read/insert role required. */
export function createPositionOwnershipEvidenceStore({ pool, anchor }) {
	const prepared = verifyAnchor(anchor); // Copies canonical public evidence before any await.
	const { bundle: pins } = prepared;
	if (typeof pool?.connect !== "function")
		throw new Error("Ownership store: dedicated pool required");
	return {
		async record(input) {
			const batch = prepare(prepared, input); // Detaches validated records before connection.
			const client = await pool.connect();
			let begun = false,
				failed = false,
				inserted = 0;
			try {
				await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
				begun = true;
				const environment = await client.query(
					"SELECT network,genesis_hash,manifest_sha256,namespace FROM quest.environment_identity WHERE singleton=true",
				);
				const identity = environment?.rows?.[0];
				if (
					environment?.rows?.length !== 1 ||
					identity.network !== pins.network ||
					identity.genesis_hash !==
						"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" ||
					identity.manifest_sha256 !== pins.manifestSha256 ||
					identity.namespace !== "quest"
				)
					throw new Error("Ownership store: database identity pins differ");
				const storedAnchor = await client.query(
					"SELECT evidence_bundle,inventory_sha256,evidence_set_sha256,network,program_id,layout_version,anchor_slot::text,manifest_sha256,position_count FROM quest.position_baseline_anchors WHERE campaign_id=$1",
					[pins.campaignId],
				);
				const a = storedAnchor?.rows?.[0];
				if (
					storedAnchor?.rows?.length !== 1 ||
					!isDeepStrictEqual(a.evidence_bundle, pins) ||
					a.inventory_sha256 !== prepared.inventorySha256 ||
					a.evidence_set_sha256 !== prepared.evidenceSetSha256 ||
					a.network !== pins.network ||
					a.program_id !== pins.programId ||
					a.layout_version !== pins.layoutVersion ||
					a.anchor_slot !== String(pins.anchorSlot) ||
					a.manifest_sha256 !== pins.manifestSha256 ||
					a.position_count !== pins.inventory.length
				)
					throw new Error("Ownership store: stored immutable anchor differs");
				for (const {
					sourceKey,
					evidenceSha256,
					record: r,
				} of batch.observations) {
					const values = [
						pins.campaignId,
						pins.network,
						pins.programId,
						batch.decoderVersion,
						batch.anchorSha256,
						r.signature,
						String(r.instructionIndex),
						r.positionAddress,
						r.positionMint,
						String(r.slot),
						String(r.transactionIndex),
						String(r.blockTimeSeconds),
						r.eventKind,
						sourceKey,
						evidenceSha256,
						JSON.stringify(r),
					];
					const result = await client.query(
						`INSERT INTO quest.position_ownership_evidence
     (campaign_id,network,program_id,decoder_version,anchor_sha256,signature,instruction_index,position_address,position_mint,slot,transaction_index,block_time_seconds,event_kind,source_key,evidence_sha256,evidence_record)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
     ON CONFLICT DO NOTHING RETURNING signature`,
						values,
					);
					if (!Array.isArray(result?.rows) || result.rows.length > 1)
						throw new Error("Ownership store: invalid insert result");
					if (result.rows.length === 1) {
						inserted++;
						continue;
					}
					const existing = await client.query(
						`SELECT campaign_id,network,program_id,decoder_version,anchor_sha256,signature,instruction_index::text,position_address,position_mint,slot::text,transaction_index::text,block_time_seconds::text,event_kind,source_key,evidence_sha256,evidence_record FROM quest.position_ownership_evidence WHERE campaign_id=$1 AND signature=$2 AND instruction_index=$3 AND position_mint=$4`,
						[
							pins.campaignId,
							r.signature,
							String(r.instructionIndex),
							r.positionMint,
						],
					);
					const expected = Object.fromEntries(
						[
							"campaign_id",
							"network",
							"program_id",
							"decoder_version",
							"anchor_sha256",
							"signature",
							"instruction_index",
							"position_address",
							"position_mint",
							"slot",
							"transaction_index",
							"block_time_seconds",
							"event_kind",
							"source_key",
							"evidence_sha256",
							"evidence_record",
						].map((key, i) => [key, i === 15 ? r : values[i]]),
					);
					if (
						existing?.rows?.length !== 1 ||
						!isDeepStrictEqual(existing.rows[0], expected)
					)
						throw new Error(
							"Ownership store: conflicting immutable source or block ordering",
						);
				}
				await client.query("COMMIT");
				begun = false;
				return {
					...batch,
					state: "TEST_ONLY_POSITION_OWNERSHIP_STORED",
					inserted,
					existing: batch.observations.length - inserted,
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
						? new Error("Ownership evidence transaction failed")
						: undefined,
				);
			}
		},
	};
}
