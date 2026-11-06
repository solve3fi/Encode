import assert from "node:assert/strict";
import { test } from "node:test";
import { createQuestCalendarHttpAdapter } from "./quest-calendar-http.mjs";
import { QuestCalendarFault } from "./quest-calendar-service.mjs";

const origin = "https://quest.solve3.test";
function fixture(options = {}) {
	const calls = [],
		service = { origin };
	for (const op of ["snapshot", "history", "xp", "budget", "operatorPlan", "mutate"])
		service[op] = async (...args) => {
			calls.push({ op, args });
			if (options.error) throw options.error;
			return (
				options.output ?? {
					awardEligible: false,
					fixtureKind: "SYNTHETIC_DEVNET",
				}
			);
		};
	return {
		calls,
		handle: createQuestCalendarHttpAdapter({
			service,
			resolveClientContext: async () => ({
				clientKey: "server-client",
				origin: "https://untrusted.test",
			}),
			bodyTimeoutMs: options.timeout ?? 100,
		}),
	};
}
function request(body = { campaignId: "fixture" }, extra = {}) {
	return new Request(`${origin}/quest`, {
		method: "POST",
		headers: {
			origin,
			"content-type": "application/json",
			"x-solve3-csrf": "fixture-csrf",
			cookie: "fixture-cookie",
			...extra.headers,
		},
		body: JSON.stringify(body),
		...extra,
	});
}
for (const op of [
	"snapshot",
	"history",
	"xp",
	"budget",
	"operator-plan",
	"publish",
	"revise",
	"observe",
])
	test(`${op} uses no-store POST, trusted context and protected auth arguments`, async () => {
		const f = fixture(),
			res = await f.handle(op, request());
		assert.equal(res.status, 200);
		assert.equal(res.headers.get("cache-control"), "no-store");
		assert.equal(res.headers.get("set-cookie"), null);
		const args = f.calls[0].args;
		assert.deepEqual(args.at(-1), { origin, clientKey: "server-client" });
		assert.deepEqual(args.at(-2), {
			cookieHeader: "fixture-cookie",
			csrfToken: "fixture-csrf",
		});
	});
for (const [code, status] of [
	["INVALID_REQUEST", 400],
	["UNAUTHORIZED", 401],
	["FORBIDDEN", 403],
	["NOT_FOUND", 404],
	["CONFLICT", 409],
	["RATE_LIMITED", 429],
	["UNAVAILABLE", 503],
])
	test(`sanitized ${code} maps to ${status}`, async () => {
		const f = fixture({ error: new QuestCalendarFault(code) }),
			res = await f.handle("snapshot", request());
		assert.equal(res.status, status);
		assert.deepEqual(await res.json(), { error: code });
	});
test("unexpected provider/SQL diagnostics are not exposed", async () => {
	const f = fixture({ error: new Error("private database diagnostics") });
	const res = await f.handle("snapshot", request());
	assert.equal(res.status, 503);
	assert.ok(!(await res.text()).includes("private"));
});
test("unknown operation, GET, foreign origin and cross-site requests never reach service", async () => {
	const f = fixture();
	assert.equal((await f.handle("toString", request())).status, 404);
	assert.equal((await f.handle("snapshot", new Request(origin))).status, 405);
	for (const h of [
		{ origin: "https://evil.test" },
		{ "sec-fetch-site": "cross-site" },
		{ origin: "null" },
	]) {
		const req = request();
		for (const [k, v] of Object.entries(h)) req.headers.set(k, v);
		assert.equal((await f.handle("snapshot", req)).status, 403);
	}
	assert.equal(f.calls.length, 0);
});
test("strict JSON content type, shape and byte caps reject before service", async () => {
	const f = fixture();
	for (const body of [null, [], false])
		assert.equal((await f.handle("snapshot", request(body))).status, 400);
	const req = request();
	req.headers.set("content-type", "text/plain");
	assert.equal((await f.handle("snapshot", req)).status, 400);
	assert.equal(
		(await f.handle("snapshot", request({ huge: "x".repeat(8192) }))).status,
		400,
	);
	assert.equal(
		(await f.handle("publish", request({ huge: "x".repeat(524288) }))).status,
		400,
	);
	assert.equal(f.calls.length, 0);
});
test("year publication permits a bounded body larger than the read limit", async () => {
	const f = fixture();
	assert.equal(
		(await f.handle("publish", request({ fixture: "x".repeat(10000) }))).status,
		200,
	);
});
test("complete pool observations have a bounded scope large enough for 256 pools", async () => {
	const f = fixture();
	assert.equal(
		(await f.handle("observe", request({ fixture: "x".repeat(30000) }))).status,
		200,
	);
	assert.equal(
		(await f.handle("observe", request({ fixture: "x".repeat(65536) }))).status,
		400,
	);
});
test("dishonest content length and invalid UTF8 cannot evade streaming cap/parser", async () => {
	const f = fixture(),
		req = request({ huge: "x".repeat(8192) });
	req.headers.set("content-length", "1");
	assert.equal((await f.handle("snapshot", req)).status, 400);
	const bad = new Request(origin, {
		method: "POST",
		headers: { origin, "content-type": "application/json" },
		body: new Uint8Array([0xff]),
	});
	assert.equal((await f.handle("snapshot", bad)).status, 400);
});
test("slow body times out and oversized output remains unavailable", async () => {
	const f = fixture({ timeout: 5 }),
		stream = new ReadableStream({ start() {} }),
		req = new Request(origin, {
			method: "POST",
			headers: { origin, "content-type": "application/json" },
			body: stream,
			duplex: "half",
		});
	assert.equal((await f.handle("snapshot", req)).status, 400);
	const out = fixture({ output: { large: "x".repeat(1048576) } });
	assert.equal((await out.handle("snapshot", request())).status, 503);
});
