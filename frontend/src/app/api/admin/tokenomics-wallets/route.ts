import { PublicKey } from "@solana/web3.js";
import { NextResponse, type NextRequest } from "next/server";
import { TOKENOMICS_CATEGORIES } from "@/configs/tokenomics";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

// category key -> assigned wallet address. No live balances are stored here
// (those are fetched fresh on read from chain) — just the admin-entered
// label, since the docs don't publish which wallet is which.
type TokenomicsWallets = Record<string, string>;

export async function GET() {
	const wallets = await readStore<TokenomicsWallets>("tokenomics-wallets", {});
	return NextResponse.json(wallets);
}

export async function POST(request: NextRequest) {
	let wallet: string | undefined;
	let message: string | undefined;
	let signature: string | undefined;
	let category: string | undefined;
	let address: string | undefined;
	try {
		const body = await request.json();
		wallet = body.wallet;
		message = body.message;
		signature = body.signature;
		category = body.category;
		address = body.address;
	} catch {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}

	if (!wallet || !message || !signature || !category) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}
	if (!TOKENOMICS_CATEGORIES.some((c) => c.key === category)) {
		return NextResponse.json({ error: "Unknown category" }, { status: 400 });
	}

	try {
		requireAdmin({ wallet, message, signature }, "set tokenomics wallet", {
			category,
			address: address ?? "",
		});
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	const wallets = await readStore<TokenomicsWallets>("tokenomics-wallets", {});

	if (!address) {
		delete wallets[category];
	} else {
		try {
			wallets[category] = new PublicKey(address).toString();
		} catch {
			return NextResponse.json({ error: "Invalid Solana address" }, { status: 400 });
		}
	}

	await writeStore("tokenomics-wallets", wallets);
	return NextResponse.json(wallets);
}
