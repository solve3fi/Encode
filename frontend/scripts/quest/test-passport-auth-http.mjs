import assert from "node:assert/strict";
import { test } from "node:test";
import { createPassportAuthHttpAdapter } from "./passport-auth-http.mjs";
import { PassportAuthFault } from "./passport-durable-auth.mjs";

const origin = "https://quest.solve3.test";
function fixture(patch = {}) {
	const calls = [];
	const auth = {
		origin,
		issueChallenge: async (input, context) => {
			calls.push({ input, context });
			return { message: "fixture", network: "DEVNET" };
		},
		authenticate: async (input, context) => {
			calls.push({ input, context });
			return {
				passportId: "fixture",
				csrfToken: "synthetic-token",
				cookie: "solve3_passport=synthetic; Secure; HttpOnly",
			};
		},
		readSession: async (input, context) => {
			calls.push({ input, context });
			return { passportId: "fixture", trust: "HISTORICAL_SESSION_SNAPSHOT" };
		},
		logout: async (input, context) => {
			calls.push({ input, context });
			return { cookie: "solve3_passport=; Max-Age=0; Secure; HttpOnly" };
		},
		...patch,
	};
	return {
		calls,
		handle: createPassportAuthHttpAdapter({
			auth,
			resolveClientContext: async () => ({ clientKey: "trusted-server-key" }),
		}),
	};
}
const request = (body = "{}", headers = {}, method = "POST") =>
	new Request(`${origin}/dormant-fixture`, {
		method,
		headers: { origin, "content-type": "application/json", ...headers },
		...(method === "GET" ? {} : { body }),
	});
test("challenge accepts exact body and trusted server context, no cache", async () => {
	const f = fixture();
	const r = await f.handle(
		"challenge",
		request(JSON.stringify({ passportId: "fixture", wallet: "fixture" }), {
			"x-forwarded-for": "attacker",
		}),
	);
	assert.equal(r.status, 200);
	assert.equal(r.headers.get("cache-control"), "no-store");
	assert.equal(f.calls[0].context.clientKey, "trusted-server-key");
});
test("authentication cookie is only a Set-Cookie header, never JSON", async () => {
	const f = fixture();
	const r = await f.handle(
		"authenticate",
		request(JSON.stringify({ message: "fixture", signature: "fixture" })),
	);
	assert.equal(r.status, 200);
	assert.match(r.headers.get("set-cookie"), /HttpOnly/);
	const data = await r.json();
	assert.equal(data.csrfToken, "synthetic-token");
	assert.ok(!("cookie" in data));
});
test("session passes cookie header to historical read", async () => {
	const f = fixture();
	const r = await f.handle(
		"session",
		request("{}", { cookie: "solve3_passport=synthetic" }),
	);
	assert.equal(r.status, 200);
	assert.equal(f.calls[0].input.cookieHeader, "solve3_passport=synthetic");
});
test("logout passes CSRF header and clears cookie only on success", async () => {
	const f = fixture();
	const r = await f.handle(
		"logout",
		request("{}", { "x-solve3-csrf": "synthetic-csrf" }),
	);
	assert.equal(r.status, 200);
	assert.equal(f.calls[0].input.csrfToken, "synthetic-csrf");
	assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
});
for (const headers of [
	{ origin: "https://evil.test" },
	{ origin: "" },
	{ "sec-fetch-site": "cross-site" },
	{ "content-type": "text/plain" },
	{ "content-length": "999999" },
	{ "content-length": "garbage" },
])
	test(`refuses ${JSON.stringify(headers)} before service`, async () => {
		const f = fixture();
		const r = await f.handle("session", request("{}", headers));
		assert.ok([400, 403].includes(r.status));
		assert.equal(f.calls.length, 0);
		assert.equal(r.headers.get("cache-control"), "no-store");
	});
for (const payload of [
	"null",
	"[]",
	"{",
	'{"passportId":"attacker"}',
	'{"__proto__":{}}',
	JSON.stringify({ oversize: "x".repeat(9000) }),
])
	test(`rejects invalid/extra/oversized body ${payload.slice(0, 20)}`, async () => {
		const f = fixture();
		const r = await f.handle("session", request(payload));
		assert.equal(r.status, 400);
		assert.equal(f.calls.length, 0);
	});
test("streaming body cap also applies without Content-Length", async () => {
	const f = fixture();
	let cancelled = false;
	const stream = new ReadableStream({
		start(c) {
			c.enqueue(new Uint8Array(9000));
		},
		cancel() {
			cancelled = true;
		},
	});
	const req = new Request(origin, {
		method: "POST",
		headers: { origin, "content-type": "application/json" },
		body: stream,
		duplex: "half",
	});
	const r = await f.handle("session", req);
	assert.equal(r.status, 400);
	assert.ok(cancelled);
	assert.equal(f.calls.length, 0);
});
test("invalid UTF-8 is refused", async () => {
	const f = fixture();
	const r = await f.handle("session", request(new Uint8Array([255])));
	assert.equal(r.status, 400);
});

test("body deadline cancels a stalled stream before service or database access", async () => {
	let cancelled = false,
		called = false;
	const auth = {
		origin,
		issueChallenge: async () => {},
		authenticate: async () => {},
		readSession: async () => {
			called = true;
			throw new Error("must not run");
		},
		logout: async () => {},
	};
	const handle = createPassportAuthHttpAdapter({
		auth,
		resolveClientContext: async () => ({ clientKey: "fixture" }),
		bodyTimeoutMs: 20,
	});
	const req = new Request(origin, {
		method: "POST",
		headers: { origin, "content-type": "application/json" },
		body: new ReadableStream({
			cancel() {
				cancelled = true;
			},
		}),
		duplex: "half",
	});
	assert.equal((await handle("session", req)).status, 400);
	assert.ok(cancelled);
	assert.equal(called, false);
});
test("method and operation gates do not execute service", async () => {
	const f = fixture();
	assert.equal(
		(await f.handle("session", request("{}", {}, "GET"))).status,
		405,
	);
	assert.equal((await f.handle("unknown", request())).status, 404);
	assert.equal(f.calls.length, 0);
});
for (const [code, status] of Object.entries({
	INVALID_REQUEST: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	RATE_LIMITED: 429,
	UNAVAILABLE: 503,
}))
	test(`maps ${code} with safe error and no cookie`, async () => {
		const f = fixture({
			readSession: async () => {
				throw new PassportAuthFault(code);
			},
		});
		const r = await f.handle("session", request());
		assert.equal(r.status, status);
		assert.equal(r.headers.get("set-cookie"), null);
		assert.deepEqual(await r.json(), { error: code });
	});
test("unexpected storage errors never expose internal messages", async () => {
	const f = fixture({
		readSession: async () => {
			throw new Error("private database details");
		},
	});
	const r = await f.handle("session", request());
	assert.equal(r.status, 503);
	assert.deepEqual(await r.json(), { error: "UNAVAILABLE" });
});
