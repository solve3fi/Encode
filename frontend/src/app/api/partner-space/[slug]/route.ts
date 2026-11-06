import { type NextRequest, NextResponse } from "next/server";
import {
	authorizedSpace,
	createAttemptLimiter,
	isSlug,
	verifyAccessToken,
} from "@/lib/partnerSpaceLogic";
import {
	buildView,
	clientKey,
	noStore,
	readSpaces,
	tokenSecret,
} from "@/lib/server/partnerSpaces";

export const runtime = "nodejs";

const allow = createAttemptLimiter(120, 10 * 60_000);

/** Reloads a space for a wallet that already holds an access token. Membership is rechecked each time. */
export async function GET(
	request: NextRequest,
	context: { params: Promise<{ slug: string }> },
) {
	const secret = tokenSecret();
	if (!secret)
		return NextResponse.json({ error: "Partner spaces are not configured." }, { status: 503, headers: noStore });
	if (!allow(clientKey(request), Date.now()))
		return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: noStore });
	const { slug } = await context.params;
	const header = request.headers.get("authorization") ?? "";
	const claims = verifyAccessToken(secret, header.startsWith("Bearer ") ? header.slice(7) : "", Date.now());
	if (!claims || !isSlug(slug) || claims.slug !== slug)
		return NextResponse.json({ error: "Sign in with your wallet again." }, { status: 401, headers: noStore });
	// Wallets can be removed or the space revoked after a token was issued; check the live list.
	const space = authorizedSpace(await readSpaces(), slug, claims.wallet);
	if (!space)
		return NextResponse.json({ error: "This partner space is not available for this wallet." }, { status: 404, headers: noStore });
	return NextResponse.json({ space: await buildView(space) }, { headers: noStore });
}
