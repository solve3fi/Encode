import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Message } from "@solana/web3.js";
import { fingerprintGenesisEvent } from "../../src/lib/genesis/eventFingerprint.ts";
import { decodeVerifiedPositionTransactions } from "../../src/lib/genesis/positionDecoder.ts";
import { projectPassportPositionEvidence } from "./passport-position-evidence.mjs";

const fixture = JSON.parse(
	readFileSync(
		new URL(
			"../../tests/fixtures/genesis-finalized-position-open.json",
			import.meta.url,
		),
	),
);
const records = decodeVerifiedPositionTransactions({
	campaignId: "genesis-devnet",
	cluster: "devnet",
	programId: "28XTA3cRFetDEdPF1DRTuPWdqFKWbScWMRG94N2u4Tas",
	slot: fixture.slot,
	blockTimeSeconds: fixture.blockTime,
	transactions: [
		{
			transaction: {
				signatures: fixture.transaction.signatures,
				message: new Message(fixture.transaction.message),
			},
			meta: fixture.meta,
		},
	],
});
const passportA = "11111111-1111-4111-8111-111111111111";
const passportB = "22222222-2222-4222-8222-222222222222";
const walletB = "11111111111111111111111111111111";
const iso = (seconds) => new Date(seconds * 1000).toISOString();
function wrap(record) {
	return {
		record,
		decoderVersion: "fixture-position-v1",
		eventSha256: fingerprintGenesisEvent(record).eventSha256,
	};
}
function input() {
	return {
		network: "DEVNET",
		campaignId: "genesis-devnet",
		decoderVersion: "fixture-position-v1",
		startSlot: fixture.slot,
		computedThroughSlot: fixture.slot + 10,
		nextSlot: fixture.slot + 11,
		reconciledThroughSlot: fixture.slot + 10,
		startsAtSeconds: fixture.blockTime,
		endsAtSeconds: fixture.blockTime + 86400,
		events: records.map((row) => wrap(structuredClone(row))),
		histories: [
			{
				wallet: records[0].wallet,
				links: [
					{
						network: "DEVNET",
						wallet: records[0].wallet,
						passportId: passportA,
						linkedAt: iso(fixture.blockTime),
						unlinkedAt: null,
					},
				],
			},
		],
	};
}
function rehash(f) {
	f.events = f.events.map((event) => wrap(event.record));
}
const observations = (f) =>
	projectPassportPositionEvidence(f).positions[0].observations;

test("saved finalized position open/deposit yields hash-bound transaction observations only", () => {
	const result = projectPassportPositionEvidence(input());
	assert.equal(result.state, "TEST_ONLY_POSITION_OBSERVATIONS");
	assert.equal(result.awardEligible, false);
	assert.equal(result.ownershipCoverage, "TRANSACTION_ONLY");
	assert.equal(result.positions.length, 1);
	assert.deepEqual(
		result.positions[0].observations.map((row) => row.eventKind),
		["position_open", "liquidity_increase"],
	);
	assert.ok(
		result.positions[0].observations.every(
			(row) => row.passportId === passportA,
		),
	);
	assert.equal(
		result.positions[0].observations[1].liquidityRaw,
		records[1].payload.liquidityRaw,
	);
	assert.equal("valueUsdCents" in result.positions[0], false);
	assert.equal("qualifyingMilliseconds" in result, false);
});

test("exact replay and reordered input cannot multiply or change observations", () => {
	const f = input();
	const expected = projectPassportPositionEvidence(f);
	f.events.push(structuredClone(f.events[0]));
	f.events.reverse();
	assert.deepEqual(projectPassportPositionEvidence(f), expected);
});

test("missing open/baseline does not invent zero liquidity or continuity", () => {
	const f = input();
	f.events.shift();
	const result = projectPassportPositionEvidence(f);
	assert.equal(result.positions[0].observations.length, 1);
	assert.equal(result.ownershipCoverage, "TRANSACTION_ONLY");
	assert.equal("liquidityBalanceRaw" in result.positions[0], false);
});

