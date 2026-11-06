import assert from "node:assert/strict";
import { test } from "node:test";
import {
	authorizedSpace,
	createAttemptLimiter,
	isSlug,
	issueAccessToken,
	newSlug,
	normalizeNote,
	normalizeWallets,
	proofIsFresh,
	spacesForWallet,
	verifyAccessToken,
} from "../src/lib/partnerSpaceLogic.ts";

const W1 = "HGUPXpPUhD6PiTSWexebRSsgCT1uDAgiKk2DvdRHsq6o";
const W2 = "BtersAyeyXrk4YuRUCfLjVdLAp26uU3w4TkhCyNFqea4";
const W3 = "4j3VFftvWC4R2KxbF4R8bJKz2Mxk3m6a2RjkEu8ySVPs";
const W4 = "So11111111111111111111111111111111111111112";
const SLUG = "A".repeat(24);
const space = (extra = {}) => ({
	slug: SLUG,
	mint: W4,
	projectName: "Acme",
	wallets: [W1, W2],
	status: "active",
	createdBy: W3,
	createdAt: 1,
	updatedAt: 1,
	...extra,
});

test("a slug is 24 URL-safe characters and different every time", () => {
	const a = newSlug();
	const b = newSlug();
	assert.match(a, /^[A-Za-z0-9_-]{24}$/);
	assert.notEqual(a, b);
	assert.ok(isSlug(a));
	assert.equal(isSlug("short"), false);
	assert.equal(isSlug("has space in it, long enough"), false);
	assert.equal(isSlug(undefined), false);
});

test("one to three distinct valid wallets are accepted, blanks ignored", () => {
	assert.deepEqual(normalizeWallets([W1]), [W1]);
	assert.deepEqual(normalizeWallets([W1, "", `  ${W2}  `, W3]), [W1, W2, W3]);
});

test("zero, four, duplicate and malformed wallets are refused", () => {
	assert.throws(() => normalizeWallets([]), /at least one/);
	assert.throws(() => normalizeWallets(["", " "]), /at least one/);
	assert.throws(() => normalizeWallets([W1, W2, W3, W4]), /at most 3/);
	assert.throws(() => normalizeWallets([W1, W1]), /twice/);
	assert.throws(() => normalizeWallets(["not-a-wallet"]), /invalid/);
	assert.throws(() => normalizeWallets("nope"), /list/);
	assert.throws(() => normalizeWallets([123]), /at least one/);
});

test("notes are optional, trimmed and bounded", () => {
	assert.equal(normalizeNote(undefined), undefined);
	assert.equal(normalizeNote("  "), undefined);
	assert.equal(normalizeNote("  hello "), "hello");
	assert.throws(() => normalizeNote("x".repeat(501)), /longer/);
	assert.throws(() => normalizeNote(5), /text/);
});

test("a wallet proof must be recent and not from the future", () => {
	const now = 1_000_000_000;
	assert.equal(proofIsFresh(now, now), true);
	assert.equal(proofIsFresh(now - 299_000, now), true);
	assert.equal(proofIsFresh(now - 301_000, now), false);
	assert.equal(proofIsFresh(now + 10_000, now), true);
	assert.equal(proofIsFresh(now + 60_000, now), false);
	assert.equal(proofIsFresh("123", now), false);
	assert.equal(proofIsFresh(1.5, now), false);
});

test("only a listed wallet on an active space is authorized; every refusal looks the same", () => {
	const spaces = { [SLUG]: space() };
	assert.equal(authorizedSpace(spaces, SLUG, W1)?.projectName, "Acme");
	assert.equal(authorizedSpace(spaces, SLUG, W3), null);
	assert.equal(authorizedSpace(spaces, "B".repeat(24), W1), null);
	assert.equal(authorizedSpace({ [SLUG]: space({ status: "revoked" }) }, SLUG, W1), null);
	assert.equal(authorizedSpace(spaces, "__proto__", W1), null);
	assert.equal(authorizedSpace(spaces, "constructor", W1), null);
});

