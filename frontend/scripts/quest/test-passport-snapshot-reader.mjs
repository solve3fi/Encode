import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintGenesisEvent } from "../../src/lib/genesis/eventFingerprint.ts";
import {
	createPassportPositionEvidenceReader,
	createPassportSwapEvidenceReader,
	createPassportSwapQualificationReader,
} from "./passport-snapshot-reader.mjs";

const wallet = "1".repeat(32);
const passport = "11111111-1111-4111-8111-111111111111";
const start = Date.parse("2026-10-01T00:00:00Z") / 1000;
function fixture() {
	const record = {
		campaignId: "snapshot-fixture",
		cluster: "devnet",
		signature: "fixture-swap",
		instructionIndex: 0,
		eventIndex: 0,
		eventKind: "swap",
		slot: 12,
		blockTimeSeconds: start + 100,
		wallet,
		poolAddress: "fixture-pool",
		positionAddress: null,
		payload: { inputRaw: "100", instructionKind: "swap" },
	};
	return {
		campaigns: [
			{
				cluster: "devnet",
				start_seconds: String(start),
				start_exact: true,
				end_seconds: String(start + 86400),
				end_exact: true,
			},
		],
		cursors: [
			{
				program_id: "fixture-program",
				decoder_version: "fixture-decoder",
				next_slot: "16",
				reconciliation_start_slot: "10",
				reconciled_through_slot: "15",
			},
		],
		conflicts: [],
		events: [
			{
				event_id: "1",
				campaign_id: record.campaignId,
				cluster: record.cluster,
				signature: record.signature,
				instruction_index: 0,
				event_index: 0,
				event_kind: "swap",
				slot: "12",
				block_seconds: String(record.blockTimeSeconds),
				block_exact: true,
				wallet,
				pool_address: record.poolAddress,
				position_address: null,
				payload: record.payload,
				decoder_version: "fixture-decoder",
				event_sha256: fingerprintGenesisEvent(record).eventSha256,
			},
		],
		valuations: [
			{
				event_id: "1",
				value_usd_cents: "600",
				price_seconds: String(start + 100),
				price_exact: true,
				valuation_source: "fixture-price",
				valuation_version: "fixture-v1",
				price_evidence: { fixture: true },
			},
		],
		links: [
			{
				network: "DEVNET",
				wallet,
				passport_id: passport,
				linked_ms: String(start * 1000),
				unlinked_ms: null,
				linked_exact: true,
				unlinked_exact: true,
			},
		],
	};
}
function harness(f = fixture(), options = {}) {
	const calls = [];
	const released = [];
	const client = {
		async query(sql, params) {
			calls.push({ sql, params });
			if (
				(options.failOn && sql.includes(options.failOn)) ||
				(options.failRollback && sql === "ROLLBACK")
			)
				throw new Error("test driver failure");
			if (sql.includes("FROM genesis.campaigns")) return { rows: f.campaigns };
			if (sql.includes("FROM quest.environment_identity"))
				return { rows: f.identity ?? [] };
			if (sql.includes("AS captured_ms")) return { rows: f.clock ?? [] };
			if (sql.includes("FROM genesis.indexer_cursors"))
				return { rows: f.cursors };
			if (sql.includes("FROM genesis.ingest_conflicts"))
				return { rows: f.conflicts };
			if (sql.includes("FROM quest.referrals")) return { rows: f.referralRows ?? [] };
			if (sql.includes("liquidity_increase")) return { rows: f.lpEvents ?? [] };
			if (sql.includes("FROM genesis.lp_value_snapshots"))
				return { rows: f.lpSnapshots ?? [] };
			if (sql.includes("FROM genesis.chain_events")) return { rows: f.events };
			if (sql.includes("FROM quest.wallet_links")) return { rows: f.links };
			if (sql.includes("FROM genesis.swap_valuations"))
				return { rows: f.valuations };
			return { rows: [] };
		},
		release(error) {
			released.push(error);
		},
	};
	const configuration = {
		pool: {
			async connect() {
				return client;
			},
		},
		network: "DEVNET",
		campaignId: "snapshot-fixture",
		programId: "fixture-program",
		decoderVersion: "fixture-decoder",
		startSlot: 10,
		...options.config,
	};
	return {
		reader: options.position
			? createPassportPositionEvidenceReader(configuration)
			: options.qualified
				? createPassportSwapQualificationReader({
						...configuration,
						policy: options.policy ?? testPolicy(),
					})
				: createPassportSwapEvidenceReader(configuration),
		calls,
		released,
	};
}

