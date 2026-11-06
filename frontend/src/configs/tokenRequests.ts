// Shared shape for the community token-listing request flow — a project
// requests their token be shown branded (logo/name/website/X) across the
// app. Read/written via src/lib/server/dataStore.ts under this store name.
export const TOKEN_REQUESTS_STORE = "token-requests";

export type TokenRequestStatus = "pending" | "approved" | "rejected";

export type TokenRequest = {
	mint: string;
	symbol: string;
	name: string;
	decimals: number;
	website?: string;
	twitter?: string;
	logoFile: string;
	submittedBy: string;
	submittedAt: number;
	status: TokenRequestStatus;
	reviewedBy?: string;
	reviewedAt?: number;
};

export type TokenRequestsById = Record<string, TokenRequest>;

// The signed message a submitter proves wallet ownership with — scoped per
// mint so a captured signature can't be replayed for a different token.
export const tokenRequestAuthMessage = (mint: string): string =>
	`solve3 token request: ${mint}`;

export const TOKEN_LOGO_MAX_BYTES = 512 * 1024;
// SVG deliberately excluded: it's script-capable XML, and this file is
// served back same-origin (see /api/token-logos/[filename]) with no
// Content-Disposition — the site's script-src 'unsafe-inline' CSP would let
// an embedded <script> in an uploaded "logo" execute as stored XSS.
export const TOKEN_LOGO_ALLOWED_TYPES: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
};