test("wallet lookup returns only active spaces that list the wallet", () => {
	const other = "C".repeat(24);
	const spaces = {
		[SLUG]: space(),
		[other]: space({ slug: other, wallets: [W3], status: "active" }),
		["D".repeat(24)]: space({ slug: "D".repeat(24), status: "revoked" }),
	};
	assert.deepEqual(spacesForWallet(spaces, W1).map((s) => s.slug), [SLUG]);
	assert.deepEqual(spacesForWallet(spaces, W3).map((s) => s.slug), [other]);
	assert.deepEqual(spacesForWallet(spaces, W4), []);
});

test("an access token round-trips and is bound to slug, wallet and expiry", () => {
	const now = 5_000_000;
	const { token, expiresAt } = issueAccessToken("secret", { slug: SLUG, wallet: W1 }, now, 60_000);
	assert.equal(expiresAt, now + 60_000);
	assert.deepEqual(verifyAccessToken("secret", token, now + 1000), { slug: SLUG, wallet: W1 });
	assert.equal(verifyAccessToken("secret", token, now + 60_000), null);
	assert.equal(verifyAccessToken("other-secret", token, now + 1000), null);
});

test("a tampered, truncated or malformed token is refused", () => {
	const now = 5_000_000;
	const { token } = issueAccessToken("secret", { slug: SLUG, wallet: W1 }, now, 60_000);
	const [payload, mac] = token.split(".");
	const forged = Buffer.from(
		JSON.stringify({ s: SLUG, w: W3, e: now + 99_000_000 }),
	).toString("base64url");
	assert.equal(verifyAccessToken("secret", `${forged}.${mac}`, now), null);
	assert.equal(verifyAccessToken("secret", `${payload}.`, now), null);
	assert.equal(verifyAccessToken("secret", payload, now), null);
	assert.equal(verifyAccessToken("secret", `${token}.extra`, now), null);
	assert.equal(verifyAccessToken("secret", "", now), null);
	assert.equal(verifyAccessToken("secret", null, now), null);
	assert.equal(verifyAccessToken("secret", "x".repeat(700), now), null);
	assert.throws(() => issueAccessToken("", { slug: SLUG, wallet: W1 }, now, 1), /secret/);
	assert.equal(verifyAccessToken("", token, now), null);
});

test("the attempt limiter caps attempts per key within a window", () => {
	const allow = createAttemptLimiter(3, 1000);
	assert.equal(allow("a", 0), true);
	assert.equal(allow("a", 1), true);
	assert.equal(allow("a", 2), true);
	assert.equal(allow("a", 3), false);
	assert.equal(allow("b", 3), true);
	assert.equal(allow("a", 1500), true);
});

import { PartnerSpaceError, createSpace, updateSpace } from "../src/lib/partnerSpaceLogic.ts";

const make = (spaces = {}, extra = {}) =>
	createSpace(spaces, {
		mint: W4,
		projectName: " Acme ",
		wallets: [W1, W2],
		listingApproved: true,
		admin: W3,
		now: 10,
		slug: () => SLUG,
		...extra,
	});
const refuses = (fn, status, pattern) =>
	assert.throws(fn, (e) => e instanceof PartnerSpaceError && e.status === status && pattern.test(e.message));

test("creating a space requires an approved listing, a name and one to three wallets", () => {
	const { space, spaces } = make();
	assert.equal(space.slug, SLUG);
	assert.equal(space.projectName, "Acme");
	assert.equal(space.status, "active");
	assert.deepEqual(space.wallets, [W1, W2]);
	assert.equal(space.createdBy, W3);
	assert.equal(spaces[SLUG], space);
	refuses(() => make({}, { listingApproved: false }), 400, /Approve this token listing/);
	refuses(() => make({}, { projectName: " " }), 400, /project name/);
	refuses(() => make({}, { projectName: "x".repeat(81) }), 400, /project name/);
	refuses(() => make({}, { mint: "nope" }), 400, /listing/);
	refuses(() => make({}, { wallets: [] }), 400, /at least one/);
	refuses(() => make({}, { wallets: [W1, W2, W3, W4] }), 400, /at most 3/);
	refuses(() => make({}, { poolAddress: "bad" }), 400, /Pool address/);
});

test("creating does not modify its input and keeps optional pool and note", () => {
	const before = {};
	const { space } = make(before, { poolAddress: W3, note: " welcome " });
	assert.deepEqual(before, {});
	assert.equal(space.poolAddress, W3);
	assert.equal(space.note, "welcome");
});

