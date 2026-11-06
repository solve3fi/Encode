import assert from "node:assert/strict";
import { test } from "node:test";
import { createQuestTestProxy } from "./quest-test-proxy.mjs";

const webOrigin = "https://quest.solve3.test",
	backendOrigin = "https://backend.solve3.test";
const req = (extra = {}) =>
	new Request(webOrigin, {
		method: "POST",
		headers: {
			origin: webOrigin,
			"content-type": "application/json",
			cookie: "other_site_cookie=private; solve3_passport=fixture-token",
			"x-forwarded-for": "evil",
			"x-solve3-csrf": "fixture-csrf",
		},
		body: "{}",
		...extra,
	});
test("gateway disabled without reviewed HTTPS configuration and refuses mutation scopes", async () => {
	for (const config of [
		{},
		{ enabled: true, webOrigin, backendOrigin: "http://bad.test" },
		{ enabled: true, webOrigin, backendOrigin: webOrigin },
	]) {
		const handler = createQuestTestProxy({
			...config,
			fetchImpl: () => assert.fail(),
		});
		assert.equal((await handler("calendar", "snapshot", req())).status, 503);
	}
	const handler = createQuestTestProxy();
	assert.equal((await handler("calendar", "observe", req())).status, 404);
	assert.equal((await handler("toString", "snapshot", req())).status, 404);
});
test("gateway forwards only session cookie and approved headers to fixed backend", async () => {
	let captured;
	const handler = createQuestTestProxy({
		enabled: true,
		webOrigin,
		backendOrigin,
		fetchImpl: async (url, options) => {
			captured = { url, options };
			return Response.json({ fixtureKind: "SYNTHETIC_DEVNET" });
		},
	});
	const result = await handler("calendar", "snapshot", req());
	assert.equal(result.status, 200);
	assert.equal(result.headers.get("cache-control"), "no-store");
	assert.equal(captured.url, `${backendOrigin}/calendar/snapshot`);
	assert.equal(captured.options.redirect, "error");
	assert.equal(
		captured.options.headers.cookie,
		"solve3_passport=fixture-token",
	);
	assert.ok(!JSON.stringify(captured).includes("other_site_cookie"));
	assert.ok(!captured.options.headers["x-forwarded-for"]);
});
test("foreign Origin refuses before backend", async () => {
	const h = createQuestTestProxy({
		enabled: true,
		webOrigin,
		backendOrigin,
		fetchImpl: () => assert.fail(),
	});
	assert.equal(
		(
			await h(
				"passport",
				"session",
				req({ headers: { origin: "https://evil.test" } }),
			)
		).status,
		403,
	);
});
for (const code of ["private SQL", "UNAUTHORIZED", "RATE_LIMITED"])
	test(`gateway sanitizes error ${code}`, async () => {
		const h = createQuestTestProxy({
			enabled: true,
			webOrigin,
			backendOrigin,
			fetchImpl: async () => Response.json({ error: code }, { status: 500 }),
		});
		const res = await h("calendar", "history", req());
		assert.equal(
			(await res.json()).error,
			code === "private SQL" ? "UNAVAILABLE" : code,
		);
	});
test("gateway rejects redirect, HTML and oversized responses without leaking diagnostics", async () => {
	for (const fetchImpl of [
		async () => {
			throw Error("private");
		},
		async () => new Response("private html"),
		async () => Response.json({ value: "a".repeat(1048576) }),
	]) {
		const h = createQuestTestProxy({
			enabled: true,
			webOrigin,
			backendOrigin,
			fetchImpl,
		});
		const res = await h("calendar", "snapshot", req());
		assert.equal(res.status, 503);
		assert.equal((await res.json()).error, "UNAVAILABLE");
	}
});

test("gateway forwards only the exact host-only Passport cookie serializer", async () => {
	const valid =
		"solve3_passport=fixture-token; Max-Age=900; Path=/; Secure; SameSite=Strict; HttpOnly";
	for (const cookie of [
		valid,
		valid.replace("fixture-token", "").replace("900", "0"),
		`${valid}, other=private`,
		`${valid}; Domain=solve3.test`,
		`${valid}; Path=/other`,
		valid.replace("; Secure", ""),
	]) {
		const h = createQuestTestProxy({
			enabled: true,
			webOrigin,
			backendOrigin,
			fetchImpl: async () =>
				Response.json({}, { headers: { "Set-Cookie": cookie } }),
		});
		const res = await h("passport", "authenticate", req());
		const accepted =
			cookie === valid ||
			cookie === valid.replace("fixture-token", "").replace("900", "0");
		assert.equal(res.status, accepted ? 200 : 503);
		assert.equal(res.headers.get("set-cookie"), accepted ? cookie : null);
	}
});
test("gateway refuses duplicate Passport cookies and oversized request before fetching", async () => {
	const h = createQuestTestProxy({
		enabled: true,
		webOrigin,
		backendOrigin,
		fetchImpl: () => assert.fail("must not fetch"),
	});
	for (const extra of [
		{
			headers: {
				origin: webOrigin,
				"content-type": "application/json",
				cookie: "solve3_passport=a; solve3_passport=b",
			},
		},
		{ body: JSON.stringify({ value: "x".repeat(8192) }) },
	]) {
		assert.equal((await h("calendar", "snapshot", req(extra))).status, 503);
	}
});
