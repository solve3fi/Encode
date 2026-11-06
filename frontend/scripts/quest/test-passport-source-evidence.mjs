import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintGenesisEvent } from "../../src/lib/genesis/eventFingerprint.ts";
import { projectPassportSwapEvidence } from "./passport-source-evidence.mjs";

const walletA = "1".repeat(32);
const walletB = "2".repeat(32);
const passportA = "11111111-1111-4111-8111-111111111111";
const passportB = "22222222-2222-4222-8222-222222222222";
const start = Date.parse("2026-10-01T00:00:00Z") / 1000;
const end = start + 3 * 86400;
const iso = (value) => new Date(value * 1000).toISOString();
const link = (
	wallet,
	passportId = passportA,
	linkedAt = start,
	unlinkedAt = null,
) => ({
	network: "DEVNET",
	wallet,
	passportId,
	linkedAt: iso(linkedAt),
	unlinkedAt: unlinkedAt === null ? null : iso(unlinkedAt),
});
function event(
	signature,
	wallet = walletA,
	time = start + 3600,
	overrides = {},
) {
	const record = {
		campaignId: "fixture-campaign",
		cluster: "devnet",
		signature,
		instructionIndex: 0,
		eventIndex: 0,
		eventKind: "swap",
		slot: 12,
		blockTimeSeconds: time,
		wallet,
		poolAddress: "fixture-pool",
		positionAddress: null,
		payload: { inputRaw: "100", outputRaw: "90" },
		...overrides,
	};
	return {
		record,
		decoderVersion: "fixture-decoder",
		eventSha256: fingerprintGenesisEvent(record).eventSha256,
	};
}
function input() {
	return {
		network: "DEVNET",
		campaignId: "fixture-campaign",
		decoderVersion: "fixture-decoder",
		startSlot: 10,
		computedThroughSlot: 15,
		nextSlot: 16,
		reconciledThroughSlot: 15,
		startsAtSeconds: start,
		endsAtSeconds: end,
		events: [event("swap-a"), event("swap-b", walletB)],
		histories: [
			{ wallet: walletA, links: [link(walletA)] },
			{ wallet: walletB, links: [link(walletB)] },
		],
	};
}

test("two linked wallets aggregate source evidence and count a shared UTC day once", () => {
	const result = projectPassportSwapEvidence(input());
	assert.equal(result.state, "TEST_ONLY_SOURCE_EVIDENCE");
	assert.equal(result.passports.length, 1);
	assert.equal(result.passports[0].finalizedSwapEvents, 2);
	assert.deepEqual(result.passports[0].activeUtcDayIndices, [
		Math.floor(start / 86400),
	]);
	assert.equal("xp" in result.passports[0], false);
});

test("exact replays and input order leave source evidence unchanged", () => {
	const f = input();
	const expected = projectPassportSwapEvidence(f);
	f.events = [f.events[1], f.events[0], structuredClone(f.events[0])];
	f.histories.reverse();
	assert.deepEqual(projectPassportSwapEvidence(f), expected);
});

test("different event ordinals stay distinct without becoming a reward or swap-action counter", () => {
	const f = input();
	f.events = [
		event("two-hop", walletA, start + 3600, { eventIndex: 0 }),
		event("two-hop", walletA, start + 3600, { eventIndex: 1 }),
	];
	assert.equal(
		projectPassportSwapEvidence(f).passports[0].finalizedSwapEvents,
		2,
	);
});

test("pre-link and unlinked-gap events are excluded; historical active links still attribute after unlink", () => {
	const f = input();
	f.histories[0].links = [
		link(walletA, passportA, start + 100, start + 300),
		link(walletA, passportA, start + 500),
	];
	f.events = [
		event("before", walletA, start + 99),
		event("during", walletA, start + 100),
		event("end", walletA, start + 300),
		event("gap", walletA, start + 499),
		event("relinked", walletA, start + 500),
	];
	const result = projectPassportSwapEvidence(f);
	assert.equal(result.passports[0].finalizedSwapEvents, 2);
	assert.equal(result.unattributedSources.length, 3);
});

