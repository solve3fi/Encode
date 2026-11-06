import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	assertValidNonce,
	buildChallengeMessage,
	CHALLENGE_TTL_MS,
	createNonce,
	hashNonce,
	isValidNonce,
	MAX_CLOCK_SKEW_MS,
	PASSPORT_ACTION_ALLOWLIST,
	PASSPORT_AUTH_ACTION,
	PASSPORT_NETWORK,
	parseChallengeMessage,
} from "./passport-challenge.mjs";

const NONCE = Buffer.alloc(32, 0).toString("base64url");
const ISSUED_AT = "2026-09-29T12:00:00.000Z";
const EXPIRES_AT = "2026-09-29T12:05:00.000Z";

function fields(overrides = {}) {
	return {
		domain: "quest.solve3.xyz",
		action: PASSPORT_AUTH_ACTION,
		passportId: "11111111-1111-4111-8111-111111111111",
		wallet: "9xQeWvG816bUx9EPf7jW1k2m3n4p5q6r7s8t9v0w1x",
		nonce: NONCE,
		issuedAt: ISSUED_AT,
		expiresAt: EXPIRES_AT,
		...overrides,
	};
}

function expectedMessage(overrides = {}) {
	const f = fields(overrides);
	return [
		"solve3 passport authentication v1",
		`network: ${PASSPORT_NETWORK}`,
		`domain: ${f.domain}`,
		`action: ${f.action}`,
		`passport: ${f.passportId}`,
		`wallet: ${f.wallet}`,
		`nonce: ${f.nonce}`,
		`issuedAt: ${f.issuedAt}`,
		`expiresAt: ${f.expiresAt}`,
	].join("\n");
}

test("constants expose the dormant Devnet configuration", () => {
	assert.equal(PASSPORT_NETWORK, "DEVNET");
	assert.equal(PASSPORT_AUTH_ACTION, "passport.authenticate");
	assert.equal(CHALLENGE_TTL_MS, 5 * 60 * 1000);
	assert.equal(MAX_CLOCK_SKEW_MS, 30000);
	assert.deepEqual(PASSPORT_ACTION_ALLOWLIST, [PASSPORT_AUTH_ACTION]);
	assert.ok(Object.isFrozen(PASSPORT_ACTION_ALLOWLIST));
});

test("buildChallengeMessage output matches the exact header and ordered lines", () => {
	assert.equal(buildChallengeMessage(fields()), expectedMessage());
	assert.equal(
		buildChallengeMessage(fields()).split("\n")[0],
		"solve3 passport authentication v1",
	);
});

test("buildChallengeMessage is deterministic for fixed inputs", () => {
	const first = buildChallengeMessage(fields());
	const second = buildChallengeMessage(fields());
	assert.equal(first, second);
});

test("buildChallengeMessage always writes DEVNET when network is omitted", () => {
	const message = buildChallengeMessage(fields());
	assert.match(message, /\nnetwork: DEVNET\n/);
	assert.equal(buildChallengeMessage(fields({ network: "DEVNET" })), message);
});

test("round-trip build then parse returns the original fields", () => {
	const message = buildChallengeMessage(fields());
	assert.deepEqual(parseChallengeMessage(message), {
		network: PASSPORT_NETWORK,
		domain: "quest.solve3.xyz",
		action: PASSPORT_AUTH_ACTION,
		passportId: "11111111-1111-4111-8111-111111111111",
		wallet: "9xQeWvG816bUx9EPf7jW1k2m3n4p5q6r7s8t9v0w1x",
		nonce: NONCE,
		issuedAt: ISSUED_AT,
		expiresAt: EXPIRES_AT,
	});
});

test("parseChallengeMessage rejects a tampered header", () => {
	const message = buildChallengeMessage(fields());
	const tampered = message.replace(
		"solve3 passport authentication v1",
		"solve3 passport authentication v2",
	);
	assert.throws(() => parseChallengeMessage(tampered), /invalid header/);
});

test("parseChallengeMessage rejects reordered lines", () => {
	const lines = buildChallengeMessage(fields()).split("\n");
	const swapped = lines.slice();
	[swapped[2], swapped[3]] = [swapped[3], swapped[2]];
	assert.throws(
		() => parseChallengeMessage(swapped.join("\n")),
		/must start with/,
	);
});

test("parseChallengeMessage rejects a missing line", () => {
	const lines = buildChallengeMessage(fields()).split("\n");
	lines.splice(4, 1);
	assert.throws(
		() => parseChallengeMessage(lines.join("\n")),
		/expected 1 header/,
	);
});

test("parseChallengeMessage rejects an extra line", () => {
	const message = `${buildChallengeMessage(fields())}\nextra: value`;
	assert.throws(() => parseChallengeMessage(message), /expected 1 header/);
});

