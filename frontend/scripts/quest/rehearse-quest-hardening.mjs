// Disposable integration rehearsal for the Partner Scout (migration 025): the real migrations and the real role
// grants. It creates and drops its own database; point it at a throwaway PostgreSQL 16 server (QUEST_TEST_PG_HOST/
// PORT/USER/PASSWORD). It checks who may run what, input rules, the first-lead-wins dedupe, the weekly limit, that
// nothing is paid on submission or rejection, that onboarding pays the scout exactly once and honours the
// community-xp pause, and that every decision is audited and immutable.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import bs58 from "bs58";
import {
	pauseAdminGrants,
	partnerScoutRuntimeGrants,
	questAdminGrants,
	xpWriterGrants,
} from "../../deploy/quest-backend/swap-grants.mjs";
import { QUEST_XP_TOTAL_SQL } from "./quest-calendar-service.mjs";
import { createQuestCalendarStore } from "./quest-calendar-store.mjs";
import { createYearPlan } from "./quest-year-plan.mjs";
import { readQuestReleaseReadiness } from "./quest-release-readiness.mjs";

const pgModule = process.env.QUEST_TEST_PG_MODULE;
const { default: pg } = await import(pgModule ? pathToFileURL(pgModule).href : "pg");
const conn = {
	host: process.env.QUEST_TEST_PG_HOST ?? "127.0.0.1",
	port: Number(process.env.QUEST_TEST_PG_PORT ?? 5432),
	user: process.env.QUEST_TEST_PG_USER ?? "postgres",
	password: process.env.QUEST_TEST_PG_PASSWORD,
};
const stamp = `${Date.now()}_${process.pid}`;
const db = `quest_scout_rehearsal_${stamp}`;
const roles = {
	questAdmin: `quest_scout_admin_${stamp}`,
	pauseAdmin: `quest_scout_pause_${stamp}`,
	settler: `quest_scout_settler_${stamp}`,
	runtime: `quest_scout_runtime_${stamp}`,
};
const admin = new pg.Client({ ...conn, database: process.env.QUEST_TEST_PG_ADMIN_DB ?? "postgres" });
const key = (n) => bs58.encode(Buffer.alloc(32, n));
const ADMIN_WALLET = key(99);
const SCOUT_WALLET = key(7);
const [P1, P2, P3] = [
	"11111111-1111-4111-8111-111111111111",
	"22222222-2222-4222-8222-222222222222",
	"33333333-3333-4333-8333-333333333333",
];

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
const submit = (passport, name, url, note = "", role = roles.runtime) =>
	as(role, async () => (await q("SELECT quest.submit_partner_lead($1,$2,$3,$4) AS r", [passport, name, url, note])).rows[0].r);
const overview = (passport, role = roles.runtime) =>
	as(role, async () => (await q("SELECT quest.partner_scout_overview($1) AS o", [passport])).rows[0].o);
const adminView = (role = roles.questAdmin) => as(role, async () => (await q("SELECT quest.partner_leads_admin() AS v")).rows[0].v);
const reject = (id, note = null, role = roles.questAdmin) =>
	as(role, async () => (await q("SELECT quest.reject_partner_lead($1,$2,$3) AS r", [id, ADMIN_WALLET, note])).rows[0].r);
const onboard = (id, note = null, role = roles.questAdmin) =>
	as(role, async () => (await q("SELECT quest.onboard_partner_lead($1,$2,$3) AS r", [id, ADMIN_WALLET, note])).rows[0].r);
const setPause = (keyName, paused, reason) =>
	as(roles.pauseAdmin, () => q("SELECT quest.set_pause($1,$2,$3,$4)", [keyName, paused, reason, ADMIN_WALLET]));
