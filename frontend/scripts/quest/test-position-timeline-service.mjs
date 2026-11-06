import assert from "node:assert/strict";
import test from "node:test";
import {
	liquidityRangeFixture,
	timelineConnection,
} from "../../tests/fixtures/quest-position-timeline.mjs";
import { decodePositionLiquidityBlockRange } from "./position-liquidity-replay.mjs";
import { verifyOwnershipRangeAnchor } from "./position-ownership-block-range.mjs";
import { timelineClock } from "./position-timeline-integrity.mjs";
import {
	createPositionTimelinePublisher,
	createPositionTimelineReader,
	timelineRangeRow,
} from "./position-timeline-service.mjs";

async function setup() {
	const f = liquidityRangeFixture(),
		p = verifyOwnershipRangeAnchor(f.anchor),
		a = f.anchor,
		r = await decodePositionLiquidityBlockRange(f),
		clock = timelineClock(a, {
			blockhash: "11111111111111111111111111111112",
			blockTime: 900,
		}),
		calls = [],
		releases = [];
	const values = {
		contextEnv: {
			rows: [{ environment_id: "33333333-3333-4333-8333-333333333333" }],
		},
		capture: { rows: [{ captured_ms: "1100000" }] },
		env: {
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
					evidence_set_sha256: p.evidenceSetSha256,
					inventory_sha256: p.inventorySha256,
					network: a.network,
					program_id: a.programId,
					layout_version: a.layoutVersion,
					anchor_slot: String(a.anchorSlot),
					manifest_sha256: a.manifestSha256,
					position_count: a.inventory.length,
				},
			],
		},
		clock: {
			rows: [
				{
					anchor_sha256: p.evidenceSetSha256,
					clock_sha256: clock.clockSha256,
					clock_bundle: clock,
				},
			],
		},
		coverage: {
			rows: [
				{
					anchor_sha256: p.evidenceSetSha256,
					decoder_version: "position-timeline-v1",
					start_slot: "13",
					covered_through_slot: "20",
					last_range_start: "13",
					last_range_sha256: r.bundleSha256,
					revision: "1",
					invalidation_reason: null,
				},
			],
		},
		conflicts: { rows: [{ quarantined: false }] },
		ranges: { rows: [timelineRangeRow(r)] },
		legacy: { rows: [] },
		links: { rows: [] },
	};
	let failure;
	const pool = {
		async connect() {
			return {
				async query(sql, params) {
					calls.push({ sql, params });
					if (sql.includes("SELECT environment_id::text"))
						return structuredClone(values.contextEnv);
					if (sql.includes("AS captured_ms"))
						return structuredClone(values.capture);
					if (failure && sql.startsWith(failure))
						throw Error("injected query failure");
					for (const [name, table] of [
						["env", "FROM quest.environment_identity"],
						["anchor", "FROM quest.position_baseline_anchors"],
						["clock", "FROM quest.position_timeline_clocks"],
						["coverage", "FROM quest.position_timeline_coverage"],
						[
							"conflicts",
							"EXISTS(SELECT 1 FROM quest.position_timeline_conflicts",
						],
						["ranges", "FROM quest.position_timeline_ranges"],
						["legacy", "FROM quest.position_ownership_evidence"],
						["links", "FROM quest.wallet_links"],
					])
						if (sql.includes(table)) return structuredClone(values[name]);
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
		r,
		values,
		calls,
		releases,
		pool,
		read: () =>
			createPositionTimelineReader({ pool, anchor: a }).read({ endSlot: 20 }),
		readContext: () =>
			createPositionTimelineReader({
				pool,
				anchor: a,
				environment: {
					network: "DEVNET",
					environmentId: "33333333-3333-4333-8333-333333333333",
					manifestSha256: a.manifestSha256,
				},
			}).read({ endSlot: 20 }),
		publish: () =>
			createPositionTimelinePublisher({
				pool,
				anchor: a,
				connection: timelineConnection(f),
			}).publish(f),
		fail: (prefix) => {
			failure = prefix;
		},
	};
}
test("timeline context binds dedicated environment and capture without changing default output", async () => {
	const s = await setup(),
		out = await s.readContext();
	assert.equal(
		out.sourceContext.environmentId,
		"33333333-3333-4333-8333-333333333333",
	);
	assert.equal(out.sourceContext.capturedAt, new Date(1100000).toISOString());
	assert.ok(s.calls.some((c) => c.sql.includes("statement_timeout")));
	assert.equal((await s.read()).sourceContext, undefined);
});
test("opt-in conservative timeline links accept rounded timestamps and preserve strict default", async () => {
	const s = await setup();
	s.values.links.rows=[{network:"DEVNET",wallet:s.f.anchor.evidence[0].observation.observedOwnerWallet,
		passport_id:"11111111-1111-4111-8111-111111111111",linked_ms:"1000001",unlinked_ms:null,
		linked_exact:false,unlinked_exact:true}];
	await assert.rejects(s.read(),/timestamp precision/);
	const out=await createPositionTimelineReader({pool:s.pool,anchor:s.f.anchor,conservativeLinkTimes:true}).read({endSlot:20});
	assert.equal(out.histories[0].links[0].linkedAt,new Date(1000001).toISOString());
	assert.ok(s.calls.some(c=>c.sql.includes("ceil(EXTRACT(EPOCH FROM linked_at)")));
});
test("timeline context refuses changed dedicated identity and discards connection", async () => {
	const s = await setup();
	s.values.contextEnv.rows[0].environment_id =
		"22222222-2222-4222-8222-222222222222";
	await assert.rejects(s.readContext(), /environment differs/);
	assert.equal(s.calls.at(-1).sql, "ROLLBACK");
	assert.ok(s.releases[0] instanceof Error);
});
test("timeline context refuses noncanonical database capture", async () => {
	const s = await setup();
	s.values.capture.rows[0].captured_ms = null;
	await assert.rejects(s.readContext(), /invalid timeline capture/);
	assert.equal(s.calls.at(-1).sql, "ROLLBACK");
});
test("reader checks clock/trust/evidence/links within one read-only stable snapshot", async () => {
	const s = await setup(),
		r = await s.read();
	assert.equal(
		s.calls[0].sql,
		"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
	);
	assert.equal(s.calls.at(-1).sql, "COMMIT");
	assert(!s.calls.some((c) => c.sql.includes("FOR UPDATE")));
	assert.equal(r.positions[0].endSlotLiquidityRaw, "107");
	assert.equal(r.histories[0].links.length, 0);
	assert.equal(r.coverageRevision, "1");
	assert.equal(s.releases[0], undefined);
});
test("fresh exact publication retry uses campaign lock and preserves revision", async () => {
	const s = await setup(),
		r = await s.publish();
	assert.equal(r.publicationChanged, false);
	assert.equal(r.coverageRevision, "1");
	assert(s.calls.some((c) => c.sql.includes("pg_advisory_xact_lock")));
	assert(!s.calls.some((c) => c.sql.startsWith("UPDATE")));
});
for (const [label, alter] of [
	[
		"wrong environment",
		(s) => {
			s.values.env.rows[0].network = "MAINNET";
		},
	],
	[
		"missing anchor",
		(s) => {
			s.values.anchor.rows = [];
		},
	],
	[
		"anchor metadata",
		(s) => {
			s.values.anchor.rows[0].anchor_slot = "11";
		},
	],
	[
		"missing clock",
		(s) => {
			s.values.clock.rows = [];
		},
	],
	[
		"changed clock",
		(s) => {
			s.values.clock.rows[0].clock_bundle.blockTimeSeconds = 901;
		},
	],
	[
		"missing coverage",
		(s) => {
			s.values.coverage.rows = [];
		},
	],
	[
		"coverage hash",
		(s) => {
			s.values.coverage.rows[0].last_range_sha256 = "b".repeat(64);
		},
	],
	[
		"coverage version",
		(s) => {
			s.values.coverage.rows[0].decoder_version = "other";
		},
	],
	[
		"incomplete invalidation",
		(s) => {
			s.values.coverage.rows[0].covered_through_slot = null;
		},
	],
	[
		"quarantine",
		(s) => {
			s.values.conflicts.rows[0].quarantined = true;
		},
	],
	[
		"incomplete conflicts",
		(s) => {
			s.values.conflicts = { rows: [] };
		},
	],
	[
		"missing prefix",
		(s) => {
			s.values.ranges.rows = [];
		},
	],
	[
		"range metadata",
		(s) => {
			s.values.ranges.rows[0].end_slot = "19";
		},
	],
	[
		"overflow",
		(s) => {
			s.values.ranges.rows = Array(65).fill(s.values.ranges.rows[0]);
		},
	],
	[
		"legacy disagreement",
		(s) => {
			s.values.legacy.rows = [{ source_key: "uncovered" }];
		},
	],
	[
		"unknown linked wallet",
		(s) => {
			s.values.links.rows = [{ network: "DEVNET", wallet: "unknown" }];
		},
	],
	[
		"submillisecond link",
		(s) => {
			s.values.links.rows = [
				{
					network: "DEVNET",
					wallet: s.f.anchor.evidence[0].observation.observedOwnerWallet,
					linked_exact: false,
					unlinked_exact: true,
				},
			];
		},
	],
])
	test(`reader refuses ${label} and discards connection`, async () => {
		const s = await setup();
		alter(s);
		await assert.rejects(s.read());
		assert.equal(s.calls.at(-1).sql, "ROLLBACK");
		assert(s.releases[0] instanceof Error);
	});
for (const prefix of [
	"BEGIN",
	"SELECT anchor_sha256,clock_sha256",
	"SELECT anchor_sha256,decoder_version,start_slot::text,end_slot",
	"SELECT network,wallet",
	"COMMIT",
	"ROLLBACK",
])
	test(`reader query failure ${prefix} returns no partial result`, async () => {
		const s = await setup();
		s.fail(prefix);
		if (prefix === "ROLLBACK") s.values.conflicts.rows = [];
		await assert.rejects(s.read());
		assert(s.releases[0] instanceof Error);
	});
test("RPC network/finality/pruning/oversize failures occur before SQL", async () => {
	for (const change of [
		(c) => {
			c.getGenesisHash = async () => "wrong";
		},
		(c) => {
			c.getSlot = async () => 19;
		},
		(c) => {
			c.getFirstAvailableBlock = async () => 13;
		},
		(c) => {
			c.getBlocks = async () => Array(257).fill(20);
		},
		(c) => {
			c.getBlock = async () => null;
		},
	]) {
		const s = await setup(),
			c = timelineConnection(s.f);
		change(c);
		await assert.rejects(
			createPositionTimelinePublisher({
				pool: s.pool,
				anchor: s.f.anchor,
				connection: c,
			}).publish(s.f),
		);
		assert.equal(s.calls.length, 0);
	}
});
test("publisher commit failure discards its connection", async () => {
	const s = await setup();
	s.fail("COMMIT");
	await assert.rejects(s.publish());
	assert.equal(s.calls.at(-1).sql, "ROLLBACK");
	assert(s.releases[0] instanceof Error);
});