test("different observed owners resolve separately without claiming a transfer time", () => {
	const f = input();
	f.events[1].record.wallet = walletB;
	rehash(f);
	f.histories.push({
		wallet: walletB,
		links: [
			{
				network: "DEVNET",
				wallet: walletB,
				passportId: passportB,
				linkedAt: iso(fixture.blockTime),
				unlinkedAt: null,
			},
		],
	});
	assert.deepEqual(
		observations(f).map((row) => row.passportId),
		[passportA, passportB],
	);
	assert.equal("transferredAtSeconds" in observations(f)[1], false);
});

test("campaign and half-open historical link bounds apply independently", () => {
	const f = input();
	f.histories[0].links[0].unlinkedAt = iso(fixture.blockTime + 10);
	f.events[0].record.blockTimeSeconds = fixture.blockTime - 1;
	f.events[1].record.blockTimeSeconds = fixture.blockTime + 10;
	rehash(f);
	assert.deepEqual(
		observations(f).map((row) => row.attributionState),
		["OUTSIDE_CAMPAIGN", "UNLINKED"],
	);
	f.events[1].record.blockTimeSeconds = fixture.blockTime + 9;
	rehash(f);
	assert.equal(observations(f)[1].passportId, passportA);
	f.events[1].record.blockTimeSeconds = f.endsAtSeconds;
	rehash(f);
	assert.equal(observations(f)[1].attributionState, "OUTSIDE_CAMPAIGN");
});

test("explicit empty history excludes credit; missing history refuses even outside campaign", () => {
	const f = input();
	f.histories[0].links = [];
	assert.ok(observations(f).every((row) => row.passportId === null));
	f.startsAtSeconds += 100;
	f.histories = [];
	assert.throws(() => projectPassportPositionEvidence(f), /history missing/);
});

test("conflicting source replay refuses globally before link filtering", () => {
	const f = input();
	f.histories[0].links = [];
	const duplicate = structuredClone(f.events[1].record);
	duplicate.payload.liquidityRaw = "1";
	f.events.push(wrap(duplicate));
	assert.throws(() => projectPassportPositionEvidence(f), /conflicting replay/);
});

test("exact u128/u64 boundary values survive without Number conversion", () => {
	const f = input();
	f.events[1].record.payload.liquidityRaw = ((1n << 128n) - 1n).toString();
	f.events[1].record.payload.tokenAAmountRaw = ((1n << 64n) - 1n).toString();
	rehash(f);
	assert.equal(observations(f)[1].liquidityRaw, ((1n << 128n) - 1n).toString());
});

test("supported decrease/v2 instructions remain distinct observations", () => {
	const f = input();
	const record = f.events[1].record;
	record.eventKind = record.payload.kind = "liquidity_decrease";
	record.payload.instructionKind = "decrease_liquidity_v2";
	rehash(f);
	assert.equal(observations(f)[1].eventKind, "liquidity_decrease");
});

