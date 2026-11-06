import assert from "node:assert/strict";
import test from "node:test";
import {
	ownershipBlockConnection,
	ownershipBlockRangeFixture,
} from "../../tests/fixtures/quest-ownership-block-range.mjs";
import { preparePositionBaselineAnchor } from "./position-baseline-anchor.mjs";
import { decodePositionOwnershipBlockRange } from "./position-ownership-block-range.mjs";
import {
	createPositionOwnershipCoveragePublisher,
	createPositionOwnershipReconciler,
	ownershipReconciliationRow,
} from "./position-ownership-reconciliation.mjs";

function setup({
	mutateRows,
	alterEnvironment,
	alterAnchor,
	fail,
	quarantined = false,
	conflictExists = false,
	coverage = null,
} = {}) {
	const f = ownershipBlockRangeFixture(),
		p = preparePositionBaselineAnchor({
			...f.anchor,
			snapshots: f.anchor.evidence.map((e) => e.raw),
		}),
		range = decodePositionOwnershipBlockRange(f);
	const rows = range.observations.map((e) =>
		ownershipReconciliationRow(e, p.evidenceSetSha256),
	);
	mutateRows?.(rows);
	const a = {
		evidence_bundle: p.bundle,
		evidence_set_sha256: p.evidenceSetSha256,
		inventory_sha256: p.inventorySha256,
		network: p.bundle.network,
		program_id: p.bundle.programId,
		layout_version: p.bundle.layoutVersion,
		anchor_slot: String(p.bundle.anchorSlot),
		manifest_sha256: p.bundle.manifestSha256,
		position_count: 1,
	};
	alterAnchor?.(a);
	const e = {
		network: "DEVNET",
		genesis_hash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
		manifest_sha256: "a".repeat(64),
		namespace: "quest",
	};
	alterEnvironment?.(e);
	const calls = [],
		releases = [];
	const pool = {
		async connect() {
			return {
				async query(sql, values) {
					calls.push({ sql, values });
					if (fail?.(sql)) throw new Error("injected failure");
					if (sql.includes("FROM quest.environment_identity"))
						return { rows: [e] };
					if (sql.includes("FROM quest.position_baseline_anchors"))
						return { rows: [a] };
					if (sql.includes("FROM quest.position_ownership_evidence"))
						return {
							rows: rows.filter(
								(row) =>
									Number(row.slot) >= Number(values[1]) &&
									Number(row.slot) <= Number(values[2]),
							),
						};
					if (sql.includes("FROM quest.position_ownership_coverage"))
						return { rows: coverage ? [coverage] : [] };
					if (sql.includes("INSERT INTO quest.position_ownership_coverage")) {
						coverage = {
							campaign_id: values[0],
							anchor_sha256: values[1],
							decoder_version: values[2],
							start_slot: values[3],
							covered_through_slot: null,
							last_range_start: null,
							last_range_end: null,
							last_range_sha256: null,
							last_stored_sha256: null,
							last_produced_slot: null,
							last_block_hash: null,
							revision: "0",
							invalidation_reason: null,
						};
						return { rows: [] };
					}
					if (sql.includes("UPDATE quest.position_ownership_coverage")) {
						Object.assign(coverage, {
							covered_through_slot: values[1],
							last_range_start: values[2],
							last_range_end: values[1],
							last_range_sha256: values[3],
							last_stored_sha256: values[4],
							last_produced_slot: values[5],
							last_block_hash: values[6],
							revision: String(BigInt(coverage.revision) + 1n),
							invalidation_reason: null,
						});
						return { rows: [{ revision: coverage.revision }] };
					}
					if (sql.includes("INSERT INTO quest.position_ownership_conflicts")) {
						quarantined = true;
						if (coverage?.covered_through_slot !== null && coverage)
							Object.assign(coverage, {
								covered_through_slot: null,
								last_range_start: null,
								last_range_end: null,
								last_range_sha256: null,
								last_stored_sha256: null,
								last_produced_slot: null,
								last_block_hash: null,
								revision: String(BigInt(coverage.revision) + 1n),
								invalidation_reason: "CONFLICT",
							});
						return { rows: conflictExists ? [] : [{ reason_code: values[5] }] };
					}
					if (sql.includes("AS quarantined"))
						return { rows: [{ quarantined }] };
					return { rows: [] };
				},
				release(error) {
					releases.push(error);
				},
			};
		},
	};
	const reconciler = createPositionOwnershipReconciler({
		pool,
		connection: ownershipBlockConnection(f),
		anchor: f.anchor,
	});
	const publisher = createPositionOwnershipCoveragePublisher({
		pool,
		connection: ownershipBlockConnection(f),
		anchor: f.anchor,
	});
	return {
		f,
		rows,
		calls,
		releases,
		reconciler,
		publisher,
		get coverage() {
			return coverage;
		},
	};
}
test("matched range is a locked snapshot comparison without a watermark", async () => {
	const s = setup();
	const r = await s.reconciler.reconcile(s.f);
	assert.equal(r.state, "TEST_ONLY_OWNERSHIP_RANGE_MATCHED");
	assert.equal(r.watermarkPublished, false);
	assert.equal(r.awardEligible, false);
	assert.equal(r.quarantined, false);
	assert.equal(r.reasonCode, null);
	assert.equal(s.calls[1].sql.includes("pg_advisory_xact_lock"), true);
	assert.equal(s.calls.at(-1).sql, "COMMIT");
	assert.equal(s.releases[0], undefined);
});
for (const [name, mutateRows, reason] of [
	[
		"missing",
		(rows) => {
			rows.length = 0;
		},
		"MISSING_SOURCE",
	],
	[
		"extra",
		(rows) => {
			rows.push({ ...rows[0], source_key: "extra-source" });
		},
		"EXTRA_SOURCE",
	],
	[
		"changed hash",
		(rows) => {
			rows[0].evidence_sha256 = "b".repeat(64);
		},
		"CHANGED_SOURCE",
	],
	[
		"changed record",
		(rows) => {
			rows[0].evidence_record.toOwnerWallet =
				"11111111111111111111111111111115";
		},
		"CHANGED_SOURCE",
	],
	[
		"changed typed metadata",
		(rows) => {
			rows[0].transaction_index = "1";
		},
		"CHANGED_SOURCE",
	],
])
	test(`durably quarantines ${name} evidence before returning mismatch`, async () => {
		const s = setup({ mutateRows });
		const r = await s.reconciler.reconcile(s.f);
		assert.equal(r.reasonCode, reason);
		assert.equal(r.quarantined, true);
		assert.equal(r.conflictInserted, true);
		assert.equal(s.calls.at(-1).sql, "COMMIT");
		const insert = s.calls.find((c) =>
			c.sql.includes("INSERT INTO quest.position_ownership_conflicts"),
		);
		assert.equal(insert.values[5], reason);
		assert.equal(insert.sql.includes("$10"), true);
	});
