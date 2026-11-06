import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	COOKIE_NAME,
	createCsrfToken,
	createSession,
	createSessionToken,
	hashCsrfToken,
	hashSessionToken,
	isSessionActive,
	parseCookieHeader,
	SESSION_NETWORK,
	SESSION_TTL_MS,
	serializeSessionCookie,
	verifyCsrf,
} from "./passport-session.mjs";

const SESSION_TOKEN = Buffer.alloc(32, 1).toString("base64url");
const CSRF_TOKEN = Buffer.alloc(32, 2).toString("base64url");
const ISSUED_AT = "2026-09-29T12:00:00.000Z";
const EXPIRES_AT = "2026-09-29T12:30:00.000Z";

function fixedRandomBytes(fillByte) {
	return (size) => Buffer.alloc(size, fillByte);
}

test("constants expose the dormant session configuration", () => {
	assert.equal(SESSION_TTL_MS, 30 * 60 * 1000);
	assert.equal(COOKIE_NAME, "solve3_passport");
	assert.equal(SESSION_NETWORK, "DEVNET");
});

test("createSessionToken returns 43-char base64url of 32 bytes", () => {
	const token = createSessionToken();
	assert.equal(token.length, 43);
	assert.match(token, /^[A-Za-z0-9_-]{43}$/);
	assert.notEqual(token, createSessionToken());
});

test("createSessionToken and createCsrfToken honor injected randomBytes", () => {
	const token = createSessionToken(fixedRandomBytes(7));
	assert.equal(token, Buffer.alloc(32, 7).toString("base64url"));

	const csrf = createCsrfToken(fixedRandomBytes(8));
	assert.equal(csrf, Buffer.alloc(32, 8).toString("base64url"));
});

test("hashSessionToken and hashCsrfToken return lowercase 64-char sha256 hex", () => {
	const digest = hashSessionToken(SESSION_TOKEN);
	assert.equal(digest.length, 64);
	assert.match(digest, /^[0-9a-f]{64}$/);
	assert.equal(hashSessionToken(SESSION_TOKEN), digest);
	assert.notEqual(
		hashSessionToken(SESSION_TOKEN),
		hashSessionToken(CSRF_TOKEN),
	);
	assert.equal(hashCsrfToken(CSRF_TOKEN), hashSessionToken(CSRF_TOKEN));
});

test("createSession stores only token/csrf hashes, never the raw tokens", () => {
	const session = createSession({
		network: SESSION_NETWORK,
		passportId: "11111111-1111-4111-8111-111111111111",
		sessionToken: SESSION_TOKEN,
		csrfToken: CSRF_TOKEN,
		issuedAt: ISSUED_AT,
		expiresAt: EXPIRES_AT,
	});

	assert.deepEqual(session, {
		network: "DEVNET",
		passportId: "11111111-1111-4111-8111-111111111111",
		tokenHash: hashSessionToken(SESSION_TOKEN),
		csrfHash: hashCsrfToken(CSRF_TOKEN),
		issuedAt: ISSUED_AT,
		expiresAt: EXPIRES_AT,
		revokedAt: null,
	});
	assert.equal(session.sessionToken, undefined);
	assert.equal(session.csrfToken, undefined);

	const serialized = JSON.stringify(session);
	assert.ok(!serialized.includes(SESSION_TOKEN));
	assert.ok(!serialized.includes(CSRF_TOKEN));
});

test("createSession rejects any network other than DEVNET", () => {
	assert.throws(
		() =>
			createSession({
				network: "MAINNET",
				passportId: "11111111-1111-4111-8111-111111111111",
				sessionToken: SESSION_TOKEN,
				csrfToken: CSRF_TOKEN,
				issuedAt: ISSUED_AT,
				expiresAt: EXPIRES_AT,
			}),
		/network must be DEVNET/,
	);
	assert.throws(
		() =>
			createSession({
				network: "devnet",
				passportId: "11111111-1111-4111-8111-111111111111",
				sessionToken: SESSION_TOKEN,
				csrfToken: CSRF_TOKEN,
				issuedAt: ISSUED_AT,
				expiresAt: EXPIRES_AT,
			}),
		/network must be DEVNET/,
	);
});

