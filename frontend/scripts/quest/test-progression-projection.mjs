import assert from "node:assert/strict";
import { test } from "node:test";
import { rebuildPassportProgress } from "./progression-projection.mjs";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function award(overrides = {}) {
	return {
		event_id: "1",
		network: "DEVNET",
		passport_id: P1,
		idempotency_key: "test-award-1",
		kind: "AWARD",
		source_event_key: "test:swap:1",
		qualification_key: "first_swap",
		rule_revision: 1,
		evidence_sha256: "a".repeat(64),
		season_key: "season_test",
		xp_delta: "250",
		reverses_event_id: null,
		...overrides,
	};
}

function xpReversal(overrides = {}) {
	return {
		event_id: "2",
		network: "DEVNET",
		passport_id: P1,
		idempotency_key: "test-reversal-1",
		kind: "REVERSAL",
		season_key: "season_test",
		xp_delta: "-250",
		reverses_event_id: "1",
		review_ref: "test-review",
		...overrides,
	};
}

function governance(overrides = {}) {
	return {
		event_id: "1",
		network: "DEVNET",
		passport_id: P1,
		idempotency_key: "test-governance-1",
		kind: "GOVERNANCE_EPOCH",
		epoch_id: "42",
		rule_revision: 1,
		evidence_sha256: "d".repeat(64),
		level_delta: "1",
		reverses_event_id: null,
		...overrides,
	};
}

function levelReversal(overrides = {}) {
	return {
		event_id: "2",
		network: "DEVNET",
		passport_id: P1,
		idempotency_key: "test-governance-reversal",
		kind: "REVERSAL",
		level_delta: "-1",
		reverses_event_id: "1",
		review_ref: "test-review",
		...overrides,
	};
}

function replay(xpEvents = [], levelEvents = [], passportIds = [P1, P2]) {
	return rebuildPassportProgress({
		network: "DEVNET",
		passportIds,
		xpEvents,
		levelEvents,
	});
}

test("rebuilds lifetime and season XP independently of bonus Levels", () => {
	const second = award({
		event_id: "2",
		idempotency_key: "test-award-2",
		source_event_key: "test:swap:2",
		season_key: "season_next",
		xp_delta: "500",
	});
	const result = replay([award(), second], [governance()]);
	const progress = result.passports.get(P1);
	assert.equal(progress.lifetimeXp, 750n);
	assert.deepEqual(
		[...progress.seasonXp],
		[
			["season_test", 250n],
			["season_next", 500n],
		],
	);
	assert.equal(progress.governanceBonusLevels, 1n);
	assert.equal(result.passports.get(P2).lifetimeXp, 0n);
	assert.equal(result.throughXpEventId, 2n);
});

test("full reviewed reversals rebuild to zero but retain source identity", () => {
	const result = replay(
		[award(), xpReversal()],
		[governance(), levelReversal()],
	);
	const progress = result.passports.get(P1);
	assert.equal(progress.lifetimeXp, 0n);
	assert.equal(progress.seasonXp.get("season_test"), 0n);
	assert.equal(progress.governanceBonusLevels, 0n);
	const reaward = award({
		event_id: "3",
		passport_id: P2,
		idempotency_key: "test-reaward",
	});
	assert.throws(
		() => replay([award(), xpReversal(), reaward]),
		/source qualification awarded twice/,
	);
});

test("refuses cross-Passport duplicate source awards even with a new revision", () => {
	const duplicate = award({
		event_id: "2",
		passport_id: P2,
		idempotency_key: "test-award-2",
		rule_revision: 2,
	});
	assert.throws(
		() => replay([award(), duplicate]),
		/source qualification awarded twice/,
	);
});

test("refuses partial, duplicate, cross-Passport, and cross-season reversals", () => {
	for (const bad of [
		xpReversal({ xp_delta: "-249" }),
		xpReversal({ passport_id: P2 }),
		xpReversal({ season_key: "season_next" }),
	]) {
		assert.throws(() => replay([award(), bad]), /reversal does not match/);
	}
	assert.throws(
		() =>
			replay([
				award(),
				xpReversal(),
				xpReversal({ event_id: "3", idempotency_key: "test-reversal-2" }),
			]),
		/reversal does not match/,
	);
});

test("one Passport gains at most one governance Level per epoch", () => {
	const duplicate = governance({
		event_id: "2",
		idempotency_key: "test-governance-2",
	});
	assert.throws(
		() => replay([], [governance(), duplicate]),
		/at most one Level/,
	);
	const otherPassport = governance({
		event_id: "2",
		passport_id: P2,
		idempotency_key: "test-governance-2",
	});
	assert.equal(
		replay([], [governance(), otherPassport]).passports.get(P2)
			.governanceBonusLevels,
		1n,
	);
});

test("requires full ordered Devnet ledgers and known Passports", () => {
	assert.throws(
		() =>
			rebuildPassportProgress({
				network: "MAINNET",
				passportIds: [P1],
				xpEvents: [],
				levelEvents: [],
			}),
		/complete Devnet ledger arrays/,
	);
	assert.throws(
		() => replay([award({ passport_id: P2 })], [], [P1]),
		/unknown Passport/,
	);
	assert.throws(
		() => replay([xpReversal(), award()]),
		/reversal does not match|append order/,
	);
	assert.throws(
		() => replay([award({ xp_delta: "250.0" })]),
		/canonical integer/,
	);
	assert.throws(
		() => replay([award({ evidence_sha256: null })]),
		/evidence hash/,
	);
	assert.throws(
		() => replay([], [governance({ evidence_sha256: null })]),
		/requires evidence/,
	);
});
