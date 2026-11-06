import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintGenesisEvent } from "../../src/lib/genesis/eventFingerprint.ts";
import { projectPassportSwapQualification } from "./passport-swap-qualification.mjs";

const start = Date.parse("2026-10-01T00:00:00Z") / 1000;
const walletA = "1".repeat(32),
	walletB = "2".repeat(32);
const passport = "11111111-1111-4111-8111-111111111111";
function event(signature, kind = "swap", index = 0, overrides = {}) {
	const record = {
		campaignId: "qualification-fixture",
		cluster: "devnet",
		signature,
		instructionIndex: 0,
		eventIndex: index,
		eventKind: "swap",
		slot: 12,
		blockTimeSeconds: start + 100,
		wallet: walletA,
		poolAddress: "fixture-pool",
		positionAddress: null,
		payload: { instructionKind: kind },
		...overrides,
	};
	return {
		record,
		eventSha256: fingerprintGenesisEvent(record).eventSha256,
		decoderVersion: "fixture-decoder",
	};
}
function valuation(e, value = "500") {
	return {
		sourceKey: JSON.stringify(fingerprintGenesisEvent(e.record).identity),
		eventSha256: e.eventSha256,
		valueUsdCents: value,
		priceObservedAtSeconds: e.record.blockTimeSeconds - 10,
		valuationSource: "fixture-price",
		valuationVersion: "fixture-v1",
		priceEvidence: { fixture: true },
	};
}
function input(events = [event("one")]) {
	return {
		snapshot: {
			network: "DEVNET",
			campaignId: "qualification-fixture",
			decoderVersion: "fixture-decoder",
			startSlot: 10,
			computedThroughSlot: 15,
			nextSlot: 16,
			reconciledThroughSlot: 15,
			startsAtSeconds: start,
			endsAtSeconds: start + 3 * 86400,
			events,
			histories: [walletA, walletB].map((wallet) => ({
				wallet,
				links: [
					{
						network: "DEVNET",
						wallet,
						passportId: passport,
						linkedAt: new Date(start * 1000).toISOString(),
						unlinkedAt: null,
					},
				],
			})),
		},
		policy: {
			fixtureKind: "SYNTHETIC_DEVNET",
			network: "DEVNET",
			revision: 1,
			minimumSwapUsdCents: "500",
			maximumPriceAgeSeconds: 10,
			valuationSource: "fixture-price",
			valuationVersion: "fixture-v1",
		},
		valuations: events.map((e) => valuation(e)),
	};
}

test("threshold and price age boundaries are inclusive; output never authorizes awards", () => {
	const result = projectPassportSwapQualification(input());
	assert.equal(result.passports[0].qualifyingSwaps, 1);
	assert.equal(result.awardEligible, false);
	assert.equal("xp" in result, false);
});
test("two hop legs count as one action using smaller value, never their sum", () => {
	const f = input([
		event("route", "two_hop_swap", 0),
		event("route", "two_hop_swap", 1),
	]);
	f.valuations[1].valueUsdCents = "900";
	assert.equal(
		projectPassportSwapQualification(f).passports[0].qualifyingSwaps,
		1,
	);
	f.valuations[0].valueUsdCents = "499";
	assert.equal(
		projectPassportSwapQualification(f).passports[0].qualifyingSwaps,
		0,
	);
});
test("multiple linked wallets aggregate actions and unique UTC days", () => {
	const f = input([
		event("a"),
		event("b", "swap_v2", 0, { wallet: walletB }),
		event("c", "swap", 0, { blockTimeSeconds: start + 86400 }),
	]);
	const row = projectPassportSwapQualification(f).passports[0];
	assert.equal(row.qualifyingSwaps, 3);
	assert.equal(row.activeUtcDayIndices.length, 2);
});

test("two hop v2 uses the same one-action route accounting", () => {
	const f = input([
		event("route-v2", "two_hop_swap_v2", 0),
		event("route-v2", "two_hop_swap_v2", 1),
	]);
	assert.equal(
		projectPassportSwapQualification(f).passports[0].qualifyingSwaps,
		1,
	);
});
test("distinct outer instructions count separately in the same transaction", () => {
	const f = input([
		event("same"),
		event("same", "swap", 0, { instructionIndex: 1 }),
	]);
	assert.equal(
		projectPassportSwapQualification(f).passports[0].qualifyingSwaps,
		2,
	);
});
test("exact event and valuation replays and input order are deterministic", () => {
	const f = input([event("a"), event("b")]);
	const expected = projectPassportSwapQualification(f);
	f.snapshot.events.reverse();
	f.snapshot.events.push(structuredClone(f.snapshot.events[0]));
	f.valuations.reverse();
	f.valuations.push(structuredClone(f.valuations[0]));
	assert.deepEqual(projectPassportSwapQualification(f), expected);
});
test("pre-link and out-of-campaign events never produce qualifying days", () => {
	const f = input([
		event("before-link"),
		event("outside", "swap", 0, { blockTimeSeconds: start + 3 * 86400 }),
	]);
	f.snapshot.histories[0].links[0].linkedAt = new Date(
		(start + 101) * 1000,
	).toISOString();
	assert.deepEqual(projectPassportSwapQualification(f).passports, []);
});
test("large exact cents remain integer strings without floating point rounding", () => {
	const f = input();
	f.valuations[0].valueUsdCents = "900719925474099312345";
	assert.equal(
		projectPassportSwapQualification(f).passports[0].actions[0].valueUsdCents,
		"900719925474099312345",
	);
});