test("matching retry never clears an existing quarantine", async () => {
	const s = setup({ quarantined: true });
	const r = await s.reconciler.reconcile(s.f);
	assert.equal(r.state, "TEST_ONLY_OWNERSHIP_RANGE_MATCHED");
	assert.equal(r.quarantined, true);
	assert.equal(
		s.calls.some((c) => /DELETE|UPDATE/.test(c.sql)),
		false,
	);
});
test("repeated conflict insertion is idempotent", async () => {
	const s = setup({
		mutateRows: (r) => {
			r.length = 0;
		},
		conflictExists: true,
	});
	assert.equal((await s.reconciler.reconcile(s.f)).conflictInserted, false);
});
test("jsonb key order cannot change stored range conflict hashes", async () => {
	const s = setup({
		mutateRows: (r) => {
			r[0].evidence_sha256 = "b".repeat(64);
		},
	});
	const first = await s.reconciler.reconcile(s.f);
	s.rows[0].evidence_record = Object.fromEntries(
		Object.entries(s.rows[0].evidence_record).reverse(),
	);
	const second = await s.reconciler.reconcile(s.f);
	assert.equal(first.storedRangeSha256, second.storedRangeSha256);
});
for (const [name, options] of [
	[
		"wrong environment",
		{
			alterEnvironment: (e) => {
				e.network = "MAINNET";
			},
		},
	],
	[
		"wrong anchor",
		{
			alterAnchor: (a) => {
				a.evidence_set_sha256 = "b".repeat(64);
			},
		},
	],
	[
		"duplicate stored source",
		{
			mutateRows: (r) => {
				r.push(r[0]);
			},
		},
	],
	[
		"stored range overflow",
		{
			mutateRows: (r) => {
				r.push(...Array(4096).fill(r[0]));
			},
		},
	],
])
	test(`refuses ${name} without publishing or recording an incomplete conflict`, async () => {
		const s = setup(options);
		await assert.rejects(s.reconciler.reconcile(s.f));
		assert.equal(s.calls.at(-1).sql, "ROLLBACK");
		assert.ok(s.releases[0] instanceof Error);
	});
