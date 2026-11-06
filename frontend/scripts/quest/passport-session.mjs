import {
	createHash,
	randomBytes as nodeRandomBytes,
	timingSafeEqual,
} from "node:crypto";
import { assertPassportId } from "./passport-id.mjs";

/**
 * Quest Passport session.
 *
 * Pure, driver-free and network-free: this module creates and validates the
 * short-lived, server-bound Passport session and its cookie. Raw tokens are
 * only ever present in the cookie value; stored sessions hold sha256 hex
 * hashes. It never opens a socket, reads a file, or touches a database.
 */

/** The only network this dormant module ever emits. */
export const SESSION_NETWORK = "DEVNET";

/** Session lifetime in milliseconds (30 minutes). */
export const SESSION_TTL_MS = 30 * 60 * 1000;

/** Cookie name for the server-bound session token. */
export const COOKIE_NAME = "solve3_passport";

const TOKEN_BYTES = 32;
const BASE64URL_32_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/**
 * Generate a fresh 32-byte token encoded as base64url.
 *
 * @param {(size: number) => Uint8Array} [randomBytes]
 * @returns {string} base64url encoding of 32 random bytes.
 */
export function createSessionToken(randomBytes = nodeRandomBytes) {
	const bytes = randomBytes(TOKEN_BYTES);
	return Buffer.from(bytes).toString("base64url");
}

/**
 * Generate a fresh CSRF token (base64url of 32 random bytes).
 *
 * @param {(size: number) => Uint8Array} [randomBytes]
 * @returns {string} base64url encoding of 32 random bytes.
 */
export function createCsrfToken(randomBytes = nodeRandomBytes) {
	const bytes = randomBytes(TOKEN_BYTES);
	return Buffer.from(bytes).toString("base64url");
}

/**
 * Hash a token with sha256.
 *
 * @param {string} token
 * @returns {string} lowercase sha256 hex digest (64 characters).
 */
