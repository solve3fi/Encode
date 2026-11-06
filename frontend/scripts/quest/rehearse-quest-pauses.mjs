// Disposable integration rehearsal for the Quest pause switches (migration 022): the real migrations and
// the real role grants. It creates and drops its own database; point it at a throwaway PostgreSQL 16
// server (QUEST_TEST_PG_HOST/PORT/USER/PASSWORD). It checks that each switch stops exactly its own path,
// that nothing is lost (evidence keeps recording, held-back awards are made on release), who may move a
// switch, and that every change is audited.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import bs58 from "bs58";
import {
	indexerGrants,
	pauseAdminGrants,
	votingRuntimeGrants,
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
const db = `quest_pause_rehearsal_${stamp}`;
const roles = {
	pauseAdmin: `quest_pause_admin_${stamp}`,
	settler: `quest_pause_settler_${stamp}`,
	indexer: `quest_pause_indexer_${stamp}`,
	runtime: `quest_pause_runtime_${stamp}`,
};
const admin = new pg.Client({ ...conn, database: process.env.QUEST_TEST_PG_ADMIN_DB ?? "postgres" });

const key = (n) => bs58.encode(Buffer.alloc(32, n));
const ADMIN_WALLET = key(99);
const WALLETS = [key(1), key(2), key(3), key(4)];
const MINTS = [key(11), key(12), key(13), key(14)];
const PASSPORTS = [
	"11111111-1111-4111-8111-111111111111",
	"22222222-2222-4222-8222-222222222222",
	"33333333-3333-4333-8333-333333333333",
	"44444444-4444-4444-8444-444444444444",
];
const HOUR = 3600;
const now = Math.floor(Date.now() / 1000);
const at = (secondsAgo) => new Date((now - secondsAgo) * 1000).toISOString();

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
const as = async (role, fn) => {
	await connection.query(`SET ROLE "${role}"`);
	try {
		return await fn();
	} finally {
		await connection.query("RESET ROLE");
	}
};
const q = (sql, params) => connection.query(sql, params);
const setPause = (role, keyName, paused, reason, actor = ADMIN_WALLET) =>
	as(role, async () => (await q("SELECT quest.set_pause($1,$2,$3,$4) AS r", [keyName, paused, reason, actor])).rows[0].r);
const status = async () => (await q("SELECT quest.pause_status() AS s")).rows[0].s;
const xpCount = async (qualification) =>
	(await q("SELECT count(*)::int AS n FROM quest.xp_events WHERE qualification_key = $1", [qualification])).rows[0].n;

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
	for (const sql of pauseAdminGrants(`"${roles.pauseAdmin}"`)) await q(sql);
	for (const sql of xpWriterGrants(`"${roles.settler}"`)) await q(sql);
	for (const sql of indexerGrants(`"${roles.indexer}"`)) await q(sql);
	await q(`REVOKE ALL ON ALL TABLES IN SCHEMA quest FROM "${roles.runtime}"`);
	for (const sql of votingRuntimeGrants(`"${roles.runtime}"`)) await q(sql);
	check("migrations 001..022 and the role grants apply to an empty database");

	// ---- Defaults and who may do what
	const initial = await status();
	assert.deepEqual(Object.keys(initial).sort(), ["community-xp", "onboarding-xp", "pass-mint", "referrals", "voting-xp", "weekly-xp"]);
	assert.ok(Object.values(initial).every((entry) => entry.paused === false && entry.reason === null));
	check("six independent switches exist and all start released");
	for (const role of [roles.settler, roles.runtime, roles.pauseAdmin]) {
		const seen = await as(role, async () => (await q("SELECT quest.pause_status() AS s")).rows[0].s);
		assert.equal(seen["weekly-xp"].paused, false);
	}
	check("the settler, the serving role and the pause admin can read the switches");
	for (const role of [roles.settler, roles.runtime, roles.indexer])
		await refused(setPause(role, "weekly-xp", true, "attack"), /permission denied/, `${role.split("_")[2]} role cannot move a switch`);
	await refused(as(roles.settler, () => q("UPDATE quest.pause_switches SET paused = true")), /permission denied/, "no role can write the switches directly");
	await refused(as(roles.pauseAdmin, () => q("UPDATE quest.pause_switches SET paused = true")), /permission denied/, "even the pause admin changes switches only through set_pause");

	// ---- Input rules
	await refused(setPause(roles.pauseAdmin, "weekly-xp", true, ""), /needs a reason/, "pausing needs a reason");
	await refused(setPause(roles.pauseAdmin, "weekly-xp", true, "x".repeat(201)), /too long/, "the reason is bounded");
	await refused(setPause(roles.pauseAdmin, "weekly-xp", true, "why", "not-a-wallet"), /admin wallet/, "a change needs a real admin wallet as actor");
	await refused(setPause(roles.pauseAdmin, "everything", true, "why"), /Unknown pause switch|check constraint/, "an unknown switch is refused");
	assert.equal((await q("SELECT count(*)::int AS n FROM quest.pause_audit")).rows[0].n, 0);
	check("refused changes leave no audit row and no change");

	// ---- Seed Passports, wallets, a verified mint and a pending reservation
	for (let i = 0; i < 4; i++) {
		await q("INSERT INTO quest.passports (passport_id) VALUES ($1)", [PASSPORTS[i]]);
		await q("INSERT INTO quest.wallet_bindings (wallet, passport_id) VALUES ($1,$2)", [WALLETS[i], PASSPORTS[i]]);
		await q("INSERT INTO quest.wallet_links (wallet,passport_id,linked_at,link_evidence_sha256) VALUES ($1,$2,$3,repeat('a',64))", [WALLETS[i], PASSPORTS[i], at(10 * 24 * HOUR)]);
	}

	// ---- weekly-xp
	await setPause(roles.pauseAdmin, "weekly-xp", true, "weekly XP investigation");
	await refused(q("INSERT INTO quest.weekly_test_receipts DEFAULT VALUES"), /Weekly quest XP is paused/, "weekly-xp paused: a new weekly receipt is refused");
	await setPause(roles.pauseAdmin, "weekly-xp", false, null);
	await assert.rejects(q("INSERT INTO quest.weekly_test_receipts DEFAULT VALUES"), (error) => !/paused/.test(error.message));
	check("weekly-xp released: the pause guard no longer stops a receipt");

	// ---- referrals
	await setPause(roles.pauseAdmin, "referrals", true, "referral abuse");
	await refused(q("INSERT INTO quest.referrals (referred_passport_id, referrer_passport_id, code) VALUES ($1,$2,'ABCDEFGH')", [PASSPORTS[0], PASSPORTS[1]]), /Referrals are paused/, "referrals paused: a redemption is refused");
	await setPause(roles.pauseAdmin, "referrals", false, null);
	await q("INSERT INTO quest.referrals (referred_passport_id, referrer_passport_id, code) VALUES ($1,$2,'ABCDEFGH')", [PASSPORTS[0], PASSPORTS[1]]);
	check("referrals released: the redemption goes through");

	// ---- pass-mint and onboarding-xp together, to show they are independent
	await q("INSERT INTO quest.pass_mint_reservations (wallet, passport_id, mint, created_at) VALUES ($1,$2,$3, now() - interval '3 hours')", [WALLETS[0], PASSPORTS[0], MINTS[0]]);
	await setPause(roles.pauseAdmin, "pass-mint", true, "mint program issue");
	await refused(
		q("INSERT INTO quest.pass_mint_reservations (wallet, passport_id, mint) VALUES ($1,$2,$3)", [WALLETS[1], PASSPORTS[1], MINTS[1]]),
		/New Pass mints are paused/,
		"pass-mint paused: a NEW reservation is refused",
	);
	await q("UPDATE quest.pass_mint_reservations SET verified_at = now() - interval '2 hours' WHERE wallet = $1", [WALLETS[0]]);
	assert.equal((await q("SELECT count(*)::int AS n FROM quest.devnet_pass_minters WHERE wallet = $1", [WALLETS[0]])).rows[0].n, 1);
	assert.equal(await xpCount("mint-pass"), 1);
	check("pass-mint paused: a mint already reserved still verifies, earns its XP and is recorded as a minter");
	await setPause(roles.pauseAdmin, "pass-mint", false, null);
	await q("INSERT INTO quest.pass_mint_reservations (wallet, passport_id, mint, created_at) VALUES ($1,$2,$3, now() - interval '3 hours')", [WALLETS[1], PASSPORTS[1], MINTS[1]]);
	check("pass-mint released: a new reservation is accepted");

	await setPause(roles.pauseAdmin, "onboarding-xp", true, "onboarding XP review");
	const heldBack = (await q("SELECT quest.award_devnet_onboarding_xp($1,'connect-wallet','wallet:held',repeat('b',64)) AS awarded", [PASSPORTS[2]])).rows[0].awarded;
	assert.equal(heldBack, false);
	await q("UPDATE quest.pass_mint_reservations SET verified_at = now() - interval '1 hour' WHERE wallet = $1", [WALLETS[1]]);
	assert.equal(await xpCount("mint-pass"), 1, "the second mint's XP is held back");
	assert.equal((await q("SELECT count(*)::int AS n FROM quest.devnet_pass_minters")).rows[0].n, 2, "but the second minter is still recorded");
	check("onboarding-xp paused: the award is skipped without failing the mint, and the minter is still recorded");
	const released = await setPause(roles.pauseAdmin, "onboarding-xp", false, null);
	assert.equal(released.caughtUp, 1);
	assert.equal(await xpCount("mint-pass"), 2);
	assert.equal((await setPause(roles.pauseAdmin, "onboarding-xp", false, null)).caughtUp, 0);
	check("onboarding-xp released: the held-back mint XP is awarded once, and releasing again adds nothing");

	// ---- voting-xp: evidence keeps recording, settlement waits
	const observe = (epoch, account, wallet, secondsAgo) =>
		q(
			`INSERT INTO quest.vote_observations (epoch_id,vote_account,owner_wallet,voting_power,gauge_count,vote_time,observed_slot)
			 VALUES ($1,$2,$3,5,1,$4,100) ON CONFLICT DO NOTHING`,
			[epoch, account, wallet, at(secondsAgo)],
		);
	const head = (epoch) => q("INSERT INTO quest.vote_epoch_heads (epoch_id,epoch_start_time,observed_slot) VALUES ($1,$2,100) ON CONFLICT DO NOTHING", [epoch, at(7 * 24 * HOUR)]);
	await setPause(roles.pauseAdmin, "voting-xp", true, "governance XP review");
	await as(roles.indexer, async () => {
		await observe(7, key(31), WALLETS[2], 5 * 24 * HOUR);
		await head(8);
	});
	let settled = await as(roles.settler, async () => (await q("SELECT quest.settle_voting_epochs() AS r")).rows[0].r);
	assert.deepEqual(settled, { settled: 0, currentEpoch: 8, paused: true });
	assert.equal(await xpCount("governance-epoch"), 0);
	assert.equal((await q("SELECT count(*)::int AS n FROM quest.vote_observations")).rows[0].n, 1);
	check("voting-xp paused: the vote is still recorded, settlement reports paused and awards nothing");
	await setPause(roles.pauseAdmin, "voting-xp", false, null);
	settled = await as(roles.settler, async () => (await q("SELECT quest.settle_voting_epochs() AS r")).rows[0].r);
	assert.equal(settled.settled, 1);
	assert.equal(await xpCount("governance-epoch"), 1);
	check("voting-xp released: the held-back epoch is awarded");

	// ---- Independence and audit
	await setPause(roles.pauseAdmin, "weekly-xp", true, "only weekly");
	const only = await status();
	assert.equal(only["weekly-xp"].paused, true);
	assert.equal(only["weekly-xp"].reason, "only weekly");
	assert.equal(only["weekly-xp"].changedBy, ADMIN_WALLET);
	assert.deepEqual(Object.entries(only).filter(([, v]) => v.paused).map(([k]) => k), ["weekly-xp"]);
	check("pausing one switch leaves the other four released, and the status shows who and why");
	await setPause(roles.pauseAdmin, "weekly-xp", false, null);
	const audit = (await q("SELECT switch_key, paused, reason, actor FROM quest.pause_audit ORDER BY audit_id")).rows;
	assert.ok(audit.length >= 10);
	assert.ok(audit.every((row) => row.actor === ADMIN_WALLET));
	assert.deepEqual(audit.filter((row) => row.switch_key === "referrals").map((row) => row.paused), [true, false]);
	check("every change, pause and release, is in the audit with the admin wallet");
	for (const statement of [
		"UPDATE quest.pause_audit SET paused = false",
		"DELETE FROM quest.pause_audit",
		"TRUNCATE quest.pause_audit",
		"DELETE FROM quest.pause_switches",
		"TRUNCATE quest.pause_switches",
	])
		await refused(q(statement), /append-only/, `the audit and switch rows refuse: ${statement.split(" ").slice(0, 3).join(" ")}`);

	console.log(`\nQuest pause rehearsal passed (${passed} checks); dropping the temporary database.`);
} finally {
	await connection?.end().catch(() => {});
	if (created) {
		await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
		for (const role of Object.values(roles)) await admin.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => {});
	}
	await admin.end().catch(() => {});
}
