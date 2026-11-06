import assert from "node:assert/strict";
import test from "node:test";
import {
	closureEvidenceFixture,
	ownershipAnchorInput,
	transferEvidenceFixture,
} from "../../tests/fixtures/quest-position-ownership.mjs";
import { preparePositionBaselineAnchor } from "./position-baseline-anchor.mjs";
import {
	createPositionOwnershipEvidenceStore,
	preparePositionOwnershipEvidence,
} from "./position-ownership-evidence-store.mjs";

const anchor = () =>
	preparePositionBaselineAnchor(ownershipAnchorInput()).bundle;
function input() {
	return {
		slot: 20,
		blockTimeSeconds: 1000,
		transferTransactions: transferEvidenceFixture().transactions,
	};
}
function database({
	existing = false,
	alterAnchor,
	alterEnvironment,
	alterRecord,
	fail,
	connectHook,
} = {}) {
	const a = preparePositionBaselineAnchor(ownershipAnchorInput());
	const calls = [],
		releases = [];
	let row;
	const storedAnchor = {
		evidence_bundle: a.bundle,
		inventory_sha256: a.inventorySha256,
		evidence_set_sha256: a.evidenceSetSha256,
		network: a.bundle.network,
		program_id: a.bundle.programId,
		layout_version: a.bundle.layoutVersion,
		anchor_slot: String(a.bundle.anchorSlot),
		manifest_sha256: a.bundle.manifestSha256,
		position_count: 1,
	};
	const environment = {
		network: "DEVNET",
		genesis_hash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
		manifest_sha256: "a".repeat(64),
		namespace: "quest",
	};
	alterAnchor?.(storedAnchor);
	alterEnvironment?.(environment);
	return {
		calls,
		releases,
		pool: {
			async connect() {
				connectHook?.();
				return {
					async query(sql, values) {
						calls.push({ sql, values });
						if (fail?.(sql)) throw new Error("injected failure");
						if (sql.includes("FROM quest.environment_identity"))
							return { rows: [environment] };
						if (sql.includes("FROM quest.position_baseline_anchors"))
							return { rows: [storedAnchor] };
						if (sql.includes("INSERT INTO quest.position_ownership_evidence")) {
							const keys = [
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
							];
							row = Object.fromEntries(
								keys.map((key, i) => [
									key,
									i === 15 ? JSON.parse(values[i]) : values[i],
								]),
							);
							alterRecord?.(row);
							return { rows: existing ? [] : [{ signature: row.signature }] };
						}
						if (sql.includes("FROM quest.position_ownership_evidence"))
							return { rows: [row] };
						return { rows: [] };
					},
					release(error) {
						releases.push(error);
					},
				};
			},
		},
	};
}
test("preparation re-decodes transfers and binds immutable anchor without claiming ranges", () => {
	const p = preparePositionOwnershipEvidence({ anchor: anchor(), ...input() });
	assert.equal(p.observations[0].record.eventKind, "position_nft_transfer");
	assert.equal(p.awardEligible, false);
	assert.equal(p.coverage, "PROVIDED_TRANSACTIONS_ONLY");
	assert.equal(p.decoderVersion, "position-ownership-v1");
});
test("closure preparation uses the closure decoder", () => {
	const p = preparePositionOwnershipEvidence({
		anchor: anchor(),
		slot: 20,
		blockTimeSeconds: 1000,
		closureTransactions: closureEvidenceFixture().transactions,
	});
	assert.equal(p.observations[0].record.eventKind, "position_close_observed");
});
test("exact repeats deduplicate before storage", () => {
	const f = input();
	f.transferTransactions.push(f.transferTransactions[0]);
	assert.equal(
		preparePositionOwnershipEvidence({ anchor: anchor(), ...f }).observations
			.length,
		1,
	);
});
test("combined kinds use a global block-index namespace", () => {
	const f = input();
	f.closureTransactions = closureEvidenceFixture().transactions;
	assert.throws(
		() => preparePositionOwnershipEvidence({ anchor: anchor(), ...f }),
		/contradictory full-block/,
	);
});
test("same signature at two indices refuses", () => {
	const f = input(),
		other = transferEvidenceFixture().transactions[0];
	other.transactionIndex = 1;
	f.transferTransactions.push(other);
	assert.throws(
		() => preparePositionOwnershipEvidence({ anchor: anchor(), ...f }),
		/contradictory full-block/,
	);
});
test("at-anchor or earlier slot refuses", () => {
	const f = input();
	f.slot = 12;
	assert.throws(
		() => preparePositionOwnershipEvidence({ anchor: anchor(), ...f }),
		/post-anchor/,
	);
});
test("unvalidated anchor observation refuses", () => {
	const a = anchor();
	a.evidence[0].observation.liquidityRaw = "0";
	assert.throws(
		() => preparePositionOwnershipEvidence({ anchor: a, ...input() }),
		/verified anchor/,
	);
});
test("caller-computed observation objects cannot substitute for RPC inputs", () => {
	const f = input();
	f.transferTransactions = [{ record: { eventKind: "position_nft_transfer" } }];
	assert.throws(
		() => preparePositionOwnershipEvidence({ anchor: anchor(), ...f }),
		/source identity/,
	);
});
test("aggregate transaction bound applies across both decoder lists", () => {
	const f = input();
	f.transferTransactions = Array(2049).fill(f.transferTransactions[0]);
	assert.throws(
		() => preparePositionOwnershipEvidence({ anchor: anchor(), ...f }),
		/bounded/,
	);
});
test("record parameterizes inserts and commits once", async () => {
	const d = database();
	const r = await createPositionOwnershipEvidenceStore({
		pool: d.pool,
		anchor: anchor(),
	}).record(input());
	assert.equal(r.inserted, 1);
	assert.equal(r.existing, 0);
	assert.equal(r.awardEligible, false);
	assert.equal(d.calls.at(-1).sql, "COMMIT");
	assert.equal(d.releases[0], undefined);
	assert.equal(
		d.calls.find((c) => c.sql.startsWith("INSERT")).values[5],
		"synthetic-transfer",
	);
});
test("identical database replay is idempotent", async () => {
	const d = database({ existing: true });
	const r = await createPositionOwnershipEvidenceStore({
		pool: d.pool,
		anchor: anchor(),
	}).record(input());
	assert.equal(r.inserted, 0);
	assert.equal(r.existing, 1);
});
for (const [name, options] of [
	[
		"changed record",
		{
			existing: true,
			alterRecord: (r) => {
				r.evidence_record.toOwnerWallet = "11111111111111111111111111111115";
			},
		},
	],
	[
		"changed hash",
		{
			existing: true,
			alterRecord: (r) => {
				r.evidence_sha256 = "b".repeat(64);
			},
		},
	],
	[
		"changed stored coordinates",
		{
			existing: true,
			alterRecord: (r) => {
				r.transaction_index = "1";
			},
		},
	],
	[
		"wrong environment",
		{
			alterEnvironment: (r) => {
				r.network = "MAINNET";
			},
		},
	],
	[
		"wrong manifest",
		{
			alterEnvironment: (r) => {
				r.manifest_sha256 = "b".repeat(64);
			},
		},
	],
	[
		"wrong anchor hash",
		{
			alterAnchor: (r) => {
				r.evidence_set_sha256 = "b".repeat(64);
			},
		},
	],
	[
		"changed stored inventory",
		{
			alterAnchor: (r) => {
				r.evidence_bundle.inventory[0].positionMint =
					"11111111111111111111111111111115";
			},
		},
	],
	[
		"changed anchor metadata",
		{
			alterAnchor: (r) => {
				r.position_count = 2;
			},
		},
	],
])
	test(`store refuses ${name} and rolls back`, async () => {
		const d = database(options);
		await assert.rejects(
			createPositionOwnershipEvidenceStore({
				pool: d.pool,
				anchor: anchor(),
			}).record(input()),
		);
		assert.equal(d.calls.at(-1).sql, "ROLLBACK");
		assert.ok(d.releases[0] instanceof Error);
	});
