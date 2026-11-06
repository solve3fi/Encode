import { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import {
	TOKEN_REQUESTS_STORE,
	type TokenRequestsById,
} from "@/configs/tokenRequests";
import { readStore } from "@/lib/server/dataStore";

export const runtime = "nodejs";

// Whitelist lookup for partner onboarding: a mint is whitelisted when its
// listing request was approved. `owner` is true when the connected wallet is
// the one that submitted that listing.
export async function GET(request: NextRequest) {
	const mintRaw = request.nextUrl.searchParams.get("mint") ?? "";
	const wallet = request.nextUrl.searchParams.get("wallet") ?? "";
	// Wallet-only lookup: the approved listings this wallet submitted (partner space).
	if (!mintRaw && wallet) {
		const all = await readStore<TokenRequestsById>(TOKEN_REQUESTS_STORE, {});
		return NextResponse.json({
			listings: Object.values(all)
				.filter((entry) => entry.status === "approved" && entry.submittedBy === wallet)
				.map(({ mint, symbol, name, website, twitter }) => ({ mint, symbol, name, website, twitter })),
		});
	}
	let mint: string;
	try {
		mint = new PublicKey(mintRaw.trim()).toString();
	} catch {
		return NextResponse.json({ error: "Enter a valid token mint address" }, { status: 400 });
	}

	const requests = await readStore<TokenRequestsById>(TOKEN_REQUESTS_STORE, {});
	const entry = requests[mint];
	if (!entry) return NextResponse.json({ status: "none" });
	return NextResponse.json({
		status: entry.status,
		symbol: entry.symbol,
		name: entry.name,
		website: entry.website,
		twitter: entry.twitter,
		owner: Boolean(wallet) && entry.submittedBy === wallet,
	});
}
