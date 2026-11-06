import { type NextRequest, NextResponse } from "next/server";
import {
	PARTNER_SPACE_CREATE_ACTION,
	PARTNER_SPACE_UPDATE_ACTION,
	partnerSpaceCreatePayload,
	partnerSpaceUpdatePayload,
	PARTNER_SPACES_READ_ACTION,
	type PartnerSpace,
} from "@/configs/partnerSpaces";
import {
	TOKEN_REQUESTS_STORE,
	type TokenRequestsById,
} from "@/configs/tokenRequests";
import {
	createSpace,
	PartnerSpaceError,
	updateSpace,
} from "@/lib/partnerSpaceLogic";
import { readStore } from "@/lib/server/dataStore";
import { noStore, readSpaces, writeSpaces } from "@/lib/server/partnerSpaces";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

const fail = (message: string, status: number) =>
	NextResponse.json({ error: message }, { status, headers: noStore });
const sorted = (spaces: Record<string, PartnerSpace>) =>
	Object.values(spaces).sort((a, b) => b.createdAt - a.createdAt);

/**
 * Admin-only management of partner spaces. Every call is a signed admin action: the link (slug) is
 * a secret, so even listing is gated. `action` is one of list | create | update; each binds its own
 * fields into the signed payload.
 */
export async function POST(request: NextRequest) {
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return fail("Invalid request body", 400);
	}
	const { wallet, message, signature, action } = body as {
		wallet?: string;
		message?: string;
		signature?: string;
		action?: string;
	};
	if (!wallet || !message || !signature || !action) return fail("Missing fields", 400);
	const auth = { wallet, message, signature };

	try {
		if (action === "list") {
			requireAdmin(auth, PARTNER_SPACES_READ_ACTION, {});
			return NextResponse.json({ spaces: sorted(await readSpaces()) }, { headers: noStore });
		}

		if (action === "create") {
			const admin = requireAdmin(auth, PARTNER_SPACE_CREATE_ACTION, partnerSpaceCreatePayload(body));
			const mint = typeof body.mint === "string" ? body.mint.trim() : "";
			const requests = await readStore<TokenRequestsById>(TOKEN_REQUESTS_STORE, {});
			const result = createSpace(await readSpaces(), {
				mint: body.mint,
				projectName: body.projectName,
				wallets: body.wallets,
				poolAddress: body.poolAddress,
				note: body.note,
				listingApproved: Object.hasOwn(requests, mint) && requests[mint].status === "approved",
				admin: admin.toString(),
				now: Date.now(),
			});
			await writeSpaces(result.spaces);
			return NextResponse.json({ space: result.space, spaces: sorted(result.spaces) }, { headers: noStore });
		}

		if (action === "update") {
			const admin = requireAdmin(auth, PARTNER_SPACE_UPDATE_ACTION, partnerSpaceUpdatePayload(body));
			const result = updateSpace(await readSpaces(), {
				slug: body.slug,
				wallets: body.wallets,
				status: body.status,
				note: body.note,
				poolAddress: body.poolAddress,
				rotate: body.rotate,
				linkSent: body.linkSent,
				admin: admin.toString(),
				now: Date.now(),
			});
			await writeSpaces(result.spaces);
			return NextResponse.json({ space: result.space, spaces: sorted(result.spaces) }, { headers: noStore });
		}

		return fail("Unknown action", 400);
	} catch (error) {
		if (error instanceof PartnerSpaceError) return fail(error.message, error.status);
		const text = error instanceof Error ? error.message : "Request failed";
		const unauthorized = /authorized|signature|auth message|expired/i.test(text);
		return fail(text, unauthorized ? 401 : 400);
	}
}
