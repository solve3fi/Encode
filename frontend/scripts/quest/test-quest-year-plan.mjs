import assert from "node:assert/strict";
import { test } from "node:test";
import { WEEKLY_METRICS, compileQuestCalendar, previewWeeklyQuests } from "./quest-calendar.mjs";
import {
	YEAR_CAMPAIGN_ID,
	YEAR_TEMPLATES,
	YEAR_WEEK_COUNT,
	createYearManualGoals,
	createYearPlan,
	yearWeekQuestIds,
	yearXpCeiling,
} from "./quest-year-plan.mjs";

test("the year plan compiles: 52 contiguous Thursday epochs from 2026-10-08, three unique quests each", () => {
	const plan = createYearPlan();
	const compiled = compileQuestCalendar(plan);
	assert.equal(plan.campaignId, YEAR_CAMPAIGN_ID);
	assert.equal(compiled.weekCount, YEAR_WEEK_COUNT);
	assert.equal(compiled.weeks[0].startsAt, "2026-10-08T00:00:00.000Z");
	assert.equal(compiled.weeks.at(-1).endsAt, "2027-10-07T00:00:00.000Z");
	for (const week of compiled.weeks) {
		assert.equal(new Date(week.startsAt).getUTCDay(), 4, "every epoch starts on a Thursday");
		assert.equal(new Set(week.quests.map((q) => q.id)).size, 3);
	}
	assert.deepEqual(plan.communityGoals, [], "monthly goals are manual goals, not calendar TVL goals");
});

test("the catalog has 13 quests, every metric exists, and every template is used", () => {
	assert.equal(YEAR_TEMPLATES.length, 13);
	assert.ok(YEAR_TEMPLATES.every((t) => WEEKLY_METRICS.includes(t.metric)));
	const used = new Set();
	for (let week = 1; week <= YEAR_WEEK_COUNT; week++) for (const id of yearWeekQuestIds(week)) used.add(id);
	assert.deepEqual([...used].sort(), YEAR_TEMPLATES.map((t) => t.id).sort());
	assert.ok(!YEAR_TEMPLATES.some((t) => /vote/i.test(t.id)), "voting pays Voting XP and is not a quest");
});

test("difficulty rises by quarter and the first week matches the approved schedule", () => {
	assert.deepEqual(yearWeekQuestIds(1), ["swap-three", "join-featured-pool", "explorer-two-pools"]);
	assert.deepEqual(yearWeekQuestIds(2), ["trade-two-days", "join-featured-pool", "invite-trader"]);
	assert.deepEqual(yearWeekQuestIds(52), ["volume-1000", "lp-in-range-6h", "invite-lp"]);
	const xp = new Map(YEAR_TEMPLATES.map((t) => [t.id, t.testXp]));
	const quarterAverage = (from, to) => {
		let total = 0;
		for (let week = from; week <= to; week++) total += yearWeekQuestIds(week).reduce((a, id) => a + xp.get(id), 0);
		return total / (to - from + 1);
	};
	const averages = [quarterAverage(1, 13), quarterAverage(14, 26), quarterAverage(27, 39), quarterAverage(40, 52)];
	for (let i = 1; i < averages.length; i++) assert.ok(averages[i] > averages[i - 1], `quarter ${i + 1} is harder than ${i}`);
});

test("a week of the plan is ACTIVE during its epoch and EXPIRED at the Thursday boundary", () => {
	const compiled = compileQuestCalendar(createYearPlan());
	const first = Date.parse("2026-10-08T00:00:00.000Z");
	const during = previewWeeklyQuests({ set: compiled.weeks[0], nowMs: first + 1000 });
	assert.equal(during.state, "ACTIVE");
	assert.equal(during.quests.length, 3);
	assert.equal(previewWeeklyQuests({ set: compiled.weeks[0], nowMs: first + 7 * 86_400_000 }).state, "EXPIRED");
});

test("twelve monthly manual goals cover October 2026 to September 2027 without overlap", () => {
	const goals = createYearManualGoals();
	assert.equal(goals.length, 12);
	assert.equal(goals[0].startsAt, "2026-10-08T00:00:00.000Z");
	assert.equal(goals[0].endsAt, "2026-11-01T00:00:00.000Z");
	assert.equal(goals.at(-1).endsAt, "2027-10-01T00:00:00.000Z");
	for (let i = 1; i < goals.length; i++) assert.equal(goals[i].startsAt, goals[i - 1].endsAt);
	assert.equal(new Set(goals.map((g) => g.id)).size, 12);
	assert.ok(goals.every((g) => g.xp === 1000 && g.title.length <= 100 && g.flavorText.length <= 300));
	assert.ok(goals.every((g) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(g.id)));
});

test("the XP ceiling matches the wiki budget", () => {
	assert.deepEqual(yearXpCeiling(), { weekly: 93700, monthly: 12000, total: 105700 });
});
