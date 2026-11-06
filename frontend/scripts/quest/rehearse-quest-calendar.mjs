import assert from "node:assert/strict";
import { createQuestCalendarExample } from "./quest-calendar-example.mjs";
import { createQuestCalendarStore } from "./quest-calendar-store.mjs";

export async function rehearseQuestCalendar({
	connection,
	makePool,
	calendarRole,
}) {
	await connection.query(`GRANT USAGE ON SCHEMA quest TO "${calendarRole}"`);
	await connection.query(
		`GRANT SELECT ON quest.environment_identity,quest.passports,quest.calendar_plans,quest.calendar_milestones,quest.calendar_plan_revisions TO "${calendarRole}"`,
	);
	await connection.query(
		`GRANT INSERT ON quest.calendar_plans,quest.calendar_milestones,quest.calendar_plan_revisions TO "${calendarRole}"`,
	);
	const environment = {
		network: "DEVNET",
		environmentId: "33333333-3333-4333-8333-333333333333",
		manifestSha256: "a".repeat(64),
	};
	const pool = makePool(calendarRole),
		store = createQuestCalendarStore({ pool, environment });
	const { rows } = await connection.query("SELECT clock_timestamp() AS now");
	const now = new Date(rows[0].now),
		year = now.getUTCFullYear();
	const plan = createQuestCalendarExample(year);
	plan.campaignId = "calendar-sql-fixture";
	const goal = plan.communityGoals[now.getUTCMonth()];
	const overflowGoal = { ...goal, id: "audience-overflow-fixture" };
	plan.communityGoals.push(overflowGoal);
	const pub = await store.publish(plan);
	assert.equal(pub.created, true);
	assert.equal((await store.publish(plan)).created, false);
	const changed = structuredClone(plan);
	changed.templates[0].testXp++;
	await assert.rejects(store.publish(changed), /cannot be changed/);
	await assert.rejects(
		store.revise(changed, { expectedRevision: 1 }),
		/started weekly/,
	);
	assert.equal((await store.snapshot(plan.campaignId)).weekly.quests.length, 3);
	await assert.rejects(
		createQuestCalendarStore({
			pool,
			environment: { ...environment, manifestSha256: "b".repeat(64) },
		}).snapshot(plan.campaignId),
		/environment differs/,
	);
	const { rows: audience } = await connection.query(
		"SELECT passport_id FROM quest.passports WHERE network=$1 AND created_at<=$2::timestamptz ORDER BY passport_id",
		["DEVNET", now.toISOString()],
	);
	assert.ok(audience.length > 0);
	const proof = {
		schemaVersion: 1,
		network: "DEVNET",
		fixtureKind: "SYNTHETIC_DEVNET",
		manifestSha256: environment.manifestSha256,
		valuationVersion: goal.valuationVersion,
		observedAt: now.toISOString(),
		sourceKey: "calendar-sql-tvl-fixture",
		pools: [{ poolAddress: goal.poolAddresses[0], tvlUsdCents: "49999999" }],
	};
	const args = { campaignId: plan.campaignId, goalId: goal.id, proof };
	assert.equal(
		(await store.observeCommunity(args)).receipt.entitlements.length,
		0,
	);
	proof.pools[0].tvlUsdCents = "50000000";
	const outcomes = await Promise.all([
		store.observeCommunity(args),
		store.observeCommunity(args),
	]);
	assert.equal(outcomes.filter((o) => o.created).length, 1);
	assert.deepEqual(outcomes[0].receipt, outcomes[1].receipt);
	assert.deepEqual(
		outcomes[0].receipt.entitlements.map((e) => e.passportId),
		audience.map((p) => p.passport_id),
	);
	assert.ok(
		outcomes[0].receipt.entitlements.every(
			(e) => e.state === "PENDING_TEST_ONLY" && e.testXp === 1000,
		),
	);
	const late = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
	await connection.query(
		"INSERT INTO quest.passports(network,passport_id) VALUES($1,$2)",
		["DEVNET", late],
	);
	proof.sourceKey = "different-retry-proof";
	assert.deepEqual(
		(await store.observeCommunity(args)).receipt,
		outcomes[0].receipt,
	);
	assert.equal(
		(await store.snapshot(plan.campaignId)).milestones[0].recipientCount,
		audience.length,
	);
	const future = createQuestCalendarExample(year + 2);
	future.campaignId = "calendar-revision-fixture";
	await store.publish(future);
	const editA = structuredClone(future),
		editB = structuredClone(future);
	editA.templates[0].testXp++;
	editB.templates[0].testXp += 2;
	const revisions = await Promise.allSettled([
		store.revise(editA, { expectedRevision: 1 }),
		store.revise(editB, { expectedRevision: 1 }),
	]);
	assert.equal(
		revisions.filter((r) => r.status === "fulfilled").length,
		1,
		revisions
			.map((r) => (r.status === "rejected" ? r.reason.message : "ok"))
			.join("; "),
	);
	assert.match(
		revisions.find((r) => r.status === "rejected").reason.message,
		/revision conflict/,
	);
	assert.equal((await store.snapshot(future.campaignId)).revision, 2);
	const current = revisions[0].status === "fulfilled" ? editA : editB;
	assert.equal(
		(await store.revise(current, { expectedRevision: 2 })).created,
		false,
	);
	await assert.rejects(
		connection.query("DELETE FROM quest.calendar_plan_revisions"),
		/immutable/,
	);
	// Direct inserts cannot bypass expected revision or started-history guards.
	const original = (
		await connection.query(
			"SELECT plan_sha256 FROM quest.calendar_plans WHERE campaign_id=$1",
			[plan.campaignId],
		)
	).rows[0].plan_sha256;
	await assert.rejects(
		connection.query(
			"INSERT INTO quest.calendar_plan_revisions(campaign_id,revision,previous_sha256,plan_sha256,document) VALUES($1,2,$2,$3,$4::jsonb)",
			[plan.campaignId, original, "b".repeat(64), JSON.stringify(changed)],
		),
		/Started quest template/,
	);
	await connection.query(
		"INSERT INTO quest.passports(network,passport_id,created_at) SELECT 'DEVNET',('bbbbbbbb-bbbb-4bbb-8bbb-'||lpad(n::text,12,'0'))::uuid,clock_timestamp()-interval '1 minute' FROM generate_series(1,20001) n",
	);
	proof.observedAt = new Date(
		(await connection.query("SELECT clock_timestamp() AS now")).rows[0].now,
	).toISOString();
	await assert.rejects(
		store.observeCommunity({ ...args, goalId: overflowGoal.id }),
		/bounded audience/,
	);
	assert.equal(
		Number(
			(
				await connection.query(
					"SELECT count(*) AS count FROM quest.calendar_milestones WHERE campaign_id=$1 AND goal_id=$2",
					[plan.campaignId, overflowGoal.id],
				)
			).rows[0].count,
		),
		0,
	);
	await connection.query(
		"DELETE FROM quest.passports WHERE passport_id::text LIKE 'bbbbbbbb-bbbb-4bbb-8bbb-%'",
	);
	await assert.rejects(
		connection.query("UPDATE quest.calendar_milestones SET recorded_at=now()"),
		/immutable/,
	);
	await assert.rejects(
		connection.query("DELETE FROM quest.calendar_plans"),
		/immutable/,
	);
	const db = await pool.connect();
	try {
		await assert.rejects(
			db.query("SELECT * FROM quest.xp_events"),
			/permission denied/,
		);
		await assert.rejects(
			db.query(
				"INSERT INTO quest.passports(network,passport_id) VALUES($1,$2)",
				["DEVNET", "ffffffff-ffff-4fff-8fff-ffffffffffff"],
			),
			/permission denied/,
		);
	} finally {
		db.release();
	}
	assert.equal(
		Number(
			(await connection.query("SELECT count(*) AS count FROM quest.xp_events"))
				.rows[0].count,
		),
		0,
	);
	console.log(
		"Quest calendar: full-year publication, immutable schedule, shared concurrent milestone, complete first audience, retry stability, no XP permissions passed.",
	);
}