for (const phase of ["BEGIN", "INSERT", "COMMIT", "ROLLBACK"])
	test(`failure at ${phase} discards connection`, async () => {
		const d = database({
			existing: phase === "ROLLBACK",
			alterRecord:
				phase === "ROLLBACK"
					? (r) => {
							r.evidence_sha256 = "b".repeat(64);
						}
					: undefined,
			fail: (sql) => sql.startsWith(phase),
		});
		await assert.rejects(
			createPositionOwnershipEvidenceStore({
				pool: d.pool,
				anchor: anchor(),
			}).record(input()),
		);
		assert.ok(d.releases[0] instanceof Error);
		if (phase !== "BEGIN") assert.equal(d.calls.at(-1).sql, "ROLLBACK");
	});
test("caller mutation during connection cannot change prepared evidence or anchor", async () => {
	const a = anchor(),
		f = input();
	const d = database({
		connectHook: () => {
			a.inventory.length = 0;
			f.transferTransactions[0].transaction.signatures[0] = "mutated";
		},
	});
	const r = await createPositionOwnershipEvidenceStore({
		pool: d.pool,
		anchor: a,
	}).record(f);
	assert.equal(r.observations[0].record.signature, "synthetic-transfer");
});
test("empty batch verifies database/anchor without claiming coverage", async () => {
	const d = database();
	const r = await createPositionOwnershipEvidenceStore({
		pool: d.pool,
		anchor: anchor(),
	}).record({ slot: 20, blockTimeSeconds: 1000 });
	assert.equal(r.inserted, 0);
	assert.equal(r.observations.length, 0);
	assert.equal(
		d.calls.some((c) => c.sql.startsWith("INSERT")),
		false,
	);
});