function testPolicy() {
	return {
		fixtureKind: "SYNTHETIC_DEVNET",
		network: "DEVNET",
		revision: 1,
		minimumSwapUsdCents: "500",
		maximumPriceAgeSeconds: 10,
		valuationSource: "fixture-price",
		valuationVersion: "fixture-v1",
	};
}

const contextEnvironment = {
	network: "DEVNET",
	environmentId: "33333333-3333-4333-8333-333333333333",
	manifestSha256: "a".repeat(64),
};
function contextFixture() {
	const f = fixture();
	f.identity = [
		{
			network: "DEVNET",
			genesis_hash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
			environment_id: contextEnvironment.environmentId,
			manifest_sha256: contextEnvironment.manifestSha256,
			namespace: "quest",
		},
	];
	f.clock = [{ captured_ms: String((start + 200) * 1000) }];
	return f;
}
test("qualified context binds database identity and historical cursor with server capture time", async () => {
	const h = harness(contextFixture(), {
			qualified: true,
			config: { includeSourceContext: true, environment: contextEnvironment },
		}),
		out = await h.reader.read(15);
	assert.equal(
		out.sourceContext.environmentId,
		contextEnvironment.environmentId,
	);
	assert.equal(
		out.sourceContext.capturedAt,
		new Date((start + 200) * 1000).toISOString(),
	);
	assert.equal(out.sourceContext.reconciledThroughSlot, 15);
	assert.ok(h.calls.some((c) => c.sql.includes("statement_timeout")));
	assert.equal(h.calls.at(-1).sql, "COMMIT");
	assert.deepEqual(h.released, [undefined]);
});
for (const [name, change] of [
	["identity", (f) => (f.identity[0].manifest_sha256 = "b".repeat(64))],
	["clock", (f) => (f.clock[0].captured_ms = "bad")],
])
	test(`qualified context rejects ${name} and releases failed transaction`, async () => {
		const f = contextFixture();
		change(f);
		const h = harness(f, {
			qualified: true,
			config: { includeSourceContext: true, environment: contextEnvironment },
		});
		await assert.rejects(h.reader.read(15));
		assert.equal(h.calls.at(-1).sql, "ROLLBACK");
		assert.equal(h.released.length, 1);
		assert.ok(h.released[0] instanceof Error);
	});

test("qualification reads source, ownership and bound stored valuations before one commit", async () => {
	const h = harness(fixture(), { qualified: true });
	const result = await h.reader.read(15);
	assert.equal(result.state, "SYNTHETIC_DEVNET_SWAP_QUALIFICATION");
	assert.equal(result.awardEligible, false);
	assert.equal(result.passports[0].qualifyingSwaps, 1);
	assert.equal(result.passports[0].actions[0].valueUsdCents, "600");
	assert.deepEqual(
		h.calls.find((c) => c.sql.includes("FROM genesis.swap_valuations")).params,
		["snapshot-fixture", ["1"], 10001],
	);
	assert.equal(h.calls.at(-1).sql, "COMMIT");
});

test("qualification policy is pinned at construction and cannot be changed during reads", async () => {
	const policy = testPolicy();
	const h = harness(fixture(), { qualified: true, policy });
	policy.minimumSwapUsdCents = "999";
	policy.valuationSource = "other";
	assert.equal((await h.reader.read(15)).passports[0].qualifyingSwaps, 1);
	assert.throws(
		() =>
			harness(fixture(), {
				qualified: true,
				policy: { ...testPolicy(), fixtureKind: "LIVE" },
			}),
		/synthetic/,
	);
});

test("qualification handles empty range without a valuation query", async () => {
	const f = fixture();
	f.events = [];
	f.valuations = [];
	const h = harness(f, { qualified: true });
	assert.deepEqual((await h.reader.read(15)).passports, []);
	assert.equal(
		h.calls.some((c) => c.sql.includes("FROM genesis.swap_valuations")),
		false,
	);
});

