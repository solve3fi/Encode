import assert from "node:assert/strict";
import { test } from "node:test";
import bs58 from "bs58";
import nacl from "tweetnacl";
import {
	createPassportAuth,
	logout,
	PASSPORT_CSRF_ERROR,
} from "./passport-auth.mjs";
import { CHALLENGE_TTL_MS, MAX_CLOCK_SKEW_MS } from "./passport-challenge.mjs";
import { createRateLimiter } from "./passport-rate-limit.mjs";
import { SESSION_TTL_MS } from "./passport-session.mjs";
import { createInMemoryPassportStore } from "./passport-store.mjs";

const WINDOW_MS = 60_000;
const BASE_TIME = Date.UTC(2026, 8, 29, 12, 0, 0, 0);
const DOMAIN = "quest.solve3.xyz";
const PASSPORT_ID = "11111111-1111-4111-8111-111111111111";

const primary = nacl.sign.keyPair();
const WALLET = bs58.encode(primary.publicKey);
const other = nacl.sign.keyPair();
const OTHER_WALLET = bs58.encode(other.publicKey);

/**
 * @param {string} message
 * @param {nacl.SignKeyPair} [keyPair]
 * @returns {string}
 */
function sign(message, keyPair = primary) {
	return Buffer.from(
		nacl.sign.detached(new TextEncoder().encode(message), keyPair.secretKey),
	).toString("base64");
}

/**
 * Build an orchestrator plus its in-memory seams on a mutable clock.
 *
 * @param {{ issueLimit?: number, verifyLimit?: number } & Record<string, unknown>} [options]
 */
function setup({ issueLimit = 50, verifyLimit = 50, ...seams } = {}) {
	const state = { now: BASE_TIME };
	const clock = () => state.now;
	const store = createInMemoryPassportStore({ clock });
	let counter = 0;
	const randomBytes = (size) => {
		counter += 1;
		const bytes = Buffer.alloc(size, 0);
		bytes.writeUInt32BE(counter, size - 4);
		return bytes;
	};
	const issueLimiter = createRateLimiter({
		limit: issueLimit,
		windowMs: WINDOW_MS,
		clock,
	});
	const verifyLimiter = createRateLimiter({
		limit: verifyLimit,
		windowMs: WINDOW_MS,
		clock,
	});
	const auth = createPassportAuth({
		store,
		clock,
		randomBytes,
		domain: DOMAIN,
		issueLimiter,
		verifyLimiter,
		authorizeWallet: (_network, passportId, wallet) =>
			passportId === PASSPORT_ID && wallet === WALLET,
		...seams,
	});
	return {
		auth,
		store,
		state,
		issueLimiter,
		verifyLimiter,
		advance: (ms) => {
			state.now += ms;
		},
		at: (ms) => {
			state.now = ms;
		},
	};
}

/**
 * Issue a challenge and return the message plus its signature.
 *
 * @param {ReturnType<typeof setup>} ctx
 */
function issue(ctx, overrides = {}) {
	const { message, challenge } = ctx.auth.issueChallenge({
		passportId: PASSPORT_ID,
		wallet: WALLET,
		...overrides,
	});
	return { message, challenge, signature: sign(message) };
}

test("issues a canonical devnet challenge and stores only its nonce hash", () => {
	const ctx = setup();
	const { message, challenge } = issue(ctx);

	assert.match(message, /^solve3 passport authentication v1\n/);
	assert.match(message, /^network: DEVNET$/m);
	assert.match(message, new RegExp(`^domain: ${DOMAIN}$`, "m"));
	assert.match(message, /^action: passport\.authenticate$/m);
	assert.match(message, new RegExp(`^passport: ${PASSPORT_ID}$`, "m"));
	assert.match(message, new RegExp(`^wallet: ${WALLET}$`, "m"));

	assert.equal(challenge.network, "DEVNET");
	assert.equal(challenge.wallet, WALLET);
	assert.equal(challenge.consumedAt, null);
	assert.match(challenge.nonceHash, /^[0-9a-f]{64}$/);
	assert.equal(challenge.expiresAt - challenge.issuedAt, CHALLENGE_TTL_MS);
});

test("happy path returns session, HttpOnly cookie and csrf token", () => {
	const ctx = setup();
	const { message, challenge, signature } = issue(ctx);

	const result = ctx.auth.authenticate({
		message,
		signature,
		expectedPassportId: PASSPORT_ID,
		expectedWallet: WALLET,
	});

	assert.equal(result.session.passportId, PASSPORT_ID);
	assert.equal(result.session.network, "DEVNET");
	assert.equal(result.session.revokedAt, null);
	assert.equal(typeof result.csrfToken, "string");
	assert.match(result.cookie, /^solve3_passport=/);
	assert.match(result.cookie, /HttpOnly/);
	assert.match(result.cookie, /SameSite=Strict/);
	assert.match(result.cookie, /Secure/);

	// The nonce was consumed exactly once.
	assert.equal(
		ctx.store.getChallenge(challenge.nonceHash).consumedAt !== null,
		true,
	);

	// A valid CSRF token passes.
	assert.equal(ctx.auth.requireCsrf(result.session, result.csrfToken), true);
});

