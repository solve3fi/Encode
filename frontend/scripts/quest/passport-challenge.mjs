import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import { assertPassportId } from "./passport-id.mjs";

/**
 * Quest Passport challenge message.
 *
 * Pure, driver-free and network-free: this module builds, validates and parses
 * the canonical challenge text a wallet signs to authenticate a Passport. It
 * never opens a socket, reads a file, or touches a database and it holds no
 * ambient state.
 */

/** @typedef {"DEVNET"} PassportNetwork */

/** The only network this dormant module ever emits. @type {PassportNetwork} */
export const PASSPORT_NETWORK = "DEVNET";

/** The single authentication action allowed by the challenge. */
export const PASSPORT_AUTH_ACTION = "passport.authenticate";

/** Default challenge lifetime in milliseconds. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Maximum tolerated clock skew in milliseconds. */
export const MAX_CLOCK_SKEW_MS = 30000;

/** Frozen allowlist of accepted actions. */
export const PASSPORT_ACTION_ALLOWLIST = Object.freeze([PASSPORT_AUTH_ACTION]);

const CHALLENGE_HEADER = "solve3 passport authentication v1";

const NONCE_BYTES = 32;
const BASE64URL_32_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** Ordered label -> output key for the eight body lines. */
const BODY_LINES = Object.freeze([
	["network", "network"],
	["domain", "domain"],
	["action", "action"],
	["passport", "passportId"],
	["wallet", "wallet"],
	["nonce", "nonce"],
	["issuedAt", "issuedAt"],
	["expiresAt", "expiresAt"],
]);

/**
 * Generate a fresh challenge nonce.
 *
 * @param {(size: number) => Uint8Array} [randomBytes]
 * @returns {string} base64url encoding of 32 random bytes.
 */
export function createNonce(randomBytes = nodeRandomBytes) {
	const bytes = randomBytes(NONCE_BYTES);
	return Buffer.from(bytes).toString("base64url");
}

/**
 * Hash a nonce with sha256.
 *
 * @param {string} nonce
 * @returns {string} lowercase sha256 hex digest (64 characters).
 */
export function hashNonce(nonce) {
	return createHash("sha256").update(nonce, "utf8").digest("hex");
}

/**
 * Return true when `nonce` is the canonical base64url encoding of 32 bytes.
 *
 * @param {unknown} nonce
 * @returns {boolean}
 */
export function isValidNonce(nonce) {
	if (typeof nonce !== "string" || !BASE64URL_32_PATTERN.test(nonce)) {
		return false;
	}
	const bytes = Buffer.from(nonce, "base64url");
	return bytes.length === NONCE_BYTES && bytes.toString("base64url") === nonce;
}

/**
 * Throw unless `nonce` is valid base64url of exactly 32 bytes.
 *
 * @param {unknown} nonce
 * @returns {string} the validated nonce.
 */
export function assertValidNonce(nonce) {
	if (!isValidNonce(nonce)) {
		throw new Error(
			"passport challenge: nonce must be base64url of exactly 32 bytes",
		);
	}
	return nonce;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function assertNonEmptyField(value, field) {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`passport challenge: ${field} must be a non-empty string`);
	}
	if (value.includes("\n")) {
		throw new Error(`passport challenge: ${field} must not contain a newline`);
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
			`passport challenge: ${field} must be an ISO-8601 UTC string`,
		);
	}
	const parsed = Date.parse(value);
	if (Number.isNaN(parsed)) {
		throw new Error(
			`passport challenge: ${field} must be a valid ISO-8601 UTC timestamp`,
		);
	}
	return parsed;
}

/**
 * @param {unknown} action
 * @returns {string}
 */
function assertAllowedAction(action) {
	if (
		typeof action !== "string" ||
		!PASSPORT_ACTION_ALLOWLIST.includes(action)
	) {
		throw new Error(
			`passport challenge: action must be one of ${PASSPORT_ACTION_ALLOWLIST.join(", ")}`,
		);
	}
	return action;
}

/**
 * @param {unknown} network
 * @returns {PassportNetwork}
 */