test("stored bigint event IDs are matched exactly without Number coercion", async () => {
	const f = fixture();
	f.events[0].event_id = "9007199254740993";
	f.valuations[0].event_id = "9007199254740993";
	assert.equal(
		(await harness(f, { qualified: true }).reader.read(15)).passports[0]
			.qualifyingSwaps,
		1,
	);
});

test("qualified reader preserves both valued two-hop legs but counts one action", async () => {
	const f = fixture();
	const first = f.events[0];
	first.payload.instructionKind = "two_hop_swap";
	const second = {
		...structuredClone(first),
		event_id: "2",
		event_index: 1,
		pool_address: "fixture-second-pool",
	};
	f.events = [first, second];
	for (const e of f.events)
		e.event_sha256 = fingerprintGenesisEvent({
			campaignId: e.campaign_id,
			cluster: e.cluster,
			signature: e.signature,
			instructionIndex: e.instruction_index,
			eventIndex: e.event_index,
			eventKind: e.event_kind,
			slot: Number(e.slot),
			blockTimeSeconds: Number(e.block_seconds),
			wallet: e.wallet,
			poolAddress: e.pool_address,
			positionAddress: e.position_address,
			payload: e.payload,
		}).eventSha256;
	f.valuations.push({
		...structuredClone(f.valuations[0]),
		event_id: "2",
		value_usd_cents: "900",
	});
	const result = await harness(f, { qualified: true }).reader.read(15);
	assert.equal(result.passports[0].qualifyingSwaps, 1);
	assert.equal(result.passports[0].actions[0].sourceKeys.length, 2);
	f.valuations[0].value_usd_cents = "499";
	assert.equal(
		(await harness(f, { qualified: true }).reader.read(15)).passports[0]
			.qualifyingSwaps,
		0,
	);
});

test("unlinked sources cannot hide incomplete price rows", async () => {
	const f = fixture();
	f.links = [];
	f.valuations = [];
	await assert.rejects(
		harness(f, { qualified: true }).reader.read(15),
		/complete valuations/,
	);
});

for (const [name, mutate, pattern] of [
	[
		"missing stored valuation",
		(f) => {
			f.valuations = [];
		},
		/complete valuations/,
	],
	[
		"unexpected valuation ID",
		(f) => {
			f.valuations[0].event_id = "2";
		},
		/unexpected/,
	],
	[
		"repeated valuation ID",
		(f) => {
			f.valuations.push(structuredClone(f.valuations[0]));
		},
		/repeated/,
	],
	[
		"malformed stored event ID",
		(f) => {
			f.events[0].event_id = "01";
		},
		/event ID/,
	],
	[
		"out-of-range stored event ID",
		(f) => {
			f.events[0].event_id = "9223372036854775808";
		},
		/event ID/,
	],
	[
		"repeated stored event ID",
		(f) => {
			f.events.push(structuredClone(f.events[0]));
		},
		/duplicate stored/,
	],
	[
		"fractional price timestamp",
		(f) => {
			f.valuations[0].price_exact = false;
		},
		/exact seconds/,
	],
	[
		"future stored price",
		(f) => {
			f.valuations[0].price_seconds = String(start + 101);
		},
		/price time/,
	],
	[
		"stale stored price",
		(f) => {
			f.valuations[0].price_seconds = String(start + 89);
		},
		/price time/,
	],
	[
		"wrong source",
		(f) => {
			f.valuations[0].valuation_source = "other";
		},
		/pins/,
	],
	[
		"wrong version",
		(f) => {
			f.valuations[0].valuation_version = "other";
		},
		/pins/,
	],
	[
		"empty stored evidence",
		(f) => {
			f.valuations[0].price_evidence = {};
		},
		/evidence/,
	],
	[
		"fractional USD cents",
		(f) => {
			f.valuations[0].value_usd_cents = "600.1";
		},
		/USD/,
	],
])
	test(`qualification reader rejects ${name}`, async () => {
		const f = fixture();
		mutate(f);
		const h = harness(f, { qualified: true });
		await assert.rejects(h.reader.read(15), pattern);
		assert.equal(h.calls.at(-1).sql, "ROLLBACK");
		assert.ok(h.released[0] instanceof Error);
	});