const scoutXp = async () =>
	(await q("SELECT count(*)::int AS n, COALESCE(sum(xp_delta),0)::int AS xp FROM quest.xp_events WHERE qualification_key = 'partner-scout'")).rows[0];

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
	for (const id of [P1, P2, P3]) await q("INSERT INTO quest.passports (passport_id) VALUES ($1)", [id]);
	await q("INSERT INTO quest.wallet_bindings (wallet,passport_id) VALUES ($1,$2)", [SCOUT_WALLET, P1]);
	await q("INSERT INTO quest.wallet_links (wallet,passport_id,linked_at,link_evidence_sha256) VALUES ($1,$2,now(),repeat('a',64))", [SCOUT_WALLET, P1]);
	check("all migrations including Genesis reset and the role grants apply; three Passports exist, one linked to a wallet");

	// ---- who may do what
	await refused(submit(P1, "Acme", "https://acme.example", "", roles.questAdmin), /permission denied/, "the quest admin cannot submit a lead");
	await refused(submit(P1, "Acme", "https://acme.example", "", roles.settler), /permission denied/, "the XP settler cannot submit a lead");
	await refused(as(roles.runtime, () => q("SELECT quest.partner_leads_admin()")), /permission denied/, "the serving role cannot read the admin list");
	await refused(as(roles.runtime, () => q("SELECT quest.onboard_partner_lead(1,$1,null)", [ADMIN_WALLET])), /permission denied/, "the serving role cannot onboard a lead");
	await refused(as(roles.runtime, () => q("SELECT * FROM quest.partner_leads")), /permission denied/, "the serving role has no table access");
	await refused(overview(P1, roles.questAdmin), /permission denied/, "the quest admin cannot read a player's overview");
	await refused(as(roles.questAdmin, () => q("SELECT * FROM quest.partner_leads")), /permission denied/, "even the quest admin reads leads only through the function");

	// ---- input rules
	await refused(submit(P1, "A", "https://acme.example"), /name needs 2 to 80/, "a one-character partner name is refused");
	await refused(submit(P1, "x".repeat(81), "https://acme.example"), /name needs 2 to 80/, "an 81-character partner name is refused");
	await refused(submit(P1, "Acme", "ftp://acme.example"), /must be a web address/, "a non-web link is refused");
	await refused(submit(P1, "Acme", "acme.example"), /must be a web address/, "a link without a scheme is refused");
	await refused(submit(P1, "Acme", "https://"), /must be a web address/, "a link without a host is refused");
	await refused(submit(P1, "Acme", "https://acme.example", "n".repeat(301)), /note is too long/, "a note over 300 characters is refused");
	await refused(submit("99999999-9999-4999-8999-999999999999", "Acme", "https://acme.example"), /Unknown Passport/, "an unknown Passport is refused");
	assert.equal((await q("SELECT count(*)::int AS n FROM quest.partner_leads")).rows[0].n, 0);
	check("refused submissions leave nothing behind");

	// ---- a lead, dedupe, weekly limit
	const first = await submit(P1, "Acme Labs", "https://www.Acme-Labs.example:8443/team", "They run a DEX aggregator");
	assert.equal(first.result, "OK");
	const view1 = await overview(P1);
	assert.deepEqual([view1.bountyXp, view1.weeklyLimit, view1.remainingThisWeek, view1.leads.length], [5000, 3, 2, 1]);
	assert.equal(view1.leads[0].status, "SUBMITTED");
	check("a lead is stored and the Passport sees it, with two submissions left this week");
	const dup = await submit(P2, "Acme (again)", "http://acme-labs.example/other");
	assert.equal(dup.result, "DUPLICATE");
	assert.equal((await overview(P2)).leads.length, 0);
	check("the same site under another scheme, www, port or case is a duplicate and is not stored");
	await submit(P1, "Beta", "https://beta.example");
	await submit(P1, "Gamma", "https://gamma.example");
	await refused(submit(P1, "Delta", "https://delta.example"), /Too many leads this week/, "a fourth lead in a week is refused");
	assert.equal((await submit(P2, "Delta", "https://delta.example")).result, "OK");
	check("the weekly limit is per Passport");
	assert.equal((await scoutXp()).n, 0);
	check("nothing is paid on submission");

	// ---- admin view
	const listed = await adminView();
	assert.equal(listed.bountyXp, 5000);
	assert.equal(listed.leads.length, 4);
	const acme = listed.leads.find((l) => l.partnerName === "Acme Labs");
	assert.deepEqual([acme.status, acme.scoutWallet, acme.partnerKey, acme.passportId], ["SUBMITTED", SCOUT_WALLET, "acme-labs.example", P1]);
	check("the admin list shows each lead with its scout wallet and a normalised partner key");

	// ---- reject, then the partner is free again
	await refused(reject(999999), /Unknown lead/, "rejecting an unknown lead is refused");
	await refused(reject(acme.leadId, "n".repeat(201)), /note is too long/, "a rejection note over 200 characters is refused");
	const beta = listed.leads.find((l) => l.partnerName === "Beta");
	assert.equal((await reject(beta.leadId, "Already in our pipeline")).status, "REJECTED");
	const scoutView = await overview(P1);
	assert.equal(scoutView.leads.find((l) => l.name === "Beta").note, "Already in our pipeline");
	assert.equal(scoutView.leads.find((l) => l.name === "Acme Labs").note, null);
	assert.deepEqual(await scoutXp(), { n: 0, xp: 0 });
	check("a rejected lead tells the scout why, pays nothing, and hides notes on other leads");
	await refused(reject(beta.leadId), /already decided/, "a lead cannot be decided twice");
	assert.equal((await submit(P3, "Beta Protocol", "https://beta.example")).result, "OK");
	check("a rejected partner can be sent again by someone else");

	// ---- onboard: the pause, the single payment
	await setPause("community-xp", true, "rehearsal");
	await refused(onboard(acme.leadId), /Community XP is paused/, "onboarding is refused while community-xp is paused");
	assert.deepEqual(await scoutXp(), { n: 0, xp: 0 });
	assert.equal((await q("SELECT status FROM quest.partner_leads WHERE lead_id = $1", [acme.leadId])).rows[0].status, "SUBMITTED");
	check("a paused onboarding pays nothing and leaves the lead undecided");
	await setPause("community-xp", false, null);
	const paid = await onboard(acme.leadId, "Live on devnet");
	assert.deepEqual([paid.status, paid.bountyXp], ["ONBOARDED", 5000]);
	assert.deepEqual(await scoutXp(), { n: 1, xp: 5000 });
	assert.equal((await q(QUEST_XP_TOTAL_SQL, [P1])).rows[0].total, 5000);
	assert.equal((await q(QUEST_XP_TOTAL_SQL, [P2])).rows[0].total, 0);
	check("onboarding pays the scout the bounty once, counted as Quest XP, and nobody else");
	await refused(onboard(acme.leadId), /already decided/, "a lead cannot be onboarded twice");
	assert.deepEqual(await scoutXp(), { n: 1, xp: 5000 });
	assert.equal((await submit(P2, "Acme Labs Two", "https://acme-labs.example")).result, "DUPLICATE");
	check("an onboarded partner cannot be claimed again");

	// ---- audit and immutability
	const audit = (await q("SELECT action, actor_wallet FROM quest.partner_lead_audit ORDER BY audit_id")).rows;
	assert.deepEqual(audit.map((a) => a.action), ["REJECT", "ONBOARD"]);
	assert.ok(audit.every((a) => a.actor_wallet === ADMIN_WALLET));
	check("every decision is audited with the admin wallet");
	await refused(q("UPDATE quest.partner_leads SET partner_name = 'Changed' WHERE lead_id = $1", [acme.leadId]), /decided lead cannot change/, "a decided lead cannot be edited");
	await refused(q("DELETE FROM quest.partner_leads"), /cannot be deleted/, "a lead cannot be deleted");
	await refused(q("TRUNCATE quest.partner_leads"), /(append-only|foreign key)/, "leads cannot be truncated");
	await refused(q("UPDATE quest.partner_lead_audit SET action = 'REJECT'"), /append-only/, "the audit cannot be edited");
	await refused(q("DELETE FROM quest.partner_lead_audit"), /append-only/, "the audit cannot be deleted");

    // Regression checks use independent connections, not a shared transaction queue.
    const extras = Array.from({length:6}, (_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`);
    for (const id of extras) await q("INSERT INTO quest.passports(passport_id) VALUES($1)",[id]);
    const [a,b,c,scout,minter,empty] = extras;
    const codes=[];
    for (const id of [a,b,c]) codes.push((await q("SELECT quest.referral_overview($1) AS v",[id])).rows[0].v.code);
    assert.equal((await q("SELECT quest.redeem_referral($1,$2) AS v",[a,codes[1]])).rows[0].v,'OK');
    assert.equal((await q("SELECT quest.redeem_referral($1,$2) AS v",[b,codes[2]])).rows[0].v,'OK');
    assert.equal((await q("SELECT quest.redeem_referral($1,$2) AS v",[c,codes[0]])).rows[0].v,'CYCLE');
    check("three-Passport referral cycle is rejected");
    const award=(await q("INSERT INTO quest.xp_events(network,passport_id,idempotency_key,kind,source_event_key,qualification_key,rule_revision,evidence_sha256,xp_delta) VALUES('DEVNET',$1,'regression-award','AWARD','regression-award','weekly-quest',1,repeat('a',64),100) RETURNING event_id",[a])).rows[0].event_id;
    assert.equal((await q("SELECT quest.referral_overview($1) AS v",[b])).rows[0].v.bonusXp,10);
    await q("INSERT INTO quest.xp_events(network,passport_id,idempotency_key,kind,reverses_event_id,review_ref,xp_delta) VALUES('DEVNET',$1,'regression-reversal','REVERSAL',$2,'test-review',-100)",[a,award]);
    assert.equal((await q("SELECT quest.referral_overview($1) AS v",[b])).rows[0].v.bonusXp,0);
    check("referral overview nets the automatically reversed bonus");
    for (const qualification of ['connect-wallet','mint-pass','partner-scout','community-goal','manual-grant','promotional-grant']) {
      await q("INSERT INTO quest.xp_events(network,passport_id,idempotency_key,kind,source_event_key,qualification_key,rule_revision,evidence_sha256,xp_delta) VALUES('DEVNET',$1,$2,'AWARD',$2,$3,1,repeat('d',64),1000)",[a,`excluded:${qualification}`,qualification]);
    }
    assert.equal((await q("SELECT quest.referral_overview($1) AS v",[b])).rows[0].v.bonusXp,0);
    await q("INSERT INTO quest.xp_events(network,passport_id,idempotency_key,kind,source_event_key,qualification_key,rule_revision,evidence_sha256,xp_delta) VALUES('DEVNET',$1,'eligible-voting','AWARD','eligible-voting','governance-epoch',1,repeat('d',64),500)",[a]);
    assert.equal((await q("SELECT quest.referral_overview($1) AS v",[b])).rows[0].v.bonusXp,50);
    assert.equal((await q("SELECT quest.referral_overview($1) AS v",[c])).rows[0].v.bonusXp,0);
    check("weekly and voting sources pay one level only; all six excluded grant categories pay no bonus");
    const clients=await Promise.all(Array.from({length:5},async()=>{const x=new pg.Client({...conn,database:db});await x.connect();return x;}));
    try {
      const results=await Promise.allSettled(clients.map((x,i)=>x.query("SELECT quest.submit_partner_lead($1,'Concurrent partner',$2,NULL)",[scout,`https://concurrent-${i}.example`])));
      assert.equal(results.filter(x=>x.status==='fulfilled').length,3);
      assert.ok(results.filter(x=>x.status==='rejected').every(x=>/Too many leads/.test(x.reason.message)));
      check("five concurrent distinct Scout submissions admit exactly three");
      const x='00000000-0000-4000-8000-000000000007', y='00000000-0000-4000-8000-000000000008';
      await q("INSERT INTO quest.passports(passport_id) VALUES($1),($2)",[x,y]);
      const cx=(await q("SELECT quest.referral_overview($1) AS v",[x])).rows[0].v.code;
      const cy=(await q("SELECT quest.referral_overview($1) AS v",[y])).rows[0].v.code;
      const cycle=await Promise.all([clients[0].query("SELECT quest.redeem_referral($1,$2) AS v",[x,cy]),clients[1].query("SELECT quest.redeem_referral($1,$2) AS v",[y,cx])]);
      assert.deepEqual(cycle.map(r=>r.rows[0].v).sort(),['CYCLE','OK']);
      check("concurrent reciprocal referral attempts admit one edge only");
      const rr='00000000-0000-4000-8000-000000000009';await q("INSERT INTO quest.passports(passport_id) VALUES($1)",[rr]);
      for (const client of clients.slice(0,2)) {await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await client.query('SELECT count(*) FROM quest.partner_leads');}
      await clients[0].query("SELECT quest.submit_partner_lead($1,'RR first','https://rr-first.example',NULL)",[rr]);await clients[0].query('COMMIT');
      await assert.rejects(clients[1].query("SELECT quest.submit_partner_lead($1,'RR second','https://rr-second.example',NULL)",[rr]),e=>e.code==='40001');await clients[1].query('ROLLBACK');
      check("stale repeatable-read Scout transaction fails instead of bypassing quota");
    } finally {await Promise.all(clients.map(x=>x.end()));}
    const mintWallet=key(77), mintKey=key(78);
    await q("INSERT INTO quest.wallet_bindings(network,wallet,passport_id) VALUES('DEVNET',$1,$2)",[mintWallet,minter]);
    await q("INSERT INTO quest.pass_mint_reservations(network,wallet,passport_id,mint) VALUES('DEVNET',$1,$2,$3)",[mintWallet,minter,mintKey]);
    await q("UPDATE quest.pass_mint_reservations SET verified_at=clock_timestamp() WHERE wallet=$1",[mintWallet]);
    await q("INSERT INTO quest.xp_events(network,passport_id,idempotency_key,kind,source_event_key,qualification_key,rule_revision,evidence_sha256,xp_delta) VALUES('DEVNET',$1,'temporary-reset-fixture','AWARD','temporary-reset-fixture','partner-scout',1,repeat('b',64),17800)",[minter]);
    const target='99999999-9999-4999-8999-999999999999';
    await q("INSERT INTO quest.environment_identity(network,genesis_hash,environment_id,manifest_sha256,namespace) VALUES('DEVNET','EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('c',64),'quest')");
    const calendarPool = new pg.Pool({...conn,database:db});
    try {
      const calendar=createQuestCalendarStore({pool:calendarPool,environment:{network:'DEVNET',genesisHash:'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',environmentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',manifestSha256:'c'.repeat(64),namespace:'quest'}});
      const plan=JSON.parse(JSON.stringify(createYearPlan()).replace(/\d{4}-\d{2}-\d{2}/g,date=>{
        const shifted=new Date(date+'T00:00:00Z');shifted.setUTCDate(shifted.getUTCDate()+3640);
        return shifted.toISOString().slice(0,10);
      }));
      await calendar.publish(plan,{actor:ADMIN_WALLET});
      assert.equal((await q("SELECT actor_wallet FROM quest.calendar_admin_audit")).rows[0].actor_wallet,ADMIN_WALLET);
      await calendar.publish(plan,{actor:ADMIN_WALLET});
      assert.equal((await q("SELECT count(*)::int AS n FROM quest.calendar_admin_audit")).rows[0].n,1);
      const invalid=structuredClone(plan);invalid.campaignId='invalid-actor-plan';
      await refused(calendar.publish(invalid,{actor:'bad'}),/admin actor/,"invalid calendar actor rolls back publication");
      assert.equal((await q("SELECT count(*)::int AS n FROM quest.calendar_plans WHERE campaign_id='invalid-actor-plan'")).rows[0].n,0);
      await refused(q("DELETE FROM quest.calendar_admin_audit"),/append-only/,"calendar actor receipt cannot be deleted");
      check("calendar publish records its authenticated actor once in the same transaction");
      const revised=structuredClone(plan);revised.templates[0].flavorText='Audit revision rehearsal';
      await calendar.revise(revised,{expectedRevision:1,actor:ADMIN_WALLET});
      assert.deepEqual((await q("SELECT action,revision,actor_wallet FROM quest.calendar_admin_audit ORDER BY revision")).rows.map(r=>[r.action,r.revision,r.actor_wallet]),[['PUBLISH',1,ADMIN_WALLET],['REVISE',2,ADMIN_WALLET]]);
      check("calendar revision records its actor and revision atomically");
    } finally {await calendarPool.end();}
    const preview=(await q("SELECT quest_genesis.preview_reset(clock_timestamp(),$1,$2) AS v",[target,key(79)])).rows[0].v;
    await refused(as(roles.runtime,()=>q("SELECT quest_genesis.apply_reset($1)",[preview])),/permission denied/,"runtime cannot apply a Genesis reset");
    const altered=structuredClone(preview);altered.body.mintPassXp=18050;
    await refused(q("SELECT quest_genesis.apply_reset($1)",[altered]),/tampered/,"tampered reset cannot initialize a target");
    assert.equal((await q("SELECT quest_genesis.apply_reset($1) AS v",[preview])).rows[0].v.created,true);
    assert.equal((await q("SELECT sum(xp_delta)::int AS xp FROM quest_genesis.xp_events WHERE passport_id=$1",[minter])).rows[0].xp,250);
    assert.equal((await q("SELECT sum(xp_delta)::int AS xp FROM quest.xp_events WHERE passport_id=$1",[minter])).rows[0].xp,18050);
    assert.equal((await q("SELECT count(*)::int AS n FROM quest_genesis.xp_events WHERE passport_id=$1",[empty])).rows[0].n,0);
    check("18,050 Devnet XP becomes exactly 250; non-minter gets zero and history survives");
    assert.equal((await q("SELECT quest_genesis.apply_reset($1) AS v",[preview])).rows[0].v.created,false);
    await q("INSERT INTO quest.xp_events(network,passport_id,idempotency_key,kind,source_event_key,qualification_key,rule_revision,evidence_sha256,xp_delta) VALUES('DEVNET',$1,'late-devnet-award','AWARD','late-devnet-award','weekly-quest',1,repeat('e',64),500)",[minter]);
    assert.equal((await q("SELECT quest_genesis.apply_reset($1) AS v",[preview])).rows[0].v.created,false);
    assert.equal((await q("SELECT sum(xp_delta)::int AS xp FROM quest_genesis.xp_events WHERE passport_id=$1",[minter])).rows[0].xp,250);
    check("late Devnet writes and reset retries cannot inflate Genesis XP");
    await refused(q("UPDATE quest_genesis.xp_events SET xp_delta=250"),/immutable/,"permanent Genesis mint credit cannot be changed");
    const different=structuredClone(preview);different.body.targetGenesis=key(80);
    await refused(q("SELECT quest_genesis.apply_reset($1)",[different]),/different document/,"initialized environment rejects a different reset");
    check("reset replay is idempotent");
    const parallelTarget='88888888-8888-4888-8888-888888888888';
    const parallelDoc=(await q("SELECT quest_genesis.preview_reset(clock_timestamp(),$1,$2) AS v",[parallelTarget,key(79)])).rows[0].v;
    const resetClients=await Promise.all([0,1].map(async()=>{const client=new pg.Client({...conn,database:db});await client.connect();return client;}));
    try {
      const applied=await Promise.all(resetClients.map(client=>client.query("SELECT quest_genesis.apply_reset($1) AS v",[parallelDoc])));
      assert.deepEqual(applied.map(r=>r.rows[0].v.created).sort(),[false,true]);
      check("concurrent identical Genesis resets initialize once");
    } finally {await Promise.all(resetClients.map(client=>client.end()));}
    assert.equal((await as(roles.settler,()=>q("SELECT quest.lock_lp_test_source('missing-campaign',repeat('f',64),1,15) AS valid"))).rows[0].valid,false);
    check("settler cannot trust missing historical LP coverage");
    const readinessPool=new pg.Pool({...conn,database:db,max:1});
    try {
      const readiness=await readQuestReleaseReadiness({pool:readinessPool,campaignId:'missing-lp-source',
        environment:{environmentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',manifestSha256:'c'.repeat(64)},featuredPools:[key(1)]});
      assert.equal(readiness.ready,false);
      assert.ok(readiness.failures.includes('LP_ANCHOR_MISSING'));
      assert.ok(readiness.failures.includes('LP_COVERAGE_INCOMPLETE'));
      assert.ok(!readiness.failures.includes('HARDENING_SCHEMA_MISSING'));
      check("read-only release preflight distinguishes installed hardening from missing LP evidence");
    } finally {await readinessPool.end();}

	console.log(`quest hardening rehearsal passed: ${passed} checks`);
} finally {
	await connection?.end().catch(() => {});
	if (created) {
		await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`).catch(() => {});
		for (const role of Object.values(roles)) await admin.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => {});
	}
	await admin.end().catch(() => {});
}
