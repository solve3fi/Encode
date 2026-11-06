import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createRateLimiter,
	enforceRateLimit,
	PASSPORT_RATE_LIMIT_EXCEEDED,
	PASSPORT_RATE_LIMIT_UNAVAILABLE,
} from "./passport-rate-limit.mjs";

const WINDOW_MS = 60_000;

function makeClock(start = 1_000_000_000_000) {
	let now = start;
	const clock = () => now;
	clock.advance = (delta) => {
		now += delta;
	};
	return clock;
}

test("requests up to the limit are allowed", () => {
	const clock = makeClock();
	const limiter = createRateLimiter({ limit: 3, windowMs: WINDOW_MS, clock });

	// Each enforce call consumes one request; all `limit` of them pass.
	assert.doesNotThrow(() => enforceRateLimit(limiter, "alice"));
	assert.doesNotThrow(() => enforceRateLimit(limiter, "alice"));
	assert.doesNotThrow(() => enforceRateLimit(limiter, "alice"));

	// The next check shows the window is exhausted.
	assert.deepEqual(limiter.check("alice"), { allowed: false, remaining: 0 });
});

test("next request after the limit throws Passport rate limit exceeded", () => {
	const clock = makeClock();
	const limiter = createRateLimiter({ limit: 2, windowMs: WINDOW_MS, clock });

	assert.deepEqual(limiter.check("alice"), { allowed: true, remaining: 1 });
	assert.deepEqual(limiter.check("alice"), { allowed: true, remaining: 0 });
	assert.deepEqual(limiter.check("alice"), { allowed: false, remaining: 0 });
	assert.throws(
		() => enforceRateLimit(limiter, "alice"),
		(e) => e instanceof Error && e.message === PASSPORT_RATE_LIMIT_EXCEEDED,
	);
});

test("window rollover by injected clock allows again", () => {
	const clock = makeClock();
	const limiter = createRateLimiter({ limit: 2, windowMs: WINDOW_MS, clock });

	limiter.check("alice");
	limiter.check("alice");
	assert.throws(
		() => enforceRateLimit(limiter, "alice"),
		(e) => e instanceof Error && e.message === PASSPORT_RATE_LIMIT_EXCEEDED,
	);

	// Rollover is based on the absolute window, so jumping anywhere past
	// `windowMs` from the first request lands in a fresh window.
	clock.advance(WINDOW_MS + 1);

	assert.deepEqual(limiter.check("alice"), { allowed: true, remaining: 1 });
	enforceRateLimit(limiter, "alice");
});

test("limits are isolated per key", () => {
	const clock = makeClock();
	const limiter = createRateLimiter({ limit: 2, windowMs: WINDOW_MS, clock });

	limiter.check("alice");
	limiter.check("alice");
	assert.deepEqual(limiter.check("alice"), { allowed: false, remaining: 0 });

	assert.deepEqual(limiter.check("bob"), { allowed: true, remaining: 1 });
	enforceRateLimit(limiter, "bob");

	limiter.check("alice");
	assert.throws(
		() => enforceRateLimit(limiter, "alice"),
		(e) => e instanceof Error && e.message === PASSPORT_RATE_LIMIT_EXCEEDED,
	);
});

test("undefined limiter fails closed", () => {
	assert.throws(
		() => enforceRateLimit(undefined, "alice"),
		(e) => e instanceof Error && e.message === PASSPORT_RATE_LIMIT_UNAVAILABLE,
	);
});

test("limiter without a function check fails closed", () => {
	assert.throws(
		() => enforceRateLimit({}, "alice"),
		(e) => e instanceof Error && e.message === PASSPORT_RATE_LIMIT_UNAVAILABLE,
	);
	assert.throws(
		() => enforceRateLimit({ check: "nope" }, "alice"),
		(e) => e instanceof Error && e.message === PASSPORT_RATE_LIMIT_UNAVAILABLE,
	);
	assert.throws(
		() => enforceRateLimit(null, "alice"),
		(e) => e instanceof Error && e.message === PASSPORT_RATE_LIMIT_UNAVAILABLE,
	);
});

test("throwing check fails closed", () => {
	const limiter = {
		check: () => {
			throw new Error("boom");
		},
	};
	assert.throws(
		() => enforceRateLimit(limiter, "alice"),
		(e) => e instanceof Error && e.message === PASSPORT_RATE_LIMIT_UNAVAILABLE,
	);
});

test("malformed check result fails closed", () => {
	const badResults = [{ allowed: "yes" }, { remaining: 5 }, "allowed", 0, NaN];
	for (const bad of badResults) {
		assert.throws(
			() => enforceRateLimit({ check: () => bad }, "alice"),
			(e) =>
				e instanceof Error && e.message === PASSPORT_RATE_LIMIT_UNAVAILABLE,
		);
	}
	// null and undefined results must fail closed too, but `null` from a
	// check is not an "object with a boolean allowed", so it is unavailable.
	assert.throws(
		() => enforceRateLimit({ check: () => null }, "alice"),
		(e) => e instanceof Error && e.message === PASSPORT_RATE_LIMIT_UNAVAILABLE,
	);
});

test("allowed result passes through", () => {
	const limiter = { check: () => ({ allowed: true, remaining: 1 }) };
	assert.doesNotThrow(() => enforceRateLimit(limiter, "alice"));
});

test("factory rejects non-positive or non-integer bounds", () => {
	const clock = makeClock();
	for (const bad of [0, -1, 1.5, Number.NaN, "1", Infinity, undefined]) {
		assert.throws(() =>
			createRateLimiter({ limit: bad, windowMs: WINDOW_MS, clock }),
		);
		assert.throws(() => createRateLimiter({ limit: 3, windowMs: bad, clock }));
	}
	assert.doesNotThrow(() =>
		createRateLimiter({ limit: 1, windowMs: 1, clock }),
	);
});