test("valuation driver failure rolls back and discards the connection", async () => {
	const h = harness(fixture(), {
		qualified: true,
		failOn: "FROM genesis.swap_valuations",
	});
	await assert.rejects(h.reader.read(15), /driver failure/);
	assert.equal(h.calls.at(-1).sql, "ROLLBACK");
	assert.ok(h.released[0] instanceof Error);
});

test("reader projects immutable source and history in one read-only repeatable snapshot", async () => {
	const h = harness();
	const result = await h.reader.read(15);
	assert.equal(result.passports[0].passportId, passport);
	assert.equal(result.passports[0].finalizedSwapEvents, 1);
	assert.equal(
		h.calls[0].sql,
		"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
	);
	assert.equal(h.calls.at(-1).sql, "COMMIT");
	assert.deepEqual(h.released, [undefined]);
	assert.deepEqual(
		h.calls.find((c) => c.sql.includes("FROM quest.wallet_links")).params,
		[[wallet], 20001],
	);
});

test("empty source snapshot is complete without a history query", async () => {
	const f = fixture();
	f.events = [];
	const h = harness(f);
	assert.deepEqual((await h.reader.read(15)).passports, []);
	assert.equal(
		h.calls.some((c) => c.sql.includes("FROM quest.wallet_links")),
		false,
	);
});

test("no links and pre-link sources stay uncredited", async () => {
	for (const links of [
		[],
		[{ ...fixture().links[0], linked_ms: String((start + 101) * 1000) }],
	]) {
		const f = fixture();
		f.links = links;
		const result = await harness(f).reader.read(15);
		assert.equal(result.passports.length, 0);
		assert.equal(result.unattributedSources.length, 1);
	}
});

for (const [name, mutate, pattern] of [
	[
		"missing campaign",
		(f) => {
			f.campaigns = [];
		},
		/campaign/,
	],
	[
		"Mainnet campaign",
		(f) => {
			f.campaigns[0].cluster = "mainnet-beta";
		},
		/Devnet/,
	],
	[
		"subsecond campaign window",
		(f) => {
			f.campaigns[0].start_exact = false;
		},
		/exact seconds/,
	],
	[
		"missing cursor",
		(f) => {
			f.cursors = [];
		},
		/cursor/,
	],
	[
		"multiple program cursors",
		(f) => {
			f.cursors.push({ ...f.cursors[0], program_id: "other" });
		},
		/oversized cursor/,
	],
	[
		"wrong program pin",
		(f) => {
			f.cursors[0].program_id = "wrong";
		},
		/pins/,
	],
	[
		"wrong decoder pin",
		(f) => {
			f.cursors[0].decoder_version = "wrong";
		},
		/pins/,
	],
	[
		"wrong starting slot",
		(f) => {
			f.cursors[0].reconciliation_start_slot = "11";
		},
		/pins/,
	],
	[
		"uninitialized starting slot",
		(f) => {
			f.cursors[0].reconciliation_start_slot = null;
		},
		/invalid/,
	],
	[
		"invalidated watermark",
		(f) => {
			f.cursors[0].reconciled_through_slot = null;
		},
		/watermark/,
	],
	[
		"watermark behind requested slot",
		(f) => {
			f.cursors[0].reconciled_through_slot = "14";
		},
		/reconciled/,
	],
	[
		"watermark beyond indexed range",
		(f) => {
			f.cursors[0].reconciled_through_slot = "16";
		},
		/reconciled/,
	],
	[
		"open source conflict",
		(f) => {
			f.conflicts = [{ id: 1 }];
		},
		/open source conflict/,
	],
	[
		"unsafe event slot",
		(f) => {
			f.events[0].slot = "9007199254740992";
		},
		/event slot/,
	],
	[
		"subsecond event time",
		(f) => {
			f.events[0].block_exact = false;
		},
		/exact seconds/,
	],
	[
		"immutable event tampering",
		(f) => {
			f.events[0].payload.inputRaw = "999";
		},
		/hash/,
	],
	[
		"wrong event decoder",
		(f) => {
			f.events[0].decoder_version = "other";
		},
		/pinned/,
	],
	[
		"sub-millisecond link time",
		(f) => {
			f.links[0].linked_exact = false;
		},
		/sub-millisecond/,
	],
	[
		"unexpected wallet history",
		(f) => {
			f.links[0].wallet = "2".repeat(32);
		},
		/history/,
	],
	[
		"cross-Passport ownership",
		(f) => {
			f.links[0].unlinked_ms = String((start + 50) * 1000);
			f.links.push({
				...f.links[0],
				passport_id: "22222222-2222-4222-8222-222222222222",
				linked_ms: String((start + 60) * 1000),
				unlinked_ms: null,
			});
		},
		/changes Passport/,
	],
]) {
	test(`reader rejects ${name} and rolls back before returning evidence`, async () => {
		const f = fixture();
		mutate(f);
		const h = harness(f);
		await assert.rejects(h.reader.read(15), pattern);
		assert.equal(h.calls.at(-1).sql, "ROLLBACK");
		assert.equal(
			h.calls.some((c) => c.sql === "COMMIT"),
			false,
		);
		assert.ok(h.released[0] instanceof Error);
	});
}

