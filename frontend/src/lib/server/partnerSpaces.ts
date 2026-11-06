import "server-only";
import type { NextRequest } from "next/server";
import {
	ACCELERATOR_PARTNERS_STORE,
	type AcceleratorPartnersById,
} from "@/configs/acceleratorProgram";
import {
	PARTNER_SPACES_STORE,
	type PartnerSpace,
	type PartnerSpacesBySlug,
	type PartnerSpaceView,
} from "@/configs/partnerSpaces";
import {
	TOKEN_REQUESTS_STORE,
	type TokenRequestsById,
} from "@/configs/tokenRequests";
import { readStore, writeStore } from "./dataStore";

export const readSpaces = () =>
	readStore<PartnerSpacesBySlug>(PARTNER_SPACES_STORE, {});
export const writeSpaces = (spaces: PartnerSpacesBySlug) =>
	writeStore(PARTNER_SPACES_STORE, spaces);

/** HMAC key for access tokens. Production refuses to run without a real secret. */
export function tokenSecret(): string | null {
	const configured =
		process.env.PARTNER_SPACE_TOKEN_SECRET ?? process.env.WALLET_CONFIG_ENCRYPTION_KEY;
	if (configured) return configured;
	return process.env.NODE_ENV === "production" ? null : "development-only-partner-space-secret";
}

/** Best-effort client key for the attempt limiter; Caddy sets x-forwarded-for. */
export function clientKey(request: NextRequest): string {
	const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	return forwarded || request.headers.get("x-real-ip") || "unknown";
}

/** The partner-facing view of a space: its own data only. */
export async function buildView(space: PartnerSpace): Promise<PartnerSpaceView> {
	const [requests, accelerator] = await Promise.all([
		readStore<TokenRequestsById>(TOKEN_REQUESTS_STORE, {}),
		readStore<AcceleratorPartnersById>(ACCELERATOR_PARTNERS_STORE, {}),
	]);
	const listing = Object.hasOwn(requests, space.mint) ? requests[space.mint] : undefined;
	const partner =
		space.poolAddress && Object.hasOwn(accelerator, space.poolAddress)
			? accelerator[space.poolAddress]
			: undefined;
	return {
		slug: space.slug,
		projectName: space.projectName,
		mint: space.mint,
		poolAddress: space.poolAddress ?? null,
		wallets: space.wallets,
		note: space.note ?? null,
		listing:
			listing && listing.status === "approved"
				? {
						symbol: listing.symbol,
						name: listing.name,
						website: listing.website ?? null,
						twitter: listing.twitter ?? null,
					}
				: null,
		accelerator: partner
			? {
					status: partner.status,
					enrolledAtEpoch: partner.enrolledAtEpoch,
					maxEpochs: partner.maxEpochs,
				}
			: null,
	};
}

export const noStore = { "Cache-Control": "no-store" } as const;
