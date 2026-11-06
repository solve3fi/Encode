import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PublicKey } from "@solana/web3.js";
import { projectPositionBaselineEvidence } from "./position-baseline-evidence.mjs";

const HASH = /^[0-9a-f]{64}$/;
const digest = (value) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
function address(value) {
	if (typeof value !== "string" || new PublicKey(value).toBase58() !== value)
		throw new Error("Baseline anchor: canonical address required");
	return value;
}
function pins({
	network,
	campaignId,
	programId,
	layoutVersion,
	manifestSha256,
}) {
	if (
		network !== "DEVNET" ||
		typeof campaignId !== "string" ||
		!campaignId.trim() ||
		campaignId.length > 128 ||
		layoutVersion !== "solve-position-v1" ||
		typeof manifestSha256 !== "string" ||
		!HASH.test(manifestSha256)
	)
		throw new Error(
			"Baseline anchor: explicit Devnet campaign/layout/manifest pins required",
		);
	address(programId);
}

/** Selected inventory completeness only; never asserts global position coverage. */
export function preparePositionBaselineAnchor(input) {
	pins(input);
	const {
		network,
		campaignId,
		programId,
		layoutVersion,
		manifestSha256,
		anchorSlot,
		inventory,
		snapshots,
	} = input;
	if (
		!Number.isSafeInteger(anchorSlot) ||
		anchorSlot < 0 ||
		anchorSlot >= Number.MAX_SAFE_INTEGER ||
		!Array.isArray(inventory) ||
		inventory.length < 1 ||
		inventory.length > 256 ||
		!Array.isArray(snapshots) ||
		snapshots.length !== inventory.length
	)
		throw new Error(
			"Baseline anchor: exact slot and bounded complete selected inventory required",
		);
	const seenPositions = new Set(),
		seenMints = new Set(),
		seenTokens = new Set();
	const selected = inventory
		.map((row) => {
			const positionAddress = address(row?.positionAddress),
				positionMint = address(row.positionMint),
				tokenAccountAddress = address(row.tokenAccountAddress);
			if (
				seenPositions.has(positionAddress) ||
				seenMints.has(positionMint) ||
				seenTokens.has(tokenAccountAddress)
			)
				throw new Error(
					"Baseline anchor: duplicate selected position/mint/token account",
				);
			seenPositions.add(positionAddress);
			seenMints.add(positionMint);
			seenTokens.add(tokenAccountAddress);
			return { positionAddress, positionMint, tokenAccountAddress };
		})
		.sort((a, b) =>
			a.positionAddress < b.positionAddress
				? -1
				: a.positionAddress > b.positionAddress
					? 1
					: 0,
		);
	const byPosition = new Map();
	for (const snapshot of snapshots) {
		if (
			snapshot?.network !== network ||
			snapshot.programId !== programId ||
			snapshot.layoutVersion !== layoutVersion ||
			snapshot.slot !== anchorSlot ||
			snapshot.finality !== "finalized"
		)
			throw new Error(
				"Baseline anchor: snapshot pins or exact anchor slot differ",
			);
		const observation = projectPositionBaselineEvidence(snapshot);
		if (byPosition.has(observation.positionAddress))
			throw new Error("Baseline anchor: duplicate snapshot position");
		// Preserve only selected public evidence fields, never arbitrary caller metadata.
		const account = (a) => ({
			address: a.address,
			owner: a.owner,
			executable: a.executable,
			dataBase64: a.dataBase64,
		});
		const raw = {
			network,
			finality: "finalized",
			slot: anchorSlot,
			programId,
			layoutVersion,
			positionAccount: account(snapshot.positionAccount),
			mintAccount: account(snapshot.mintAccount),
			tokenAccount: account(snapshot.tokenAccount),
		};
		byPosition.set(observation.positionAddress, { observation, raw });
	}
	const evidence = selected.map((row) => {
		const entry = byPosition.get(row.positionAddress);
		if (
			!entry ||
			entry.observation.positionMint !== row.positionMint ||
			entry.observation.tokenAccountAddress !== row.tokenAccountAddress
		)
			throw new Error(
				"Baseline anchor: selected inventory evidence missing or mismatched",
			);
		return entry;
	});
	const bundle = {
		schemaVersion: 1,
		state: "TEST_ONLY_POSITION_BASELINE_ANCHOR",
		awardEligible: false,
		ownershipCoverage: "POINT_IN_TIME",
		inventoryCoverage: "SELECTED_POSITIONS_ONLY",
		network,
		campaignId,
		programId,
		layoutVersion,
		manifestSha256,
		anchorSlot,
		firstReplaySlot: anchorSlot + 1,
		inventory: selected,
		evidence,
	};
	if (Buffer.byteLength(JSON.stringify(bundle)) > 1048576)
		throw new Error("Baseline anchor: evidence bundle too large");
	return {
		bundle,
		inventorySha256: digest(selected),
		evidenceSetSha256: digest(bundle),
	};
}