function assertNetwork(network) {
	if (network !== PASSPORT_NETWORK) {
		throw new Error(`passport challenge: network must be ${PASSPORT_NETWORK}`);
	}
	return PASSPORT_NETWORK;
}

/**
 * Build the canonical challenge message.
 *
 * The output is exactly the header line followed by eight `key: value` lines in
 * a fixed order. The emitted network is always `DEVNET` and the action must be
 * present in the frozen allowlist.
 *
 * @param {{
 *   domain: string,
 *   action: string,
 *   passportId: string,
 *   wallet: string,
 *   nonce: string,
 *   issuedAt: string,
 *   expiresAt: string,
 *   network?: PassportNetwork,
 * }} params
 * @returns {string}
 */
export function buildChallengeMessage({
	domain,
	action,
	passportId,
	wallet,
	nonce,
	issuedAt,
	expiresAt,
	network = PASSPORT_NETWORK,
} = {}) {
	const safeDomain = assertNonEmptyField(domain, "domain");
	const safeAction = assertAllowedAction(action);
	const safePassportId = assertPassportId(passportId);
	const safeWallet = assertNonEmptyField(wallet, "wallet");
	const safeNonce = assertValidNonce(nonce);
	const issued = assertTimestamp(issuedAt, "issuedAt");
	const expires = assertTimestamp(expiresAt, "expiresAt");
	assertNetwork(network);

	if (expires <= issued) {
		throw new Error(
			"passport challenge: expiresAt must be after issuedAt (positive TTL)",
		);
	}

	return [
		CHALLENGE_HEADER,
		`network: ${PASSPORT_NETWORK}`,
		`domain: ${safeDomain}`,
		`action: ${safeAction}`,
		`passport: ${safePassportId}`,
		`wallet: ${safeWallet}`,
		`nonce: ${safeNonce}`,
		`issuedAt: ${issuedAt}`,
		`expiresAt: ${expiresAt}`,
	].join("\n");
}

/**
 * Strictly re-parse a canonical challenge message.
 *
 * The header and the eight body lines must match exactly, in order, with no
 * extra, missing or renamed lines, and every parsed value is re-validated.
 *
 * @param {string} message
 * @returns {{
 *   network: PassportNetwork,
 *   domain: string,
 *   action: string,
 *   passportId: string,
 *   wallet: string,
 *   nonce: string,
 *   issuedAt: string,
 *   expiresAt: string,
 * }}
 */
export function parseChallengeMessage(message) {
	if (typeof message !== "string" || message.length === 0) {
		throw new Error("passport challenge: message must be a non-empty string");
	}

	const lines = message.split("\n");
	if (lines.length !== BODY_LINES.length + 1) {
		throw new Error(
			`passport challenge: expected 1 header and ${BODY_LINES.length} body lines, got ${lines.length} line(s)`,
		);
	}

	if (lines[0] !== CHALLENGE_HEADER) {
		throw new Error(
			`passport challenge: invalid header, expected "${CHALLENGE_HEADER}"`,
		);
	}

	/** @type {Record<string, string>} */
	const raw = {};
	BODY_LINES.forEach(([label, key], index) => {
		const line = lines[index + 1];
		const prefix = `${label}: `;
		if (!line.startsWith(prefix)) {
			throw new Error(
				`passport challenge: line ${index + 2} must start with "${prefix}"`,
			);
		}
		raw[key] = line.slice(prefix.length);
	});

	const network = assertNetwork(raw.network);
	const domain = assertNonEmptyField(raw.domain, "domain");
	const action = assertAllowedAction(raw.action);
	const passportId = assertNonEmptyField(raw.passportId, "passportId");
	const wallet = assertNonEmptyField(raw.wallet, "wallet");
	const nonce = assertValidNonce(raw.nonce);
	const issued = assertTimestamp(raw.issuedAt, "issuedAt");
	const expires = assertTimestamp(raw.expiresAt, "expiresAt");

	if (expires <= issued) {
		throw new Error(
			"passport challenge: expiresAt must be after issuedAt (positive TTL)",
		);
	}

	return {
		network,
		domain,
		action,
		passportId,
		wallet,
		nonce,
		issuedAt: raw.issuedAt,
		expiresAt: raw.expiresAt,
	};
}
