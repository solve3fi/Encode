// Pure partner-space rules, shared by the API routes and the tests. No Next, no I/O, no aliases,
// so Node can import it directly.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
	PARTNER_SPACE_MAX_WALLETS,
	PARTNER_SPACE_NOTE_MAX,
	PARTNER_SPACE_PROOF_WINDOW_MS,
	type PartnerSpace,
	type PartnerSpacesBySlug,
} from "../configs/partnerSpaces.ts";

export class PartnerSpaceError extends Error {
	status: number;
	constructor(message: string, status = 400) {
		super(message);
		this.name = "PartnerSpaceError";
		this.status = status;
	}
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SLUG = /^[A-Za-z0-9_-]{20,64}$/;

export const isBase58Address = (value: unknown): value is string =>
	typeof value === "string" && BASE58.test(value);

export const isSlug = (value: unknown): value is string =>
	typeof value === "string" && SLUG.test(value);

/** 144 bits of randomness: an unguessable link component. */
export const newSlug = (bytes: (n: number) => Buffer = randomBytes): string =>
	bytes(18).toString("base64url");

/** One to three distinct valid wallet addresses, order preserved. */
export function normalizeWallets(input: unknown): string[] {
	if (!Array.isArray(input)) throw new PartnerSpaceError("Wallets must be a list");
	const wallets: string[] = [];
	for (const raw of input) {
		const value = typeof raw === "string" ? raw.trim() : "";
		if (!value) continue;
		if (!isBase58Address(value)) throw new PartnerSpaceError("A wallet address is invalid");
		if (wallets.includes(value)) throw new PartnerSpaceError("A wallet is listed twice");
		wallets.push(value);
	}
	if (wallets.length < 1) throw new PartnerSpaceError("Add at least one wallet");
	if (wallets.length > PARTNER_SPACE_MAX_WALLETS)
		throw new PartnerSpaceError(`A partner space allows at most ${PARTNER_SPACE_MAX_WALLETS} wallets`);
	return wallets;
}

export function normalizeNote(input: unknown): string | undefined {
	if (input === null || input === undefined || input === "") return undefined;
	if (typeof input !== "string") throw new PartnerSpaceError("Note must be text");
	const note = input.trim();
	if (note.length > PARTNER_SPACE_NOTE_MAX)
		throw new PartnerSpaceError(`Note is longer than ${PARTNER_SPACE_NOTE_MAX} characters`);
	return note || undefined;
}

/** True when the signed timestamp is recent and not from the future. */
export function proofIsFresh(issuedAtMs: unknown, nowMs: number): issuedAtMs is number {
	return (
		typeof issuedAtMs === "number" &&
		Number.isSafeInteger(issuedAtMs) &&
		issuedAtMs <= nowMs + 30_000 &&
		nowMs - issuedAtMs <= PARTNER_SPACE_PROOF_WINDOW_MS
	);
}

/** Active spaces that list this wallet. */
export function spacesForWallet(spaces: PartnerSpacesBySlug, wallet: string): PartnerSpace[] {
	return Object.values(spaces).filter(
		(space) => space.status === "active" && space.wallets.includes(wallet),
	);
}

/** A space the wallet may enter, or null: unknown, revoked and not-a-member look identical. */
export function authorizedSpace(
	spaces: PartnerSpacesBySlug,
	slug: string,
	wallet: string,
): PartnerSpace | null {
	if (!isSlug(slug)) return null;
	const space = Object.hasOwn(spaces, slug) ? spaces[slug] : undefined;
	if (!space || space.status !== "active" || !space.wallets.includes(wallet)) return null;
	return space;
}

// --- stateless access tokens -------------------------------------------------------------

const b64 = (value: Buffer | string) => Buffer.from(value).toString("base64url");

/** `<payload>.<hmac>`: slug, wallet and expiry, signed with a server secret. */
export function issueAccessToken(
	secret: string,
	claims: { slug: string; wallet: string },
	nowMs: number,
	ttlMs: number,
): { token: string; expiresAt: number } {
	if (!secret) throw new Error("A token secret is required");
	const expiresAt = nowMs + ttlMs;
	const payload = b64(JSON.stringify({ s: claims.slug, w: claims.wallet, e: expiresAt }));
	const mac = b64(createHmac("sha256", secret).update(payload).digest());
	return { token: `${payload}.${mac}`, expiresAt };
}

export function verifyAccessToken(
	secret: string,
	token: unknown,
	nowMs: number,
): { slug: string; wallet: string } | null {
	if (!secret || typeof token !== "string" || token.length > 600) return null;
	const [payload, mac, extra] = token.split(".");
	if (!payload || !mac || extra !== undefined) return null;
	const expected = createHmac("sha256", secret).update(payload).digest();
	let given: Buffer;
	try {
		given = Buffer.from(mac, "base64url");
	} catch {
		return null;
	}
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
	try {
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		if (
			!isSlug(claims?.s) ||
			!isBase58Address(claims?.w) ||
			!Number.isSafeInteger(claims?.e) ||
			claims.e <= nowMs
		)
			return null;
		return { slug: claims.s, wallet: claims.w };
	} catch {
		return null;
	}
}

// --- a small in-memory attempt limiter -----------------------------------------------------

/** At most `limit` attempts per key per window. Soft protection against link guessing. */
export function createAttemptLimiter(limit: number, windowMs: number) {
	const hits = new Map<string, number[]>();
	return (key: string, nowMs: number): boolean => {
		const recent = (hits.get(key) ?? []).filter((t) => nowMs - t < windowMs);
		if (recent.length >= limit) {
			hits.set(key, recent);
			return false;
		}
		recent.push(nowMs);
		hits.set(key, recent);
		if (hits.size > 5000)
			for (const [k, v] of hits) if (v.every((t) => nowMs - t >= windowMs)) hits.delete(k);
		return true;
	};
}

// --- admin rules ------------------------------------------------------------------------------

const optionalPool = (value: unknown): string | null => {
	if (value === null || value === undefined || value === "") return null;
	if (!isBase58Address(value)) throw new PartnerSpaceError("Pool address is invalid");
	return value;
};

/** Creates a space for an approved listing. Returns a new map; the input is not modified. */
export function createSpace(
	spaces: PartnerSpacesBySlug,
	input: {
		mint: unknown;
		projectName: unknown;
		wallets: unknown;
		poolAddress?: unknown;
		note?: unknown;
		listingApproved: boolean;
		admin: string;
		now: number;
		slug?: () => string;
	},
): { spaces: PartnerSpacesBySlug; space: PartnerSpace } {
	const mint = typeof input.mint === "string" ? input.mint.trim() : "";
	if (!isBase58Address(mint)) throw new PartnerSpaceError("Choose an approved token listing");
	const projectName = typeof input.projectName === "string" ? input.projectName.trim() : "";
	if (!projectName || projectName.length > 80)
		throw new PartnerSpaceError("Enter a project name (up to 80 characters)");
	if (!input.listingApproved) throw new PartnerSpaceError("Approve this token listing first");
	if (Object.values(spaces).some((s) => s.mint === mint && s.status === "active"))
		throw new PartnerSpaceError("This token already has an active partner space", 409);
	const next = { ...spaces };
	const make = input.slug ?? newSlug;
	let slug = make();
	while (Object.hasOwn(next, slug)) slug = make();
	const space: PartnerSpace = {
		slug,
		mint,
		projectName,
		wallets: normalizeWallets(input.wallets),
		status: "active",
		createdBy: input.admin,
		createdAt: input.now,
		updatedAt: input.now,
	};
	const pool = optionalPool(input.poolAddress);
	if (pool) space.poolAddress = pool;
	const note = normalizeNote(input.note);
	if (note) space.note = note;
	next[slug] = space;
	return { spaces: next, space };
}

/**
 * Edits a space. `null`/`undefined` leaves a field alone; an empty note or pool clears it.
 * `rotate` issues a new link and removes the old one, so every old link and token stops working.
 */
export function updateSpace(
	spaces: PartnerSpacesBySlug,
	input: {
		slug: unknown;
		wallets?: unknown;
		status?: unknown;
		note?: unknown;
		poolAddress?: unknown;
		rotate?: unknown;
		linkSent?: unknown;
		admin: string;
		now: number;
		newSlug?: () => string;
	},
): { spaces: PartnerSpacesBySlug; space: PartnerSpace } {
	if (!isSlug(input.slug) || !Object.hasOwn(spaces, input.slug))
		throw new PartnerSpaceError("Partner space not found", 404);
	const current = spaces[input.slug];
	const next: PartnerSpace = { ...current, updatedBy: input.admin, updatedAt: input.now };
	const map = { ...spaces };
	if (input.wallets !== null && input.wallets !== undefined) next.wallets = normalizeWallets(input.wallets);
	if (input.status !== null && input.status !== undefined) {
		if (input.status !== "active" && input.status !== "revoked")
			throw new PartnerSpaceError("Status must be active or revoked");
		next.status = input.status;
		if (
			next.status === "active" &&
			current.status !== "active" &&
			Object.values(spaces).some((s) => s.slug !== current.slug && s.mint === current.mint && s.status === "active")
		)
			throw new PartnerSpaceError("This token already has another active partner space", 409);
	}
	if (input.note !== null && input.note !== undefined) {
		const note = normalizeNote(input.note);
		if (note) next.note = note;
		else delete next.note;
	}
	if (input.poolAddress !== null && input.poolAddress !== undefined) {
		const pool = optionalPool(input.poolAddress);
		if (pool) next.poolAddress = pool;
		else delete next.poolAddress;
	}
	if (typeof input.linkSent === "boolean") {
		if (input.linkSent) next.linkSentAt = input.now;
		else delete next.linkSentAt;
	}
	if (input.rotate === true) {
		// A new link has not been handed over yet, whatever the old one's state was.
		delete next.linkSentAt;
		const make = input.newSlug ?? newSlug;
		let slug = make();
		while (Object.hasOwn(map, slug)) slug = make();
		delete map[current.slug];
		next.slug = slug;
	}
	map[next.slug] = next;
	return { spaces: map, space: next };
}
