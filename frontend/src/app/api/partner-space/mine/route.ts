import { type NextRequest, NextResponse } from "next/server";
import { partnerSpaceLookupMessage } from "@/configs/partnerSpaces";
import {
	createAttemptLimiter,
	isBase58Address,
	proofIsFresh,
	spacesForWallet,
} from "@/lib/partnerSpaceLogic";
import { clientKey, noStore, readSpaces } from "@/lib/server/partnerSpaces";
import { verifyWalletSignature } from "@/lib/server/verifyWalletSignature";

export const runtime = "nodejs";

const allow = createAttemptLimiter(30, 10 * 60_000);

/** A wallet proves ownership and learns the link(s) of the space(s) that list it. */
export async function POST(request: NextRequest) {
	if (!allow(clientKey(request), Date.now()))
		return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: noStore });
	let body: { wallet?: unknown; issuedAt?: unknown; signature?: unknown };
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400, headers: noStore });
	}
	const { wallet, issuedAt, signature } = body;
	if (!isBase58Address(wallet) || typeof signature !== "string" || signature.length > 200)
		return NextResponse.json({ spaces: [] }, { headers: noStore });
	if (!proofIsFresh(issuedAt, Date.now()))
		return NextResponse.json({ error: "The wallet signature expired. Sign again." }, { status: 400, headers: noStore });
	if (!verifyWalletSignature(wallet, partnerSpaceLookupMessage(wallet, issuedAt), signature))
		return NextResponse.json({ spaces: [] }, { headers: noStore });
	const spaces = spacesForWallet(await readSpaces(), wallet).map((space) => ({
		slug: space.slug,
		projectName: space.projectName,
	}));
	return NextResponse.json({ spaces }, { headers: noStore });
}
