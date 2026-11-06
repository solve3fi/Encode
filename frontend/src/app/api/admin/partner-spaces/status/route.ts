import { NextResponse } from "next/server";
import type { PartnerSpaceStatus_ } from "@/configs/partnerSpaces";
import { noStore, readSpaces } from "@/lib/server/partnerSpaces";

export const runtime = "nodejs";

// Public read, same convention as the token-request list: only which listings already have a space,
// whether it is active, how many wallets it lists and whether the link was handed over, and the recorded pool address (public chain data). No slug and
// no wallet address ever leaves here, so the checklist can load before an admin signs anything.
export async function GET() {
	const spaces = await readSpaces();
	const summary: PartnerSpaceStatus_[] = Object.values(spaces).map((space) => ({
		mint: space.mint,
		status: space.status,
		walletCount: space.wallets.length,
		linkSentAt: space.linkSentAt ?? null,
		poolAddress: space.poolAddress ?? null,
	}));
	return NextResponse.json({ spaces: summary }, { headers: noStore });
}