test("parseChallengeMessage rejects a renamed line", () => {
	const message = buildChallengeMessage(fields()).replace(
		"passport: ",
		"passportId: ",
	);
	assert.throws(() => parseChallengeMessage(message), /must start with/);
});

test("parseChallengeMessage rejects a wrong network string", () => {
	const message = buildChallengeMessage(fields()).replace(
		"network: DEVNET",
		"network: MAINNET",
	);
	assert.throws(() => parseChallengeMessage(message), /network must be DEVNET/);
});

test("buildChallengeMessage rejects a non-DEVNET network", () => {
	assert.throws(
		() => buildChallengeMessage(fields({ network: "MAINNET" })),
		/network must be DEVNET/,
	);
});

test("buildChallengeMessage rejects an action outside the allowlist", () => {
	assert.throws(
		() => buildChallengeMessage(fields({ action: "passport.login" })),
		/action must be one of/,
	);
	assert.throws(
		() => buildChallengeMessage(fields({ action: "" })),
		/action must be one of/,
	);
});

test("buildChallengeMessage rejects empty and non-string fields", () => {
	assert.throws(() => buildChallengeMessage(fields({ domain: "" })), /domain/);
	assert.throws(() => buildChallengeMessage(fields({ domain: 42 })), /domain/);
	assert.throws(
		() => buildChallengeMessage(fields({ passportId: "" })),
		/passportId/,
	);
	assert.throws(
		() => buildChallengeMessage(fields({ wallet: null })),
		/wallet/,
	);
	assert.throws(
		() => buildChallengeMessage(fields({ issuedAt: 123 })),
		/issuedAt/,
	);
	assert.throws(
		() => buildChallengeMessage(fields({ expiresAt: "not-a-date" })),
		/expiresAt/,
	);
});

test("buildChallengeMessage rejects a malformed nonce", () => {
	assert.throws(
		() => buildChallengeMessage(fields({ nonce: "short" })),
		/nonce must be base64url of exactly 32 bytes/,
	);
	assert.throws(
		() => buildChallengeMessage(fields({ nonce: `${NONCE}!!` })),
		/nonce must be base64url of exactly 32 bytes/,
	);
	assert.throws(
		() => buildChallengeMessage(fields({ nonce: NONCE.slice(0, 42) })),
		/nonce must be base64url of exactly 32 bytes/,
	);
});

test("assertValidNonce rejects non-base64url-32 input", () => {
	assert.equal(assertValidNonce(NONCE), NONCE);
	assert.equal(isValidNonce(NONCE), true);
	assert.equal(isValidNonce("not base64url"), false);
	assert.equal(isValidNonce(NONCE.padEnd(44, "=")), false);
	assert.throws(() => assertValidNonce("nope"), /nonce must be base64url/);
});

test("buildChallengeMessage rejects expiry at or before issuedAt", () => {
	assert.throws(
		() => buildChallengeMessage(fields({ expiresAt: ISSUED_AT })),
		/expiresAt must be after issuedAt/,
	);
	assert.throws(
		() =>
			buildChallengeMessage(fields({ expiresAt: "2026-09-29T11:59:00.000Z" })),
		/expiresAt must be after issuedAt/,
	);
});

test("hashNonce returns a lowercase 64-char sha256 hex", () => {
	const digest = hashNonce(NONCE);
	assert.equal(digest.length, 64);
	assert.match(digest, /^[0-9a-f]{64}$/);
	assert.equal(digest, hashNonce(NONCE));
	assert.notEqual(digest, hashNonce(Buffer.alloc(32, 1).toString("base64url")));
});

test("createNonce returns 43-char base64url of 32 bytes", () => {
	const nonce = createNonce();
	assert.equal(nonce.length, 43);
	assert.match(nonce, /^[A-Za-z0-9_-]{43}$/);
	assert.equal(isValidNonce(nonce), true);

	const another = createNonce();
	assert.notEqual(nonce, another);
});

test("createNonce is deterministic when randomBytes is injected", () => {
	const fixed = (size) => Buffer.alloc(size, 7);
	const first = createNonce(fixed);
	const second = createNonce(fixed);
	assert.equal(first, second);
	assert.equal(first, Buffer.alloc(32, 7).toString("base64url"));
	assert.equal(isValidNonce(first), true);
});

test("module imports no filesystem, network or database driver", () => {
	const source = readFileSync(
		fileURLToPath(new URL("./passport-challenge.mjs", import.meta.url)),
		"utf8",
	);
	assert.doesNotMatch(source, /node:fs|node:net|node:http|node:dns/i);
	assert.doesNotMatch(source, /from\s+["']pg["']|postgres|mysql|sqlite/i);
});
