// Disposable integration rehearsal for Voting XP: the real migrations and the real least-privilege
// grants. It creates and drops its own database; point it at a throwaway PostgreSQL 16 server
// (QUEST_TEST_PG_HOST/PORT/USER/PASSWORD). No chain access. It checks who earns the governance Level,
// that it is awarded once per Passport per ended epoch, and what each database role may and may not do.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import bs58 from "bs58";
import { QUEST_XP_TOTAL_SQL } from "./quest-calendar-service.mjs";
import {
	indexerGrants,
	readerGrants,
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
const db = `quest_vote_rehearsal_${stamp}`;
const roles = {
	indexer: `quest_vote_indexer_${stamp}`,
	settler: `quest_vote_settler_${stamp}`,
	runtime: `quest_vote_runtime_${stamp}`,
};
const admin = new pg.Client({ ...conn, database: process.env.QUEST_TEST_PG_ADMIN_DB ?? "postgres" });

const wallet = (n) => bs58.encode(Buffer.alloc(32, n));
const W1A = wallet(1);
const W1B = wallet(2);
const W2 = wallet(3);
const W3 = wallet(4);
const W4 = wallet(5);
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";
const P4 = "44444444-4444-4444-8444-444444444444";
const HOUR = 3600;
const DAY = 24 * HOUR;
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
	for (const role of Object.values(roles)) await admin.query(`CREATE ROLE "${role}" NOLOGIN`);
	for (const sql of indexerGrants(`"${roles.indexer}"`)) await connection.query(sql);
	for (const sql of xpWriterGrants(`"${roles.settler}"`)) await connection.query(sql);
	for (const sql of readerGrants(`"${roles.runtime}"`)) await connection.query(sql);
	await connection.query(`REVOKE ALL ON ALL TABLES IN SCHEMA quest FROM "${roles.runtime}"`);
	for (const sql of votingRuntimeGrants(`"${roles.runtime}"`)) await connection.query(sql);
	check("migrations 001..020 and the role grants apply to an empty database");

	// ---- Passports and wallets
	for (const passport of [P1, P2, P3, P4])
		await connection.query("INSERT INTO quest.passports (passport_id) VALUES ($1)", [passport]);
	const link = async (walletAddress, passport, linkedAgo, unlinkedAgo = null) => {
		await connection.query("INSERT INTO quest.wallet_bindings (wallet,passport_id) VALUES ($1,$2)", [walletAddress, passport]);
		await connection.query(
			`INSERT INTO quest.wallet_links (wallet,passport_id,linked_at,unlinked_at,link_evidence_sha256,unlink_evidence_sha256)
			 VALUES ($1,$2,$3,$4,repeat('a',64),$5)`,
			[walletAddress, passport, at(linkedAgo), unlinkedAgo === null ? null : at(unlinkedAgo), unlinkedAgo === null ? null : "b".repeat(64)],
		);
	};
	await link(W1A, P1, 10 * DAY);
	await link(W1B, P1, 9 * DAY); // a second wallet of the same Passport
	await link(W2, P2, 10 * DAY);
	await link(W3, P3, 1 * HOUR); // linked AFTER it voted
	await link(W4, P4, 10 * DAY, 3 * DAY); // unlinked BEFORE it voted

	// ---- Settling with no epoch seen does nothing
	let settled = (await connection.query("SELECT quest.settle_voting_epochs() AS r")).rows[0].r;
	assert.deepEqual(settled, { settled: 0, currentEpoch: null });
	check("settling before any epoch has been seen awards nothing");

	// ---- The worker role records observations (the real path: it cannot do anything else)
	const observe = (epoch, voteAccount, owner, power, secondsAgo, slot = 5000) =>
		connection.query(
			`INSERT INTO quest.vote_observations (epoch_id,vote_account,owner_wallet,voting_power,gauge_count,vote_time,observed_slot)
			 VALUES ($1,$2,$3,$4,1,$5,$6) ON CONFLICT DO NOTHING`,
			[epoch, voteAccount, owner, power, at(secondsAgo), slot],
		);
	const head = (epoch, slot = 6000) =>
		connection.query(
			"INSERT INTO quest.vote_epoch_heads (epoch_id,epoch_start_time,observed_slot) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
			[epoch, at(7 * DAY), slot],
		);
	await as(roles.indexer, async () => {
		await observe(3, wallet(21), W1A, "2000000000000000", 5 * DAY); // P1, lock one
		await observe(3, wallet(22), W1A, "500000000000000", 5 * DAY - 60); // P1, lock two
		await observe(3, wallet(23), W1B, "100", 5 * DAY); // P1, second wallet
		await observe(3, wallet(24), W2, "1", 5 * DAY); // P2, smallest possible power
		await observe(3, wallet(25), W3, "1000", 5 * DAY); // P3, before it linked
		await observe(3, wallet(26), W4, "1000", 2 * DAY); // P4, after it unlinked
		await observe(4, wallet(27), W1A, "2000000000000000", 1 * HOUR); // the current epoch
		await head(3);
	});
	check("the worker role records votes and the epoch head");

	settled = (await connection.query("SELECT quest.settle_voting_epochs() AS r")).rows[0].r;
	assert.deepEqual(settled, { settled: 0, currentEpoch: 3 });
	check("an epoch is not settled while it is still the current epoch");

	// ---- Epoch 3 ends once epoch 4 is seen
	await as(roles.indexer, () => head(4));
	settled = await as(roles.settler, async () => (await connection.query("SELECT quest.settle_voting_epochs() AS r")).rows[0].r);
	assert.deepEqual(settled, { settled: 2, currentEpoch: 4 });
	const events = (await connection.query("SELECT * FROM quest.level_events ORDER BY passport_id")).rows;
	assert.equal(events.length, 2);
	assert.deepEqual(events.map((row) => row.passport_id), [P1, P2]);
	for (const row of events) {
		assert.equal(row.kind, "GOVERNANCE_EPOCH");
		assert.equal(Number(row.epoch_id), 3);
		assert.equal(row.level_delta, 1);
		assert.equal(row.rule_revision, 1);
		assert.match(row.evidence_sha256, /^[0-9a-f]{64}$/);
		assert.equal(row.idempotency_key, `governance:3:${row.passport_id}`);
	}
	assert.notEqual(events[0].evidence_sha256, events[1].evidence_sha256);
	const awards = (await connection.query("SELECT * FROM quest.xp_events WHERE qualification_key = 'governance-epoch' ORDER BY passport_id")).rows;
	assert.equal(awards.length, 2);
	for (const row of awards) {
		assert.equal(row.kind, "AWARD");
		assert.equal(Number(row.xp_delta), 500);
		assert.equal(row.season_key, "devnet-test-2026");
		assert.equal(row.source_event_key, `governance:3:${row.passport_id}`);
		assert.equal(row.evidence_sha256, events.find((e) => e.passport_id === row.passport_id).evidence_sha256);
	}
	check("each Passport earns exactly one 500 XP award and one +1 Level for epoch 3, however many locks and wallets voted");
	check("a wallet that voted before it was linked, or after it was unlinked, earns nothing");

	settled = (await connection.query("SELECT quest.settle_voting_epochs() AS r")).rows[0].r;
	assert.equal(settled.settled, 0);
	assert.equal((await connection.query("SELECT count(*)::int AS n FROM quest.level_events")).rows[0].n, 2);
	assert.equal((await connection.query("SELECT count(*)::int AS n FROM quest.xp_events WHERE qualification_key = 'governance-epoch'")).rows[0].n, 2);
	check("settling again is a no-op (idempotent)");

	// ---- What the Pass shows
	const overview = async (passport) =>
		as(roles.runtime, async () => (await connection.query("SELECT quest.voting_overview($1) AS r", [passport])).rows[0].r);
	const o1 = await overview(P1);
	assert.equal(o1.votingXp, 500);
	assert.equal(o1.xpPerEpoch, 500);
	assert.equal(o1.currentEpoch, 4);
	assert.equal(o1.votedThisEpoch, true);
	assert.deepEqual(o1.recentEpochs, [{ epoch: 3, earned: true }]);
	assert.equal(o1.testOnly, true);
	const o2 = await overview(P2);
	assert.equal(o2.votingXp, 500);
	assert.equal(o2.votedThisEpoch, false);
	const o3 = await overview(P3);
	assert.deepEqual([o3.votingXp, o3.votedThisEpoch, o3.recentEpochs], [0, false, []]);
	check("the overview shows Voting XP, the current epoch, and whether this epoch already has a vote");

	// ---- Epoch 4 is awarded only after epoch 5 is seen. P1 was referred by P3 just before, so the
	// existing referral rule (a percentage of every XP award the referred Passport earns) applies to
	// Voting XP too, and the bonus counts as Quest XP for the referrer.
	await connection.query(
		"INSERT INTO quest.referrals (referred_passport_id, referrer_passport_id, code) VALUES ($1, $2, 'ABCDEFGH')",
		[P1, P3],
	);
	await as(roles.indexer, () => head(5));
	settled = (await connection.query("SELECT quest.settle_voting_epochs() AS r")).rows[0].r;
	assert.equal(settled.settled, 1);
	assert.equal((await overview(P1)).votingXp, 1000);
	assert.equal((await connection.query(QUEST_XP_TOTAL_SQL, [P3])).rows[0].total, 50);
	assert.equal((await overview(P3)).votingXp, 0);
	check("the next epoch is awarded once the one after it is seen");
	check("a referred Passport's 500 Voting XP pays its referrer 50 as Quest XP, not as Voting XP");

	// ---- Evidence is first-write-wins and immutable
	const firstPower = (await connection.query("SELECT voting_power::text AS p FROM quest.vote_observations WHERE vote_account=$1", [wallet(24)])).rows[0].p;
	const again = await connection.query(
		`INSERT INTO quest.vote_observations (epoch_id,vote_account,owner_wallet,voting_power,gauge_count,vote_time,observed_slot)
		 VALUES (3,$1,$2,'999999',1,$3,9999) ON CONFLICT DO NOTHING`,
		[wallet(24), W2, at(1 * HOUR)],
	);
	assert.equal(again.rowCount, 0);
	assert.equal((await connection.query("SELECT voting_power::text AS p FROM quest.vote_observations WHERE vote_account=$1", [wallet(24)])).rows[0].p, firstPower);
	check("a later re-vote never replaces the first observation");
	for (const [table, statement] of [
		["quest.vote_observations", "UPDATE quest.vote_observations SET voting_power = 5"],
		["quest.vote_observations", "DELETE FROM quest.vote_observations"],
		["quest.vote_observations", "TRUNCATE quest.vote_observations"],
		["quest.vote_epoch_heads", "UPDATE quest.vote_epoch_heads SET epoch_id = 99"],
		["quest.vote_epoch_heads", "DELETE FROM quest.vote_epoch_heads"],
		["quest.governance_test_rules", "UPDATE quest.governance_test_rules SET minimum_voting_power = 1"],
	])
		await refused(connection.query(statement), /append-only/, `${table} refuses: ${statement.split(" ").slice(0, 2).join(" ")}`);
	await refused(
		connection.query(
			`INSERT INTO quest.vote_observations (epoch_id,vote_account,owner_wallet,voting_power,gauge_count,vote_time,observed_slot)
			 VALUES (3,$1,$2,0,1,now(),1)`,
			[wallet(30), W2],
		),
		/violates check constraint/,
		"a vote with no voting power is not accepted as evidence",
	);

	// ---- Quest XP never includes Voting XP
	await connection.query(
		"INSERT INTO quest.xp_events (passport_id,idempotency_key,kind,source_event_key,qualification_key,rule_revision,season_key,evidence_sha256,xp_delta) VALUES ($1,'quest:p1:swap','AWARD','quest:p1:swap','weekly-quest',1,'devnet-test-2026',repeat('d',64),400)",
		[P1],
	);
	assert.equal((await connection.query(QUEST_XP_TOTAL_SQL, [P1])).rows[0].total, 400);
	assert.equal((await overview(P1)).votingXp, 1000);
	assert.equal((await connection.query(QUEST_XP_TOTAL_SQL, [P3])).rows[0].total, 90);
	check("Quest XP counts only quest awards (400) while Voting XP counts only governance awards (1000)");

	// ---- Role boundaries
	await refused(as(roles.indexer, () => connection.query("SELECT * FROM quest.level_events")), /permission denied/, "the worker role cannot read Levels");
	await refused(
		as(roles.indexer, () => connection.query("INSERT INTO quest.level_events (passport_id,idempotency_key,kind,epoch_id,rule_revision,evidence_sha256,level_delta) VALUES ($1,'x','GOVERNANCE_EPOCH',9,1,repeat('c',64),1)", [P3])),
		/permission denied/,
		"the worker role cannot write Levels",
	);
	await refused(as(roles.indexer, () => connection.query("SELECT quest.settle_voting_epochs()")), /permission denied/, "the worker role cannot run the settlement function");
	await refused(
		as(roles.settler, () => connection.query("INSERT INTO quest.level_events (passport_id,idempotency_key,kind,epoch_id,rule_revision,evidence_sha256,level_delta) VALUES ($1,'y','GOVERNANCE_EPOCH',9,1,repeat('c',64),1)", [P3])),
		/permission denied/,
		"the settler role cannot write Levels directly",
	);
	await refused(
		as(roles.settler, () => connection.query("INSERT INTO quest.vote_observations (epoch_id,vote_account,owner_wallet,voting_power,gauge_count,vote_time,observed_slot) VALUES (3,$1,$2,5,1,now(),1)", [wallet(31), W3])),
		/permission denied/,
		"the settler role cannot forge vote evidence",
	);
	await refused(as(roles.runtime, () => connection.query("SELECT quest.settle_voting_epochs()")), /permission denied/, "the serving role cannot run settlement");
	await refused(as(roles.runtime, () => connection.query("SELECT * FROM quest.vote_observations")), /permission denied/, "the serving role cannot read vote evidence tables");
	await refused(as(roles.runtime, () => connection.query("SELECT * FROM quest.level_events")), /permission denied/, "the serving role reads Voting XP only through the overview function");

	// ---- A reviewed reversal lowers Voting XP, and settlement never re-awards that epoch
	const p2Award = awards.find((row) => row.passport_id === P2);
	await connection.query(
		"INSERT INTO quest.xp_events (passport_id,idempotency_key,kind,season_key,xp_delta,reverses_event_id,review_ref) VALUES ($1,'reversal:p2:3','REVERSAL','devnet-test-2026',-500,$2,'review-1')",
		[P2, p2Award.event_id],
	);
	const afterReversal = await overview(P2);
	assert.equal(afterReversal.votingXp, 0);
	assert.deepEqual(afterReversal.recentEpochs, []);
	settled = (await connection.query("SELECT quest.settle_voting_epochs() AS r")).rows[0].r;
	assert.equal(settled.settled, 0);
	assert.equal((await overview(P2)).votingXp, 0);
	assert.equal((await connection.query(QUEST_XP_TOTAL_SQL, [P2])).rows[0].total, 0);
	check("a reviewed reversal lowers Voting XP, leaves Quest XP alone, and the epoch is never awarded again");

	console.log(`\nVoting XP rehearsal passed (${passed} checks); dropping the temporary database.`);
} finally {
	await connection?.end().catch(() => {});
	if (created) {
		await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
		for (const role of Object.values(roles)) await admin.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => {});
	}
	await admin.end().catch(() => {});
}
