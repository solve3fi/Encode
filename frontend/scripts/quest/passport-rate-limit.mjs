/**
 * Dormant fail-closed Passport rate limiter.
 *
 * Pure bounded rate limiter: fixed-window counters keyed by an arbitrary
 * string, driven by an injected clock. No I/O, no sockets, no persistence.
 *
 * `enforceRateLimit` is fail-closed: any ambiguity about whether the limit
 * is in force (missing limiter, broken check, thrown check, malformed
 * result) is treated as denied by throwing
 * `Error("Passport rate limit unavailable")`, never as allowed.
 */

/** Error thrown when a key has exhausted its fixed window. */
export const PASSPORT_RATE_LIMIT_EXCEEDED = "Passport rate limit exceeded";

/** Error thrown when the limiter cannot reliably decide the request. */
export const PASSPORT_RATE_LIMIT_UNAVAILABLE =
	"Passport rate limit unavailable";

/**
 * @param {number} value
 * @param {string} label
 * @returns {number}
 */
function assertPositiveInteger(value, label) {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}
	return value;
}

/**
 * Create a pure fixed-window rate limiter.
 *
 * Each string key keeps a counter bound to the most recent window
 * (`floor(clock / windowMs) * windowMs`). When the clock moves past the
 * current window, the counter resets.
 *
 * @param {{ limit?: number, windowMs?: number, clock?: () => number }} options
 * @returns {{ check: (key: string) => { allowed: boolean, remaining: number } }}
 */
export function createRateLimiter({ limit, windowMs, clock = Date.now } = {}) {
	const limitValue = assertPositiveInteger(limit, "limit");
	const windowValue = assertPositiveInteger(windowMs, "windowMs");
	if (typeof clock !== "function") {
		throw new Error("clock must be a function");
	}

	/** @type {Map<string, { windowStart: number, count: number }>} */
	const keys = new Map();

	return {
		/**
		 * Check (and consume) one request against the limiter for `key`.
		 *
		 * @param {string} key
		 * @returns {{ allowed: boolean, remaining: number }}
		 */
		check(key) {
			if (typeof key !== "string") {
				throw new Error("key must be a string");
			}
			const now = clock();
			if (typeof now !== "number" || !Number.isFinite(now)) {
				throw new Error("clock must return a finite number");
			}

			const windowStart = Math.floor(now / windowValue) * windowValue;
			const entry = keys.get(key);
			if (entry && entry.windowStart !== windowStart) {
				// The window rolled over: the previous window's count
				// no longer applies.
				entry.windowStart = windowStart;
				entry.count = 0;
			}

			let state = entry;
			if (!state) {
				state = { windowStart, count: 0 };
				keys.set(key, state);
			}

			state.count += 1;
			const remaining = Math.max(limitValue - state.count, 0);

			return {
				allowed: state.count <= limitValue,
				remaining,
			};
		},
	};
}

/**
 * Enforce a rate-limiter check for `key`, failing closed.
 *
 * Returns normally when the limiter decides the request is allowed. Throws
 * `Error("Passport rate limit exceeded")` when it is denied. Throws
 * `Error("Passport rate limit unavailable")` when the limiter is missing,
 * its `check` is not a function, `check` throws, or `check` returns anything
 * that is not an object with a boolean `allowed`.
 *
 * @param {unknown} limiter
 * @param {string} key
 * @returns {void}
 */
export function enforceRateLimit(limiter, key) {
	if (
		typeof limiter !== "object" ||
		limiter === null ||
		typeof limiter.check !== "function"
	) {
		throw new Error(PASSPORT_RATE_LIMIT_UNAVAILABLE);
	}

	let result;
	try {
		result = limiter.check(key);
	} catch {
		throw new Error(PASSPORT_RATE_LIMIT_UNAVAILABLE);
	}

	if (
		typeof result !== "object" ||
		result === null ||
		typeof result.allowed !== "boolean"
	) {
		throw new Error(PASSPORT_RATE_LIMIT_UNAVAILABLE);
	}

	if (!result.allowed) {
		throw new Error(PASSPORT_RATE_LIMIT_EXCEEDED);
	}
}