test("oversized event and history results reject rather than silently truncate", async () => {
	for (const field of ["events", "links"]) {
		const f = fixture();
		f[field].push(structuredClone(f[field][0]));
		const h = harness(f, { config: { maxEvents: 1, maxLinks: 1 } });
		await assert.rejects(h.reader.read(15), /oversized/);
	}
});

test("SQL failures during BEGIN, read, and COMMIT discard the dedicated connection", async () => {
	for (const failOn of ["BEGIN", "FROM quest.wallet_links", "COMMIT"]) {
		const h = harness(fixture(), { failOn });
		await assert.rejects(h.reader.read(15), /driver failure/);
		assert.equal(
			h.calls.at(-1).sql,
			failOn === "BEGIN"
				? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
				: "ROLLBACK",
		);
		assert.ok(h.released[0] instanceof Error);
	}
});

test("invalid configuration and requested range refuse before connecting", async () => {
	for (const config of [
		{ network: "MAINNET" },
		{ maxEvents: 0 },
		{ maxLinks: 100001 },
		{ campaignId: "" },
	]) {
		assert.throws(() => harness(fixture(), { config }), /configuration/);
	}
	const h = harness();
	await assert.rejects(h.reader.read(9), /computed slot/);
	assert.equal(h.calls.length, 0);
});

test("rollback failure preserves original failure and discards the connection", async () => {
	const f = fixture();
	f.conflicts = [{ id: 1 }];
	const h = harness(f, { failRollback: true });
	await assert.rejects(h.reader.read(15), /open source conflict/);
	assert.ok(h.released[0] instanceof Error);
});

