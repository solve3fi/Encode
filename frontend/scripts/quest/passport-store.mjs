import { assertPassportId } from "./passport-id.mjs";

/**
 * Quest Passport challenge store.
 *
 * Pure, driver-free storage seam for one-use Passport challenges. Later
 * tasks (session redemption, worker claim) will implement the same interface
 * against the real database; this file ships the interface plus a test-only
 * in-memory implementation. It never opens a socket, reads a file, or
 * touches a database.
 *
 * Challenge rows are keyed by `network|nonceHash` so a nonce hash can never
 * leak across networks. `consumeChallenge` performs its check-and-set
 * synchronously: the read and the `consumedAt` write happen in one tick, so
 * in single-threaded JS exactly one of two concurrently-awaited calls wins.
 */

/** Reasons a consume attempt can fail. */
export const PASSPORT_STORE_CONSUME_REASONS = Object.freeze([
	"not_found",
	"already_consumed",
	"expired",
	"network_mismatch",
]);

/** Ordered fields of a challenge row, excluding `consumedAt`. */
const CHALLENGE_FIELDS = Object.freeze([
	"network",
	"nonceHash",
	"action",
	"passportId",
	"wallet",
	"domain",
	"issuedAt",
	"expiresAt",
]);

/**
 * @typedef {Object} ChallengeRow
 * @property {string} network network this challenge is pinned to.
 * @property {string} nonceHash sha256 hex digest of the challenge nonce.
 * @property {string} action authenticated action (from the challenge allowlist).
 * @property {string} passportId passport identifier for the challenge.
 * @property {string} wallet base58 wallet address bound to the challenge.
 * @property {string} domain domain embedded in the challenge message.
 * @property {number} issuedAt Unix epoch milliseconds.
 * @property {number} expiresAt Unix epoch milliseconds; the row is dead when `now >= expiresAt`.
 * @property {number|null} consumedAt Unix epoch milliseconds, `null` until claimed.
 *
 * @typedef {"not_found"|"already_consumed"|"expired"|"network_mismatch"} ConsumeReason
 *
 * @typedef {Object} ConsumeRequest
 * @property {string} network
 * @property {string} nonceHash
 * @property {number} [now] Unix epoch milliseconds; defaults to the store clock.
 *
 * @typedef {{ ok: true, challenge: ChallengeRow }} ConsumeOk
 * @typedef {{ ok: false, reason: ConsumeReason }} ConsumeFail
 *
 * @typedef {Object} PassportStore
 * @property {(record: ChallengeRow) => ChallengeRow} createChallenge
 * @property {(nonceHash: string) => ChallengeRow|null} getChallenge
 * @property {(request: ConsumeRequest) => ConsumeOk|ConsumeFail} consumeChallenge
 */

/**
 * Real SQL the consume path models (later tasks implement it verbatim).
 * The WHERE clause is the atomic claim: a row is consumed only if it is
 * unconsumed and not yet expired, and because the UPDATE is conditional,
 * exactly one concurrent caller gets the row back from RETURNING while losers
 * see no row and report the matching reason.
 *
 * ```sql
 * UPDATE quest.wallet_challenges
 *    SET consumed_at = now()
 *  WHERE network = $1
 *    AND nonce_hash = $2
 *    AND consumed_at IS NULL
 *    AND expires_at > now()
 *  RETURNING challenge_id;
 * ```
 */

/**
 * Create a test-only in-memory passport store.
 *
 * Challenges are stored in a Map keyed by `network|nonceHash`. The returned
 * object is the `PassportStore` interface later tasks consume:
 *
 * - `createChallenge(record)` inserts a row and returns a copy of it. Throws
 *   when a `network|nonceHash` pair already exists.
 * - `getChallenge(nonceHash)` returns a copy of the stored row or `null`.
 * - `consumeChallenge({ network, nonceHash, now })` atomically claims the row:
 *   `{ ok: true, challenge }` when a matching unconsumed, unexpired row is
 *   claimed, otherwise `{ ok: false, reason }` with reason one of
 *   `{ "not_found", "already_consumed", "expired", "network_mismatch" }`.
 *
 * @param {{ clock?: () => number }} [options]
 * @returns {PassportStore}
 */
