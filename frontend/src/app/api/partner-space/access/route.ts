import { type NextRequest, NextResponse } from "next/server";
import {
	PARTNER_SPACE_TOKEN_TTL_MS,
	partnerSpaceAccessMessage,
} from "@/configs/partnerSpaces";
import {
	authorizedSpace,
	createAttemptLimiter,
	isBase58Address,
	isSlug,
	issueAccessToken,
	proofIsFresh,
} from "@/lib/partnerSpaceLogic";
import {
	buildView,
	clientKey,
	noStore,
	readSpaces,
	tokenSecret,
} from "@/lib/server/partnerSpaces";
import { verifyWalletSignature } from "@/lib/server/verifyWalletSignature";

export const runtime = "nodejs";

const allow = createAttemptLimiter(30, 10 * 60_000);
// One answer for every refusal: an unknown link, a revoked space and a wallet that is not on the
// list are indistinguishable, so the response never confirms that a link exists.
const denied = () =>
	NextResponse.json({ error: "This partner space is not available for this wallet." }, { status: 404, headers: noStore });

/** A wallet proves it owns an address listed on the space and receives a short-lived access token. */
export async function POST(request: NextRequest) {
	const secret = tokenSecret();
	if (!secret)
		return NextResponse.json({ error: "Partner spaces are not configured." }, { status: 503, headers: noStore });
	if (!allow(clientKey(request), Date.now()))
		return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: noStore });
	let body: { slug?: unknown; wallet?: unknown; issuedAt?: unknown; signature?: unknown };
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400, headers: noStore });
	}
	const { slug, wallet, issuedAt, signature } = body;
	if (!isSlug(slug) || !isBase58Address(wallet) || typeof signature !== "string" || signature.length > 200)
		return denied();
	const now = Date.now();
	if (!proofIsFresh(issuedAt, now))
		return NextResponse.json({ error: "The wallet signature expired. Sign again." }, { status: 400, headers: noStore });
	if (!verifyWalletSignature(wallet, partnerSpaceAccessMessage(slug, wallet, issuedAt), signature))
		return denied();
	const space = authorizedSpace(await readSpaces(), slug, wallet);
	if (!space) return denied();
	const { token, expiresAt } = issueAccessToken(secret, { slug, wallet }, now, PARTNER_SPACE_TOKEN_TTL_MS);
	return NextResponse.json({ token, expiresAt, space: await buildView(space) }, { headers: noStore });
}
