import assert from "node:assert/strict";
import { test } from "node:test";
import { createQuestPauseGateway } from "./quest-pause-gateway.mjs";

const ORIGIN = "https://quest.example";
const TOKEN = "k".repeat(48);
const ACTOR = "HGUPXpPUhD6PiTSWexebRSsgCT1uDAgiKk2DvdRHsq6o";
const PAUSES = { "weekly-xp": { paused: true, reason: "r", changedBy: ACTOR, changedAt: "2026-10-06T00:00:00Z" } };

function fixture(respond, config = {}) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url, init });
		return respond(url, init);
	};
	return { calls, gateway: createQuestPauseGateway({ backendOrigin: ORIGIN, token: TOKEN, fetchImpl, ...config }) };
}
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

test("not configured unless the origin is a bare https origin and the token is long", async () => {
	for (const config of [
		{ backendOrigin: undefined },
		{ backendOrigin: "http://quest.example" },
		{ backendOrigin: "http://localhost:8080" },
		{ backendOrigin: "http://quest-backend:8080/admin" },
		{ backendOrigin: "ftp://quest-backend:8080" },
		{ backendOrigin: "https://quest.example/path" },
		{ backendOrigin: "https://user:pw@quest.example" },
		{ token: "short" },
		{ token: undefined },
	]) {
		const { gateway, calls } = fixture(() => ok({ pauses: {} }), config);
		assert.equal(gateway.configured(), false);
		assert.deepEqual(await gateway.read(), { ok: false, status: 503, error: "NOT_CONFIGURED" });
		assert.equal(calls.length, 0);
	}
});

test("read sends a bearer-token GET to /admin/pause and returns only the switches", async () => {
	const { gateway, calls } = fixture(() => ok({ pauses: PAUSES, internal: "x" }));
	const result = await gateway.read();
	assert.deepEqual(result, { ok: true, status: 200, pauses: PAUSES, result: null });
	assert.equal(calls[0].url, `${ORIGIN}/admin/pause`);
	assert.equal(calls[0].init.method, "GET");
	assert.equal(calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
	assert.equal(calls[0].init.redirect, "error");
});

test("set sends the verified wallet as the actor and the exact change", async () => {
	const { gateway, calls } = fixture(() => ok({ pauses: PAUSES, result: { switch: "weekly-xp", paused: true, caughtUp: 0 } }));
	const result = await gateway.set({ key: "weekly-xp", paused: true, reason: "  checking payouts  ", actor: ACTOR });
	assert.equal(result.ok, true);
	assert.deepEqual(result.result, { switch: "weekly-xp", paused: true, caughtUp: 0 });
	assert.equal(calls[0].init.method, "POST");
	assert.deepEqual(JSON.parse(calls[0].init.body), { key: "weekly-xp", paused: true, actor: ACTOR, reason: "checking payouts" });
});

test("a release sends no reason", async () => {
	const { gateway, calls } = fixture(() => ok({ pauses: PAUSES, result: {} }));
	await gateway.set({ key: "voting-xp", paused: false, actor: ACTOR });
	assert.deepEqual(JSON.parse(calls[0].init.body), { key: "voting-xp", paused: false, actor: ACTOR });
});

test("a bad change is refused locally and never sent", async () => {
	const { gateway, calls } = fixture(() => ok({ pauses: PAUSES }));
	const bad = [
		undefined,
		{ key: "all", paused: true, reason: "r", actor: ACTOR },
		{ key: "weekly-xp", paused: "yes", reason: "r", actor: ACTOR },
		{ key: "weekly-xp", paused: true, actor: ACTOR },
		{ key: "weekly-xp", paused: true, reason: "   ", actor: ACTOR },
		{ key: "weekly-xp", paused: true, reason: "x".repeat(201), actor: ACTOR },
		{ key: "weekly-xp", paused: true, reason: "r", actor: "nope" },
	];
	for (const change of bad) assert.deepEqual(await gateway.set(change), { ok: false, status: 400, error: "INVALID_REQUEST" });
	assert.equal(calls.length, 0);
});

test("backend failures are reduced to a short code with nothing from the backend passed on", async () => {
	for (const [response, expected] of [
		[new Response(JSON.stringify({ error: "UNAUTHORIZED", secret: "x" }), { status: 401 }), { status: 503, error: "UNAVAILABLE" }],
		[new Response(JSON.stringify({ error: "INVALID_REQUEST" }), { status: 400 }), { status: 400, error: "INVALID_REQUEST" }],
		[new Response("<html>boom 10.0.0.5</html>", { status: 502 }), { status: 503, error: "UNAVAILABLE" }],
		[new Response("not json", { status: 200 }), { status: 503, error: "UNAVAILABLE" }],
		[ok({ nothing: true }), { status: 503, error: "UNAVAILABLE" }],
	]) {
		const { gateway } = fixture(() => response);
		const result = await gateway.read();
		assert.deepEqual(result, { ok: false, ...expected });
	}
	const { gateway } = fixture(() => {
		throw new Error("connect ECONNREFUSED 10.0.0.5:443");
	});
	assert.deepEqual(await gateway.read(), { ok: false, status: 503, error: "UNAVAILABLE" });
});

test("the backend's private Docker-network address is accepted over plain http", async () => {
	const { gateway, calls } = fixture(() => ok({ pauses: PAUSES }), { backendOrigin: "http://quest-backend:8080" });
	assert.equal(gateway.configured(), true);
	assert.equal((await gateway.read()).ok, true);
	assert.equal(calls[0].url, "http://quest-backend:8080/admin/pause");
});
