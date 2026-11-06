import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PublicKey } from "@solana/web3.js";
import { verifyOwnershipRangeAnchor } from "./position-ownership-block-range.mjs";
import { readOwnershipCoverage } from "./position-ownership-coverage.mjs";
import { ownershipReconciliationRow } from "./position-ownership-reconciliation.mjs";

const transferKeys =
	"network finality campaignId programId signature instructionIndex eventKind transactionIndex slot blockTimeSeconds positionAddress positionMint sourceTokenAccount destinationTokenAccount fromOwnerWallet toOwnerWallet amountRaw instructionKind".split(
		" ",
	);
const closeKeys =
	"network finality campaignId programId signature transactionIndex instructionIndex eventKind slot blockTimeSeconds positionAddress positionMint tokenAccountAddress observedOwnerWallet receiver burnAmountRaw instructionKind burnInstructionKind".split(
		" ",
	);
const fail = (message) => {
	throw new Error(`Ownership state: ${message}`);
};
const safe = (v) => Number.isSafeInteger(v) && v >= 0;
const key = (v) => typeof v === "string" && new PublicKey(v).toBase58() === v;

/** Selected inventory only. No time intervals, current liquidity or XP inference. */
export function projectPositionOwnershipState({ anchor, endSlot, rows, initialPositions }) {
	const prepared = verifyOwnershipRangeAnchor(anchor);
	anchor = prepared.bundle;
	if (
		!safe(endSlot) ||
		endSlot < anchor.firstReplaySlot ||
		endSlot === Number.MAX_SAFE_INTEGER
	)
		fail("invalid end slot");
	if (!Array.isArray(rows) || rows.length > 4096)
		fail("bounded complete evidence required");
	const states = new Map(
		anchor.evidence.map(({ observation: o }) => [
			o.positionMint,
			{
				positionAddress: o.positionAddress,
				positionMint: o.positionMint,
				ownerWallet: o.observedOwnerWallet,
				tokenAccountAddress: o.tokenAccountAddress,
				closed: false,
				transitions: [],
			},
		]),
	);
	if (initialPositions !== undefined) {
		if (!Array.isArray(initialPositions) || initialPositions.length !== states.size)
			fail("complete continuation state required");
		const seen = new Set();
		for (const initial of initialPositions) {
			const state = states.get(initial.positionMint);
			if (!state || seen.has(initial.positionMint) || state.positionAddress !== initial.positionAddress ||
				typeof initial.closed !== "boolean" || (initial.closed ? initial.ownerWallet !== null || initial.tokenAccountAddress !== null :
					!key(initial.ownerWallet) || !key(initial.tokenAccountAddress))) fail("invalid ownership continuation state");
			seen.add(initial.positionMint);
			Object.assign(state,{ownerWallet:initial.ownerWallet,tokenAccountAddress:initial.tokenAccountAddress,closed:initial.closed});
		}
	}
	const sources = new Set(),
		signatures = new Map(),
		indices = new Map(),
		times = new Map(),
		positions = new Set();
	const records = rows
		.map((row) => {
			const r = row?.evidence_record;
			if (!r || typeof r !== "object" || Array.isArray(r))
				fail("missing evidence record");
			const keys =
				r.eventKind === "position_nft_transfer"
					? transferKeys
					: r.eventKind === "position_close_observed"
						? closeKeys
						: fail("unsupported event kind");
			const canonical = Object.fromEntries(keys.map((k) => [k, r[k]]));
			if (!isDeepStrictEqual(canonical, r)) fail("unexpected evidence fields");
			const state = states.get(r.positionMint);
			if (
				!state ||
				r.positionAddress !== state.positionAddress ||
				r.network !== anchor.network ||
				r.finality !== "finalized" ||
				r.campaignId !== anchor.campaignId ||
				r.programId !== anchor.programId ||
				![
					r.slot,
					r.transactionIndex,
					r.instructionIndex,
					r.blockTimeSeconds,
				].every(safe) ||
				r.slot < anchor.firstReplaySlot ||
				r.slot > endSlot ||
				typeof r.signature !== "string" ||
				!r.signature.length ||
				r.signature.length > 128
			)
				fail("record pins or bounds differ");
			const transfer = r.eventKind === "position_nft_transfer";
			if (
				transfer
					? ![
							r.sourceTokenAccount,
							r.destinationTokenAccount,
							r.fromOwnerWallet,
							r.toOwnerWallet,
						].every(key) ||
						r.sourceTokenAccount === r.destinationTokenAccount ||
						r.amountRaw !== "1" ||
						!["transfer", "transfer_checked"].includes(r.instructionKind)
					: ![r.tokenAccountAddress, r.observedOwnerWallet, r.receiver].every(
							key,
						) ||
						r.burnAmountRaw !== "1" ||
						r.instructionKind !== "close_position" ||
						!["burn", "burn_checked"].includes(r.burnInstructionKind)
			)
				fail("invalid ownership mutation");
			const sourceKey = JSON.stringify([
				r.campaignId,
				r.network,
				r.signature,
				r.instructionIndex,
				r.positionMint,
				...(!transfer ? ["position_close"] : []),
			]);
			const evidenceSha256 = createHash("sha256")
				.update(JSON.stringify(canonical))
				.digest("hex");
			if (
				!isDeepStrictEqual(
					row,
					ownershipReconciliationRow(
						{ sourceKey, evidenceSha256, record: canonical },
						prepared.evidenceSetSha256,
					),
				)
			)
				fail("source hash or typed metadata differs");
			const index = `${r.slot}:${r.transactionIndex}`,
				position = `${index}:${r.instructionIndex}:${r.positionMint}`;
			if (
				sources.has(sourceKey) ||
				positions.has(position) ||
				(signatures.has(r.signature) &&
					signatures.get(r.signature) !== index) ||
				(indices.has(index) && indices.get(index) !== r.signature) ||
				(times.has(r.slot) && times.get(r.slot) !== r.blockTimeSeconds)
			)
				fail("duplicate source or contradictory block ordering");
			sources.add(sourceKey);
			positions.add(position);
			signatures.set(r.signature, index);
			indices.set(index, r.signature);
			times.set(r.slot, r.blockTimeSeconds);
			return canonical;
		})
		.sort(
			(a, b) =>
				a.slot - b.slot ||
				a.transactionIndex - b.transactionIndex ||
				a.instructionIndex - b.instructionIndex ||
				a.positionMint.localeCompare(b.positionMint),
		);
	let priorTime = -1;
	for (const r of records) {
		if (r.blockTimeSeconds < priorTime)
			fail("nonmonotonic observed block time");
		priorTime = r.blockTimeSeconds;
		const s = states.get(r.positionMint);
		if (s.closed) fail("mutation after terminal closure");
		if (r.eventKind === "position_nft_transfer") {
			if (
				s.ownerWallet !== r.fromOwnerWallet ||
				s.tokenAccountAddress !== r.sourceTokenAccount
			)
				fail("transfer does not follow prior ownership");
			s.ownerWallet = r.toOwnerWallet;
			s.tokenAccountAddress = r.destinationTokenAccount;
		} else {
			if (
				s.ownerWallet !== r.observedOwnerWallet ||
				s.tokenAccountAddress !== r.tokenAccountAddress
			)
				fail("closure does not follow prior ownership");
			s.closed = true;
			s.ownerWallet = null;
			s.tokenAccountAddress = null;
		}
		s.transitions.push(r);
	}
	return {
		state: "TEST_ONLY_POSITION_OWNERSHIP_STATE",
		awardEligible: false,
		scope: "SELECTED_POSITIONS_ONLY",
		campaignId: anchor.campaignId,
		anchorSlot: anchor.anchorSlot,
		endSlot,
		positions: [...states.values()],
	};
}