/** Dormant write adapter; caller verifies dedicated DB/read+insert role at startup. */
export function createPositionBaselineAnchorStore(configuration) {
	const {
		pool,
		network,
		campaignId,
		programId,
		layoutVersion,
		manifestSha256,
	} = configuration;
	const pinned = {
		network,
		campaignId,
		programId,
		layoutVersion,
		manifestSha256,
	};
	pins(pinned);
	if (typeof pool?.connect !== "function")
		throw new Error("Baseline anchor: dedicated pool required");
	return {
		async record({ anchorSlot, inventory, snapshots }) {
			const prepared = preparePositionBaselineAnchor({
				...pinned,
				anchorSlot,
				inventory,
				snapshots,
			});
			const client = await pool.connect();
			let begun = false,
				failed = false;
			try {
				await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
				begun = true;
				const identity = await client.query(
					"SELECT network, genesis_hash, manifest_sha256, namespace FROM quest.environment_identity WHERE singleton=true",
				);
				if (
					identity?.rows?.length !== 1 ||
					identity.rows[0].network !== network ||
					identity.rows[0].genesis_hash !==
						"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" ||
					identity.rows[0].namespace !== "quest" ||
					identity.rows[0].manifest_sha256 !== manifestSha256
				)
					throw new Error("Baseline anchor: database identity pins differ");
				// Unique campaign serializes competing first writes; the following READ
				// COMMITTED statement sees the winner, including a concurrently committed row.
				const inserted = await client.query(
					`INSERT INTO quest.position_baseline_anchors
			(campaign_id,network,program_id,layout_version,anchor_slot,manifest_sha256,inventory_sha256,evidence_set_sha256,position_count,evidence_bundle)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT (campaign_id) DO NOTHING RETURNING campaign_id`,
					[
						campaignId,
						network,
						programId,
						layoutVersion,
						String(anchorSlot),
						manifestSha256,
						prepared.inventorySha256,
						prepared.evidenceSetSha256,
						prepared.bundle.inventory.length,
						JSON.stringify(prepared.bundle),
					],
				);
				if (!Array.isArray(inserted?.rows) || inserted.rows.length > 1)
					throw new Error("Baseline anchor: invalid insert result");
				if (inserted.rows.length === 0) {
					const stored = await client.query(
						"SELECT network, program_id, layout_version, anchor_slot::text, manifest_sha256, position_count, evidence_bundle, inventory_sha256, evidence_set_sha256 FROM quest.position_baseline_anchors WHERE campaign_id=$1",
						[campaignId],
					);
					if (
						stored?.rows?.length !== 1 ||
						stored.rows[0].network !== network ||
						stored.rows[0].program_id !== programId ||
						stored.rows[0].layout_version !== layoutVersion ||
						stored.rows[0].anchor_slot !== String(anchorSlot) ||
						stored.rows[0].manifest_sha256 !== manifestSha256 ||
						stored.rows[0].position_count !==
							prepared.bundle.inventory.length ||
						stored.rows[0].inventory_sha256 !== prepared.inventorySha256 ||
						stored.rows[0].evidence_set_sha256 !== prepared.evidenceSetSha256 ||
						!isDeepStrictEqual(stored.rows[0].evidence_bundle, prepared.bundle)
					)
						throw new Error(
							"Baseline anchor: conflicting immutable campaign anchor",
						);
				}
				await client.query("COMMIT");
				begun = false;
				return {
					state: "TEST_ONLY_ANCHOR_STORED",
					awardEligible: false,
					inserted: inserted.rows.length === 1,
					...prepared,
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
					failed ? new Error("Baseline anchor transaction failed") : undefined,
				);
			}
		},
	};
}
