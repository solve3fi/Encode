import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ownershipBlockRangeFixture } from "../../tests/fixtures/quest-ownership-block-range.mjs";
import { closureEvidenceFixture } from "../../tests/fixtures/quest-position-ownership.mjs";
import { decodePositionClosureEvidence } from "./position-closure-evidence.mjs";
import {
	decodePositionOwnershipBlockRange,
	verifyOwnershipRangeAnchor,
} from "./position-ownership-block-range.mjs";
import { ownershipReconciliationRow } from "./position-ownership-reconciliation.mjs";
import {
	createPositionOwnershipStateReader,
	projectPositionOwnershipState,
} from "./position-ownership-state-reader.mjs";

function fixture() {
	const f = ownershipBlockRangeFixture(),
		p = verifyOwnershipRangeAnchor(f.anchor);
	const range = decodePositionOwnershipBlockRange(f);
	const rows = range.observations.map((e) =>
		ownershipReconciliationRow(e, p.evidenceSetSha256),
	);
	return { ...f, p, rows };
}
function rowFor(f, record) {
	const transfer = record.eventKind === "position_nft_transfer";
	return ownershipReconciliationRow(
		{
			record,
			sourceKey: JSON.stringify([
				record.campaignId,
				record.network,
				record.signature,
				record.instructionIndex,
				record.positionMint,
				...(!transfer ? ["position_close"] : []),
			]),
			evidenceSha256: createHash("sha256")
				.update(JSON.stringify(record))
				.digest("hex"),
		},
		f.p.evidenceSetSha256,
	);
}
const project = (f) => projectPositionOwnershipState(f);
test("ordered transfer updates owner and preserves the original caller data", () => {
	const f = fixture(),
		before = structuredClone(f.rows);
	const result = project(f);
	assert.equal(
		result.positions[0].ownerWallet,
		f.rows[0].evidence_record.toOwnerWallet,
	);
	assert.equal(result.awardEligible, false);
	assert.deepEqual(f.rows, before);
});
test("empty replay retains baseline without inventing liquidity or timestamps", () => {
	const f = fixture();
	f.rows = [];
	const s = project(f).positions[0];
	assert.equal(
		s.ownerWallet,
		f.anchor.evidence[0].observation.observedOwnerWallet,
	);
	assert.equal(s.closed, false);
	assert.equal(s.liquidityRaw, undefined);
	assert.equal(s.startTime, undefined);
});
test("jsonb key order does not alter the immutable record hash", () => {
	const f = fixture();
	f.rows[0].evidence_record = Object.fromEntries(
		Object.entries(f.rows[0].evidence_record).reverse(),
	);
	project(f);
});
test("same-owner account move retained; later transfer follows its destination", () => {
	const f = fixture(),
		r = f.rows[0].evidence_record;
	r.toOwnerWallet = r.fromOwnerWallet;
	const second = {
		...r,
		signature: "second",
		slot: 21,
		blockTimeSeconds: 1001,
		sourceTokenAccount: r.destinationTokenAccount,
		destinationTokenAccount: r.sourceTokenAccount,
	};
	f.rows = [rowFor(f, second), rowFor(f, r)];
	f.endSlot = 21;
	assert.equal(project(f).positions[0].transitions.length, 2);
});
test("closure is terminal and following transfers or repeat closure refuse", () => {
	const f = fixture(),
		close = decodePositionClosureEvidence({
			...closureEvidenceFixture(),
			campaignId: f.anchor.campaignId,
		}).closures[0].record;
	f.rows = [rowFor(f, close)];
	assert.equal(project(f).positions[0].ownerWallet, null);
	const later = {
		...close,
		signature: "second-close",
		slot: 21,
		blockTimeSeconds: 1001,
	};
	f.endSlot = 21;
	f.rows.push(rowFor(f, later));
	assert.throws(() => project(f), /terminal/);
	f.rows[1] = rowFor(f, {
		...fixture().rows[0].evidence_record,
		slot: 21,
		blockTimeSeconds: 1001,
	});
	assert.throws(() => project(f), /terminal/);
});
test("transfer followed by current-owner closure succeeds", () => {
	const f = fixture(),
		r = f.rows[0].evidence_record;
	const c = {
		...decodePositionClosureEvidence({
			...closureEvidenceFixture(),
			campaignId: f.anchor.campaignId,
		}).closures[0].record,
		slot: 21,
		blockTimeSeconds: 1001,
		observedOwnerWallet: r.toOwnerWallet,
		tokenAccountAddress: r.destinationTokenAccount,
	};
	f.rows.push(rowFor(f, c));
	f.endSlot = 21;
	assert.equal(project(f).positions[0].closed, true);
});
for (const [label, change, pattern] of [
	[
		"prior owner",
		(r) => {
			r.fromOwnerWallet = r.toOwnerWallet;
		},
		/prior ownership/,
	],
	[
		"prior account",
		(r) => {
			r.sourceTokenAccount = "11111111111111111111111111111115";
		},
		/prior ownership/,
	],
	[
		"unknown mint",
		(r) => {
			r.positionMint = r.toOwnerWallet;
		},
		/pins/,
	],
	[
		"wrong campaign",
		(r) => {
			r.campaignId = "other";
		},
		/pins/,
	],
	[
		"pre-anchor",
		(r) => {
			r.slot = 12;
		},
		/bounds/,
	],
	[
		"future slot",
		(r) => {
			r.slot = 21;
		},
		/bounds/,
	],
	[
		"amount",
		(r) => {
			r.amountRaw = "2";
		},
		/mutation/,
	],
	[
		"unknown field",
		(r) => {
			r.extra = true;
		},
		/fields/,
	],
	[
		"unsafe index",
		(r) => {
			r.transactionIndex = Number.MAX_SAFE_INTEGER + 1;
		},
		/bounds/,
	],
])
	test(`refuses ${label} even with refreshed hash`, () => {
		const f = fixture(),
			r = f.rows[0].evidence_record;
		change(r);
		f.rows = [rowFor(f, r)];
		assert.throws(() => project(f), pattern);
	});
