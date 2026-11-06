// Disposable integration rehearsal for the manual community goals (migration 024): the real migrations and the
// real role grants. It creates and drops its own database; point it at a throwaway PostgreSQL 16 server
// (QUEST_TEST_PG_HOST/PORT/USER/PASSWORD). It checks who may run what, that a goal can change only before it
// starts, that completing one pays every Passport exactly once, that the community-xp pause stops it without
// losing anything, and that every operator action is audited and immutable.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import bs58 from "bs58";
import {
	communityGoalReadGrants,
	pauseAdminGrants,
	questAdminGrants,
	xpWriterGrants,
} from "../../deploy/quest-backend/swap-grants.mjs";
import { QUEST_XP_TOTAL_SQL } from "./quest-calendar-service.mjs";

const pgModule = process.env.QUEST_TEST_PG_MODULE;
const { default: pg } = await import(pgModule ? pathToFileURL(pgModule).href : "pg");
const conn = {
	host: process.env.QUEST_TEST_PG_HOST ?? "127.0.0.1",
	port: Number(process.env.QUEST_TEST_PG_PORT ?? 5432),
	user: process.env.QUEST_TEST_PG_USER ?? "postgres",
	password: process.env.QUEST_TEST_PG_PASSWORD,
};
const stamp = `${Date.now()}_${process.pid}`;
const db = `quest_goals_rehearsal_${stamp}`;
const roles = {
	questAdmin: `quest_goals_admin_${stamp}`,
	pauseAdmin: `quest_goals_pause_${stamp}`,
	settler: `quest_goals_settler_${stamp}`,
	runtime: `quest_goals_runtime_${stamp}`,
};
const admin = new pg.Client({ ...conn, database: process.env.QUEST_TEST_PG_ADMIN_DB ?? "postgres" });

const key = (n) => bs58.encode(Buffer.alloc(32, n));
const ADMIN_WALLET = key(99);
const CAMPAIGN = "quests-y1";
const PASSPORTS = [
	"11111111-1111-4111-8111-111111111111",
	"22222222-2222-4222-8222-222222222222",
	"33333333-3333-4333-8333-333333333333",
	"44444444-4444-4444-8444-444444444444",
];
const LATE = "55555555-5555-4555-8555-555555555555";
const DAY = 86400000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

let connection;
let created = false;
let passed = 0;
const check = (label) => {
	passed += 1;
	console.log(`ok ${passed} - ${label}`);
};
const refused = async (promise, pattern, label) => {
	await assert.rejects(promise, pattern, label);
	check(label);
};
const q = (sql, params) => connection.query(sql, params);
const as = async (role, fn) => {
	await connection.query(`SET ROLE "${role}"`);
	try {
		return await fn();
	} finally {
		await connection.query("RESET ROLE");
	}
};
const save = (goal, over = {}, role = roles.questAdmin, actor = ADMIN_WALLET) => {
	const g = { title: "Get a partner onboarded", flavor: "Somebody important said yes.", starts: iso(DAY), ends: iso(30 * DAY), xp: 1000, ...over };
	return as(role, async () =>
		(await q("SELECT quest.save_manual_goal($1,$2,$3,$4,$5,$6,$7,$8) AS r", [CAMPAIGN, goal, g.title, g.flavor, g.starts, g.ends, g.xp, actor])).rows[0].r,
	);
};
const complete = (goal, role = roles.questAdmin, note = null) =>
	as(role, async () => (await q("SELECT quest.complete_manual_goal($1,$2,$3,$4) AS r", [CAMPAIGN, goal, ADMIN_WALLET, note])).rows[0].r);
const goals = (role = roles.questAdmin) =>
	as(role, async () => (await q("SELECT quest.manual_goals_admin($1) AS g", [CAMPAIGN])).rows[0].g);
const overview = (passport, role = roles.runtime) =>
	as(role, async () => (await q("SELECT quest.community_goals_overview($1,$2) AS g", [passport, CAMPAIGN])).rows[0].g);
const setPause = (keyName, paused, reason) =>
	as(roles.pauseAdmin, () => q("SELECT quest.set_pause($1,$2,$3,$4)", [keyName, paused, reason, ADMIN_WALLET]));
const communityXp = async () =>
	(await q("SELECT count(*)::int AS n, COALESCE(sum(xp_delta),0)::int AS xp FROM quest.xp_events WHERE qualification_key = 'community-goal'")).rows[0];

