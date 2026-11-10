// Clans service and HTTP adapter test against a DISPOSABLE Postgres with migrations 001..033 applied.
//   CLANS_TEST_DB_URL=postgres://postgres:x@127.0.0.1:5432/postgres node scripts/quest/test-clans-service.mjs
// The session layer is stubbed (it is covered by its own tests): it hands the service one Passport per request.
// Everything is rolled back at the end.
import assert from "node:assert/strict";
import pg from "pg";
import { createQuestCalendarHttpAdapter } from "./quest-calendar-http.mjs";
import { createQuestCalendarService } from "./quest-calendar-service.mjs";

const url = process.env.CLANS_TEST_DB_URL;
if (!url) throw new Error("CLANS_TEST_DB_URL is required (a disposable database)");
const environment = {
	network: "DEVNET",
	environmentId: "33333333-3333-4333-8333-333333333333",
	manifestSha256: "a".repeat(64),
};
const origin = "https://dev.solve3.fi";
const campaignId = "devnet-test-2026";

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("BEGIN");
const ids = [];
for (let i = 0; i < 3; i++) {
	const id = (await client.query("INSERT INTO quest.passports (passport_id) VALUES (gen_random_uuid()) RETURNING passport_id")).rows[0].passport_id;
	ids.push(id);
	// A minted Pass makes the Passport eligible.
	await client.query(
		"INSERT INTO quest.xp_events (network,passport_id,idempotency_key,kind,source_event_key,qualification_key,rule_revision,season_key,evidence_sha256,xp_delta) VALUES ('DEVNET',$1,$2,'AWARD',$2,'mint-pass',1,'devnet-test-2026',$3,250)",
		[id, `pass:${id}`, "b".repeat(64)],
	);
}
let current = ids[0];
const auth = {
	origin,
	async withSession(_authentication, _context, work) {
		return work({ client, session: { passportId: current, sessionId: "s" } });
	},
};
const service = createQuestCalendarService({ auth, environment });
const call = (action, extra = {}) => service.clans({ campaignId, action, ...extra }, {}, {});
const as = (index) => {
	current = ids[index];
};

// overview before anything
as(0);
let r = await call("overview");
assert.equal(r.testOnly, true);
assert.equal(r.overview.eligible, true);
assert.equal(r.overview.clan, null);

// create, then the same name again from another Passport
r = await call("create", { name: "Moon Cats", tag: "mcat" });
assert.equal(r.result, "OK");
assert.equal(r.overview.clan.tag, "MCAT");
assert.equal(r.overview.clan.role, "LEADER");
const clanId = r.overview.clan.id;
as(1);
assert.equal((await call("create", { name: "moon cats", tag: "ZZZ" })).result, "NAME_TAKEN");

// board and join by id, then by invite
r = await call("board", { query: "", limit: 10, offset: 0 });
assert.equal(r.board.total, 1);
assert.equal(r.board.clans[0].name, "Moon Cats");
assert.equal((await call("join", { clanId, code: null })).result, "OK");
as(2);
assert.equal((await call("join", { clanId: null, code: "AAAAAAAA" })).result, "NOT_FOUND");
as(0);
const code = (await call("invite")).result;
assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
as(2);
r = await call("join", { clanId: null, code: code.toLowerCase() });
assert.equal(r.result, "OK");
assert.equal(r.overview.clan.members, 3);

// no Passport id in any response
const text = JSON.stringify(await call("overview")) + JSON.stringify(await call("board", { query: "", limit: 10, offset: 0 }));
// The caller's own id is echoed (as in every quest response); no OTHER Passport id may appear.
for (const id of ids) if (id !== current) assert.equal(text.includes(id), false, "response leaked another Passport id");

// kick, leave, disband
as(2);
const thirdRef = (await call("overview")).overview.clan.myRef;
as(0);
assert.equal((await call("kick", { memberRef: thirdRef })).result, "OK");
as(2);
assert.equal((await call("overview")).overview.clan, null, "a kicked member has no clan");
as(0);
assert.equal((await call("leave")).result, "OK");
as(1);
assert.equal((await call("overview")).overview.clan.role, "LEADER");

// input validation
for (const bad of [
	{ action: "nope" },
	{ action: "board", query: 5, limit: 10, offset: 0 },
	{ action: "board", query: "", limit: 500, offset: 0 },
	{ action: "create", name: "x".repeat(60), tag: "AB" },
	{ action: "join", clanId: null, code: null },
	{ action: "join", clanId: "not-a-uuid", code: null },
	{ action: "join", clanId, code: "AAAAAAAA" },
	{ action: "kick", memberRef: "nope" },
	{ action: "overview", extra: 1 },
])
	await assert.rejects(() => service.clans({ campaignId, ...bad }, {}, {}), (error) => error.code === "INVALID_REQUEST", JSON.stringify(bad));

// the HTTP adapter routes the operation, requires POST and the site origin
const adapter = createQuestCalendarHttpAdapter({ service, resolveClientContext: async () => ({ clientKey: "gateway" }) });
const post = (body, headers = {}) =>
	adapter("clans", new Request("https://backend/calendar/clans", {
		method: "POST",
		headers: { "content-type": "application/json", origin, ...headers },
		body: JSON.stringify(body),
	}));
let res = await post({ campaignId, action: "overview" });
assert.equal(res.status, 200);
assert.equal((await res.json()).overview.clan.role, "LEADER");
res = await post({ campaignId, action: "overview" }, { origin: "https://evil.example" });
assert.equal(res.status, 403);
res = await post({ campaignId, action: "bogus" });
assert.equal(res.status, 400);
res = await adapter("clans", new Request("https://backend/calendar/clans", { method: "GET" }));
assert.equal(res.status, 405);

await client.query("ROLLBACK");
await client.end();
console.log("clans service: all checks passed");