/** Trust and all replay evidence come from the same historical SQL snapshot. */
export function createPositionOwnershipStateReader({ pool, anchor }) {
	const p = verifyOwnershipRangeAnchor(anchor);
	anchor = p.bundle;
	if (typeof pool?.connect !== "function") fail("dedicated pool required");
	return {
		async read({ endSlot }) {
			if (
				!safe(endSlot) ||
				endSlot < anchor.firstReplaySlot ||
				endSlot === Number.MAX_SAFE_INTEGER
			)
				fail("invalid end slot");
			const client = await pool.connect();
			let begun = false,
				failed = false;
			try {
				await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
				begun = true;
				const env = await client.query(
					"SELECT network,genesis_hash,manifest_sha256,namespace FROM quest.environment_identity WHERE singleton=true",
				);
				if (
					env?.rows?.length !== 1 ||
					!isDeepStrictEqual(env.rows[0], {
						network: anchor.network,
						genesis_hash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
						manifest_sha256: anchor.manifestSha256,
						namespace: "quest",
					})
				)
					fail("database identity differs");
				const stored = await client.query(
					"SELECT evidence_bundle,evidence_set_sha256,inventory_sha256,network,program_id,layout_version,anchor_slot::text,manifest_sha256,position_count FROM quest.position_baseline_anchors WHERE campaign_id=$1",
					[anchor.campaignId],
				);
				if (
					stored?.rows?.length !== 1 ||
					!isDeepStrictEqual(stored.rows[0], {
						evidence_bundle: anchor,
						evidence_set_sha256: p.evidenceSetSha256,
						inventory_sha256: p.inventorySha256,
						network: anchor.network,
						program_id: anchor.programId,
						layout_version: anchor.layoutVersion,
						anchor_slot: String(anchor.anchorSlot),
						manifest_sha256: anchor.manifestSha256,
						position_count: anchor.inventory.length,
					})
				)
					fail("stored anchor differs");
				const coverage = await readOwnershipCoverage(
					client,
					anchor,
					p.evidenceSetSha256,
					{ lock: false },
				);
				if (
					!coverage ||
					coverage.covered_through_slot === null ||
					Number(coverage.covered_through_slot) < endSlot
				)
					fail("current contiguous coverage required");
				const conflict = await client.query(
					"SELECT EXISTS(SELECT 1 FROM quest.position_ownership_conflicts WHERE campaign_id=$1) AS quarantined",
					[anchor.campaignId],
				);
				if (
					conflict?.rows?.length !== 1 ||
					conflict.rows[0].quarantined !== false
				)
					fail("campaign quarantine or incomplete conflict state");
				const selected = await client.query(
					`SELECT source_key,evidence_sha256,evidence_record,network,program_id,decoder_version,anchor_sha256,signature,instruction_index::text,position_address,position_mint,slot::text,transaction_index::text,block_time_seconds::text,event_kind FROM quest.position_ownership_evidence WHERE campaign_id=$1 AND slot BETWEEN $2 AND $3 ORDER BY slot,transaction_index,instruction_index,position_mint LIMIT 4097`,
					[anchor.campaignId, String(anchor.firstReplaySlot), String(endSlot)],
				);
				const result = projectPositionOwnershipState({
					anchor,
					endSlot,
					rows: selected?.rows,
				});
				await client.query("COMMIT");
				begun = false;
				return {
					...result,
					trust: "HISTORICAL_REPEATABLE_READ_SNAPSHOT",
					coverageRevision: coverage.revision,
					coveredThroughSlot: Number(coverage.covered_through_slot),
					anchorSha256: p.evidenceSetSha256,
				};
			} catch (error) {
				failed = true;
				if (begun) {
					try {
						await client.query("ROLLBACK");
					} catch {
						/* Preserve original refusal. */
					}
				}
				throw error;
			} finally {
				client.release(
					failed ? new Error("Ownership state transaction failed") : undefined,
				);
			}
		},
	};
}
