import { randomBytes as nodeRandomBytes } from "node:crypto";

/**
 * Quest Passport authentication orchestrator.
 *
 * Dormant, driver-free and network-free: this module wires the prior Quest
 * Passport modules (challenge, session, store, rate limit, signature) into a
 * single `issueChallenge` / `authenticate` flow behind injected seams. It
 * never opens a socket, reads a file, or touches a database.
 *
 * Everything is injected for isolated tests. A future server route needs an
 * asynchronous durable driver and shared rate limiters before using this
 * flow. No session is ever created before every
 * rejection check has passed, and an invalid signature never consumes a
 * nonce.
 */

import {
	buildChallengeMessage,
	CHALLENGE_TTL_MS,
	createNonce,
	hashNonce,
	MAX_CLOCK_SKEW_MS,
	PASSPORT_ACTION_ALLOWLIST,
	PASSPORT_AUTH_ACTION,
	PASSPORT_NETWORK,
	parseChallengeMessage,
} from "./passport-challenge.mjs";
import { enforceRateLimit } from "./passport-rate-limit.mjs";
import {
	createCsrfToken,
	createSession,
	createSessionToken,
	isSessionActive,
	SESSION_NETWORK,
	SESSION_TTL_MS,
	serializeSessionCookie,
	verifyCsrf,
} from "./passport-session.mjs";
import { verifyPassportSignature } from "./passport-signature.mjs";

/** Error message thrown when a CSRF check fails. */
export const PASSPORT_CSRF_ERROR = "Passport CSRF check failed";

/**
 * @param {unknown} value
 * @param {string} message
 * @returns {string}
 */
function assertNonEmptyString(value, message) {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(message);
	}
	return value;
}

/**
 * @param {() => number} clock
 * @returns {number} the current epoch milliseconds, validated.
 */
function readClock(clock) {
	const now = clock();
	if (typeof now !== "number" || !Number.isFinite(now)) {
		throw new Error("passport auth: clock must return a finite number");
	}
	return now;
}

/**
 * Build a Passport authentication orchestrator from injected seams.
 *
 * @param {{
 *   store: import("./passport-store.mjs").PassportStore,
 *   clock?: () => number,
 *   randomBytes?: (size: number) => Uint8Array,
 *   verifySignature?: (wallet: string, message: string, signature: string) => boolean,
 *   authorizeWallet: (network: string, passportId: string, wallet: string) => boolean,
 *   domain: string,
 *   issueLimiter?: unknown,
 *   verifyLimiter?: unknown,
 * }} [seams]
 * @returns {{
 *   issueChallenge: (params?: object) => { message: string, challenge: object },
 *   authenticate: (params?: object) => { session: object, cookie: string, csrfToken: string },
 *   logout: (session: object) => object,
 *   requireCsrf: (session: object, token: string) => true,
 * }}
 */