test("invalid CSRF token is rejected", () => {
	const ctx = setup();
	const { message, signature } = issue(ctx);
	const { session } = ctx.auth.authenticate({
		message,
		signature,
		expectedPassportId: PASSPORT_ID,
		expectedWallet: WALLET,
	});

	assert.throws(
		() => ctx.auth.requireCsrf(session, "wrong-token"),
		new RegExp(PASSPORT_CSRF_ERROR),
	);
});

test("invalid signature is rejected before consume and leaves the nonce reusable", () => {
	const ctx = setup();
	const { message, challenge } = issue(ctx);

	assert.throws(
		() =>
			ctx.auth.authenticate({
				message,
				signature: sign("some other message"),
				expectedPassportId: PASSPORT_ID,
				expectedWallet: WALLET,
			}),
		/invalid signature/,
	);

	// The nonce was never consumed, so it is not "consumed-only-once".
	assert.equal(ctx.store.getChallenge(challenge.nonceHash).consumedAt, null);

	// A correct signature on the untouched challenge still succeeds.
	const result = ctx.auth.authenticate({
		message,
		signature: sign(message),
		expectedPassportId: PASSPORT_ID,
		expectedWallet: WALLET,
	});
	assert.ok(result.session);
});

test("replay of a successful message is rejected on the second call", () => {
	const ctx = setup();
	const { message, signature } = issue(ctx);

	const first = ctx.auth.authenticate({
		message,
		signature,
		expectedPassportId: PASSPORT_ID,
		expectedWallet: WALLET,
	});
	assert.ok(first.session);

	assert.throws(
		() =>
			ctx.auth.authenticate({
				message,
				signature,
				expectedPassportId: PASSPORT_ID,
				expectedWallet: WALLET,
			}),
		/already_consumed/,
	);
});

test("an unlinked wallet cannot authenticate a Passport", () => {
	const ctx = setup({ authorizeWallet: () => false });
	const { message, signature, challenge } = issue(ctx);
	assert.throws(
		() =>
			ctx.auth.authenticate({
				message,
				signature,
				expectedPassportId: PASSPORT_ID,
				expectedWallet: WALLET,
			}),
		/wallet is not linked/,
	);
	assert.equal(ctx.store.getChallenge(challenge.nonceHash).consumedAt, null);
});

test("a signed message cannot change the stored challenge Passport", () => {
	const ctx = setup({ authorizeWallet: () => true });
	const { message } = issue(ctx);
	const otherPassport = "22222222-2222-4222-8222-222222222222";
	const changed = message.replace(
		`passport: ${PASSPORT_ID}`,
		`passport: ${otherPassport}`,
	);
	assert.throws(
		() =>
			ctx.auth.authenticate({
				message: changed,
				signature: sign(changed),
				expectedPassportId: otherPassport,
				expectedWallet: WALLET,
			}),
		/stored challenge mismatch/,
	);
});

test("expired challenge is rejected", () => {
	const ctx = setup();
	const { message, signature } = issue(ctx);

	ctx.advance(CHALLENGE_TTL_MS + 1000);

	assert.throws(
		() =>
			ctx.auth.authenticate({
				message,
				signature,
				expectedPassportId: PASSPORT_ID,
				expectedWallet: WALLET,
			}),
		/expired|past beyond TTL/,
	);
});

test("challenge issued too far in the future is rejected", () => {
	const ctx = setup();
	const { message, signature } = issue(ctx);

	ctx.at(BASE_TIME - (MAX_CLOCK_SKEW_MS + 1000));

	assert.throws(
		() =>
			ctx.auth.authenticate({
				message,
				signature,
				expectedPassportId: PASSPORT_ID,
				expectedWallet: WALLET,
			}),
		/issued in the future/,
	);
});

test("malformed message is rejected", () => {
	const ctx = setup();
	assert.throws(
		() =>
			ctx.auth.authenticate({
				message: "definitely not a challenge",
				signature: "x",
				expectedPassportId: PASSPORT_ID,
				expectedWallet: WALLET,
			}),
		/passport challenge/,
	);
});

test("wrong action is rejected", () => {
	const ctx = setup();
	const { message } = issue(ctx);
	const tampered = message.replace(
		"action: passport.authenticate",
		"action: passport.transfer",
	);

	assert.throws(
		() =>
			ctx.auth.authenticate({
				message: tampered,
				signature: sign(tampered),
				expectedPassportId: PASSPORT_ID,
				expectedWallet: WALLET,
			}),
		/action/,
	);
});

test("wrong passport is rejected", () => {
	const ctx = setup();
	const { message } = issue(ctx);
	const tampered = message.replace(
		`passport: ${PASSPORT_ID}`,
		"passport: 22222222-2222-4222-8222-222222222222",
	);

	assert.throws(
		() =>
			ctx.auth.authenticate({
				message: tampered,
				signature: sign(tampered),
				expectedPassportId: PASSPORT_ID,
				expectedWallet: WALLET,
			}),
		/passport mismatch/,
	);
});

