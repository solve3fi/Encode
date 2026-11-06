import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	calendarHash,
	communityEntitlementKey,
	compileQuestCalendar,
	previewCommunityEntitlements,
	previewQuestCalendar,
	previewWeeklyQuests,
	validateCalendarRevision,
	verifyCommunityProof,
	verifyWeeklySet,
	WEEKLY_METRICS,
} from "./quest-calendar.mjs";
import { createQuestCalendarExample } from "./quest-calendar-example.mjs";

const ms = (v) => Date.parse(v),
	iso = (v) => new Date(v).toISOString();
const passport = "33333333-3333-4333-8333-333333333333",
	manifestSha256 = "a".repeat(64);
const plan = () => createQuestCalendarExample();
const goal = () => compileQuestCalendar(plan()).goals[0];
const proof = () => ({
	schemaVersion: 1,
	network: "DEVNET",
	fixtureKind: "SYNTHETIC_DEVNET",
	manifestSha256,
	valuationVersion: "synthetic-price-v1",
	observedAt: "2027-01-07T00:00:00.000Z",
	sourceKey: "synthetic-tvl-1",
	pools: [
		{
			poolAddress: "11111111111111111111111111111111",
			tvlUsdCents: "50000000",
		},
	],
});
const check = (p = proof(), g = goal(), nowMs = ms(p.observedAt)) =>
	verifyCommunityProof({ goal: g, proof: p, manifestSha256, nowMs });

