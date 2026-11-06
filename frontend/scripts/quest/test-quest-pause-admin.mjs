import assert from "node:assert/strict";
import { test } from "node:test";
import { PAUSE_KEYS, createPauseAdminHandler } from "./quest-pause-admin.mjs";

const TOKEN = "t".repeat(48);
const ACTOR = "HGUPXpPUhD6PiTSWexebRSsgCT1uDAgiKk2DvdRHsq6o";
const STATUS = { "weekly-xp": { paused: false, reason: null, changedBy: null, changedAt: "2026-10-06T00:00:00Z" } };

function fixture(options = {}) {
	const calls = [];
	const pool = {
		async query(sql, params = []) {
			calls.push({ sql, params });
			if (options.fail) throw new Error(options.fail);
			if (sql.includes("set_pause")) return { rows: [{ result: { switch: params[0], paused: params[1], caughtUp: 0 } }] };
			return { rows: [{ status: options.status ?? STATUS }] };
		},
	};
	let clock = 1_000_000;
	const handle = createPauseAdminHandler({ token: TOKEN, pool, now: () => clock, ratePerMinute: options.rate ?? 60, failedPerMinute: options.failed ?? 30, ...options.config });
	const call = (method, body, headers = { authorization: `Bearer ${TOKEN}` }) =>
		handle(
			new Request("https://quest.example/admin/pause", {
				method,
				headers: { "content-type": "application/json", ...headers },
				...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
			}),
		);
	return { calls, call, advance: (ms) => (clock += ms) };
}
const valid = { key: "weekly-xp", paused: true, reason: "investigating a payout", actor: ACTOR };
const json = async (response) => response.json();

test("the route does not exist without a long enough token or without a pool", async () => {
	for (const config of [{ token: undefined }, { token: "short" }, { pool: null }]) {
		const f = fixture({ config });
		const response = await f.call("GET");
		assert.equal(response.status, 404);
		assert.deepEqual(await json(response), { error: "NOT_FOUND" });
		assert.equal(f.calls.length, 0);
	}
});

test("a missing, wrong or malformed token is refused identically and touches nothing", async () => {
	const f = fixture();
	const bodies = [];
	for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: `Basic ${TOKEN}` }, { authorization: `bearer ${TOKEN}` }, { authorization: `Bearer ${TOKEN} extra` }]) {
		const response = await f.call("POST", valid, headers);
		assert.equal(response.status, 401);
		bodies.push(JSON.stringify(await json(response)));
	}
	assert.equal(new Set(bodies).size, 1);
	assert.equal(f.calls.length, 0);
});

test("GET returns the switches", async () => {
	const f = fixture();
	const response = await f.call("GET");
	assert.equal(response.status, 200);
	assert.deepEqual(await json(response), { pauses: STATUS });
	assert.match(f.calls[0].sql, /quest\.pause_status\(\)/);
});

test("POST moves exactly one switch and returns the result and the new status", async () => {
	const f = fixture();
	const response = await f.call("POST", valid);
	assert.equal(response.status, 200);
	const body = await json(response);
	assert.deepEqual(body.result, { switch: "weekly-xp", paused: true, caughtUp: 0 });
	assert.deepEqual(body.pauses, STATUS);
	assert.match(f.calls[0].sql, /quest\.set_pause\(\$1, \$2, \$3, \$4\)/);
	assert.deepEqual(f.calls[0].params, ["weekly-xp", true, "investigating a payout", ACTOR]);
});

test("a release needs no reason and passes none", async () => {
	const f = fixture();
	const response = await f.call("POST", { key: "voting-xp", paused: false, actor: ACTOR });
	assert.equal(response.status, 200);
	assert.deepEqual(f.calls[0].params, ["voting-xp", false, null, ACTOR]);
});

test("every switch key is accepted and nothing else", async () => {
	for (const key of PAUSE_KEYS) {
		const f = fixture();
		assert.equal((await f.call("POST", { ...valid, key })).status, 200, key);
	}
	for (const key of ["all", "weekly", "", "WEEKLY-XP", "weekly-xp; drop table quest.xp_events", 7, null]) {
		const f = fixture();
		assert.equal((await f.call("POST", { ...valid, key })).status, 400, String(key));
		assert.equal(f.calls.length, 0);
	}
});

test("a malformed request is refused before the database", async () => {
	const cases = [
		"not json",
		"[]",
		"null",
		{},
		{ ...valid, extra: 1 },
		{ ...valid, paused: "yes" },
		{ ...valid, paused: 1 },
		{ ...valid, actor: "not-a-wallet" },
		{ ...valid, actor: undefined },
		{ ...valid, reason: 5 },
		{ ...valid, reason: "" },
		{ ...valid, reason: "   " },
		{ ...valid, reason: "x".repeat(201) },
		{ key: valid.key, paused: true, actor: ACTOR },
		"x".repeat(3000),
	];
	for (const body of cases) {
		const f = fixture();
		const response = await f.call("POST", body);
		assert.equal(response.status, 400, JSON.stringify(body).slice(0, 60));
		assert.deepEqual(await json(response), { error: "INVALID_REQUEST" });
		assert.equal(f.calls.length, 0);
	}
});

test("only GET and POST are allowed", async () => {
	for (const method of ["PUT", "DELETE", "PATCH"]) {
		const response = await fixture().call(method, valid);
		assert.equal(response.status, 405);
	}
});

test("database refusals map to a plain bad request, anything else to unavailable, with no detail leaked", async () => {
	const bad = fixture({ fail: "Pausing needs a reason" });
	const badResponse = await bad.call("POST", valid);
	assert.equal(badResponse.status, 400);
	assert.deepEqual(await json(badResponse), { error: "INVALID_REQUEST" });

	const down = fixture({ fail: "connection refused to 10.0.0.5 with password hunter2" });
	const downResponse = await down.call("POST", valid);
	assert.equal(downResponse.status, 503);
	const text = JSON.stringify(await json(downResponse));
	assert.deepEqual(JSON.parse(text), { error: "UNAVAILABLE" });
	assert.ok(!text.includes("hunter2"));
	assert.equal((await down.call("GET")).status, 503);
});

test("valid requests are rate limited per minute, and the window resets", async () => {
	const f = fixture({ rate: 3 });
	for (let i = 0; i < 3; i++) assert.equal((await f.call("GET")).status, 200);
	assert.equal((await f.call("GET")).status, 429);
	f.advance(60_001);
	assert.equal((await f.call("GET")).status, 200);
});

test("a flood of failed attempts is limited on its own and never locks the admin out", async () => {
	const f = fixture({ failed: 5, rate: 10 });
	const statuses = [];
	for (let i = 0; i < 8; i++) statuses.push((await f.call("GET", undefined, { authorization: "Bearer wrong" })).status);
	assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429, 429, 429]);
	for (let i = 0; i < 3; i++) assert.equal((await f.call("GET")).status, 200, "the admin's own budget is untouched");
	assert.equal(f.calls.length, 3, "failed attempts never reach the database");
	f.advance(60_001);
	assert.equal((await f.call("GET", undefined, { authorization: "Bearer wrong" })).status, 401);
});

test("responses are never cached", async () => {
	const response = await fixture().call("GET");
	assert.equal(response.headers.get("cache-control"), "no-store");
});

test("the community-xp switch (migration 024) is a known switch", async () => {
	assert.ok(PAUSE_KEYS.includes("community-xp"));
	const f = fixture();
	const response = await f.call("POST", { ...valid, key: "community-xp" });
	assert.equal(response.status, 200);
	assert.equal(f.calls.find((c) => c.sql.includes("set_pause")).params[0], "community-xp");
});