for (const [name, mutate, pattern, hash = true] of [
	[
		"Mainnet",
		(f) => {
			f.network = "MAINNET";
		},
		/Devnet/,
	],
	[
		"wrong campaign",
		(f) => {
			f.events[0].record.campaignId = "other";
		},
		/pinned/,
	],
	[
		"wrong decoder",
		(f) => {
			f.events[0].decoderVersion = "other";
		},
		/pinned/,
		false,
	],
	[
		"unreconciled range",
		(f) => {
			f.reconciledThroughSlot--;
		},
		/reconciled/,
	],
	[
		"next slot boundary",
		(f) => {
			f.nextSlot = f.computedThroughSlot;
		},
		/reconciled/,
	],
	[
		"fractional slot",
		(f) => {
			f.events[0].record.slot += 0.5;
		},
		/identity/,
		false,
	],
	[
		"wrong hash",
		(f) => {
			f.events[0].eventSha256 = "0".repeat(64);
		},
		/hash/,
		false,
	],
	[
		"unsupported close",
		(f) => {
			f.events[0].record.eventKind = "position_close";
		},
		/pinned/,
	],
	[
		"swap mixed in",
		(f) => {
			f.events[0].record.eventKind = "swap";
		},
		/pinned/,
	],
	[
		"nonzero event ordinal",
		(f) => {
			f.events[0].record.eventIndex = 1;
		},
		/payload/,
	],
	[
		"kind mismatch",
		(f) => {
			f.events[1].record.payload.kind = "liquidity_decrease";
		},
		/payload/,
	],
	[
		"instruction mismatch",
		(f) => {
			f.events[1].record.payload.instructionKind = "decrease_liquidity";
		},
		/payload/,
	],
	[
		"payload position mismatch",
		(f) => {
			f.events[0].record.payload.positionAddress = walletB;
		},
		/payload/,
	],
	[
		"position changes pool",
		(f) => {
			f.events[1].record.poolAddress = f.events[1].record.payload.poolAddress =
				walletB;
		},
		/identity changed/,
	],
	[
		"position changes ticks",
		(f) => {
			f.events[1].record.payload.tickLowerIndex++;
		},
		/identity changed/,
	],
	[
		"invalid tick order",
		(f) => {
			f.events[0].record.payload.tickUpperIndex =
				f.events[0].record.payload.tickLowerIndex;
		},
		/payload/,
	],
	[
		"invalid address",
		(f) => {
			f.events[0].record.poolAddress = f.events[0].record.payload.poolAddress =
				"bad";
		},
		/public key|address/i,
	],
	[
		"numeric amount",
		(f) => {
			f.events[1].record.payload.liquidityRaw = 1;
		},
		/unsigned/,
	],
	[
		"negative amount",
		(f) => {
			f.events[1].record.payload.liquidityRaw = "-1";
		},
		/unsigned/,
	],
	[
		"leading zero",
		(f) => {
			f.events[1].record.payload.liquidityRaw = "01";
		},
		/unsigned/,
	],
	[
		"u128 overflow",
		(f) => {
			f.events[1].record.payload.liquidityRaw = (1n << 128n).toString();
		},
		/unsigned/,
	],
	[
		"u64 overflow",
		(f) => {
			f.events[1].record.payload.tokenAAmountRaw = (1n << 64n).toString();
		},
		/unsigned/,
	],
	[
		"missing amount",
		(f) => {
			delete f.events[1].record.payload.tokenATransferFeeRaw;
		},
		/unsigned/,
	],
	[
		"open claims deposit",
		(f) => {
			f.events[0].record.payload.liquidityRaw = "1";
		},
		/open event/,
	],
	[
		"duplicate history",
		(f) => {
			f.histories.push(structuredClone(f.histories[0]));
		},
		/history/,
	],
	[
		"history reassigns Passport",
		(f) => {
			const old = f.histories[0].links[0];
			old.unlinkedAt = iso(fixture.blockTime + 1);
			f.histories[0].links.push({
				...old,
				passportId: passportB,
				linkedAt: old.unlinkedAt,
				unlinkedAt: null,
			});
		},
		/ownership/,
	],
	[
		"event limit",
		(f) => {
			f.events = Array(10001).fill(f.events[0]);
		},
		/bounded/,
	],
	[
		"history limit",
		(f) => {
			f.histories = Array(10001).fill(f.histories[0]);
		},
		/bounded/,
	],
	[
		"link limit",
		(f) => {
			f.histories[0].links = Array(20001).fill(f.histories[0].links[0]);
		},
		/limit/,
	],
])
	test(`refuses ${name}`, () => {
		const f = input();
		mutate(f);
		if (hash) rehash(f);
		assert.throws(() => projectPassportPositionEvidence(f), pattern);
	});

test("distinct duplicate position-open identity refuses", () => {
	const f = input();
	const open = structuredClone(f.events[0].record);
	open.signature += "other";
	f.events.push(wrap(open));
	assert.throws(
		() => projectPassportPositionEvidence(f),
		/repeated position open/,
	);
});

test("empty snapshot has no inferred positions", () => {
	const f = input();
	f.events = [];
	f.histories = [];
	assert.deepEqual(projectPassportPositionEvidence(f).positions, []);
});

test("submillisecond link precision is refused instead of silently truncated", () => {
	const f = input();
	f.histories[0].links[0].linkedAt = iso(fixture.blockTime).replace(
		".000Z",
		".000001Z",
	);
	assert.throws(() => projectPassportPositionEvidence(f), /millisecond/);
});

test("end-before-start campaign and events beyond pinned range are refused", () => {
	const f = input();
	f.endsAtSeconds = f.startsAtSeconds;
	assert.throws(() => projectPassportPositionEvidence(f), /campaign window/);
	const other = input();
	other.events[0].record.slot = other.computedThroughSlot + 1;
	rehash(other);
	assert.throws(() => projectPassportPositionEvidence(other), /pinned/);
});