export function hashSessionToken(token) {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Hash a CSRF token with sha256.
 *
 * @param {string} token
 * @returns {string} lowercase sha256 hex digest (64 characters).
 */
export function hashCsrfToken(token) {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Return true when `token` is the canonical base64url encoding of 32 bytes.
 *
 * @param {unknown} token
 * @returns {boolean}
 */
function isValidToken(token) {
	if (typeof token !== "string" || !BASE64URL_32_PATTERN.test(token)) {
		return false;
	}
	const bytes = Buffer.from(token, "base64url");
	return bytes.length === TOKEN_BYTES && bytes.toString("base64url") === token;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function assertToken(value, field) {
	if (!isValidToken(value)) {
		throw new Error(
			`passport session: ${field} must be base64url of exactly 32 bytes`,
		);
	}
	return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
function assertTimestamp(value, field) {
	if (typeof value !== "string" || !ISO_UTC_PATTERN.test(value)) {
		throw new Error(
			`passport session: ${field} must be an ISO-8601 UTC string`,
		);
	}
	const parsed = Date.parse(value);
	if (Number.isNaN(parsed)) {
		throw new Error(
			`passport session: ${field} must be a valid ISO-8601 UTC timestamp`,
		);
	}
	return parsed;
}

/**
 * Build a stored session object.
 *
 * Network validation is limited to exactly `DEVNET`. The returned object
 * stores only sha256 hashes of the session token and CSRF token; the raw
 * tokens are never retained.
 *
 * @param {{
 *   network: string,
 *   passportId: string,
 *   sessionToken: string,
 *   csrfToken: string,
 *   issuedAt: string,
 *   expiresAt: string,
 * }} params
 * @returns {{
 *   network: string,
 *   passportId: string,
 *   tokenHash: string,
 *   csrfHash: string,
 *   issuedAt: string,
 *   expiresAt: string,
 *   revokedAt: string | null,
 * }}
 */
export function createSession({
	network,
	passportId,
	sessionToken,
	csrfToken,
	issuedAt,
	expiresAt,
}) {
	if (network !== SESSION_NETWORK) {
		throw new Error(`passport session: network must be ${SESSION_NETWORK}`);
	}
	const safePassportId = assertPassportId(passportId);
	assertToken(sessionToken, "sessionToken");
	assertToken(csrfToken, "csrfToken");
	const issuedMs = assertTimestamp(issuedAt, "issuedAt");
	const expiresMs = assertTimestamp(expiresAt, "expiresAt");

	if (expiresMs <= issuedMs) {
		throw new Error(
			"passport session: expiresAt must be after issuedAt (positive TTL)",
		);
	}

	return {
		network: SESSION_NETWORK,
		passportId: safePassportId,
		tokenHash: hashSessionToken(sessionToken),
		csrfHash: hashCsrfToken(csrfToken),
		issuedAt,
		expiresAt,
		revokedAt: null,
	};
}

/**
 * Serialize the session cookie.
 *
 * The cookie value is the raw session token; the server looks the session up
 * by its sha256 hash. The serialized string always includes `HttpOnly`,
 * `SameSite=Strict` and `Path=/`, and includes `Secure` unless explicitly
 * disabled.
 *
 * @param {string} token
 * @param {{ maxAgeSeconds?: number, secure?: boolean }} [options]
 * @returns {string}
 */
export function serializeSessionCookie(
	token,
	{ maxAgeSeconds = SESSION_TTL_MS / 1000, secure = true } = {},
) {
	assertToken(token, "sessionToken");
	if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
		throw new Error(
			"passport session: maxAgeSeconds must be a non-negative integer",
		);
	}
	if (typeof secure !== "boolean") {
		throw new Error("passport session: secure must be a boolean");
	}

	const attributes = [`Max-Age=${maxAgeSeconds}`, "Path=/"];
	if (secure) {
		attributes.push("Secure");
	}
	attributes.push("SameSite=Strict", "HttpOnly");

	return `${COOKIE_NAME}=${token}; ${attributes.join("; ")}`;
}

/**
 * Read a cookie value back out of a `Cookie` request header string.
 *
 * @param {string} header
 * @param {string} name
 * @returns {string | null} the cookie value, or null when the cookie is absent.
 */
export function parseCookieHeader(header, name) {
	if (typeof header !== "string" || typeof name !== "string") {
		return null;
	}

	/** @type {string | null} */
	let value = null;
	for (const part of header.split(";")) {
		const trimmed = part.trim();
		const separator = trimmed.indexOf("=");
		if (separator <= 0) {
			continue;
		}
		if (trimmed.slice(0, separator).trim() !== name) {
			continue;
		}
		if (value !== null) {
			return null;
		}
		value = trimmed.slice(separator + 1).trim();
	}
	return value;
}

/**
 * Compare a presented CSRF token against the stored hash in constant time.
 *
 * Uses `crypto.timingSafeEqual` on equal-length buffers and returns false
 * when the digests differ in length, instead of throwing.
 *
 * @param {{ csrfHash?: string }} session
 * @param {string} presentedToken
 * @returns {boolean}
 */
export function verifyCsrf(session, presentedToken) {
	if (
		typeof session !== "object" ||
		session === null ||
		typeof session.csrfHash !== "string" ||
		typeof presentedToken !== "string"
	) {
		return false;
	}
	const expected = Buffer.from(session.csrfHash, "hex");
	const actual = Buffer.from(hashCsrfToken(presentedToken), "hex");
	if (expected.length !== actual.length) {
		return false;
	}
	return timingSafeEqual(expected, actual);
}

/**
 * Return true when the session is active at the given moment.
 *
 * A session is inactive once `now` reaches `expiresAt` (inclusive) or when a
 * `revokedAt` marker is set.
 *
 * @param {{ expiresAt?: string, revokedAt?: string | null }} session
 * @param {number | Date} now epoch milliseconds or a Date.
 * @returns {boolean}
 */
export function isSessionActive(session, now) {
	if (
		typeof session !== "object" ||
		session === null ||
		typeof session.expiresAt !== "string"
	) {
		return false;
	}
	if (session.revokedAt != null) {
		return false;
	}

	const expiresMs = Date.parse(session.expiresAt);
	if (!Number.isFinite(expiresMs)) {
		return false;
	}
	const nowMs = now instanceof Date ? now.getTime() : Number(now);
	if (!Number.isFinite(nowMs)) {
		return false;
	}
	return nowMs < expiresMs;
}
