import assert from "node:assert/strict";
import { test } from "node:test";
import {
	compileQuestCalendar,
	previewWeeklyQuests,
} from "./quest-calendar.mjs";
import { createQuestCalendarExample } from "./quest-calendar-example.mjs";
import { buildWeeklyQuestFacts } from "./quest-calendar-facts.mjs";

const set = compileQuestCalendar(createQuestCalendarExample()).weeks[1],
	passportId = "33333333-3333-4333-8333-333333333333",
	other = "44444444-4444-4444-8444-444444444444";
const computedAt = "2027-01-13T23:59:59.999Z";
const event = (sourceKey, observedAt, kind = "SWAP", extra = {}) => ({
	sourceKey,
	observedAt,
	kind,
	passportId,
	poolAddress:
		kind === "FEATURED_POOL_JOIN" ? "11111111111111111111111111111111" : null,
	qualified: true,
	...extra,
});
const build = (events, complete = true) =>
	buildWeeklyQuestFacts({
		set,
		passportId,
		computedAt,
		evidence: {
			network: "DEVNET",
			fixtureKind: "SYNTHETIC_DEVNET",
			complete,
			events,
		},
	});
test("epoch facts exclude prior-epoch swaps and other Passports without losing the first boundary event", () => {
	const f = build([
		event("prior", "2027-01-06T23:59:59.999Z"),
		event("first", set.startsAt),
		event("second", "2027-01-08T00:00:00.000Z"),
		event("same-day", "2027-01-08T01:00:00.000Z"),
		event("other", "2027-01-08T02:00:00.000Z", "SWAP", { passportId: other }),
		event("failed", "2027-01-08T03:00:00.000Z", "SWAP", { qualified: false }),
	]);
	assert.equal(f.metrics.qualifyingSwaps, 3);
	assert.equal(f.metrics.activeTradingDays, 2);
	assert.equal(
		previewWeeklyQuests({ set, nowMs: Date.parse(computedAt), facts: f })
			.awardEligible,
		false,
	);
});
test("distinct pools and qualified referrals count once per accepted source", () => {
	const f = build([
		event("lp-1", set.startsAt, "FEATURED_POOL_JOIN"),
		event("lp-2", set.startsAt, "FEATURED_POOL_JOIN"),
		event("trader", set.startsAt, "TRADER_REFERRAL"),
		event("lp-ref", set.startsAt, "LP_REFERRAL"),
	]);
	assert.equal(f.metrics.featuredPoolsJoined, 1);
	assert.equal(f.metrics.qualifiedTraderReferrals, 1);
	assert.equal(f.metrics.qualifiedLpReferrals, 1);
});
test("incomplete evidence returns unknown progress, never zero or completed", () => {
	assert.ok(
		Object.values(build([event("one", set.startsAt)], false).metrics).every(
			(v) => v === null,
		),
	);
});
test("source replay across kinds and conflicting attribution are refused", () => {
	assert.throws(
		() =>
			build([
				event("same", set.startsAt),
				event("same", set.startsAt, "TRADER_REFERRAL"),
			]),
		/duplicate/,
	);
	assert.throws(
		() =>
			build([
				event("same", set.startsAt),
				event("same", set.startsAt, "SWAP", { passportId: other }),
			]),
		/duplicate/,
	);
});
test("future and expired epoch facts cannot count", () => {
	assert.throws(() => build([event("end", set.endsAt)]), /future/);
	assert.throws(
		() =>
			buildWeeklyQuestFacts({
				set,
				passportId,
				computedAt: set.endsAt,
				evidence: {
					network: "DEVNET",
					fixtureKind: "SYNTHETIC_DEVNET",
					complete: true,
					events: [],
				},
			}),
		/active epoch/,
	);
});
test("malformed pools, source identities and unqualified invented fields refuse", () => {
	assert.throws(() =>
		build([
			event("pool", set.startsAt, "FEATURED_POOL_JOIN", {
				poolAddress: "invalid",
			}),
		]),
	);
	assert.throws(() => build([event("bad source", set.startsAt)]));
	assert.throws(() =>
		build([event("bad", set.startsAt, "SWAP", { extra: true })]),
	);
});
