import assert from "node:assert/strict";
import { test } from "node:test";
import { hashNonce } from "./passport-challenge.mjs";
import {
	createInMemoryPassportStore,
	PASSPORT_STORE_CONSUME_REASONS,
} from "./passport-store.mjs";

const NONCE_HASH = hashNonce("nonce-a");
const OTHER_NONCE_HASH = hashNonce("nonce-b");
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

let now = 1_700_000_000_000;
const clock = () => now;
const makeStore = () => createInMemoryPassportStore({ clock });

function record(overrides = {}) {
	return {
		network: "DEVNET",
		nonceHash: NONCE_HASH,
		action: "passport.authenticate",
		passportId: "11111111-1111-4111-8111-111111111111",
		wallet: "9xQeWvG816bUx9EPf7jW1k2m3n4p5q6r7s8t9v0w1x",
		domain: "quest.solve3.xyz",
		issuedAt: now,
		expiresAt: now + CHALLENGE_TTL_MS,
		...overrides,
	};
}

test("consume reasons are exactly not_found, already_consumed, expired, network_mismatch", () => {
	assert.deepEqual(PASSPORT_STORE_CONSUME_REASONS, [
		"not_found",
		"already_consumed",
		"expired",
		"network_mismatch",
	]);
});

test("createChallenge stores a row and getChallenge returns a copy", () => {
	const store = makeStore();
	const row = store.createChallenge(record());

	assert.equal(row.consumedAt, null);
	const fetched = store.getChallenge(NONCE_HASH);
	assert.deepEqual(fetched, row);
	assert.equal(store.getChallenge(OTHER_NONCE_HASH), null);
	assert.equal(store.getChallenge("missing"), null);

	// Returned rows are copies: mutating them does not touch the store.
	fetched.consumedAt = 12345;
	assert.equal(store.getChallenge(NONCE_HASH).consumedAt, null);

	assert.throws(() => store.createChallenge(record()), /already exists/);
});

test("first consume is ok and a replay reports already_consumed", () => {
	const store = makeStore();
	store.createChallenge(record());

	const first = store.consumeChallenge({
		network: "DEVNET",
		nonceHash: NONCE_HASH,
		now,
	});
	assert.equal(first.ok, true);
	assert.equal(first.challenge.consumedAt, now);
	assert.equal(first.challenge.nonceHash, NONCE_HASH);

	const replay = store.consumeChallenge({
		network: "DEVNET",
		nonceHash: NONCE_HASH,
		now,
	});
	assert.deepEqual(replay, { ok: false, reason: "already_consumed" });
	assert.equal(store.getChallenge(NONCE_HASH).consumedAt, now);
});

test("Promise.all of two concurrent consumes yields exactly one ok", async () => {
	const store = makeStore();
	store.createChallenge(record());

	const results = await Promise.all([
		store.consumeChallenge({ network: "DEVNET", nonceHash: NONCE_HASH, now }),
		store.consumeChallenge({ network: "DEVNET", nonceHash: NONCE_HASH, now }),
	]);

	assert.equal(results.filter((r) => r.ok === true).length, 1);
	assert.deepEqual(
		results.filter((r) => r.ok === false).map((r) => r.reason),
		["already_consumed"],
	);
	assert.equal(store.getChallenge(NONCE_HASH).consumedAt, now);
});

test("consume succeeds while now is still before expiresAt", () => {
	const store = makeStore();
	store.createChallenge(record());

	const ok = store.consumeChallenge({
		network: "DEVNET",
		nonceHash: NONCE_HASH,
		now: now + CHALLENGE_TTL_MS - 1,
	});
	assert.equal(ok.ok, true);
	assert.equal(ok.challenge.consumedAt, now + CHALLENGE_TTL_MS - 1);
});

test("an expired row reports expired and is never claimed", () => {
	const store = makeStore();
	store.createChallenge({
		...record(),
		issuedAt: now - CHALLENGE_TTL_MS,
		expiresAt: now,
	});

	// expires_at > now is false at the exact boundary, so now == expiresAt is expired.
	const boundary = store.consumeChallenge({
		network: "DEVNET",
		nonceHash: NONCE_HASH,
		now,
	});
	assert.deepEqual(boundary, { ok: false, reason: "expired" });
	assert.equal(store.getChallenge(NONCE_HASH).consumedAt, null);
});

test("consuming under a different network reports network_mismatch", () => {
	const store = makeStore();
	store.createChallenge(record());

	const result = store.consumeChallenge({
		network: "MAINNET",
		nonceHash: NONCE_HASH,
		now,
	});
	assert.deepEqual(result, { ok: false, reason: "network_mismatch" });
	// The original row is untouched.
	assert.equal(store.getChallenge(NONCE_HASH).consumedAt, null);
});

test("consuming an unknown nonce hash reports not_found", () => {
	const store = makeStore();
	store.createChallenge(record());

	const result = store.consumeChallenge({
		network: "DEVNET",
		nonceHash: OTHER_NONCE_HASH,
		now,
	});
	assert.deepEqual(result, { ok: false, reason: "not_found" });
});

test("a consumed challenge stays consumed after the clock advances past expiry", () => {
	const store = makeStore();
	store.createChallenge(record());

	const first = store.consumeChallenge({
		network: "DEVNET",
		nonceHash: NONCE_HASH,
		now,
	});
	assert.equal(first.ok, true);

	now += 100 * 60 * 60 * 1000; // advance far past expiresAt
	const second = store.consumeChallenge({
		network: "DEVNET",
		nonceHash: NONCE_HASH,
		now,
	});
	assert.deepEqual(second, { ok: false, reason: "already_consumed" });
	assert.equal(
		store.getChallenge(NONCE_HASH).consumedAt,
		first.challenge.consumedAt,
	);
});

test("consume without an explicit now falls back to the injected clock", () => {
	const store = makeStore();
	store.createChallenge(record());

	const result = store.consumeChallenge({
		network: "DEVNET",
		nonceHash: NONCE_HASH,
	});
	assert.equal(result.ok, true);
	assert.equal(result.challenge.consumedAt, now);
});

test("the default store uses Date.now and rejects bad arguments", () => {
	const store = createInMemoryPassportStore();
	assert.throws(() => store.consumeChallenge(), /network/);
	assert.throws(
		() => store.consumeChallenge({ network: "", nonceHash: NONCE_HASH }),
		/network/,
	);
	assert.throws(
		() => store.consumeChallenge({ network: "DEVNET", nonceHash: "" }),
		/nonceHash/,
	);
	assert.throws(
		() =>
			store.consumeChallenge({
				network: "DEVNET",
				nonceHash: NONCE_HASH,
				now: "x",
			}),
		/now/,
	);
	assert.throws(
		() =>
			store.createChallenge({
				...record(),
				issuedAt: "soon",
			}),
		/issuedAt/,
	);
	assert.throws(
		() => createInMemoryPassportStore({ clock: "not a function" }),
		/clock/,
	);
});