for (const [name, mutate, pattern] of [
	[
		"non-test policy",
		(f) => {
			f.policy.fixtureKind = "LIVE";
		},
		/synthetic/,
	],
	[
		"Mainnet policy",
		(f) => {
			f.policy.network = "MAINNET";
		},
		/synthetic/,
	],
	[
		"zero minimum",
		(f) => {
			f.policy.minimumSwapUsdCents = "0";
		},
		/positive/,
	],
	[
		"fractional cents",
		(f) => {
			f.valuations[0].valueUsdCents = "5.5";
		},
		/USD/,
	],
	[
		"overflow cents",
		(f) => {
			f.valuations[0].valueUsdCents = "9".repeat(39);
		},
		/USD/,
	],
	[
		"missing valuation",
		(f) => {
			f.valuations = [];
		},
		/complete/,
	],
	[
		"wrong source hash",
		(f) => {
			f.valuations[0].eventSha256 = "a".repeat(64);
		},
		/pins/,
	],
	[
		"unknown source",
		(f) => {
			f.valuations[0].sourceKey = "unknown";
		},
		/pins/,
	],
	[
		"unapproved price source",
		(f) => {
			f.valuations[0].valuationSource = "other";
		},
		/pins/,
	],
	[
		"wrong price version",
		(f) => {
			f.valuations[0].valuationVersion = "other";
		},
		/pins/,
	],
	[
		"future price",
		(f) => {
			f.valuations[0].priceObservedAtSeconds += 11;
		},
		/price time/,
	],
	[
		"stale price",
		(f) => {
			f.valuations[0].priceObservedAtSeconds -= 1;
		},
		/price time/,
	],
	[
		"empty proof",
		(f) => {
			f.valuations[0].priceEvidence = {};
		},
		/evidence/,
	],
	[
		"conflicting valuation replay",
		(f) => {
			f.valuations.push({ ...f.valuations[0], valueUsdCents: "501" });
		},
		/conflicting/,
	],
	[
		"incomplete two hop",
		(f) => {
			f.snapshot.events = [event("route", "two_hop_swap", 0)];
			f.valuations = f.snapshot.events.map((e) => valuation(e));
		},
		/route/,
	],
	[
		"unknown instruction kind",
		(f) => {
			f.snapshot.events = [event("x", "aggregator")];
			f.valuations = f.snapshot.events.map((e) => valuation(e));
		},
		/unsupported/,
	],
	[
		"invalid ordinal",
		(f) => {
			f.snapshot.events = [event("x", "swap", 1)];
			f.valuations = f.snapshot.events.map((e) => valuation(e));
		},
		/route/,
	],
	[
		"mixed route wallets",
		(f) => {
			f.snapshot.events = [
				event("route", "two_hop_swap", 0),
				event("route", "two_hop_swap", 1, { wallet: walletB }),
			];
			f.valuations = f.snapshot.events.map((e) => valuation(e));
		},
		/route/,
	],
	[
		"unreconciled source",
		(f) => {
			f.snapshot.reconciledThroughSlot = 14;
		},
		/reconciled/,
	],
])
	test(`qualification refuses ${name}`, () => {
		const f = input();
		mutate(f);
		assert.throws(() => projectPassportSwapQualification(f), pattern);
	});

test("each qualified action carries the pool of every route leg, in leg order", () => {
	const f = input([
		event("route-pools", "two_hop_swap_v2", 0, { poolAddress: "pool-first" }),
		event("route-pools", "two_hop_swap_v2", 1, { poolAddress: "pool-second" }),
		event("single"),
	]);
	const actions = projectPassportSwapQualification(f).passports[0].actions;
	const byLength = Object.fromEntries(actions.map((a) => [a.sourceKeys.length, a.poolAddresses]));
	assert.deepEqual(byLength[2], ["pool-first", "pool-second"]);
	assert.deepEqual(byLength[1], ["fixture-pool"]);
});
