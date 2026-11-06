import { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import {
	TOKEN_LINKS_ADMIN_ACTION,
	TOKEN_LINKS_STORE,
	type TokenLinksById,
} from "@/configs/tokenLinks";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

// Public read, same convention as /api/admin/tokenomics-wallets and
// /api/admin/token-requests — useAllTokens() needs this to merge website/X
// overrides into already-known tokens (see src/hooks/useToken.ts) before an
// admin action has ever been signed.
export async function GET() {
	const links = await readStore<TokenLinksById>(TOKEN_LINKS_STORE, {});
	return NextResponse.json(links);
}

export async function POST(request: NextRequest) {
	let wallet: string | undefined;
	let message: string | undefined;
	let signature: string | undefined;
	let mint: string | undefined;
	let website: string | undefined;
	let twitter: string | undefined;
	try {
		const body = await request.json();
		wallet = body.wallet;
		message = body.message;
		signature = body.signature;
		mint = body.mint;
		website = body.website;
		twitter = body.twitter;
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	if (!wallet || !message || !signature || !mint) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	let mintKey: PublicKey;
	try {
		mintKey = new PublicKey(mint);
	} catch {
		return NextResponse.json(
			{ error: "Invalid mint address" },
			{ status: 400 },
		);
	}

	let adminPublicKey: PublicKey;
	try {
		adminPublicKey = requireAdmin(
			{ wallet, message, signature },
			TOKEN_LINKS_ADMIN_ACTION,
			{ mint, website: website ?? "", twitter: twitter ?? "" },
		);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	const links = await readStore<TokenLinksById>(TOKEN_LINKS_STORE, {});
	const mintAddress = mintKey.toString();
	const trimmedWebsite = typeof website === "string" ? website.trim() : "";
	const trimmedTwitter = typeof twitter === "string" ? twitter.trim() : "";

	if (!trimmedWebsite && !trimmedTwitter) {
		delete links[mintAddress];
	} else {
		links[mintAddress] = {
			...(trimmedWebsite ? { website: trimmedWebsite } : {}),
			...(trimmedTwitter ? { twitter: trimmedTwitter } : {}),
			updatedBy: adminPublicKey.toString(),
			updatedAt: Date.now(),
		};
	}
	await writeStore(TOKEN_LINKS_STORE, links);

	return NextResponse.json({
		mint: mintAddress,
		link: links[mintAddress] ?? null,
	});
}