try {
	await admin.connect();
	assert.ok(Number((await admin.query("SHOW server_version_num")).rows[0].server_version_num) >= 160000);
	await admin.query(`CREATE DATABASE "${db}"`);
	created = true;
	connection = new pg.Client({ ...conn, database: db });
	await connection.connect();
	for (const dir of ["db/migrations", "db/quest/migrations"]) {
		const base = fileURLToPath(new URL(`../../${dir}/`, import.meta.url));
		for (const name of (await readdir(base)).filter((n) => n.endsWith(".sql")).sort())
			await q(await readFile(base + name, "utf8"));
	}
	for (const role of Object.values(roles)) await admin.query(`CREATE ROLE "${role}" NOLOGIN`);
	for (const sql of questAdminGrants(`"${roles.questAdmin}"`)) await q(sql);
	for (const sql of pauseAdminGrants(`"${roles.pauseAdmin}"`)) await q(sql);
	for (const sql of xpWriterGrants(`"${roles.settler}"`)) await q(sql);
	await q(`REVOKE ALL ON ALL TABLES IN SCHEMA quest FROM "${roles.runtime}"`);
	for (const sql of communityGoalReadGrants(`"${roles.runtime}"`)) await q(sql);
	for (const id of PASSPORTS) await q("INSERT INTO quest.passports (passport_id) VALUES ($1)", [id]);
	check("migrations 001..024 and the role grants apply; four Passports exist");

	// ---- the sixth switch and who may do what
	const status = (await q("SELECT quest.pause_status() AS s")).rows[0].s;
	assert.deepEqual(Object.keys(status).sort(), ["community-xp", "onboarding-xp", "pass-mint", "referrals", "voting-xp", "weekly-xp"]);
	assert.equal(status["community-xp"].paused, false);
	check("a sixth pause switch, community-xp, exists and starts released");
	await refused(save("g-denied", {}, roles.runtime), /permission denied/, "the serving role cannot save a goal");
	await refused(save("g-denied", {}, roles.settler), /permission denied/, "the XP settler cannot save a goal");
	await refused(complete("g-denied", roles.runtime), /permission denied/, "the serving role cannot complete a goal");
	await refused(complete("g-denied", roles.settler), /permission denied/, "the XP settler cannot complete a goal");
	await refused(as(roles.questAdmin, () => q("SELECT * FROM quest.xp_events")), /permission denied/, "the quest admin cannot read the XP ledger");
	await refused(as(roles.questAdmin, () => q("SELECT * FROM quest.passports")), /permission denied/, "the quest admin cannot read Passports");
	await refused(as(roles.questAdmin, () => q("INSERT INTO quest.manual_goals (campaign_id,goal_id,title,flavor_text,starts_at,ends_at,xp_each) VALUES ('a','b','c','d',now(),now()+interval '1 day',5)")), /permission denied/, "goals change only through the functions, never by table write");
	await refused(as(roles.runtime, () => q("SELECT quest.manual_goals_admin($1)", [CAMPAIGN])), /permission denied/, "the serving role cannot read the operator list");

	// ---- input rules
	await refused(save("g-bad", { ends: iso(-DAY) }), /cannot end in the past/, "a goal cannot end in the past");
	await refused(save("g-bad", { xp: 0 }), /violates check constraint/, "zero XP is refused");
	await refused(save("g-bad", { xp: 100001 }), /violates check constraint/, "XP above 100,000 is refused");
	await refused(save("Bad Id"), /violates check constraint/, "a malformed goal id is refused");
	await refused(save("g-bad", { ends: iso(400 * DAY) }), /violates check constraint/, "a window longer than 366 days is refused");
	await refused(save("g-bad", {}, roles.questAdmin, "not-a-wallet"), /violates check constraint/, "an audit needs a real admin wallet");

	// ---- change only before the start
	let saved = await save("partner-m1");
	assert.equal(saved.revision, 1);
	saved = await save("partner-m1", { title: "Get a partner onboarded (renamed)", xp: 1200 });
	assert.equal(saved.revision, 2);
	let list = await goals();
	assert.equal(list.length, 1);
	assert.equal(list[0].status, "UPCOMING");
	assert.equal(list[0].xpEach, 1200);
	check("an upcoming goal can be created and edited, and its revision counts up");
	await refused(complete("partner-m1"), /outside its window/, "a goal that has not started cannot be completed");
	await save("partner-open", { starts: iso(-3600 * 1000), xp: 1000 });
	list = await goals();
	assert.equal(list.find((g) => g.goalId === "partner-open").status, "ACTIVE");
	check("a new goal may be created for a window that is already open");
	await refused(save("partner-open", { title: "Changed after start" }), /has started cannot change/, "a started goal cannot be edited");
	await refused(as(roles.questAdmin, async () => q("SELECT quest.remove_manual_goal($1,$2,$3)", [CAMPAIGN, "partner-open", ADMIN_WALLET])), /has started cannot be removed/, "a started goal cannot be removed");
	await refused(as(roles.questAdmin, async () => q("SELECT quest.remove_manual_goal($1,$2,$3)", [CAMPAIGN, "nope", ADMIN_WALLET])), /Unknown goal/, "removing an unknown goal is refused");
	await as(roles.questAdmin, async () => q("SELECT quest.remove_manual_goal($1,$2,$3)", [CAMPAIGN, "partner-m1", ADMIN_WALLET]));
	assert.deepEqual((await goals()).map((g) => g.goalId), ["partner-open"]);
	check("an upcoming goal can be removed");

	// ---- the pause stops completion and loses nothing
	await setPause("community-xp", true, "rehearsal");
	await refused(complete("partner-open"), /Community XP is paused/, "completion is refused while community-xp is paused");
	assert.deepEqual(await communityXp(), { n: 0, xp: 0 });
	assert.equal((await q("SELECT count(*)::int AS n FROM quest.manual_goal_completions")).rows[0].n, 0);
	check("a paused completion writes no XP and no completion row");
	await setPause("community-xp", false, null);

	// ---- completion pays everyone once
	await refused(complete("partner-open", roles.questAdmin, "x".repeat(201)), /note is too long/, "a note longer than 200 characters is refused");
	const done = await complete("partner-open", roles.questAdmin, "Partner A is live");
	assert.deepEqual([done.xpEach, done.recipients], [1000, 4]);
	assert.deepEqual(await communityXp(), { n: 4, xp: 4000 });
	for (const id of PASSPORTS) {
		const total = (await q(QUEST_XP_TOTAL_SQL, [id])).rows[0].total;
		assert.equal(total, 1000, "community XP counts as Quest XP");
	}
	check("completing a goal pays every Passport exactly once and it counts as Quest XP");
	await refused(complete("partner-open"), /already completed/, "a goal cannot be completed twice");
	assert.deepEqual(await communityXp(), { n: 4, xp: 4000 });
	await refused(save("partner-open", { title: "Late edit" }), /(completed goal cannot change|has started cannot change)/, "a completed goal cannot change");
	await refused(as(roles.questAdmin, async () => q("SELECT quest.remove_manual_goal($1,$2,$3)", [CAMPAIGN, "partner-open", ADMIN_WALLET])), /(completed goal cannot be removed|has started cannot be removed)/, "a completed goal cannot be removed");
	check("a completed goal is final");

	// ---- late Passports and what a player sees
	await q("INSERT INTO quest.passports (passport_id) VALUES ($1)", [LATE]);
	const mine = await overview(PASSPORTS[0]);
	const late = await overview(LATE);
	assert.equal(mine.length, 1);
	assert.deepEqual([mine[0].status, mine[0].received, mine[0].xp], ["COMPLETED", true, 1000]);
	assert.deepEqual([late[0].status, late[0].received], ["COMPLETED", false]);
	assert.equal((await communityXp()).n, 4);
	check("a Passport created after completion receives nothing and sees the goal as completed, not received");
	await refused(overview(PASSPORTS[0], roles.questAdmin), /permission denied/, "the quest admin cannot read a player's goal list");

	// ---- audit and immutability
	const audit = (await q("SELECT action, actor_wallet FROM quest.manual_goal_audit ORDER BY audit_id")).rows;
	assert.deepEqual(audit.map((a) => a.action), ["SAVE", "SAVE", "SAVE", "REMOVE", "COMPLETE"]);
	assert.ok(audit.every((a) => a.actor_wallet === ADMIN_WALLET));
	check("every save, removal and completion is audited with the admin wallet");
	await refused(q("UPDATE quest.manual_goal_audit SET action = 'SAVE'"), /append-only/, "the audit cannot be edited");
	await refused(q("DELETE FROM quest.manual_goal_audit"), /append-only/, "the audit cannot be deleted");
	await refused(q("TRUNCATE quest.manual_goal_audit"), /append-only/, "the audit cannot be truncated");
	await refused(q("UPDATE quest.manual_goal_completions SET recipients = 1"), /append-only/, "a completion cannot be edited");
	await refused(q("DELETE FROM quest.manual_goal_completions"), /append-only/, "a completion cannot be deleted");
	await refused(q("TRUNCATE quest.manual_goals"), /(append-only|foreign key)/, "the goal table cannot be truncated while completions reference it");
	console.log(`manual goal rehearsal passed: ${passed} checks`);
} finally {
	await connection?.end().catch(() => {});
	if (created) {
		await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`).catch(() => {});
		for (const role of Object.values(roles)) await admin.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => {});
	}
	await admin.end().catch(() => {});
}
