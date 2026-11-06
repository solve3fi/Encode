// Disposable integration rehearsal for the Quest admin endpoint (quest-admin.mjs): the real migrations, the real
// quest admin grants and the real calendar store, driven through the handler with Request objects. It creates
// and drops its own database; point it at a throwaway PostgreSQL 16 server (QUEST_TEST_PG_HOST/PORT/USER/
// PASSWORD). It checks the token, publish/revise through the store under the narrow role, immutable started
// history, the manual goal actions end to end, and the rate budgets.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import bs58 from "bs58";
import { questAdminGrants } from "../../deploy/quest-backend/swap-grants.mjs";
import { createQuestAdminHandler } from "./quest-admin.mjs";
import { createQuestCalendarExample } from "./quest-calendar-example.mjs";

const pgModule = process.env.QUEST_TEST_PG_MODULE;
const { default: pg } = await import(pgModule ? pathToFileURL(pgModule).href : "pg");
const conn = {
	host: process.env.QUEST_TEST_PG_HOST ?? "127.0.0.1",
	port: Number(process.env.QUEST_TEST_PG_PORT ?? 5432),
	user: process.env.QUEST_TEST_PG_USER ?? "postgres",
	password: process.env.QUEST_TEST_PG_PASSWORD,
};
const stamp = `${Date.now()}_${process.pid}`;
const db = `quest_admin_rehearsal_${stamp}`;
const adminRole = `quest_admin_role_${stamp}`;
const admin = new pg.Client({ ...conn, database: process.env.QUEST_TEST_PG_ADMIN_DB ?? "postgres" });
const environment = {
	network: "DEVNET",
	environmentId: "33333333-3333-4333-8333-333333333333",
	manifestSha256: "a".repeat(64),
};
const TOKEN = "t".repeat(48);
const ACTOR = bs58.encode(Buffer.alloc(32, 99));
const DAY = 86400000;

let connection;
let created = false;
let passed = 0;
const check = (label) => {
	passed += 1;
	console.log(`ok ${passed} - ${label}`);
};

// A pool whose every connection runs as the narrow quest admin role, like the production login.
const makePool = (role) => ({
	async connect() {
		const client = new pg.Client({ ...conn, database: db });
		await client.connect();
		await client.query(`SET ROLE "${role}"`);
		return { query: (sql, params) => client.query(sql, params), release: () => void client.end() };
	},
	async query(sql, params) {
		const client = await this.connect();
		try {
			return await client.query(sql, params);
		} finally {
			client.release();
		}
	},
});

