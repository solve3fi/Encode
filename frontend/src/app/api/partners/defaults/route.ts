import { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import { partnerDefaultsMessage } from "@/configs/partnerDefaults";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { verifyWalletSignature } from "@/lib/server/verifyWalletSignature";

export const runtime = "nodejs";

const STORE = "partner-defaults";

type Defaults = { vote: boolean; autolock: boolean; updatedAt: number };

export async function GET(request: NextRequest) {
	const wallet = request.nextUrl.searchParams.get("wallet") ?? "";
	try {
		new PublicKey(wallet);
	} catch {
		return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
	}
	const all = await readStore<Record<string, Defaults>>(STORE, {});
	// `saved` tells the page whether this wallet ever chose; the vote keeper only follows an explicit
	// saved choice, never the default shown before one is made.
	return NextResponse.json(
		all[wallet] ? { ...all[wallet], saved: true } : { vote: false, autolock: false, saved: false },
	);
}

// Saving a default requires a wallet signature, so only the wallet owner can change it.
export async function POST(request: NextRequest) {
	const body = (await request.json().catch(() => null)) as {
		wallet?: string;
		vote?: boolean;
		autolock?: boolean;
		signature?: string;
	} | null;
	if (
		!body ||
		typeof body.wallet !== "string" ||
		typeof body.vote !== "boolean" ||
		typeof body.autolock !== "boolean" ||
		typeof body.signature !== "string"
	) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}
	const message = partnerDefaultsMessage(body.wallet, body.vote, body.autolock);
	if (!verifyWalletSignature(body.wallet, message, body.signature)) {
		return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
	}
	const all = await readStore<Record<string, Defaults>>(STORE, {});
	all[body.wallet] = { vote: body.vote, autolock: body.autolock, updatedAt: Date.now() };
	await writeStore(STORE, all);
	return NextResponse.json(all[body.wallet]);
}
