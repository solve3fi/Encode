import assert from "node:assert/strict";
import { test } from "node:test";
import { countNeedingAction, onboardingProgress } from "../src/lib/partnerOnboarding.ts";

const space = (extra = {}) => ({ status: "active", walletCount: 2, linkSentAt: null, ...extra });
const run = (input) => onboardingProgress(input);
const done = (r) => r.steps.filter((s) => s.done).map((s) => s.key);

test("a pending request is the admin's first move", () => {
	const r = run({ requestStatus: "pending", pool: null, space: null });
	assert.equal(r.next.key, "request");
	assert.equal(r.next.needsAction, true);
	assert.equal(r.next.target, "token-requests");
	assert.deepEqual(done(r), []);
});

test("an approved request with no pool is waiting on the partner, not the admin", () => {
	const r = run({ requestStatus: "approved", pool: null, space: null });
	assert.equal(r.next.key, "pool");
	assert.equal(r.next.needsAction, false);
	assert.equal(r.next.target, null);
	assert.deepEqual(done(r), ["request"]);
});

test("a pool without a gauge asks the admin to add one", () => {
	const r = run({ requestStatus: "approved", pool: { gaugeStatus: undefined }, space: null });
	assert.equal(r.next.key, "gauge");
	assert.equal(r.next.target, "add-gauge");
	assert.deepEqual(done(r), ["request", "pool"]);
});

test("any gauge, even one still pending activation, lets the admin create the space", () => {
	for (const status of [0, 1, 2, 3, 4]) {
		const r = run({ requestStatus: "approved", pool: { gaugeStatus: status }, space: null });
		assert.equal(r.next.key, "space", `gauge status ${status}`);
		assert.equal(r.next.needsAction, true);
		assert.equal(r.gaugeActive, status === 2);
	}
});

test("a created space whose link has not been handed over still needs the admin", () => {
	const r = run({ requestStatus: "approved", pool: { gaugeStatus: 2 }, space: space() });
	assert.equal(r.next.key, "link");
	assert.equal(r.next.needsAction, true);
	assert.deepEqual(done(r), ["request", "pool", "gauge", "space"]);
});

test("a sent link completes onboarding", () => {
	const r = run({ requestStatus: "approved", pool: { gaugeStatus: 2 }, space: space({ linkSentAt: 5 }) });
	assert.equal(r.state, "done");
	assert.equal(r.next, null);
	assert.deepEqual(done(r), ["request", "pool", "gauge", "space", "link"]);
});

test("rejected and revoked partners need nothing from the admin", () => {
	const rejected = run({ requestStatus: "rejected", pool: null, space: null });
	assert.equal(rejected.state, "rejected");
	assert.equal(rejected.next, null);
	const revoked = run({ requestStatus: "approved", pool: { gaugeStatus: 2 }, space: space({ status: "revoked", linkSentAt: 5 }) });
	assert.equal(revoked.state, "revoked");
	assert.equal(revoked.next, null);
	assert.equal(done(revoked).includes("space"), false);
});

test("the reminder count includes only partners waiting on the admin", () => {
	const results = [
		run({ requestStatus: "pending", pool: null, space: null }),
		run({ requestStatus: "approved", pool: null, space: null }),
		run({ requestStatus: "approved", pool: { gaugeStatus: undefined }, space: null }),
		run({ requestStatus: "approved", pool: { gaugeStatus: 2 }, space: space({ linkSentAt: 1 }) }),
		run({ requestStatus: "rejected", pool: null, space: null }),
	];
	assert.equal(countNeedingAction(results), 2);
	assert.equal(countNeedingAction([]), 0);
});