function positionFixture() {
	const f = fixture();
	const row = f.events[0];
	row.event_kind = "liquidity_increase";
	row.pool_address = wallet;
	row.position_address = "So11111111111111111111111111111111111111112";
	row.payload = {
		kind: row.event_kind,
		instructionKind: "increase_liquidity_v2",
		poolAddress: row.pool_address,
		positionAddress: row.position_address,
		tickLowerIndex: -100,
		tickUpperIndex: 100,
		liquidityRaw: "9007199254740993",
		tokenAAmountRaw: "100",
		tokenBAmountRaw: "200",
		tokenATransferFeeRaw: "0",
		tokenBTransferFeeRaw: "0",
	};
	hashPosition(row);
	return f;
}
function hashPosition(row) {
	row.event_sha256 = fingerprintGenesisEvent({
		campaignId: row.campaign_id,
		cluster: row.cluster,
		signature: row.signature,
		instructionIndex: row.instruction_index,
		eventIndex: row.event_index,
		eventKind: row.event_kind,
		slot: Number(row.slot),
		blockTimeSeconds: Number(row.block_seconds),
		wallet: row.wallet,
		poolAddress: row.pool_address,
		positionAddress: row.position_address,
		payload: row.payload,
	}).eventSha256;
}
test("LP reader uses the shared stable lifecycle and preserves exact transaction observations", async () => {
	const h = harness(positionFixture(), { position: true });
	const result = await h.reader.read(15);
	assert.equal(result.state, "TEST_ONLY_POSITION_OBSERVATIONS");
	assert.equal(result.ownershipCoverage, "TRANSACTION_ONLY");
	assert.equal(result.awardEligible, false);
	assert.equal(result.positions[0].observations[0].passportId, passport);
	assert.equal(
		result.positions[0].observations[0].liquidityRaw,
		"9007199254740993",
	);
	assert.equal(
		h.calls[0].sql,
		"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
	);
	assert.equal(h.calls.at(-1).sql, "COMMIT");
	const eventQuery = h.calls.find((c) =>
		c.sql.includes("FROM genesis.chain_events"),
	);
	assert.match(eventQuery.sql, /event_kind <> 'swap'/);
	assert.deepEqual(eventQuery.params, ["snapshot-fixture", 10, 15, 10001]);
	assert.equal(
		h.calls.some((c) => c.sql.includes("swap_valuations")),
		false,
	);
	assert.equal(h.released[0], undefined);
});
test("LP reader keeps unlinked and outside-campaign sources while reading complete histories", async () => {
	const f = positionFixture();
	f.links = [];
	let result = await harness(f, { position: true }).reader.read(15);
	assert.equal(
		result.positions[0].observations[0].attributionState,
		"UNLINKED",
	);
	f.events[0].block_seconds = String(start - 1);
	hashPosition(f.events[0]);
	const h = harness(f, { position: true });
	result = await h.reader.read(15);
	assert.equal(
		result.positions[0].observations[0].attributionState,
		"OUTSIDE_CAMPAIGN",
	);
	assert.ok(h.calls.some((c) => c.sql.includes("FROM quest.wallet_links")));
});
test("LP reader refuses limits beyond the position projector capacity at construction", () => {
	for (const config of [
		{ maxEvents: 10001 },
		{ maxLinks: 20001 },
		{ network: "MAINNET" },
	])
		assert.throws(
			() => harness(positionFixture(), { position: true, config }),
			/configuration/,
		);
});
test("empty LP source range commits without inventing positions or querying links", async () => {
	const f = positionFixture();
	f.events = [];
	const h = harness(f, { position: true });
	assert.deepEqual((await h.reader.read(15)).positions, []);
	assert.equal(
		h.calls.some((c) => c.sql.includes("FROM quest.wallet_links")),
		false,
	);
});
for (const [name, mutate, pattern] of [
	[
		"stale watermark",
		(f) => {
			f.cursors[0].reconciled_through_slot = "14";
		},
		/reconciled/,
	],
	[
		"wrong program",
		(f) => {
			f.cursors[0].program_id = "other";
		},
		/pins/,
	],
	[
		"multiple cursors",
		(f) => {
			f.cursors.push({ ...f.cursors[0] });
		},
		/oversized/,
	],
	[
		"open non-LP conflict",
		(f) => {
			f.conflicts = [{ id: 1 }];
		},
		/conflict/,
	],
	[
		"different decoder",
		(f) => {
			f.events[0].decoder_version = "other";
		},
		/pinned/,
	],
	[
		"fractional block time",
		(f) => {
			f.events[0].block_exact = false;
		},
		/exact seconds/,
	],
	[
		"submillisecond link",
		(f) => {
			f.links[0].linked_exact = false;
		},
		/sub-millisecond/,
	],
	[
		"changed hash",
		(f) => {
			f.events[0].event_sha256 = "0".repeat(64);
		},
		/hash/,
	],
	[
		"unsupported close",
		(f) => {
			f.events[0].event_kind = "position_close";
			hashPosition(f.events[0]);
		},
		/pinned/,
	],
	[
		"malformed exact amount",
		(f) => {
			f.events[0].payload.liquidityRaw = "-1";
			hashPosition(f.events[0]);
		},
		/unsigned/,
	],
])
	test(`LP reader refuses ${name} and discards the connection`, async () => {
		const f = positionFixture();
		mutate(f);
		const h = harness(f, { position: true });
		await assert.rejects(h.reader.read(15), pattern);
		assert.equal(h.calls.at(-1).sql, "ROLLBACK");
		assert.ok(h.released[0] instanceof Error);
		assert.equal(
			h.calls.some((c) => c.sql === "COMMIT"),
			false,
		);
	});
