import assert from "node:assert/strict";
import { test } from "node:test";
import { passportAtEvent } from "./wallet-link-attribution.mjs";

const wallet = "1".repeat(32);
const passportId = "11111111-1111-4111-8111-111111111111";
const first = {
	network: "DEVNET",
	wallet,
	passportId,
	linkedAt: "2026-10-01T00:00:00.000Z",
	unlinkedAt: "2026-10-02T00:00:00.000Z",
};
const second = {
	...first,
	linkedAt: "2026-10-03T00:00:00.000Z",
	unlinkedAt: null,
};

function resolve(eventAt, links = [second, first]) {
	return passportAtEvent({ network: "DEVNET", wallet, eventAt, links });
}

test("attributes only within linked intervals, with exact half-open boundaries", () => {
	assert.equal(resolve("2026-09-30T23:59:59.999Z"), null);
	assert.equal(resolve(first.linkedAt), passportId);
	assert.equal(resolve("2026-10-01T12:00:00.000Z"), passportId);
	assert.equal(resolve(first.unlinkedAt), null);
	assert.equal(resolve("2026-10-02T12:00:00.000Z"), null);
	assert.equal(resolve(second.linkedAt), passportId);
});

test("missing history does not backfill an event", () => {
	assert.equal(resolve("2026-10-01T12:00:00.000Z", []), null);
});

test("refuses ownership changes and overlapping or malformed history", () => {
	assert.throws(
		() => resolve(second.linkedAt, [{ ...second, passportId: "22222222-2222-4222-8222-222222222222" }, first]),
		/changes Passport/,
	);
	assert.throws(
		() => resolve(second.linkedAt, [{ ...second, linkedAt: "2026-10-01T12:00:00.000Z" }, first]),
		/overlapping/,
	);
	assert.throws(
		() => resolve(second.linkedAt, [{ ...second, unlinkedAt: second.linkedAt }]),
		/invalid or overlapping/,
	);
	assert.throws(
		() => resolve(second.linkedAt, [{ ...second, wallet: "2".repeat(32) }]),
		/different network or wallet/,
	);
});

test("refuses client network overrides and malformed event time", () => {
	assert.throws(
		() => passportAtEvent({ network: "MAINNET", wallet, eventAt: second.linkedAt, links: [second] }),
		/Devnet/,
	);
	assert.throws(() => resolve("not-a-date"), /eventAt/);
});
