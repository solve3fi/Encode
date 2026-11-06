// Disposable integration rehearsal for the one-time social quests (migration 026): the real migrations and the real
// role grants. It creates and drops its own database; point it at a throwaway PostgreSQL 16 server
// (QUEST_TEST_PG_HOST/PORT/USER/PASSWORD). It checks who may run what, that a claim pays once, that nothing is paid
// for an unknown quest or while community-xp is paused, and that rules and claims are immutable.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import bs58 from "bs58";
import {
	partnerScoutRuntimeGrants,
	pauseAdminGrants,
	questAdminGrants,
	xpWriterGrants,
} from "../../deploy/quest-backend/swap-grants.mjs";

const pgModule = process.env.QUEST_TEST_PG_MODULE;
const { default: pg } = await import(pgModule ? pathToFileURL(pgModule).href : "pg");
const conn = {
	host: process.env.QUEST_TEST_PG_HOST ?? "127.0.0.1",
	port: Number(process.env.QUEST_TEST_PG_PORT ?? 5432),
	user: process.env.QUEST_TEST_PG_USER ?? "postgres",
	password: process.env.QUEST_TEST_PG_PASSWORD,
};
const stamp = `${Date.now()}_${process.pid}`;
const db = `quest_social_rehearsal_${stamp}`;
const roles = {
	questAdmin: `quest_social_admin_${stamp}`,
	pauseAdmin: `quest_social_pause_${stamp}`,
	settler: `quest_social_settler_${stamp}`,
	runtime: `quest_social_runtime_${stamp}`,
};
const admin = new pg.Client({ ...conn, database: process.env.QUEST_TEST_PG_ADMIN_DB ?? "postgres" });
const key = (n) => bs58.encode(Buffer.alloc(32, n));
const ADMIN_WALLET = key(99);
const [P1, P2] = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];

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
const claim = (passport, quest, role = roles.runtime) =>
	as(role, async () => (await q("SELECT quest.claim_social_quest($1,$2) AS r", [passport, quest])).rows[0].r);
const overview = (passport, role = roles.runtime) =>
	as(role, async () => (await q("SELECT quest.social_quests_overview($1) AS o", [passport])).rows[0].o);
const setPause = (keyName, paused, reason) =>
	as(roles.pauseAdmin, () => q("SELECT quest.set_pause($1,$2,$3,$4)", [keyName, paused, reason, ADMIN_WALLET]));
const socialXp = async (passport) =>
	(
		await q(
			"SELECT count(*)::int AS n, COALESCE(sum(xp_delta),0)::int AS xp FROM quest.xp_events WHERE qualification_key LIKE 'social-%' AND passport_id = $1",
			[passport],
		)
	).rows[0];

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
	for (const sql of partnerScoutRuntimeGrants(`"${roles.runtime}"`)) await q(sql);
	for (const id of [P1, P2]) await q("INSERT INTO quest.passports (passport_id) VALUES ($1)", [id]);
	check("migrations 001..026 and the role grants apply; two Passports exist");

	await refused(claim(P1, "follow-x", roles.questAdmin), /permission denied/, "the quest admin cannot claim for a player");
	await refused(claim(P1, "follow-x", roles.settler), /permission denied/, "the XP settler cannot claim for a player");
	await refused(as(roles.runtime, () => q("SELECT * FROM quest.social_quest_claims")), /permission denied/, "the serving role has no table access");
	await refused(claim(P1, "follow-everyone"), /(check|Unknown social quest)/i, "an unknown quest is refused");
	await refused(claim("99999999-9999-4999-8999-999999999999", "follow-x"), /Unknown Passport/, "an unknown Passport is refused");
	assert.deepEqual(await socialXp(P1), { n: 0, xp: 0 });
	check("refused claims pay nothing");

	const before = await overview(P1);
	assert.deepEqual(before.map((x) => x.key), ["follow-x", "post-x", "join-discord"]);
	assert.ok(before.every((x) => x.xp === 100 && x.claimedAt === null && /^https:\/\//.test(x.actionUrl)));
	assert.equal(before[1].postText.includes("@solve3fi") && before[1].postText.includes("solve3.fi/quests") && before[1].postText.length <= 280 && new URL(before[1].actionUrl).searchParams.get("text") === before[1].postText, true);
	check("a Passport sees the three quests at 100 XP each, none claimed");

	assert.equal((await claim(P1, "follow-x")).result, "OK");
	assert.deepEqual(await socialXp(P1), { n: 1, xp: 100 });
	assert.equal((await claim(P1, "follow-x")).result, "ALREADY");
	assert.deepEqual(await socialXp(P1), { n: 1, xp: 100 });
	check("a claim pays once; claiming again pays nothing");
	const after = await overview(P1);
	assert.ok(after[0].claimedAt && after[1].claimedAt === null && after[2].claimedAt === null);
	assert.deepEqual(await socialXp(P2), { n: 0, xp: 0 });
	assert.equal((await overview(P2))[0].claimedAt, null);
	check("claims are per Passport and only the claimed quest shows as done");

	await claim(P1, "post-x");
	await claim(P1, "join-discord");
	assert.deepEqual(await socialXp(P1), { n: 3, xp: 300 });
	check("all three quests pay 300 XP in total, once each");
	const total = (await q("SELECT COALESCE(sum(xp_delta),0)::int AS xp FROM quest.xp_events WHERE passport_id = $1", [P1])).rows[0].xp;
	assert.ok(total >= 300);
	check("the XP sits in the shared ledger");

	await setPause("community-xp", true, "rehearsal");
	await refused(claim(P2, "join-discord"), /paused/, "a claim is refused while community-xp is paused");
	assert.deepEqual(await socialXp(P2), { n: 0, xp: 0 });
	await setPause("community-xp", false, "rehearsal over");
	assert.equal((await claim(P2, "join-discord")).result, "OK");
	check("the pause stops claims and releasing it lets them through");

	await refused(q("UPDATE quest.social_quest_rules SET xp = 5000"), /append-only/, "a rule cannot be edited");
	await refused(q("DELETE FROM quest.social_quest_rules"), /append-only/, "a rule cannot be deleted");
	await refused(q("UPDATE quest.social_quest_claims SET xp = 5000"), /append-only/, "a claim cannot be edited");
	await refused(q("DELETE FROM quest.social_quest_claims"), /append-only/, "a claim cannot be deleted");
	await refused(q("TRUNCATE quest.social_quest_claims"), /(append-only|foreign key)/, "claims cannot be truncated");
	console.log(`social quests rehearsal passed: ${passed} checks`);
} finally {
	await connection?.end().catch(() => {});
	if (created) {
		await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`).catch(() => {});
		for (const role of Object.values(roles)) await admin.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => {});
	}
	await admin.end().catch(() => {});
}