test("LP source and history overflows fail rather than truncate", async () => {
	for (const field of ["events", "links"]) {
		const f = positionFixture();
		f[field].push(structuredClone(f[field][0]));
		await assert.rejects(
			harness(f, {
				position: true,
				config: { maxEvents: 1, maxLinks: 1 },
			}).reader.read(15),
			/oversized/,
		);
	}
});
test("LP reader discards on commit failure and preserves failure through failed rollback", async () => {
	const h = harness(positionFixture(), {
		position: true,
		failOn: "COMMIT",
		failRollback: true,
	});
	await assert.rejects(h.reader.read(15), /driver failure/);
	assert.equal(h.calls.at(-1).sql, "ROLLBACK");
	assert.ok(h.released[0] instanceof Error);
});

test("conservative link rounding is opt-in: a link start rounds up, and the strict default still refuses", async () => {
	const strict = fixture();
	strict.links[0].linked_exact = false;
	strict.links[0].unlinked_exact = false;
	await assert.rejects(
		harness(strict, { qualified: true }).reader.read(15),
		/sub-millisecond/,
	);
	const tolerant = fixture();
	tolerant.links[0].linked_exact = false;
	tolerant.links[0].unlinked_exact = false;
	const h = harness(tolerant, {
		qualified: true,
		config: { conservativeLinkTimes: true },
	});
	const result = await h.reader.read(15);
	assert.equal(result.state, "SYNTHETIC_DEVNET_SWAP_QUALIFICATION");
	const linkQuery = h.calls.find((c) => c.sql.includes("FROM quest.wallet_links"));
	assert.match(linkQuery.sql, /ceil\(EXTRACT\(EPOCH FROM link\.linked_at\)/);
	assert.match(linkQuery.sql, /trunc\(EXTRACT\(EPOCH FROM link\.unlinked_at\)/);
	const exact = harness(fixture(), { qualified: true });
	await exact.reader.read(15);
	assert.match(
		exact.calls.find((c) => c.sql.includes("FROM quest.wallet_links")).sql,
		/trunc\(EXTRACT\(EPOCH FROM link\.linked_at\)/,
	);
});

test("the link rounding mode must be a boolean", () => {
	assert.throws(
		() =>
			harness(fixture(), {
				qualified: true,
				config: { conservativeLinkTimes: "yes" },
			}),
		/link rounding mode/,
	);
});

// ---- LP section of the qualification reader ----
const LP_POOL = "6ybsFQhg2Rj9ceQM9T978fNArMNr7TRJkXGphJwaiknY";
const lpPolicy = () => ({
	...testPolicy(),
	lp: {
		featuredPools: [LP_POOL],
		minimumLpUsdCents: "1000",
		minimumDwellSeconds: 3600,
		valuationSource: "devnet-usdc-leg",
		valuationVersion: "devnet-usdc-leg-lp-v1",
	},
});
function lpFixture() {
	const f = fixture();
	f.clock = [{ captured_ms: String((start + 200) * 1000) }];
	f.lpEvents = [
		{ event_id: "2", event_kind: "liquidity_increase", pool_address: LP_POOL, position_address: "position-1" },
	];
	f.lpSnapshots = [
		{
			event_id: "2",
			position_address: "position-1",
			pool_address: LP_POOL,
			wallet,
			effective_ms: String((start + 100) * 1000),
			sequence: "0",
			value: "2000",
			valuation_source: "devnet-usdc-leg",
			valuation_version: "devnet-usdc-leg-lp-v1",
		},
	];
	return f;
}
test("qualification reader adds a checked LP section when an LP policy is configured", async () => {
	const f = lpFixture(); f.identity = contextFixture().identity;
	const h = harness(f, { qualified: true, policy: lpPolicy(), config: {
		includeSourceContext:true, environment:contextEnvironment,
		lpOwnershipReader:{ async read({endSlot}) { return {
			trust:"HISTORICAL_REPEATABLE_READ_SNAPSHOT", network:"DEVNET", campaignId:"snapshot-fixture",
			endSlot,coveredThroughSlot:endSlot,sourceContext:contextEnvironment,
			histories:[{wallet,links:[{passportId:passport,linkedAt:new Date(start*1000).toISOString(),unlinkedAt:null}]}],
			intervalPositions:[{positionAddress:"position-1",intervals:[{
				startsAtSeconds:start,endsAtSeconds:start+200,wallet,closed:false,liquidityRaw:"1000",
			}]}],
		}; } },
	} });
	const out = await h.reader.read(15);
	assert.equal(out.lp.state, "SYNTHETIC_DEVNET_LP_QUALIFICATION");
	assert.equal(out.lp.minimumDwellMs, 3_600_000);
	assert.equal(out.lp.ownershipCoverage,"HISTORICAL_COVERAGE");
	assert.deepEqual(out.lp.passports[0].pools[0].intervals, [
		[(start + 100) * 1000, (start + 200) * 1000],
	]);
	assert.equal(out.passports[0].qualifyingSwaps, 1);
	assert.equal(h.calls.at(-1).sql, "COMMIT");
});
test("missing historical ownership coverage makes LP unavailable but preserves swaps", async () => {
	const out = await harness(lpFixture(), { qualified:true,policy:lpPolicy() }).reader.read(15);
	assert.equal(out.lp,null);
	assert.equal(out.passports[0].qualifyingSwaps,1);
});
test("an LP event without its valuation snapshot makes only the LP section unavailable", async () => {
	const f = lpFixture();
	f.lpSnapshots = [];
	const out = await harness(f, { qualified: true, policy: lpPolicy() }).reader.read(15);
	assert.equal(out.lp, null);
	assert.equal(out.passports[0].qualifyingSwaps, 1);
});
test("without an LP policy the qualification shape is unchanged", async () => {
	const out = await harness(lpFixture(), { qualified: true }).reader.read(15);
	assert.equal(Object.hasOwn(out, "lp"), false);
});
test("an invalid LP policy is refused at construction", () => {
	const bad = lpPolicy();
	bad.lp.minimumDwellSeconds = -5;
	assert.throws(() => harness(fixture(), { qualified: true, policy: bad }));
});

// ---- Referral section of the qualification reader ----
const referralPolicy = () => ({ ...testPolicy(), referrals: true });
const FRIEND = "22222222-2222-4222-8222-222222222222";
test("qualification reader adds the referral list when the policy asks for it", async () => {
	const f = fixture();
	f.referralRows = [{ referrer: passport, referred: FRIEND, created_ms: String((start + 50) * 1000) }];
	const h = harness(f, { qualified: true, policy: referralPolicy() });
	const out = await h.reader.read(15);
	assert.deepEqual(out.referrals, [
		{ referrerPassportId: passport, referredPassportId: FRIEND, createdAtMs: (start + 50) * 1000 },
	]);
	assert.ok(h.calls.some((c) => c.sql === "SAVEPOINT referral_source"));
	assert.equal(h.calls.at(-1).sql, "COMMIT");
});
test("a referral source failure leaves referrals null and the swap read intact", async () => {
	const h = harness(fixture(), { qualified: true, policy: referralPolicy(), failOn: "FROM quest.referrals" });
	const out = await h.reader.read(15);
	assert.equal(out.referrals, null);
	assert.equal(out.passports[0].qualifyingSwaps, 1);
	assert.ok(h.calls.some((c) => c.sql === "ROLLBACK TO SAVEPOINT referral_source"));
	assert.equal(h.calls.at(-1).sql, "COMMIT");
});
test("without the referral policy the shape is unchanged; a non-boolean flag is refused", async () => {
	const out = await harness(fixture(), { qualified: true }).reader.read(15);
	assert.equal(Object.hasOwn(out, "referrals"), false);
	assert.throws(() => harness(fixture(), { qualified: true, policy: { ...testPolicy(), referrals: "yes" } }));
});