for (const phase of ["BEGIN", "INSERT", "COMMIT", "ROLLBACK"])
	test(`failure at ${phase} refuses and discards connection`, async () => {
		const s = setup({
			mutateRows: (r) => {
				r.length = 0;
			},
			fail: (sql) =>
				sql.startsWith(phase) ||
				(phase === "ROLLBACK" && sql.startsWith("INSERT")),
		});
		await assert.rejects(s.reconciler.reconcile(s.f));
		assert.ok(s.releases[0] instanceof Error);
	});
test("RPC incompleteness fails before connecting to the database", async () => {
	const s = setup();
	s.f.blocks[0].block = null;
	await assert.rejects(s.reconciler.reconcile(s.f));
	assert.equal(s.calls.length, 0);
});

test("publisher compares before initializing and committing first contiguous coverage", async () => {
	const s = setup();
	const r = await s.publisher.publish(s.f);
	assert.equal(r.state, "TEST_ONLY_OWNERSHIP_COVERAGE_PUBLISHED");
	assert.equal(r.awardEligible, false);
	assert.equal(r.coveredThroughSlot, 20);
	assert.equal(r.coverageRevision, "1");
	assert.equal(r.publicationChanged, true);
	assert.equal(s.coverage.start_slot, "13");
	assert.equal(s.coverage.last_produced_slot, "20");
	assert.equal(s.calls.at(-1).sql, "COMMIT");
});
test("exact last-range publication retry is idempotent", async () => {
	const s = setup();
	await s.publisher.publish(s.f);
	const r = await s.publisher.publish(s.f);
	assert.equal(r.watermarkPublished, true);
	assert.equal(r.publicationChanged, false);
	assert.equal(r.coverageRevision, "1");
	assert.equal(s.calls.filter((c) => c.sql.startsWith("UPDATE")).length, 1);
});
test("empty next range extends slots and retains the previous produced block", async () => {
	const s = setup();
	await s.publisher.publish(s.f);
	Object.assign(s.f, {
		startSlot: 21,
		endSlot: 23,
		producedSlots: [],
		blocks: [],
	});
	const r = await s.publisher.publish(s.f);
	assert.equal(r.coveredThroughSlot, 23);
	assert.equal(r.coverageRevision, "2");
	assert.equal(s.coverage.last_produced_slot, "20");
});
test("publisher refuses a gap even when its independent comparison matches", async () => {
	const s = setup();
	await s.publisher.publish(s.f);
	Object.assign(s.f, {
		startSlot: 22,
		endSlot: 23,
		producedSlots: [],
		blocks: [],
	});
	await assert.rejects(s.publisher.publish(s.f), /contiguous prefix/);
	assert.equal(s.coverage.covered_through_slot, "20");
	assert.ok(s.releases.at(-1) instanceof Error);
});
test("first publication cannot skip the anchored prefix", async () => {
	const s = setup();
	Object.assign(s.f, {
		startSlot: 21,
		endSlot: 23,
		producedSlots: [],
		blocks: [],
	});
	await assert.rejects(s.publisher.publish(s.f), /contiguous prefix/);
});
test("publisher refuses disconnected produced blocks across batches", async () => {
	const s = setup();
	await s.publisher.publish(s.f);
	Object.assign(s.f, {
		startSlot: 21,
		endSlot: 23,
		producedSlots: [23],
		blocks: [
			{
				slot: 23,
				block: {
					parentSlot: 19,
					blockhash: "11111111111111111111111111111113",
					previousBlockhash: "11111111111111111111111111111111",
					blockTime: 1001,
					transactions: [],
				},
			},
		],
	});
	await assert.rejects(s.publisher.publish(s.f), /cross-range block chain/);
});
test("connected produced blocks extend prefix coverage", async () => {
	const s = setup();
	await s.publisher.publish(s.f);
	Object.assign(s.f, {
		startSlot: 21,
		endSlot: 23,
		producedSlots: [23],
		blocks: [
			{
				slot: 23,
				block: {
					parentSlot: 20,
					blockhash: "11111111111111111111111111111113",
					previousBlockhash: "11111111111111111111111111111111",
					blockTime: 1001,
					transactions: [],
				},
			},
		],
	});
	assert.equal((await s.publisher.publish(s.f)).coveredThroughSlot, 23);
	assert.equal(s.coverage.last_produced_slot, "23");
});
test("changed already-published block claim quarantines and clears trust", async () => {
	const s = setup();
	await s.publisher.publish(s.f);
	s.f.blocks[0].block.blockhash = "11111111111111111111111111111113";
	const r = await s.publisher.publish(s.f);
	assert.equal(r.reasonCode, "CHANGED_SOURCE");
	assert.equal(r.quarantined, true);
	assert.equal(r.watermarkPublished, false);
	assert.equal(s.coverage.covered_through_slot, null);
});
test("quarantined matched campaign cannot initialize or publish coverage", async () => {
	const s = setup({ quarantined: true });
	const r = await s.publisher.publish(s.f);
	assert.equal(r.watermarkPublished, false);
	assert.equal(s.coverage, null);
});
test("mismatched publisher commits conflict without publishing", async () => {
	const s = setup({
		mutateRows: (r) => {
			r.length = 0;
		},
	});
	const r = await s.publisher.publish(s.f);
	assert.equal(r.reasonCode, "MISSING_SOURCE");
	assert.equal(r.quarantined, true);
	assert.equal(s.coverage, null);
	assert.equal(s.calls.at(-1).sql, "COMMIT");
});
for (const [name, mutate] of [
	[
		"anchor pin",
		(r) => {
			r.anchor_sha256 = "b".repeat(64);
		},
	],
	[
		"prefix pin",
		(r) => {
			r.start_slot = "14";
		},
	],
	[
		"partial cleared state",
		(r) => {
			r.covered_through_slot = null;
		},
	],
	[
		"malformed revision",
		(r) => {
			r.revision = "invalid";
		},
	],
	[
		"invalid block identity",
		(r) => {
			r.last_block_hash = "bad";
		},
	],
])
	test(`publisher refuses stored ${name}`, async () => {
		const s = setup();
		await s.publisher.publish(s.f);
		mutate(s.coverage);
		await assert.rejects(s.publisher.publish(s.f));
	});
test("publication update failure rolls back and discards client", async () => {
	const s = setup({ fail: (sql) => sql.startsWith("UPDATE") });
	await assert.rejects(s.publisher.publish(s.f));
	assert.equal(s.calls.at(-1).sql, "ROLLBACK");
	assert.ok(s.releases[0] instanceof Error);
});
