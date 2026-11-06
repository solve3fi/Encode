/**
 * Partner spaces: a private page per approved launch partner, reached through an unguessable link
 * and usable only by up to three wallets the partner chose. Admins create and manage them in the
 * Admin page; the partner never edits the wallet list.
 */
export const PARTNER_SPACES_STORE = "partner-spaces";

export const PARTNER_SPACE_MAX_WALLETS = 3;
export const PARTNER_SPACE_NOTE_MAX = 500;
/** How long a signed wallet proof, and the access token issued for it, stay valid. */
export const PARTNER_SPACE_PROOF_WINDOW_MS = 5 * 60_000;
export const PARTNER_SPACE_TOKEN_TTL_MS = 8 * 60 * 60_000;

export const PARTNER_SPACES_READ_ACTION = "read partner spaces";
export const PARTNER_SPACE_CREATE_ACTION = "create partner space";
export const PARTNER_SPACE_UPDATE_ACTION = "update partner space";

export type PartnerSpaceStatus = "active" | "revoked";

export type PartnerSpace = {
	/** The secret in the link: /partner/<slug>. Rotating it kills every old link. */
	slug: string;
	/** The approved token listing this space belongs to. */
	mint: string;
	projectName: string;
	/** The partner's pool, when known; used for gauge, vote and accelerator status. */
	poolAddress?: string;
	/** One to three wallets allowed in. */
	wallets: string[];
	status: PartnerSpaceStatus;
	/** A short message from Solve3 shown to the partner. */
	note?: string;
	createdBy: string;
	createdAt: number;
	updatedBy?: string;
	updatedAt: number;
	/** When the admin marked the link as handed to the partner; unset until then. */
	linkSentAt?: number;
};

export type PartnerSpacesBySlug = Record<string, PartnerSpace>;

/** What a partner is shown after proving a wallet; never includes other partners' data. */
export type PartnerSpaceView = {
	slug: string;
	projectName: string;
	mint: string;
	poolAddress: string | null;
	wallets: string[];
	note: string | null;
	listing: {
		symbol: string;
		name: string;
		website: string | null;
		twitter: string | null;
	} | null;
	accelerator: {
		status: "active" | "completed" | "removed";
		enrolledAtEpoch: number;
		maxEpochs: number;
	} | null;
};

/** The message a wallet signs to enter a space. Bound to the slug, wallet and time. */
export const partnerSpaceAccessMessage = (
	slug: string,
	wallet: string,
	issuedAtMs: number,
): string => `solve3 partner space: ${slug} | ${wallet} | ${issuedAtMs}`;

/** The message a wallet signs to find the space(s) it belongs to. */
export const partnerSpaceLookupMessage = (
	wallet: string,
	issuedAtMs: number,
): string => `solve3 partner space lookup: ${wallet} | ${issuedAtMs}`;

// The signed payloads, built in one place so the Admin page and the API route cannot disagree.
// `null` always means "leave unchanged"; an empty string clears a note or pool.
export const partnerSpaceCreatePayload = (f: {
	mint?: unknown;
	projectName?: unknown;
	wallets?: unknown;
	poolAddress?: unknown;
	note?: unknown;
}) => ({
	mint: f.mint ?? null,
	projectName: f.projectName ?? null,
	wallets: f.wallets ?? null,
	poolAddress: f.poolAddress ?? "",
	note: f.note ?? "",
});

export const partnerSpaceUpdatePayload = (f: {
	slug?: unknown;
	wallets?: unknown;
	status?: unknown;
	note?: unknown;
	poolAddress?: unknown;
	rotate?: unknown;
	linkSent?: unknown;
}) => ({
	linkSent: typeof f.linkSent === "boolean" ? f.linkSent : null,
	slug: f.slug ?? null,
	wallets: f.wallets ?? null,
	status: f.status ?? null,
	note: f.note ?? null,
	poolAddress: f.poolAddress ?? null,
	rotate: f.rotate === true,
});

/** The non-secret summary the Admin onboarding checklist reads without a signature. */
export type PartnerSpaceStatus_ = {
	mint: string;
	status: PartnerSpaceStatus;
	walletCount: number;
	linkSentAt: number | null;
	/** The recorded partner pool (a public on-chain address), or null when none is recorded. */
	poolAddress: string | null;
};