for (const field of [
	"source_key",
	"evidence_sha256",
	"anchor_sha256",
	"decoder_version",
	"instruction_index",
	"block_time_seconds",
	"position_address",
	"event_kind",
])
	test(`refuses altered ${field}`, () => {
		const f = fixture();
		f.rows[0][field] = "changed";
		assert.throws(() => project(f), /metadata/);
	});
test("duplicate sources refuse", () => {
	const f = fixture();
	f.rows.push(structuredClone(f.rows[0]));
	assert.throws(() => project(f), /duplicate/);
});
test("nonmonotonic block time refuses", () => {
	const f = fixture(),
		r = f.rows[0].evidence_record;
	f.endSlot = 21;
	f.rows.push(
		rowFor(f, { ...r, slot: 21, signature: "second", blockTimeSeconds: 999 }),
	);
	assert.throws(() => project(f), /nonmonotonic/);
});
test("contradictory signature placement refuses before owner replay", () => {
	const f = fixture(),
		r = f.rows[0].evidence_record;
	f.endSlot = 21;
	f.rows.push(rowFor(f, { ...r, slot: 21 }));
	assert.throws(() => project(f), /ordering/);
});
test("oversized replay refuses", () => {
	const f = fixture();
	f.rows = Array(4097).fill(f.rows[0]);
	assert.throws(() => project(f), /bounded/);
});

test("different signatures cannot claim the same block transaction index", () => {
	const f = fixture(),
		r = f.rows[0].evidence_record;
	f.rows.push(rowFor(f, { ...r, signature: "other", instructionIndex: 1 }));
	assert.throws(() => project(f), /ordering/);
});
test("all observations within a slot must agree on block time", () => {
	const f = fixture(),
		r = f.rows[0].evidence_record;
	f.rows.push(rowFor(f, { ...r, instructionIndex: 1, blockTimeSeconds: 1001 }));
	assert.throws(() => project(f), /ordering/);
});
test("closure requires the current token account and owner", () => {
	const f = fixture();
	const r = decodePositionClosureEvidence({
		...closureEvidenceFixture(),
		campaignId: f.anchor.campaignId,
	}).closures[0].record;
	r.observedOwnerWallet = "11111111111111111111111111111113";
	f.rows = [rowFor(f, r)];
	assert.throws(() => project(f), /prior ownership/);
});
test("end slot must be bounded and after the anchor", () => {
	for (const endSlot of [12, -1, 20.5, "20", Number.MAX_SAFE_INTEGER]) {
		const f = fixture();
		f.endSlot = endSlot;
		assert.throws(() => project(f), /end slot/);
	}
});