const call = async (handler, body, { token = TOKEN, method = "POST" } = {}) => {
	const response = await handler(
		new Request("http://quest-backend:8080/admin/quests", {
			method,
			headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
			...(method === "POST" ? { body: JSON.stringify(body) } : {}),
		}),
	);
	return { status: response.status, body: await response.json() };
};

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
			await connection.query(await readFile(base + name, "utf8"));
	}
	await admin.query(`CREATE ROLE "${adminRole}" NOLOGIN`);
	for (const sql of questAdminGrants(`"${adminRole}"`)) await connection.query(sql);
	await connection.query(
		`INSERT INTO quest.environment_identity (network,genesis_hash,environment_id,manifest_sha256,namespace)
		 VALUES ('DEVNET','EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',$1,$2,'quest')`,
		[environment.environmentId, environment.manifestSha256],
	);
	for (const id of ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"])
		await connection.query("INSERT INTO quest.passports (passport_id) VALUES ($1)", [id]);
	check("migrations and the quest admin grants apply; two Passports exist");

	const handler = createQuestAdminHandler({ token: TOKEN, pool: makePool(adminRole), environment, failedPerMinute: 4 });

	// ---- the door
	assert.equal((await call(handler, {}, { token: null })).status, 401);
	assert.equal((await call(handler, {}, { token: "wrong" })).status, 401);
	assert.equal((await call(handler, null, { method: "GET" })).status, 405);
	assert.equal((await call(handler, { action: "nope" })).status, 400);
	assert.equal((await call(handler, { action: "overview", campaignId: "Bad Id" })).status, 400);
	assert.equal((await call(handler, { action: "overview", campaignId: "x", extra: 1 })).status, 400);
	check("no token, a wrong token, a GET, an unknown action, a bad id and an extra field are all refused");
	const disabled = createQuestAdminHandler({});
	assert.equal((await call(disabled, {})).status, 404);
	assert.equal((await call(createQuestAdminHandler({ token: "short", pool: makePool(adminRole), environment }), {})).status, 404);
	check("without a long token or a pool the route does not exist");

	// ---- publish and revise through the calendar store under the narrow role
	const campaign = "quest-lab-2027";
	let overview = await call(handler, { action: "overview", campaignId: campaign });
	assert.deepEqual([overview.status, overview.body.plan, overview.body.goals], [200, null, []]);
	check("an unpublished campaign reads as no plan and no goals");
	const plan = createQuestCalendarExample(2027);
	let result = await call(handler, { action: "publish", plan, actor: ACTOR });
	assert.equal(result.status, 200);
	assert.equal(result.body.result.created, true);
	assert.equal(result.body.plan.revision, 1);
	check("a year plan publishes through the store");
	result = await call(handler, { action: "publish", plan, actor: ACTOR });
	assert.equal(result.body.result.created, false);
	check("publishing the same plan again changes nothing");
	result = await call(handler, { action: "publish", plan: { ...plan, weekCount: plan.weekCount - 1, weeks: plan.weeks.slice(1) }, actor: ACTOR });
	assert.equal(result.status, 400);
	check("a different plan under a published campaign is refused");
	assert.equal((await call(handler, { action: "publish", plan, actor: "not-a-wallet" })).status, 400);
	check("a publish needs a real admin wallet");

	const revised = structuredClone(plan);
	revised.weeks[5].questIds = [...plan.weeks[6].questIds];
	result = await call(handler, { action: "revise", plan: revised, expectedRevision: 1, actor: ACTOR });
	assert.equal(result.status, 200);
	assert.equal(result.body.plan.revision, 2);
	assert.deepEqual(result.body.plan.plan.weeks[5].questIds, plan.weeks[6].questIds);
	check("a future week can be revised and the revision counts up");
	const stale = structuredClone(plan);
	stale.weeks[7].questIds = [...plan.weeks[6].questIds];
	result = await call(handler, { action: "revise", plan: stale, expectedRevision: 1, actor: ACTOR });
	assert.equal(result.status, 409);
	check("a stale revision is a conflict, not a silent merge");

	// A plan that has already started: its started weeks are history and cannot be edited.
	const started = createQuestCalendarExample(2026);
	result = await call(handler, { action: "publish", plan: started, actor: ACTOR });
	assert.equal(result.status, 200);
	const rewritten = structuredClone(started);
	rewritten.weeks[0].questIds = [...started.weeks[1].questIds];
	result = await call(handler, { action: "revise", plan: rewritten, expectedRevision: 1, actor: ACTOR });
	assert.equal(result.status, 400);
	check("a week that has already started cannot be rewritten");

	// ---- manual community goals, end to end
	const base = { action: "save-goal", campaignId: campaign, actor: ACTOR };
	const goal = (over = {}) => ({
		id: "partner-m1",
		title: "Get a partner onboarded",
		flavorText: "Somebody important said yes.",
		startsAt: new Date(Date.now() - 3600_000).toISOString(),
		endsAt: new Date(Date.now() + 30 * DAY).toISOString(),
		xp: 1000,
		...over,
	});
	result = await call(handler, { ...base, goal: goal() });
	assert.equal(result.status, 200);
	assert.equal(result.body.goals[0].status, "ACTIVE");
	check("a goal saves and appears in the list");
	assert.equal((await call(handler, { ...base, goal: goal({ xp: 0 }) })).status, 400);
	assert.equal((await call(handler, { ...base, goal: goal({ startsAt: "yesterday" }) })).status, 400);
	assert.equal((await call(handler, { ...base, goal: goal({ id: "Bad Id" }) })).status, 400);
	assert.equal((await call(handler, { ...base, goal: { ...goal(), extra: 1 } })).status, 400);
	result = await call(handler, { ...base, goal: goal({ title: "Changed" }) });
	assert.equal(result.status, 400);
	assert.match(result.body.detail, /has started cannot change/);
	check("bad goal fields are refused and a started goal cannot be edited (with the reason shown)");
	result = await call(handler, { action: "complete-goal", campaignId: campaign, goalId: "partner-m1", note: "Partner A is live", actor: ACTOR });
	assert.equal(result.status, 200);
	assert.deepEqual([result.body.result.xpEach, result.body.result.recipients], [1000, 2]);
	assert.equal(result.body.goals[0].status, "COMPLETED");
	check("completing a goal pays every Passport and the list shows it completed");
	result = await call(handler, { action: "complete-goal", campaignId: campaign, goalId: "partner-m1", actor: ACTOR });
	assert.equal(result.status, 400);
	assert.match(result.body.detail, /already completed/);
	assert.equal((await connection.query("SELECT count(*)::int AS n FROM quest.xp_events WHERE qualification_key = 'community-goal'")).rows[0].n, 2);
	check("a second completion is refused and pays nothing more");
	await connection.query("UPDATE quest.pause_switches SET paused = true WHERE switch_key = 'community-xp'");
	await call(handler, { ...base, goal: goal({ id: "partner-m2", startsAt: new Date(Date.now() - 1000).toISOString() }) });
	result = await call(handler, { action: "complete-goal", campaignId: campaign, goalId: "partner-m2", actor: ACTOR });
	assert.equal(result.status, 400);
	assert.match(result.body.detail, /paused/);
	check("a paused community-xp switch refuses completion with a clear reason");
	await connection.query("UPDATE quest.pause_switches SET paused = false WHERE switch_key = 'community-xp'");
	const next = goal({ id: "partner-m3", startsAt: new Date(Date.now() + DAY).toISOString() });
	await call(handler, { ...base, goal: next });
	result = await call(handler, { action: "remove-goal", campaignId: campaign, goalId: "partner-m3", actor: ACTOR });
	assert.equal(result.status, 200);
	assert.ok(!result.body.goals.some((g) => g.goalId === "partner-m3"));
	check("an upcoming goal can be removed through the endpoint");

	// ---- Partner Scout leads through the endpoint
	const P1 = "11111111-1111-4111-8111-111111111111";
	const lead = async (name, host) =>
		(await connection.query("SELECT quest.submit_partner_lead($1,$2,$3,$4) AS r", [P1, name, `https://${host}`, "from the rehearsal"])).rows[0].r;
	await lead("Acme Labs", "acme.example");
	await lead("Beta Protocol", "beta.example");
	await lead("Gamma", "gamma.example");
	let leads = await call(handler, { action: "leads" });
	assert.equal(leads.status, 200);
	assert.equal(leads.body.bountyXp, 5000);
	assert.equal(leads.body.leads.length, 3);
	assert.ok(leads.body.leads.every((l) => l.status === "SUBMITTED"));
	check("the leads list carries the bounty and every undecided lead");
	assert.equal((await call(handler, { action: "leads", extra: 1 })).status, 400);
	assert.equal((await call(handler, { action: "reject-lead", leadId: 1 })).status, 400);
	assert.equal((await call(handler, { action: "reject-lead", leadId: 0, actor: ACTOR })).status, 400);
	assert.equal((await call(handler, { action: "reject-lead", leadId: "1", actor: ACTOR })).status, 400);
	assert.equal((await call(handler, { action: "onboard-lead", leadId: 1, actor: ACTOR, extra: true })).status, 400);
	assert.equal((await call(handler, { action: "onboard-lead", leadId: 1, note: "n".repeat(201), actor: ACTOR })).status, 400);
	check("malformed lead decisions are refused before the database");
	const byName = (name) => leads.body.leads.find((l) => l.partnerName === name);
	result = await call(handler, { action: "reject-lead", leadId: byName("Beta Protocol").leadId, note: "Already in our pipeline", actor: ACTOR });
	assert.equal(result.status, 200);
	assert.equal(result.body.leads.find((l) => l.partnerName === "Beta Protocol").status, "REJECTED");
	check("a lead can be rejected with a note");
	result = await call(handler, { action: "onboard-lead", leadId: byName("Acme Labs").leadId, note: "Live on devnet", actor: ACTOR });
	assert.equal(result.status, 200);
	assert.equal(result.body.result.bountyXp, 5000);
	assert.deepEqual(
		(await connection.query("SELECT count(*)::int AS n, COALESCE(sum(xp_delta),0)::int AS xp FROM quest.xp_events WHERE qualification_key = 'partner-scout'")).rows[0],
		{ n: 1, xp: 5000 },
	);
	check("onboarding a lead pays the scout the bounty once");
	result = await call(handler, { action: "onboard-lead", leadId: byName("Acme Labs").leadId, actor: ACTOR });
	assert.equal(result.status, 400);
	assert.match(result.body.detail, /already decided/);
	result = await call(handler, { action: "onboard-lead", leadId: 999999, actor: ACTOR });
	assert.equal(result.status, 400);
	assert.match(result.body.detail, /Unknown lead/);
	check("a decided or unknown lead is refused with the reason shown");
	await connection.query("UPDATE quest.pause_switches SET paused = true WHERE switch_key = 'community-xp'");
	result = await call(handler, { action: "onboard-lead", leadId: byName("Gamma").leadId, actor: ACTOR });
	assert.equal(result.status, 400);
	assert.match(result.body.detail, /paused/);
	await connection.query("UPDATE quest.pause_switches SET paused = false WHERE switch_key = 'community-xp'");
	check("a paused community-xp switch refuses a bounty with a clear reason");

	// ---- the narrow role really is narrow, and the failed-attempt budget works
	const probe = await makePool(adminRole).connect();
	await assert.rejects(probe.query("SELECT * FROM quest.xp_events"), /permission denied/);
	await assert.rejects(probe.query("INSERT INTO quest.calendar_milestones (campaign_id) VALUES ('x')"), /permission denied/);
	probe.release();
	check("the login can neither read the XP ledger nor write milestones");
	const limited = createQuestAdminHandler({ token: TOKEN, pool: makePool(adminRole), environment, failedPerMinute: 2 });
	const codes = [];
	for (let i = 0; i < 4; i++) codes.push((await call(limited, {}, { token: "wrong" })).status);
	assert.deepEqual(codes, [401, 401, 429, 429]);
	assert.equal((await call(limited, { action: "overview", campaignId: campaign })).status, 200);
	check("failed attempts are rate limited without locking the real admin out");
	console.log(`quest admin rehearsal passed: ${passed} checks`);
} finally {
	await connection?.end().catch(() => {});
	if (created) {
		await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`).catch(() => {});
		await admin.query(`DROP ROLE IF EXISTS "${adminRole}"`).catch(() => {});
	}
	await admin.end().catch(() => {});
}