test("explicit empty history cannot backfill and a missing snapshot entry fails closed", () => {
	const f = input();
	f.histories[0].links = [];
	assert.equal(projectPassportSwapEvidence(f).unattributedSources.length, 1);
	f.histories.shift();
	assert.throws(() => projectPassportSwapEvidence(f), /history is missing/);
});

test("campaign window uses inclusive start and exclusive end", () => {
	const f = input();
	f.events = [
		event("before", walletA, start - 1),
		event("start", walletA, start),
		event("end", walletA, end),
	];
	const result = projectPassportSwapEvidence(f);
	assert.equal(result.passports[0].finalizedSwapEvents, 1);
	assert.equal(result.outsideCampaignSources.length, 2);
});

test("separate Passports receive separate sources and deterministic ordering", () => {
	const f = input();
	f.histories[1].links = [link(walletB, passportB)];
	f.events.push(event("next-day", walletA, start + 86400));
	const result = projectPassportSwapEvidence(f);
	assert.deepEqual(
		result.passports.map((row) => [row.passportId, row.finalizedSwapEvents]),
		[
			[passportA, 2],
			[passportB, 1],
		],
	);
	assert.equal(result.passports[0].activeUtcDayIndices.length, 2);
});

test("same source identity with a different wallet or payload is refused before Passport filtering", () => {
	const f = input();
	f.events.push(event("swap-a", walletB));
	assert.throws(() => projectPassportSwapEvidence(f), /conflicting replay/);
	f.events = [
		event("same"),
		event("same", walletA, start + 3600, { payload: { inputRaw: "999" } }),
	];
	assert.throws(() => projectPassportSwapEvidence(f), /conflicting replay/);
});

for (const [name, mutate, pattern] of [
	[
		"Mainnet override",
		(f) => {
			f.network = "MAINNET";
		},
		/Devnet/,
	],
	[
		"wrong chain event",
		(f) => {
			f.events[0] = event("x", walletA, start, { cluster: "mainnet-beta" });
		},
		/pinned/,
	],
	[
		"wrong campaign event",
		(f) => {
			f.events[0] = event("x", walletA, start, { campaignId: "other" });
		},
		/pinned/,
	],
	[
		"wrong decoder",
		(f) => {
			f.events[0].decoderVersion = "wrong";
		},
		/pinned/,
	],
	[
		"unreconciled range",
		(f) => {
			f.reconciledThroughSlot = 14;
		},
		/reconciled/,
	],
	[
		"indexer lag",
		(f) => {
			f.nextSlot = 15;
		},
		/reconciled/,
	],
	[
		"event beyond watermark",
		(f) => {
			f.events[0] = event("x", walletA, start, { slot: 16 });
		},
		/pinned/,
	],
	[
		"tampered hash",
		(f) => {
			f.events[0].eventSha256 = "a".repeat(64);
		},
		/hash/,
	],
	[
		"duplicate history",
		(f) => {
			f.histories.push(f.histories[0]);
		},
		/duplicate/,
	],
	[
		"cross-Passport relink",
		(f) => {
			f.histories[0].links = [
				link(walletA, passportA, start, start + 100),
				link(walletA, passportB, start + 200),
			];
		},
		/changes Passport/,
	],
	[
		"overlapping history",
		(f) => {
			f.histories[0].links.push(link(walletA, passportA, start + 100));
		},
		/overlapping/,
	],
	[
		"non-swap input",
		(f) => {
			f.events[0] = event("x", walletA, start, { eventKind: "position_open" });
		},
		/pinned/,
	],
]) {
	test(`source projection rejects ${name}`, () => {
		const f = input();
		mutate(f);
		assert.throws(() => projectPassportSwapEvidence(f), pattern);
	});
}