test("future edits preserve already-started weekly and monthly history", () => {
	const previous = plan(),
		next = plan(),
		nowMs = ms("2027-01-07T00:00:00.000Z");
	const t = { ...next.templates[0], id: "future-swap", testXp: 800 };
	next.templates.push(t);
	next.weeks[2].questIds[0] = t.id;
	next.communityGoals[1].testXp = 900;
	validateCalendarRevision({ previous, next, nowMs });
	assert.equal(
		compileQuestCalendar(previous).weeks[0].setSha256,
		compileQuestCalendar(next).weeks[0].setSha256,
	);
	next.weeks[1].questIds[0] = t.id;
	assert.throws(
		() => validateCalendarRevision({ previous, next, nowMs }),
		/started weekly/,
	);
});
test("template edits cannot alter historical XP or active community goals", () => {
	const previous = plan(),
		next = plan(),
		nowMs = ms("2027-01-07T00:00:00.000Z");
	next.templates[0].testXp++;
	assert.throws(
		() => validateCalendarRevision({ previous, next, nowMs }),
		/started weekly/,
	);
	const monthEdit = plan();
	monthEdit.communityGoals[0].testXp++;
	assert.throws(
		() => validateCalendarRevision({ previous, next: monthEdit, nowMs }),
		/started community/,
	);
	const deleted = plan();
	deleted.communityGoals.shift();
	assert.throws(
		() => validateCalendarRevision({ previous, next: deleted, nowMs }),
		/started community/,
	);
});
test("no retroactive community insertion or moving a future goal into the past", () => {
	const previous = plan(),
		next = plan(),
		nowMs = ms("2027-01-07T00:00:00.000Z");
	next.communityGoals.push({ ...next.communityGoals[0], id: "retroactive" });
	assert.throws(
		() => validateCalendarRevision({ previous, next, nowMs }),
		/retroactive/,
	);
	const moved = plan();
	moved.communityGoals[1].startsAt = "2027-01-06T00:00:00.000Z";
	assert.throws(
		() => validateCalendarRevision({ previous, next: moved, nowMs }),
		/retroactive/,
	);
	const shortened = plan();
	shortened.weeks.pop();
	shortened.weekCount--;
	assert.throws(
		() => validateCalendarRevision({ previous, next: shortened, nowMs }),
		/horizon/,
	);
});
test("full year has exactly three quests per epoch and twelve independent monthly goals", () => {
	const c = compileQuestCalendar(plan());
	assert.equal(c.weekCount, 53);
	assert.equal(c.goals.length, 12);
	for (const w of c.weeks) {
		assert.equal(w.quests.length, 3);
		assert.equal(new Date(w.startsAt).getUTCDay(), 4);
		assert.equal(ms(w.endsAt) - ms(w.startsAt), 604800000);
		assert.equal(w.startsAt.slice(11), "00:00:00.000Z");
	}
	assert.equal(c.goals[0].startsAt, "2027-01-01T00:00:00.000Z");
	assert.equal(c.goals[0].endsAt, "2027-02-01T00:00:00.000Z");
});
test("every supported year covers January 1 through the following January 1, including leap Wednesday", () => {
	for (let year = 2020; year <= 2100; year++) {
		const c = compileQuestCalendar(createQuestCalendarExample(year));
		assert.ok(ms(c.startsAt) <= Date.UTC(year, 0, 1));
		assert.ok(ms(c.endsAt) >= Date.UTC(year + 1, 0, 1));
		assert.ok(c.weekCount >= 52 && c.weekCount <= 54);
	}
	assert.equal(createQuestCalendarExample(2020).weekCount, 54);
});
test("weekly boundary helper agrees with the existing frontend Thursday convention", () => {
	const source = readFileSync(
		new URL("../../src/utils/epoch.ts", import.meta.url),
		"utf8",
	);
	const fn = source
		.slice(
			source.indexOf("export const getNextEpochBoundary"),
			source.indexOf("export const INITIAL_WEEKLY_EMISSIONS"),
		)
		.replace("export const", "const")
		.replace(": number =>", " =>");
	const boundary = Function(
		`const EPOCH_LENGTH_MS=604800000; ${fn}; return getNextEpochBoundary;`,
	)();
	for (const w of compileQuestCalendar(plan()).weeks) {
		assert.equal(boundary(ms(w.startsAt)), ms(w.endsAt));
		assert.equal(boundary(ms(w.endsAt) - 1), ms(w.endsAt));
	}
});
test("Thursday midnight expires previous set and activates next; Monday does not reset", () => {
	const c = compileQuestCalendar(plan()),
		first = c.weeks[0],
		next = c.weeks[1];
	assert.equal(
		previewQuestCalendar({ plan: plan(), nowMs: ms(next.startsAt) - 1 }).weekly
			.startsAt,
		first.startsAt,
	);
	assert.equal(
		previewQuestCalendar({ plan: plan(), nowMs: ms(next.startsAt) }).weekly
			.startsAt,
		next.startsAt,
	);
	assert.equal(
		previewWeeklyQuests({ set: first, nowMs: ms(next.startsAt) }).state,
		"EXPIRED",
	);
	assert.equal(
		previewQuestCalendar({
			plan: plan(),
			nowMs: ms("2027-01-04T00:00:00.000Z"),
		}).weekly.startsAt,
		first.startsAt,
	);
});
test("year end never recycles old sets; scheduled sets expose no progress", () => {
	const c = compileQuestCalendar(plan());
	assert.equal(
		previewQuestCalendar({ plan: plan(), nowMs: ms(c.endsAt) }).weekly,
		null,
	);
	assert.equal(
		previewQuestCalendar({ plan: plan(), nowMs: ms(c.startsAt) - 1 }).weekly,
		null,
	);
	assert.ok(
		previewWeeklyQuests({
			set: c.weeks[0],
			nowMs: ms(c.startsAt) - 1,
		}).quests.every((q) => q.progress === null && q.status === "SCHEDULED"),
	);
});
test("DST changes leave the Thursday UTC boundary unchanged", () => {
	const c = compileQuestCalendar(plan());
	for (const start of ["2027-03-11", "2027-11-04"])
		assert.equal(
			c.weeks.find((w) => w.startsOn === start).endsAt,
			iso(ms(`${start}T00:00:00.000Z`) + 604800000),
		);
});
for (const mutate of [
	(p) => (p.startsOn = "2027-01-04"),
	(p) => (p.timezone = "America/Chicago"),
	(p) => (p.weekCount = 54),
	(p) => p.weeks.pop(),
	(p) => (p.weeks[1].startsOn = p.weeks[0].startsOn),
	(p) => p.weeks[0].questIds.pop(),
	(p) => (p.weeks[0].questIds[1] = p.weeks[0].questIds[0]),
	(p) => (p.weeks[0].questIds[0] = "unknown"),
	(p) => (p.templates[0].testXp = 0),
	(p) => (p.templates[0].metric = "lifetimeXp"),
	(p) => (p.network = "MAINNET"),
	(p) => (p.fixtureKind = "LIVE"),
	(p) => (p.dailyQuests = []),
	(p) => (p.communityGoals[0].endsAt = p.communityGoals[0].startsAt),
	(p) => (p.communityGoals[0].targetUsdCents = "050000000"),
]) {
	test(`reject malformed plan ${mutate.toString()}`, () => {
		const p = plan();
		mutate(p);
		assert.throws(() => compileQuestCalendar(p));
	});
}
test("stored set is hash-bound including content and stable occurrence keys", () => {
	const set = compileQuestCalendar(plan()).weeks[0];
	assert.deepEqual(verifyWeeklySet(set), set);
	const changed = structuredClone(set);
	changed.quests[0].testXp++;
	assert.throws(() => verifyWeeklySet(changed));
	delete changed.setSha256;
	changed.setSha256 = calendarHash(changed);
	assert.notEqual(changed.setSha256, set.setSha256);
	const changedKey = structuredClone(set);
	changedKey.quests[0].instanceKey = "b".repeat(64);
	const { setSha256, ...body } = changedKey;
	changedKey.setSha256 = calendarHash(body);
	assert.throws(() => verifyWeeklySet(changedKey));
});
test("only period-scoped facts count and unavailable metrics never fabricate completion", () => {
	const set = compileQuestCalendar(plan()).weeks[0],
		nowMs = ms(set.startsAt) + 1000;
	const facts = {
		network: "DEVNET",
		fixtureKind: "SYNTHETIC_DEVNET",
		passportId: passport,
		startsAt: set.startsAt,
		endsAt: set.endsAt,
		computedAt: iso(nowMs),
		metrics: Object.fromEntries(WEEKLY_METRICS.map((m) => [m, null])),
	};
	assert.ok(
		previewWeeklyQuests({ set, nowMs, facts }).quests.every(
			(q) => q.status === "UNAVAILABLE",
		),
	);
	facts.metrics.qualifyingSwaps = 3;
	assert.equal(
		previewWeeklyQuests({ set, nowMs, facts }).quests[0].status,
		"PROVISIONAL_COMPLETE",
	);
	assert.equal(previewWeeklyQuests({ set, nowMs, facts }).awardEligible, false);
	assert.throws(() =>
		previewWeeklyQuests({
			set: compileQuestCalendar(plan()).weeks[1],
			nowMs: ms(set.endsAt),
			facts,
		}),
	);
	facts.computedAt = iso(nowMs + 1);
	assert.throws(() => previewWeeklyQuests({ set, nowMs, facts }));
});
test("month survives all weekly resets and expires exactly at next month midnight", () => {
	for (const date of ["2027-01-07", "2027-01-14", "2027-01-21", "2027-01-28"])
		assert.equal(
			previewQuestCalendar({ plan: plan(), nowMs: ms(`${date}T00:00:00.000Z`) })
				.communityGoals[0].state,
			"ACTIVE",
		);
	const end = ms("2027-02-01T00:00:00.000Z");
	assert.equal(
		previewQuestCalendar({ plan: plan(), nowMs: end - 1 }).communityGoals[0]
			.state,
		"ACTIVE",
	);
	assert.equal(
		previewQuestCalendar({ plan: plan(), nowMs: end }).communityGoals[0].state,
		"EXPIRED",
	);
	const p = proof();
	p.observedAt = iso(end - 1);
	assert.throws(() => check(p, goal(), end));
});
test("complete pinned exact-cent TVL hits 500k without float rounding", () => {
	const p = proof();
	p.pools[0].tvlUsdCents = "49999999";
	assert.equal(check(p).reached, false);
	p.pools[0].tvlUsdCents = "50000000";
	assert.equal(check(p).reached, true);
	assert.equal(check(p).progressBasisPoints, 10000);
	assert.equal(check(p).awardEligible, false);
});
for (const mutate of [
	(p) => (p.network = "MAINNET"),
	(p) => (p.fixtureKind = "LIVE"),
	(p) => (p.manifestSha256 = "b".repeat(64)),
	(p) => (p.valuationVersion = "untrusted"),
	(p) => (p.pools = []),
	(p) => p.pools.push(p.pools[0]),
	(p) => (p.pools[0].tvlUsdCents = "1.1"),
	(p) => (p.pools[0].tvlUsdCents = "-1"),
	(p) => (p.pools[0].tvlUsdCents = "050000000"),
	(p) => (p.observedAt = "2026-12-31T23:59:59.999Z"),
	(p) => (p.observedAt = "2027-02-01T00:00:00.000Z"),
]) {
	test(`reject TVL proof ${mutate.toString()}`, () => {
		const p = proof();
		mutate(p);
		assert.throws(() => check(p));
	});
}
test("stale or future measurements and omitted clock cannot reach a goal", () => {
	const p = proof();
	assert.throws(() => check(p, goal(), ms(p.observedAt) + 300001));
	assert.throws(() => check(p, goal(), ms(p.observedAt) - 1));
	assert.throws(() =>
		verifyCommunityProof({ goal: goal(), proof: p, manifestSha256 }),
	);
});
test("all Passports existing at milestone receive stable pending XP; late arrivals excluded", () => {
	const p = proof(),
		nowMs = ms(p.observedAt),
		early = { passportId: passport, createdAt: iso(nowMs - 1) },
		late = {
			passportId: "44444444-4444-4444-8444-444444444444",
			createdAt: iso(nowMs + 1),
		};
	const args = {
		campaignId: plan().campaignId,
		goal: goal(),
		proof: p,
		manifestSha256,
		nowMs,
		passports: [late, early],
	};
	const result = previewCommunityEntitlements(args);
	assert.equal(result.entitlements.length, 1);
	assert.equal(result.entitlements[0].testXp, 1000);
	assert.equal(result.entitlements[0].state, "PENDING_TEST_ONLY");
	assert.equal(result.awardEligible, false);
	assert.deepEqual(previewCommunityEntitlements(args), result);
	assert.notEqual(
		communityEntitlementKey(args.campaignId, goal().id, passport),
		communityEntitlementKey(
			args.campaignId,
			compileQuestCalendar(plan()).goals[1].id,
			passport,
		),
	);
	assert.throws(() =>
		previewCommunityEntitlements({ ...args, passports: [early, early] }),
	);
	p.pools[0].tvlUsdCents = "49999999";
	assert.deepEqual(previewCommunityEntitlements(args).entitlements, []);
});