export function createPassportAuth({
	store,
	clock = Date.now,
	randomBytes = nodeRandomBytes,
	verifySignature = verifyPassportSignature,
	authorizeWallet,
	domain,
	issueLimiter,
	verifyLimiter,
} = {}) {
	if (
		typeof store !== "object" ||
		store === null ||
		typeof store.createChallenge !== "function" ||
		typeof store.consumeChallenge !== "function"
	) {
		throw new Error(
			"passport auth: store seam must provide createChallenge and consumeChallenge",
		);
	}
	if (typeof clock !== "function") {
		throw new Error("passport auth: clock must be a function");
	}
	if (typeof randomBytes !== "function") {
		throw new Error("passport auth: randomBytes must be a function");
	}
	if (typeof verifySignature !== "function") {
		throw new Error("passport auth: verifySignature must be a function");
	}
	if (typeof authorizeWallet !== "function") {
		throw new Error("passport auth: wallet ownership verifier is required");
	}
	const configuredDomain = assertNonEmptyString(
		domain,
		"passport auth: domain seam must be a non-empty string",
	);

	/**
	 * Issue a fresh one-use challenge bound to a wallet, passport and domain.
	 *
	 * The issue limiter is enforced first, keyed by wallet. The stored row
	 * keeps only the sha256 hash of the nonce.
	 *
	 * @param {{
	 *   action?: string,
	 *   passportId: string,
	 *   wallet: string,
	 *   domain?: string,
	 * }} [params]
	 * @returns {{ message: string, challenge: object }}
	 */
	function issueChallenge({
		action = PASSPORT_AUTH_ACTION,
		passportId,
		wallet,
		domain: challengeDomain = configuredDomain,
	} = {}) {
		const safeWallet = assertNonEmptyString(
			wallet,
			"passport auth: wallet must be a non-empty string",
		);

		// Fail-closed rate limit before anything is generated or stored.
		enforceRateLimit(issueLimiter, safeWallet);

		const now = readClock(clock);
		const nonce = createNonce(randomBytes);
		const issuedAt = new Date(now).toISOString();
		const expiresAt = new Date(now + CHALLENGE_TTL_MS).toISOString();

		const message = buildChallengeMessage({
			domain: challengeDomain,
			action,
			passportId,
			wallet: safeWallet,
			nonce,
			issuedAt,
			expiresAt,
		});

		const challenge = store.createChallenge({
			network: PASSPORT_NETWORK,
			nonceHash: hashNonce(nonce),
			action,
			passportId,
			wallet: safeWallet,
			domain: challengeDomain,
			issuedAt: now,
			expiresAt: now + CHALLENGE_TTL_MS,
		});

		return { message, challenge };
	}

	/**
	 * Verify a signed challenge and, only if everything passes, mint a session.
	 *
	 * Rejection order (every failure throws before a session exists):
	 * 1. malformed message; 2. action not allowed; 3. passport mismatch;
	 * 4. wallet mismatch; 5. configured domain mismatch; 6. network mismatch;
	 * 7. clock skew / TTL / expiry; 8. verify rate limit then signature;
	 * 9. atomic nonce consume; 10. session creation.
	 *
	 * @param {{
	 *   message: string,
	 *   signature: string,
	 *   expectedPassportId: string,
	 *   expectedWallet: string,
	 * }} [params]
	 * @returns {{ session: object, cookie: string, csrfToken: string }}
	 */
	function authenticate({
		message,
		signature,
		expectedPassportId,
		expectedWallet,
	} = {}) {
		// (1) Strictly re-parse the canonical message.
		const parsed = parseChallengeMessage(message);

		// (2) Action must be in the frozen allowlist.
		if (!PASSPORT_ACTION_ALLOWLIST.includes(parsed.action)) {
			throw new Error(
				"Passport authentication rejected: action is not allowed",
			);
		}

		// (3) The signed passport must match the one being authenticated.
		if (parsed.passportId !== expectedPassportId) {
			throw new Error("Passport authentication rejected: passport mismatch");
		}

		// (4) The signed wallet must match the expected wallet.
		if (parsed.wallet !== expectedWallet) {
			throw new Error("Passport authentication rejected: wallet mismatch");
		}

		// (5) The challenge must have been issued for the configured domain.
		if (parsed.domain !== configuredDomain) {
			throw new Error("Passport authentication rejected: domain mismatch");
		}

		// (6) Only the Devnet network is accepted.
		if (parsed.network !== PASSPORT_NETWORK) {
			throw new Error("Passport authentication rejected: network mismatch");
		}

		// (7) Clock skew, TTL and expiry.
		const now = readClock(clock);
		const issuedMs = Date.parse(parsed.issuedAt);
		const expiresMs = Date.parse(parsed.expiresAt);
		if (issuedMs > now + MAX_CLOCK_SKEW_MS) {
			throw new Error(
				"Passport authentication rejected: challenge issued in the future",
			);
		}
		if (now - issuedMs > CHALLENGE_TTL_MS) {
			throw new Error(
				"Passport authentication rejected: challenge issued in the past beyond TTL",
			);
		}
		if (now >= expiresMs) {
			throw new Error("Passport authentication rejected: challenge expired");
		}

		// (8) Fail-closed verify rate limit keyed by wallet, then signature.
		enforceRateLimit(verifyLimiter, parsed.wallet);
		if (!verifySignature(parsed.wallet, message, signature)) {
			throw new Error("Passport authentication rejected: invalid signature");
		}
		if (
			authorizeWallet(parsed.network, parsed.passportId, parsed.wallet) !== true
		) {
			throw new Error(
				"Passport authentication rejected: wallet is not linked to Passport",
			);
		}

		// (9) Atomically consume the nonce (rejects replay/consumed/expired).
		const consumed = store.consumeChallenge({
			network: parsed.network,
			nonceHash: hashNonce(parsed.nonce),
			now,
		});
		if (
			typeof consumed !== "object" ||
			consumed === null ||
			consumed.ok !== true
		) {
			const reason =
				typeof consumed === "object" && consumed !== null
					? consumed.reason
					: "unavailable";
			throw new Error(`Passport authentication rejected: challenge ${reason}`);
		}
		const stored = consumed.challenge;
		if (
			stored?.network !== parsed.network ||
			stored.action !== parsed.action ||
			stored.passportId !== parsed.passportId ||
			stored.wallet !== parsed.wallet ||
			stored.domain !== parsed.domain ||
			stored.issuedAt !== issuedMs ||
			stored.expiresAt !== expiresMs
		) {
			throw new Error(
				"Passport authentication rejected: stored challenge mismatch",
			);
		}

		// (10) Only now create the server-bound session.
		const sessionToken = createSessionToken(randomBytes);
		const csrfToken = createCsrfToken(randomBytes);
		const session = createSession({
			network: SESSION_NETWORK,
			passportId: parsed.passportId,
			sessionToken,
			csrfToken,
			issuedAt: new Date(now).toISOString(),
			expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
		});
		const cookie = serializeSessionCookie(sessionToken);

		return { session, cookie, csrfToken };
	}

	return {
		issueChallenge,
		authenticate,
		logout: (session) => logout(store, session, clock),
		requireCsrf: (session, token) =>
			requireCsrf(session, token, readClock(clock)),
	};
}