test("a token can have only one active space, but a revoked one can be replaced", () => {
	const { spaces } = make();
	refuses(() => make(spaces, { slug: () => "B".repeat(24) }), 409, /already has an active/);
	const revoked = { [SLUG]: { ...spaces[SLUG], status: "revoked" } };
	assert.equal(make(revoked, { slug: () => "B".repeat(24) }).space.slug, "B".repeat(24));
});

test("a slug that already exists is never reused", () => {
	const { spaces } = make();
	const other = { ...spaces, [SLUG]: { ...spaces[SLUG], status: "revoked" } };
	const queue = [SLUG, SLUG, "C".repeat(24)];
	assert.equal(make(other, { slug: () => queue.shift() }).space.slug, "C".repeat(24));
});

const edit = (spaces, extra) => updateSpace(spaces, { slug: SLUG, admin: W3, now: 20, ...extra });

test("editing changes only what is given and stamps who and when", () => {
	const { spaces } = make({}, { note: "keep me" });
	const { space } = edit(spaces, { wallets: [W2, W3] });
	assert.deepEqual(space.wallets, [W2, W3]);
	assert.equal(space.note, "keep me");
	assert.equal(space.status, "active");
	assert.equal(space.updatedBy, W3);
	assert.equal(space.updatedAt, 20);
	assert.equal(spaces[SLUG].wallets.length, 2);
});

test("an empty note or pool clears it; null leaves it", () => {
	const { spaces } = make({}, { note: "hi", poolAddress: W3 });
	assert.equal(edit(spaces, { note: null, poolAddress: null }).space.note, "hi");
	const cleared = edit(spaces, { note: "", poolAddress: "" }).space;
	assert.equal(cleared.note, undefined);
	assert.equal(cleared.poolAddress, undefined);
});

test("editing enforces the wallet limits and a valid status", () => {
	const { spaces } = make();
	refuses(() => edit(spaces, { wallets: [W1, W2, W3, W4] }), 400, /at most 3/);
	refuses(() => edit(spaces, { wallets: [] }), 400, /at least one/);
	refuses(() => edit(spaces, { status: "deleted" }), 400, /active or revoked/);
	refuses(() => updateSpace(spaces, { slug: "Z".repeat(24), admin: W3, now: 1 }), 404, /not found/);
	refuses(() => updateSpace(spaces, { slug: "__proto__", admin: W3, now: 1 }), 404, /not found/);
});

test("revoking closes the space and reactivating is blocked while another is active", () => {
	const { spaces } = make();
	const revoked = edit(spaces, { status: "revoked" });
	assert.equal(revoked.space.status, "revoked");
	assert.equal(authorizedSpace(revoked.spaces, SLUG, W1), null);
	const replacement = make(revoked.spaces, { slug: () => "B".repeat(24) });
	refuses(() => edit(replacement.spaces, { status: "active" }), 409, /another active/);
	assert.equal(edit(revoked.spaces, { status: "active" }).space.status, "active");
});

test("rotating issues a new link and the old one stops working", () => {
	const { spaces } = make();
	const rotated = edit(spaces, { rotate: true, newSlug: () => "R".repeat(24) });
	assert.equal(rotated.space.slug, "R".repeat(24));
	assert.equal(Object.hasOwn(rotated.spaces, SLUG), false);
	assert.equal(authorizedSpace(rotated.spaces, SLUG, W1), null);
	assert.equal(authorizedSpace(rotated.spaces, "R".repeat(24), W1)?.projectName, "Acme");
	assert.equal(Object.keys(rotated.spaces).length, 1);
});

test("marking the link as sent stamps it, clearing removes it, and rotating resets it", () => {
	const { spaces } = make();
	const sent = edit(spaces, { linkSent: true });
	assert.equal(sent.space.linkSentAt, 20);
	assert.equal(edit(sent.spaces, { wallets: [W1] }).space.linkSentAt, 20);
	assert.equal(edit(sent.spaces, { linkSent: false }).space.linkSentAt, undefined);
	assert.equal(edit(sent.spaces, { linkSent: null }).space.linkSentAt, 20);
	const rotated = edit(sent.spaces, { rotate: true, newSlug: () => "R".repeat(24) });
	assert.equal(rotated.space.linkSentAt, undefined);
});
