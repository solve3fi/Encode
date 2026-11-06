import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarHash, compileQuestCalendar } from "./quest-calendar.mjs";
import { createQuestCalendarExample } from "./quest-calendar-example.mjs";
import {
	readPersonalWeeklyHistory,
	validateHistoryPage,
} from "./quest-calendar-history.mjs";
import { weeklyCompletionKey } from "./quest-weekly-xp-preview.mjs";

const plan = createQuestCalendarExample(),
	passportId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const set = compileQuestCalendar(plan).weeks[1],
	nowMs = Date.parse(set.endsAt);
function row(slot = 2) {
	const instance = calendarHash([
		"weekly",
		plan.campaignId,
		set.startsAt,
		slot,
	]);
	return {
		campaign_id: plan.campaignId,
		passport_id: passportId,
		starts_at: new Date(set.startsAt),
		slot,
		instance_key: instance,
		completion_key: weeklyCompletionKey(plan.campaignId, instance, passportId),
		test_xp: set.quests[slot].testXp,
		set_sha256: set.setSha256,
		facts_sha256: "a".repeat(64),
		qualification_sha256: "b".repeat(64),
		source_captured_at: set.startsAt,
		recorded_at: new Date(Date.parse(set.startsAt) + 1000),
		fixture_kind: "SYNTHETIC_DEVNET",
		award_eligible: false,
	};
}
async function read(rows, page = { before: null, limit: 2 }) {
	const calls = [];
	const out = await readPersonalWeeklyHistory({
		db: {
			async query(sql, args) {
				calls.push({ sql, args });
				return { rows };
			},
		},
		plan,
		passportId,
		nowMs,
		...page,
	});
	return { out, calls };
}
test("history preserves expired test receipts with bounded descending keyset pages", async () => {
	const { out, calls } = await read([row(2), row(1), row(0)]);
	assert.equal(out.receipts.length, 2);
	assert.deepEqual(out.nextCursor, { startsAt: set.startsAt, slot: 1 });
	assert.ok(
		out.receipts.every(
			(r) => r.expired && !r.awardEligible && r.state === "RESERVED_TEST_ONLY",
		),
	);
	assert.deepEqual(calls[0].args, [plan.campaignId, passportId, null, null, 3]);
	assert.match(calls[0].sql, /passport_id=\$2/);
	assert.ok(!JSON.stringify(out).includes("qualificationSha256"));
	const final = await read([row(0)], { before: out.nextCursor, limit: 2 });
	assert.equal(final.out.nextCursor, null);
});
test("empty personal history is complete only for that page and Passport", async () => {
	assert.deepEqual((await read([])).out.receipts, []);
	assert.equal((await read([])).out.nextCursor, null);
});
for (const page of [
	{ before: null, limit: 0 },
	{ before: null, limit: 101 },
	{ before: null, limit: 1.5 },
	{ before: undefined, limit: 1 },
	{ before: { startsAt: "2027-01-04T00:00:00.000Z", slot: 0 }, limit: 1 },
	{ before: { startsAt: set.startsAt, slot: 3 }, limit: 1 },
	{ before: { startsAt: set.startsAt, slot: 0, passportId }, limit: 1 },
])
	test(`invalid history page ${JSON.stringify(page)}`, () =>
		assert.throws(() => validateHistoryPage(page)));
for (const [key, value] of Object.entries({
	passport_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
	campaign_id: "wrong",
	slot: 3,
	test_xp: 0,
	set_sha256: "f".repeat(64),
	completion_key: "f".repeat(64),
	instance_key: "f".repeat(64),
	fixture_kind: "LIVE",
	award_eligible: true,
	qualification_sha256: "bad",
	facts_sha256: null,
	source_captured_at: "2026-01-01T00:00:00.000Z",
	recorded_at: set.endsAt,
}))
	test(`history refuses corrupt ${key}`, async () =>
		assert.rejects(read([{ ...row(), [key]: value }])));
test("history refuses duplicate, unordered and cursor-overlapping rows", async () => {
	await assert.rejects(read([row(2), row(2)]));
	await assert.rejects(read([row(0), row(2)]));
	await assert.rejects(
		read([row(2)], { before: { startsAt: set.startsAt, slot: 2 }, limit: 1 }),
	);
});
test("extra fetched row is validated before issuing next cursor", async () => {
	await assert.rejects(
		read([row(2), row(1), { ...row(0), award_eligible: true }]),
	);
	await assert.rejects(
		read([row(2), row(1), row(0)], { before: null, limit: 1 }),
	);
});