/**
 * Revoke a session in place.
 *
 * Marks the session revoked (`revokedAt`) and, when the store seam exposes a
 * `revokeSession` hook, delegates to it so a real store can persist the
 * revocation. Mutating `revokedAt` alone is enough to make `isSessionActive`
 * return false.
 *
 * @param {{ revokeSession?: (session: object) => void } | undefined} store
 * @param {{ revokedAt?: string | null }} session
 * @param {() => number} [clock]
 * @returns {object} the same, now revoked, session.
 */
export function logout(store, session, clock = Date.now) {
	if (typeof session !== "object" || session === null) {
		throw new Error("Passport logout requires a session");
	}
	const rawNow = typeof clock === "function" ? readClock(clock) : Date.now();
	session.revokedAt = new Date(rawNow).toISOString();
	if (store && typeof store.revokeSession === "function") {
		store.revokeSession(session);
	}
	return session;
}

/**
 * Require a valid CSRF token on an active session.
 *
 * @param {object} session
 * @param {string} token
 * @param {number} [now] epoch milliseconds; defaults to `Date.now()`.
 * @returns {true}
 */
export function requireCsrf(session, token, now = Date.now()) {
	if (!verifyCsrf(session, token) || !isSessionActive(session, now)) {
		throw new Error(PASSPORT_CSRF_ERROR);
	}
	return true;
}

/**
 * @typedef {Object} PassportAuth
 * @property {(params?: object) => { message: string, challenge: object }} issueChallenge
 * @property {(params?: object) => { session: object, cookie: string, csrfToken: string }} authenticate
 * @property {(session: object) => object} logout
 * @property {(session: object, token: string) => true} requireCsrf
 */