test("createSession rejects malformed tokens and timestamps", () => {
	const fields = {
		network: SESSION_NETWORK,
		passportId: "11111111-1111-4111-8111-111111111111",
		sessionToken: SESSION_TOKEN,
		csrfToken: CSRF_TOKEN,
		issuedAt: ISSUED_AT,
		expiresAt: EXPIRES_AT,
	};

	assert.throws(
		() => createSession({ ...fields, passportId: "" }),
		/passportId/,
	);
	assert.throws(
		() => createSession({ ...fields, sessionToken: "short" }),
		/sessionToken must be base64url of exactly 32 bytes/,
	);
	assert.throws(
		() => createSession({ ...fields, csrfToken: 123 }),
		/csrfToken must be base64url of exactly 32 bytes/,
	);
	assert.throws(
		() => createSession({ ...fields, issuedAt: "not-a-date" }),
		/issuedAt/,
	);
	assert.throws(
		() => createSession({ ...fields, expiresAt: ISSUED_AT }),
		/expiresAt must be after issuedAt/,
	);
	assert.throws(
		() =>
			createSession({
				...fields,
				expiresAt: "2026-09-29T11:00:00.000Z",
			}),
		/expiresAt must be after issuedAt/,
	);
});

test("serializeSessionCookie emits HttpOnly, Secure, SameSite=Strict and Path=/", () => {
	const cookie = serializeSessionCookie(SESSION_TOKEN, {
		maxAgeSeconds: 1800,
	});

	assert.match(cookie, new RegExp(`^${COOKIE_NAME}=${SESSION_TOKEN};`));
	assert.match(cookie, /HttpOnly/);
	assert.match(cookie, /Secure/);
	assert.match(cookie, /SameSite=Strict/);
	assert.match(cookie, /Path=\//);
	assert.match(cookie, /Max-Age=1800/);
});

test("serializeSessionCookie defaults to the session TTL and Secure", () => {
	const cookie = serializeSessionCookie(SESSION_TOKEN);
	assert.match(cookie, /Max-Age=1800/);
	assert.match(cookie, /Secure/);
});

test("serializeSessionCookie refuses malformed or injected token values", () => {
	assert.throws(() => serializeSessionCookie("short"), /sessionToken/);
	assert.throws(
		() => serializeSessionCookie(`${SESSION_TOKEN}; SameSite=None`),
		/sessionToken/,
	);
});

test("serializeSessionCookie omits Secure when secure is false", () => {
	const cookie = serializeSessionCookie(SESSION_TOKEN, {
		maxAgeSeconds: 10,
		secure: false,
	});
	assert.match(cookie, /Max-Age=10/);
	assert.match(cookie, /HttpOnly/);
	assert.match(cookie, /SameSite=Strict/);
	assert.match(cookie, /Path=\//);
	assert.doesNotMatch(cookie, /Secure/);
});

test("parseCookieHeader reads the cookie value back", () => {
	assert.equal(
		parseCookieHeader(`${COOKIE_NAME}=${SESSION_TOKEN}; other=1`, COOKIE_NAME),
		SESSION_TOKEN,
	);
	assert.equal(
		parseCookieHeader(
			`other=1; ${COOKIE_NAME}=${CSRF_TOKEN}; flag=on`,
			COOKIE_NAME,
		),
		CSRF_TOKEN,
	);
	assert.equal(
		parseCookieHeader(` ${COOKIE_NAME}=${CSRF_TOKEN} `, COOKIE_NAME),
		CSRF_TOKEN,
	);
	assert.equal(parseCookieHeader("other=1", COOKIE_NAME), null);
	assert.equal(parseCookieHeader("", COOKIE_NAME), null);
	assert.equal(parseCookieHeader("other=1", "nope"), null);
	assert.equal(
		parseCookieHeader(
			`${COOKIE_NAME}=${SESSION_TOKEN}; ${COOKIE_NAME}=${CSRF_TOKEN}`,
			COOKIE_NAME,
		),
		null,
	);
});

test("cookie serialize then parse round-trips the token", () => {
	const token = createSessionToken();
	const cookie = serializeSessionCookie(token, { maxAgeSeconds: 30 });
	const header = `visitor=abc; ${COOKIE_NAME}=${token}; flag=on`;
	assert.equal(parseCookieHeader(header, COOKIE_NAME), token);
	assert.ok(cookie.startsWith(`${COOKIE_NAME}=${token};`));
});

test("verifyCsrf matches the stored hash", () => {
	const session = createSession({
		network: SESSION_NETWORK,
		passportId: "11111111-1111-4111-8111-111111111111",
		sessionToken: SESSION_TOKEN,
		csrfToken: CSRF_TOKEN,
		issuedAt: ISSUED_AT,
		expiresAt: EXPIRES_AT,
	});

	assert.equal(verifyCsrf(session, CSRF_TOKEN), true);
});

test("verifyCsrf is false on a mismatched token", () => {
	const session = createSession({
		network: SESSION_NETWORK,
		passportId: "11111111-1111-4111-8111-111111111111",
		sessionToken: SESSION_TOKEN,
		csrfToken: CSRF_TOKEN,
		issuedAt: ISSUED_AT,
		expiresAt: EXPIRES_AT,
	});

	assert.equal(verifyCsrf(session, createCsrfToken()), false);
	assert.equal(verifyCsrf(session, ""), false);
	assert.equal(verifyCsrf(session, "not-a-token"), false);
	assert.equal(verifyCsrf(session, null), false);
	assert.equal(
		verifyCsrf({ csrfHash: hashCsrfToken(CSRF_TOKEN) }, CSRF_TOKEN),
		true,
	);
	assert.equal(verifyCsrf({}, CSRF_TOKEN), false);
});

test("verifyCsrf is false on different-length hashes without throwing", () => {
	// A shortened stored hash differs in buffer length; verifyCsrf must
	// return false instead of throwing from timingSafeEqual.
	const shortHash = hashCsrfToken(CSRF_TOKEN).slice(0, 8);
	assert.equal(verifyCsrf({ csrfHash: shortHash }, CSRF_TOKEN), false);

	const longHash = `${hashCsrfToken(CSRF_TOKEN)}00`;
	assert.equal(verifyCsrf({ csrfHash: longHash }, CSRF_TOKEN), false);
});

test("isSessionActive is true before expiry with an injected now", () => {
	const session = createSession({
		network: SESSION_NETWORK,
		passportId: "11111111-1111-4111-8111-111111111111",
		sessionToken: SESSION_TOKEN,
		csrfToken: CSRF_TOKEN,
		issuedAt: ISSUED_AT,
		expiresAt: EXPIRES_AT,
	});

	const issuedMs = Date.parse(ISSUED_AT);
	const expiresMs = Date.parse(EXPIRES_AT);

	assert.equal(isSessionActive(session, issuedMs), true);
	assert.equal(isSessionActive(session, expiresMs - 1), true);
	assert.equal(isSessionActive(session, new Date(expiresMs - 1)), true);
});

test("isSessionActive is false at and after expiry", () => {
	const session = createSession({
		network: SESSION_NETWORK,
		passportId: "11111111-1111-4111-8111-111111111111",
		sessionToken: SESSION_TOKEN,
		csrfToken: CSRF_TOKEN,
		issuedAt: ISSUED_AT,
		expiresAt: EXPIRES_AT,
	});

	const expiresMs = Date.parse(EXPIRES_AT);
	assert.equal(isSessionActive(session, expiresMs), false);
	assert.equal(isSessionActive(session, expiresMs + 1), false);
});

test("isSessionActive is false once revoked, even before expiry", () => {
	const session = createSession({
		network: SESSION_NETWORK,
		passportId: "11111111-1111-4111-8111-111111111111",
		sessionToken: SESSION_TOKEN,
		csrfToken: CSRF_TOKEN,
		issuedAt: ISSUED_AT,
		expiresAt: EXPIRES_AT,
	});

	assert.equal(isSessionActive(session, Date.parse(ISSUED_AT)), true);
	session.revokedAt = "2026-09-29T12:01:00.000Z";
	assert.equal(isSessionActive(session, Date.parse(ISSUED_AT)), false);
	assert.equal(isSessionActive(session, Date.parse(EXPIRES_AT) + 1), false);
});

test("module imports no filesystem, network or database driver", () => {
	const source = readFileSync(
		fileURLToPath(new URL("./passport-session.mjs", import.meta.url)),
		"utf8",
	);
	assert.doesNotMatch(source, /node:fs|node:net|node:http|node:dns/i);
	assert.doesNotMatch(source, /from\s+["']pg["']|postgres|mysql|sqlite/i);
});
