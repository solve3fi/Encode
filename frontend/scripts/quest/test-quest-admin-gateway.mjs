import assert from "node:assert/strict";
import { test } from "node:test";
import { createQuestAdminGateway } from "./quest-admin-gateway.mjs";

const ORIGIN = "http://quest-backend:8080";
const TOKEN = "k".repeat(48);
const ACTOR = "HGUPXpPUhD6PiTSWexebRSsgCT1uDAgiKk2DvdRHsq6o";

function fixture(respond, config = {}) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url, init });
		return respond(url, init);
	};
	return { calls, gateway: createQuestAdminGateway({ backendOrigin: ORIGIN, token: TOKEN, fetchImpl, ...config }) };
}
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("not configured unless the origin is https or a private single-label http host and the token is long", async () => {
	for (const config of [
		{ backendOrigin: undefined },
		{ backendOrigin: "http://quest.example" },
		{ backendOrigin: "http://localhost:8080" },
		{ backendOrigin: "http://quest-backend:8080/admin" },
		{ backendOrigin: "https://user:pw@quest.example" },
		{ token: "short" },
		{ token: undefined },
	]) {
		const { gateway, calls } = fixture(() => reply(200, {}), config);
		assert.equal(gateway.configured(), false);
		assert.deepEqual(await gateway.send({ action: "overview", campaignId: "x" }), { ok: false, status: 503, error: "NOT_CONFIGURED" });
		assert.equal(calls.length, 0);
	}
	assert.equal(fixture(() => reply(200, {}), { backendOrigin: "https://quest.example" }).gateway.configured(), true);
});

test("a request goes to /admin/quests with the bearer token and the verified actor", async () => {
	const { gateway, calls } = fixture(() => reply(200, { goals: [] }));
	const result = await gateway.send({ action: "complete-goal", campaignId: "c", goalId: "g", actor: ACTOR });
	assert.deepEqual(result, { ok: true, status: 200, data: { goals: [] } });
	assert.equal(calls[0].url, `${ORIGIN}/admin/quests`);
	assert.equal(calls[0].init.method, "POST");
	assert.equal(calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
	assert.equal(calls[0].init.redirect, "error");
	assert.equal(JSON.parse(calls[0].init.body).actor, ACTOR);
});

test("an overview needs no actor, every other action does, and an unknown action never leaves", async () => {
	const { gateway, calls } = fixture(() => reply(200, {}));
	assert.equal((await gateway.send({ action: "overview", campaignId: "c" })).ok, true);
	for (const request of [
		{ action: "publish", plan: {} },
		{ action: "revise", plan: {}, expectedRevision: 1, actor: "not-a-wallet" },
		{ action: "drop-database", actor: ACTOR },
		null,
	])
		assert.deepEqual(await gateway.send(request), { ok: false, status: 400, error: "INVALID_REQUEST" });
	assert.equal(calls.length, 1);
});

test("a refusal passes back only the short fixed detail; any other failure is just unavailable", async () => {
	let next = reply(400, { error: "INVALID_REQUEST", detail: "A goal that has started cannot change", stack: "secret" });
	const { gateway } = fixture(() => next);
	const refused = await gateway.send({ action: "save-goal", actor: ACTOR });
	assert.deepEqual(refused, { ok: false, status: 400, error: "INVALID_REQUEST", detail: "A goal that has started cannot change" });
	next = reply(409, { error: "CONFLICT", detail: "calendar revision conflict" });
	assert.deepEqual(await gateway.send({ action: "revise", plan: {}, expectedRevision: 1, actor: ACTOR }), {
		ok: false,
		status: 409,
		error: "CONFLICT",
		detail: "calendar revision conflict",
	});
	next = reply(400, { error: "INVALID_REQUEST", detail: "x".repeat(500) });
	assert.equal((await gateway.send({ action: "save-goal", actor: ACTOR })).detail, undefined);
	for (const status of [401, 404, 429, 500, 503]) {
		next = reply(status, { error: "X", detail: "leaky detail" });
		assert.deepEqual(await gateway.send({ action: "overview", campaignId: "c" }), { ok: false, status: 503, error: "UNAVAILABLE" });
	}
});

test("a network failure or a request that is too large is handled without calling the backend wrongly", async () => {
	const failing = createQuestAdminGateway({
		backendOrigin: ORIGIN,
		token: TOKEN,
		fetchImpl: async () => {
			throw new Error("down");
		},
	});
	assert.deepEqual(await failing.send({ action: "overview", campaignId: "c" }), { ok: false, status: 503, error: "UNAVAILABLE" });
	const { gateway, calls } = fixture(() => reply(200, {}));
	const huge = await gateway.send({ action: "publish", plan: { filler: "x".repeat(700 * 1024) }, actor: ACTOR });
	assert.equal(huge.status, 400);
	assert.equal(calls.length, 0);
});

test("partner leads: the list needs no actor, a decision does", async () => {
	const { gateway, calls } = fixture(() => reply(200, { leads: [], bountyXp: 5000 }));
	assert.equal((await gateway.send({ action: "leads" })).ok, true);
	assert.equal((await gateway.send({ action: "onboard-lead", leadId: 1, actor: ACTOR })).ok, true);
	assert.equal((await gateway.send({ action: "reject-lead", leadId: 1, note: "no", actor: ACTOR })).ok, true);
	assert.equal((await gateway.send({ action: "onboard-lead", leadId: 1 })).status, 400);
	assert.equal((await gateway.send({ action: "reject-lead", leadId: 1, actor: "not-a-wallet" })).status, 400);
	assert.equal(calls.length, 3);
});
