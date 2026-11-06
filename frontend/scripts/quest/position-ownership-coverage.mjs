import { PublicKey } from "@solana/web3.js";

const integer = (value) =>
	typeof value === "string" &&
	/^(0|[1-9][0-9]*)$/.test(value) &&
	Number.isSafeInteger(Number(value));
export async function readOwnershipCoverage(
	client,
	anchor,
	anchorSha256,
	{ lock = true } = {},
) {
	const result = await client.query(
		`SELECT campaign_id,anchor_sha256,decoder_version,start_slot::text,covered_through_slot::text,last_range_start::text,last_range_end::text,last_range_sha256,last_stored_sha256,last_produced_slot::text,last_block_hash,revision::text,invalidation_reason FROM quest.position_ownership_coverage WHERE campaign_id=$1${lock ? " FOR UPDATE" : ""}`,
		[anchor.campaignId],
	);
	if (!Array.isArray(result?.rows) || result.rows.length > 1)
		throw new Error("Ownership coverage: incomplete coverage row");
	if (result.rows.length === 0) return null;
	const row = result.rows[0];
	if (
		row.campaign_id !== anchor.campaignId ||
		row.anchor_sha256 !== anchorSha256 ||
		row.decoder_version !== "position-ownership-v1" ||
		row.start_slot !== String(anchor.firstReplaySlot) ||
		typeof row.revision !== "string" ||
		!/^(0|[1-9][0-9]*)$/.test(row.revision)
	)
		throw new Error("Ownership coverage: stored coverage pins differ");
	const fields = [
		"covered_through_slot",
		"last_range_start",
		"last_range_end",
		"last_range_sha256",
		"last_stored_sha256",
		"last_produced_slot",
		"last_block_hash",
	];
	if (row.covered_through_slot === null) {
		if (
			fields.some((key) => row[key] !== null) ||
			![null, "LATE_EVIDENCE", "CONFLICT"].includes(row.invalidation_reason)
		)
			throw new Error("Ownership coverage: incomplete invalidation");
	} else {
		if (
			![
				row.covered_through_slot,
				row.last_range_start,
				row.last_range_end,
			].every(integer) ||
			Number(row.last_range_start) < anchor.firstReplaySlot ||
			row.last_range_end !== row.covered_through_slot ||
			Number(row.last_range_end) < Number(row.last_range_start) ||
			Number(row.last_range_end) - Number(row.last_range_start) > 255 ||
			![row.last_range_sha256, row.last_stored_sha256].every(
				(v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v),
			) ||
			row.invalidation_reason !== null
		)
			throw new Error("Ownership coverage: malformed published coverage");
		if (
			row.last_produced_slot === null
				? row.last_block_hash !== null
				: !integer(row.last_produced_slot) ||
					Number(row.last_produced_slot) < anchor.firstReplaySlot ||
					Number(row.last_produced_slot) > Number(row.covered_through_slot) ||
					typeof row.last_block_hash !== "string" ||
					new PublicKey(row.last_block_hash).toBase58() !== row.last_block_hash
		)
			throw new Error("Ownership coverage: malformed produced block identity");
	}
	return row;
}

export async function publishOwnershipCoverage(
	client,
	{ anchor, anchorSha256, range, storedRangeSha256, coverage },
) {
	if (!coverage) {
		await client.query(
			`INSERT INTO quest.position_ownership_coverage(campaign_id,anchor_sha256,decoder_version,start_slot) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
			[
				anchor.campaignId,
				anchorSha256,
				range.decoderVersion,
				String(anchor.firstReplaySlot),
			],
		);
		coverage = await readOwnershipCoverage(client, anchor, anchorSha256);
		if (!coverage) throw new Error("Ownership coverage: initialization failed");
	}
	if (
		coverage.last_range_start === String(range.startSlot) &&
		coverage.last_range_end === String(range.endSlot) &&
		coverage.last_range_sha256 === range.rangeSha256 &&
		coverage.last_stored_sha256 === storedRangeSha256
	)
		return {
			watermarkPublished: true,
			publicationChanged: false,
			coveredThroughSlot: Number(coverage.covered_through_slot),
			coverageRevision: coverage.revision,
		};
	const next =
		coverage.covered_through_slot === null
			? anchor.firstReplaySlot
			: Number(coverage.covered_through_slot) + 1;
	if (range.startSlot !== next)
		throw new Error("Ownership coverage: contiguous prefix extension required");
	const first = range.blocks[0],
		last = range.blocks.at(-1);
	if (
		first &&
		coverage.last_produced_slot !== null &&
		(first.parentSlot !== Number(coverage.last_produced_slot) ||
			first.previousBlockhash !== coverage.last_block_hash)
	)
		throw new Error("Ownership coverage: cross-range block chain differs");
	const nextRevision = BigInt(coverage.revision) + 1n;
	const updated = await client.query(
		`UPDATE quest.position_ownership_coverage SET covered_through_slot=$2,last_range_start=$3,last_range_end=$2,last_range_sha256=$4,last_stored_sha256=$5,last_produced_slot=$6,last_block_hash=$7,revision=revision+1,invalidation_reason=NULL WHERE campaign_id=$1 RETURNING revision::text`,
		[
			anchor.campaignId,
			String(range.endSlot),
			String(range.startSlot),
			range.rangeSha256,
			storedRangeSha256,
			last ? String(last.slot) : coverage.last_produced_slot,
			last ? last.blockhash : coverage.last_block_hash,
		],
	);
	if (
		updated?.rows?.length !== 1 ||
		typeof updated.rows[0].revision !== "string" ||
		BigInt(updated.rows[0].revision) !== nextRevision
	)
		throw new Error("Ownership coverage: incomplete publication result");
	return {
		watermarkPublished: true,
		publicationChanged: true,
		coveredThroughSlot: range.endSlot,
		coverageRevision: updated.rows[0].revision,
	};
}