function setup() {
	const f = fixture(),
		a = f.anchor,
		calls = [],
		releases = [];
	const results = {
		environment: {
			rows: [
				{
					network: a.network,
					genesis_hash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
					manifest_sha256: a.manifestSha256,
					namespace: "quest",
				},
			],
		},
		anchor: {
			rows: [
				{
					evidence_bundle: a,
					evidence_set_sha256: f.p.evidenceSetSha256,
					inventory_sha256: f.p.inventorySha256,
					network: a.network,
					program_id: a.programId,
					layout_version: a.layoutVersion,
					anchor_slot: String(a.anchorSlot),
					manifest_sha256: a.manifestSha256,
					position_count: a.inventory.length,
				},
			],
		},
		coverage: {
			rows: [
				{
					campaign_id: a.campaignId,
					anchor_sha256: f.p.evidenceSetSha256,
					decoder_version: "position-ownership-v1",
					start_slot: "13",
					covered_through_slot: "20",
					last_range_start: "13",
					last_range_end: "20",
					last_range_sha256: "a".repeat(64),
					last_stored_sha256: "b".repeat(64),
					last_produced_slot: "20",
					last_block_hash: f.blocks[0].block.blockhash,
					revision: "1",
					invalidation_reason: null,
				},
			],
		},
		conflicts: { rows: [{ quarantined: false }] },
		evidence: { rows: f.rows },
	};
	let failure;
	const pool = {
		async connect() {
			return {
				async query(sql, values) {
					calls.push({ sql, values });
					if (failure && sql.startsWith(failure))
						throw Error("injected query failure");
					for (const [name, table] of [
						["environment", "environment_identity"],
						["anchor", "position_baseline_anchors"],
						["coverage", "position_ownership_coverage"],
						["conflicts", "position_ownership_conflicts"],
						["evidence", "position_ownership_evidence"],
					])
						if (sql.includes(table)) return structuredClone(results[name]);
					return { rows: [] };
				},
				release(error) {
					releases.push(error);
				},
			};
		},
	};
	return {
		f,
		results,
		calls,
		releases,
		read: () =>
			createPositionOwnershipStateReader({ pool, anchor: a }).read({
				endSlot: 20,
			}),
		fail: (prefix) => {
			failure = prefix;
		},
	};
}
test("reader uses read-only stable snapshot, all campaign conflicts and complete bounded prefix", async () => {
	const s = setup(),
		r = await s.read();
	assert.equal(r.trust, "HISTORICAL_REPEATABLE_READ_SNAPSHOT");
	assert.equal(r.coverageRevision, "1");
	assert.equal(
		s.calls[0].sql,
		"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
	);
	assert.equal(s.calls.at(-1).sql, "COMMIT");
	assert.equal(s.releases[0], undefined);
	assert(!s.calls.some(({ sql }) => sql.includes("FOR UPDATE")));
	assert.deepEqual(s.calls.at(-2).values, [s.f.anchor.campaignId, "13", "20"]);
});
for (const [label, alter] of [
	[
		"environment",
		(s) => {
			s.results.environment.rows[0].namespace = "other";
		},
	],
	[
		"anchor",
		(s) => {
			s.results.anchor.rows[0].position_count = 99;
		},
	],
	[
		"missing coverage",
		(s) => {
			s.results.coverage.rows = [];
		},
	],
	[
		"insufficient coverage",
		(s) => {
			s.results.coverage.rows[0].covered_through_slot = "19";
			s.results.coverage.rows[0].last_range_end = "19";
			s.results.coverage.rows[0].last_produced_slot = "19";
		},
	],
	[
		"cleared coverage",
		(s) => {
			const r = s.results.coverage.rows[0];
			for (const k of [
				"covered_through_slot",
				"last_range_start",
				"last_range_end",
				"last_range_sha256",
				"last_stored_sha256",
				"last_produced_slot",
				"last_block_hash",
			])
				r[k] = null;
			r.invalidation_reason = "LATE_EVIDENCE";
		},
	],
	[
		"quarantine",
		(s) => {
			s.results.conflicts.rows[0].quarantined = true;
		},
	],
	[
		"incomplete conflicts",
		(s) => {
			s.results.conflicts.rows = [];
		},
	],
	[
		"incomplete evidence",
		(s) => {
			s.results.evidence = {};
		},
	],
])
	test(`snapshot refuses ${label} and discards connection`, async () => {
		const s = setup();
		alter(s);
		await assert.rejects(s.read());
		assert.equal(s.calls.at(-1).sql, "ROLLBACK");
		assert(s.releases[0] instanceof Error);
	});
for (const prefix of ["BEGIN", "SELECT source_key", "COMMIT", "ROLLBACK"])
	test(`query failure ${prefix} returns no partial result`, async () => {
		const s = setup();
		s.fail(prefix);
		if (prefix === "ROLLBACK") s.results.conflicts.rows = [];
		await assert.rejects(s.read());
		assert(s.releases[0] instanceof Error);
	});
