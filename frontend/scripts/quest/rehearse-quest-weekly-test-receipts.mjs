import assert from "node:assert/strict";
import { calendarHash, compileQuestCalendar } from "./quest-calendar.mjs";
import { createQuestCalendarStore } from "./quest-calendar-store.mjs";
import { createWeeklyTestReceiptStore } from "./quest-weekly-test-store.mjs";

export async function rehearseWeeklyTestReceipts({
	connection,
	pool,
	environment,
	sourcePins,
	qualification,
	passportId,
	plan,
	set,
}) {
	const swap = set.quests.find((q) => q.metric === "qualifyingSwaps");
	// The first slot that can complete reserves its test amount. A small shared
	// ceiling deliberately prevents any second completion, even with full facts.
	const policy = {
		fixtureKind: "SYNTHETIC_DEVNET",
		network: "DEVNET",
		revision: 1,
		perPassportEpochXp: String(swap.testXp),
		perCampaignEpochXp: String(swap.testXp),
		perCampaignYearXp: String(swap.testXp),
	};
	await connection.query(
		"INSERT INTO quest.weekly_test_policies(campaign_id,document) VALUES($1,$2::jsonb)",
		[plan.campaignId, JSON.stringify(policy)],
	);
	const store = createWeeklyTestReceiptStore({ pool, environment, sourcePins }),
		input = { campaignId: plan.campaignId, passportId, qualification };
	const results = await Promise.all([
		store.reserve(input),
		store.reserve(input),
	]);
	assert.equal(
		results.reduce((n, r) => n + r.created, 0),
		1,
	);
	assert.equal(results[0].receipts.length, 1);
	assert.deepEqual(results[0].receipts, results[1].receipts);
	assert.equal(results[0].receipts[0].testXp, swap.testXp);
	assert.equal(
		results[0].receipts[0].qualificationSha256,
		calendarHash(qualification),
	);
	const replay = await store.reserve(input);
	assert.equal(replay.created, 0);
	assert.ok(replay.results.some((r) => r.state === "ALREADY_PLANNED"));
	const other = "d1000000-0000-4000-8000-000000000002";
	await connection.query(
		"INSERT INTO quest.passports(passport_id) VALUES($1)",
		[other],
	);
	// Direct SQL insertion still cannot exceed the shared cap. The test row uses
	// a proper stable occurrence identity independently of application checks.
	const receipt = replay.receipts[0];
	const { weeklyCompletionKey } = await import("./quest-weekly-xp-preview.mjs");
	const insert = (overrides = {}) =>
		connection.query(
			`INSERT INTO quest.weekly_test_receipts(campaign_id,starts_at,slot,passport_id,instance_key,completion_key,test_xp,set_sha256,facts_sha256,qualification_sha256,source_captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			[
				plan.campaignId,
				overrides.startsAt ?? receipt.startsAt,
				receipt.slot,
				overrides.passportId ?? other,
				overrides.instanceKey ?? receipt.instanceKey,
				overrides.completionKey ??
					weeklyCompletionKey(plan.campaignId, receipt.instanceKey, other),
				overrides.testXp ?? receipt.testXp,
				receipt.setSha256,
				receipt.factsSha256,
				receipt.qualificationSha256,
				overrides.capturedAt ?? receipt.sourceCapturedAt,
			],
		);
	await assert.rejects(insert(), /budget exhausted/);
	await assert.rejects(
		insert({ testXp: receipt.testXp + 1 }),
		/differs from published/,
	);
	await assert.rejects(
		insert({ completionKey: "b".repeat(64) }),
		/identity differs/,
	);
	await assert.rejects(
		insert({ capturedAt: "2020-01-01T00:00:00.000Z" }),
		/expired or stale/,
	);
	await assert.rejects(
		insert({
			startsAt: new Date(
				Date.parse(receipt.startsAt) - 604800000,
			).toISOString(),
		}),
		/expired or stale/,
	);
	for (const sql of [
		"UPDATE quest.weekly_test_policies SET document=document",
		"DELETE FROM quest.weekly_test_policies",
		"UPDATE quest.weekly_test_receipts SET test_xp=test_xp",
		"DELETE FROM quest.weekly_test_receipts",
	])
		await assert.rejects(connection.query(sql), /immutable/);
	const history = await store.personalHistory(plan.campaignId, passportId);
	assert.deepEqual(history, replay.receipts);
	assert.deepEqual(await store.personalHistory(plan.campaignId, other), []);
	const restricted = await pool.connect();
	try {
		await assert.rejects(
			restricted.query("INSERT INTO quest.xp_events DEFAULT VALUES"),
			/permission denied/,
		);
		await assert.rejects(
			restricted.query("INSERT INTO quest.weekly_test_policies DEFAULT VALUES"),
			/permission denied/,
		);
		await restricted.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
		await assert.rejects(
			restricted.query(
				`INSERT INTO quest.weekly_test_receipts(campaign_id,starts_at,slot,passport_id,instance_key,completion_key,test_xp,set_sha256,facts_sha256,qualification_sha256,source_captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp())`,
				[
					plan.campaignId,
					receipt.startsAt,
					receipt.slot,
					other,
					receipt.instanceKey,
					weeklyCompletionKey(plan.campaignId, receipt.instanceKey, other),
					receipt.testXp,
					receipt.setSha256,
					receipt.factsSha256,
					receipt.qualificationSha256,
				],
			),
			/read committed isolation/,
		);
		await restricted.query("ROLLBACK");
	} finally {
		restricted.release();
	}
	// Two different Passports race for the final shared allocation. Exercise
	// the SQL guard directly so the application lock cannot hide a DB race.
	const racePlan = structuredClone(plan);
	racePlan.campaignId = "weekly-receipt-race";
	await createQuestCalendarStore({ pool, environment }).publish(racePlan);
	await connection.query(
		"INSERT INTO quest.weekly_test_policies(campaign_id,document) VALUES($1,$2::jsonb)",
		[racePlan.campaignId, JSON.stringify(policy)],
	);
	const third = "d1000000-0000-4000-8000-000000000003";
	await connection.query(
		"INSERT INTO quest.passports(passport_id) VALUES($1)",
		[third],
	);
	const raceSet = compileQuestCalendar(racePlan).weeks.find(
			(w) => w.startsAt === set.startsAt,
		),
		raceQuest = raceSet.quests[receipt.slot];
	const compete = async (selectedPassport) => {
		const db = await pool.connect();
		try {
			await db.query("BEGIN");
			await db.query(
				`INSERT INTO quest.weekly_test_receipts(campaign_id,starts_at,slot,passport_id,instance_key,completion_key,test_xp,set_sha256,facts_sha256,qualification_sha256,source_captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp())`,
				[
					racePlan.campaignId,
					raceSet.startsAt,
					raceQuest.slot,
					selectedPassport,
					raceQuest.instanceKey,
					weeklyCompletionKey(
						racePlan.campaignId,
						raceQuest.instanceKey,
						selectedPassport,
					),
					raceQuest.testXp,
					raceSet.setSha256,
					receipt.factsSha256,
					receipt.qualificationSha256,
				],
			);
			await db.query("COMMIT");
			return true;
		} catch (e) {
			await db.query("ROLLBACK");
			assert.match(e.message, /budget exhausted/);
			return false;
		} finally {
			db.release();
		}
	};
	const race = await Promise.all([compete(other), compete(third)]);
	assert.equal(race.filter(Boolean).length, 1);
	assert.equal(
		Number(
			(
				await connection.query(
					"SELECT sum(test_xp) AS total FROM quest.weekly_test_receipts WHERE campaign_id=$1",
					[racePlan.campaignId],
				)
			).rows[0].total,
		),
		swap.testXp,
	);
	console.log(
		"Weekly test receipts: concurrent retry, stable immutable history, shared cap, direct SQL guards, private projection and zero XP permissions passed.",
	);
	return store;
}