test("wrong wallet is rejected", () => {
	const ctx = setup();
	const { message } = issue(ctx);
	const tampered = message.replace(
		`wallet: ${WALLET}`,
		`wallet: ${OTHER_WALLET}`,
	);

	assert.throws(
		() =>
			ctx.auth.authenticate({
				message: tampered,
				signature: sign(tampered, other),
				expectedPassportId: PASSPORT_ID,
				expectedWallet: WALLET,
			}),
		/wallet mismatch/,
	);
});

test("wrong domain is rejected", () => {
	const ctx = setup();
	const { message } = issue(ctx);
	const tampered = message.replace(`domain: ${DOMAIN}`, "domain: evil.example");

	assert.throws(
		() =>
			ctx.auth.authenticate({
				message: tampered,
				signature: sign(tampered),
				expectedPassportId: PASSPORT_ID,
				expectedWallet: WALLET,
			}),
		/domain mismatch/,
	);
});

test("wrong network is rejected", () => {
	const ctx = setup();
	const { message } = issue(ctx);
	const tampered = message.replace("network: DEVNET", "network: MAINNET");

	assert.throws(
		() =>
			ctx.auth.authenticate({
				message: tampered,
				signature: sign(tampered),
				expectedPassportId: PASSPORT_ID,
				expectedWallet: WALLET,
			}),
		/network/,
	);
});

test("verify limit exceeded is rejected fail-closed and does not consume the nonce", () => {
	const ctx = setup({ verifyLimit: 1 });
	const { message, challenge, signature } = issue(ctx);

	// Exhaust the verify window for this wallet first.
	assert.equal(ctx.verifyLimiter.check(WALLET).allowed, true);

	assert.throws(
		() =>
			ctx.auth.authenticate({
				message,
				signature,
				expectedPassportId: PASSPORT_ID,
				expectedWallet: WALLET,
			}),
		/rate limit exceeded/,
	);

	assert.equal(ctx.store.getChallenge(challenge.nonceHash).consumedAt, null);
});

test("a broken verify limiter fails closed and does not consume the nonce", () => {
	const ctx = setup({ verifyLimiter: {} });
	const { message, challenge, signature } = issue(ctx);

	assert.throws(
		() =>
			ctx.auth.authenticate({
				message,
				signature,
				expectedPassportId: PASSPORT_ID,
				expectedWallet: WALLET,
			}),
		/rate limit unavailable/,
	);

	assert.equal(ctx.store.getChallenge(challenge.nonceHash).consumedAt, null);
});

test("issue limiter is keyed by wallet and fails closed", () => {
	const ctx = setup({ issueLimit: 1 });

	assert.doesNotThrow(() =>
		ctx.auth.issueChallenge({ passportId: PASSPORT_ID, wallet: WALLET }),
	);
	// Second issue for the same wallet is denied.
	assert.throws(
		() => ctx.auth.issueChallenge({ passportId: PASSPORT_ID, wallet: WALLET }),
		/rate limit exceeded/,
	);
	// A different wallet still gets its own window.
	assert.doesNotThrow(() =>
		ctx.auth.issueChallenge({ passportId: PASSPORT_ID, wallet: OTHER_WALLET }),
	);
});

test("logout revokes the session so CSRF then fails", () => {
	const ctx = setup();
	const { message, signature } = issue(ctx);
	const { session, csrfToken } = ctx.auth.authenticate({
		message,
		signature,
		expectedPassportId: PASSPORT_ID,
		expectedWallet: WALLET,
	});

	// Valid CSRF passes while the session is active.
	assert.equal(ctx.auth.requireCsrf(session, csrfToken), true);

	logout(ctx.store, session);
	assert.equal(typeof session.revokedAt, "string");

	assert.throws(
		() => ctx.auth.requireCsrf(session, csrfToken),
		new RegExp(PASSPORT_CSRF_ERROR),
	);
});

test("no session is returned on any rejection path", () => {
	const ctx = setup();
	const { message } = issue(ctx);

	const attempts = [
		{ message: "bad", signature: "x" },
		{ message, signature: "x" },
		{
			message: message.replace(`wallet: ${WALLET}`, `wallet: ${OTHER_WALLET}`),
			signature: "x",
		},
	];

	for (const attempt of attempts) {
		assert.throws(() =>
			ctx.auth.authenticate({
				...attempt,
				expectedPassportId: PASSPORT_ID,
				expectedWallet: WALLET,
			}),
		);
	}
});

test("session credentials live for exactly the session TTL window", () => {
	const ctx = setup();
	const { message, signature } = issue(ctx);
	const { session, csrfToken } = ctx.auth.authenticate({
		message,
		signature,
		expectedPassportId: PASSPORT_ID,
		expectedWallet: WALLET,
	});

	assert.equal(
		Date.parse(session.expiresAt) - Date.parse(session.issuedAt),
		SESSION_TTL_MS,
	);
	assert.equal(ctx.auth.requireCsrf(session, csrfToken), true);
	ctx.advance(SESSION_TTL_MS + 1);
	assert.throws(
		() => ctx.auth.requireCsrf(session, csrfToken),
		new RegExp(PASSPORT_CSRF_ERROR),
	);
});