export function createInMemoryPassportStore({ clock = Date.now } = {}) {
	if (typeof clock !== "function") {
		throw new Error("passport store: clock must be a function");
	}

	/** @type {Map<string, ChallengeRow>} */
	const rows = new Map();

	return {
		/**
		 * Insert a new challenge row.
		 *
		 * @param {unknown} record
		 * @returns {ChallengeRow} copy of the stored row.
		 */
		createChallenge(record) {
			const row = normalizeRow(record);
			const key = `${row.network}|${row.nonceHash}`;
			if (rows.has(key)) {
				throw new Error("passport store: challenge already exists");
			}
			rows.set(key, row);
			return cloneRow(row);
		},

		/**
		 * Look up a stored challenge by its nonce hash.
		 *
		 * @param {unknown} nonceHash
		 * @returns {ChallengeRow|null} copy of the stored row, or `null`.
		 */
		getChallenge(nonceHash) {
			if (typeof nonceHash !== "string" || nonceHash.length === 0) {
				return null;
			}
			for (const row of rows.values()) {
				if (row.nonceHash === nonceHash) {
					return cloneRow(row);
				}
			}
			return null;
		},

		/**
		 * Atomically claim one challenge (see SQL model at top of module).
		 *
		 * The check-and-set is fully synchronous: no await between reading
		 * the row and writing `consumedAt`.
		 *
		 * @param {ConsumeRequest} request
		 * @returns {ConsumeOk|ConsumeFail}
		 */
		consumeChallenge(request = {}) {
			const { network, nonceHash } = request;
			assertConsumeArgs(network, nonceHash);
			const claimedAt = assertNow(request.now ?? clock());

			// Synchronous check-and-set (see SQL model above).
			const row = rows.get(`${network}|${nonceHash}`);
			if (row) {
				if (row.consumedAt !== null) {
					return { ok: false, reason: "already_consumed" };
				}
				if (!(row.expiresAt > claimedAt)) {
					return { ok: false, reason: "expired" };
				}
				row.consumedAt = claimedAt;
				return { ok: true, challenge: cloneRow(row) };
			}
			for (const other of rows.values()) {
				if (other.nonceHash === nonceHash) {
					return { ok: false, reason: "network_mismatch" };
				}
			}
			return { ok: false, reason: "not_found" };
		},
	};
}

/**
 * @param {unknown} record
 * @returns {ChallengeRow}
 */
function normalizeRow(record) {
	if (typeof record !== "object" || record === null) {
		throw new Error("passport store: challenge record must be an object");
	}
	/** @type {ChallengeRow} */
	const row = {
		consumedAt: null,
	};
	for (const field of CHALLENGE_FIELDS) {
		const value = record[field];
		if (field === "issuedAt" || field === "expiresAt") {
			if (!Number.isFinite(value)) {
				throw new Error(
					`passport store: challenge ${field} must be a finite number`,
				);
			}
			row[field] = value;
		} else if (typeof value !== "string" || value.length === 0) {
			throw new Error(
				`passport store: challenge ${field} must be a non-empty string`,
			);
		} else {
			row[field] = value;
		}
	}
	assertPassportId(row.passportId);
	const consumedAt = record.consumedAt === undefined ? null : record.consumedAt;
	if (consumedAt !== null && !Number.isFinite(consumedAt)) {
		throw new Error(
			"passport store: challenge consumedAt must be a finite number or null",
		);
	}
	row.consumedAt = consumedAt;
	return row;
}

/**
 * @param {unknown} network
 * @param {unknown} nonceHash
 * @returns {never} throws when either argument is not a non-empty string.
 */
function assertConsumeArgs(network, nonceHash) {
	if (typeof network !== "string" || network.length === 0) {
		throw new Error("passport store: network must be a non-empty string");
	}
	if (typeof nonceHash !== "string" || nonceHash.length === 0) {
		throw new Error("passport store: nonceHash must be a non-empty string");
	}
}

/**
 * @param {unknown} now
 * @returns {number}
 */
function assertNow(now) {
	if (!Number.isFinite(now)) {
		throw new Error("passport store: now must be a finite number");
	}
	return now;
}

/**
 * @param {ChallengeRow} row
 * @returns {ChallengeRow}
 */
function cloneRow(row) {
	return { ...row };
}
