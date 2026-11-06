import { PublicKey } from "@solana/web3.js";
import { NextResponse, type NextRequest } from "next/server";
import {
	TOKEN_REQUESTS_STORE,
	type TokenRequestsById,
} from "@/configs/tokenRequests";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

// Public read, same convention as /api/admin/tokenomics-wallets — the admin
// panel needs this to load before an admin action has been signed, and
// submitted website/X/logo data isn't sensitive (the submitter chose it for
// public listing).
export async function GET() {
	const requests = await readStore<TokenRequestsById>(TOKEN_REQUESTS_STORE, {});
	return NextResponse.json(requests);
}

export async function POST(request: NextRequest) {
	let wallet: string | undefined;
	let message: string | undefined;
	let signature: string | undefined;
	let mint: string | undefined;
	let decision: string | undefined;
	try {
		const body = await request.json();
		wallet = body.wallet;
		message = body.message;
		signature = body.signature;
		mint = body.mint;
		decision = body.decision;
	} catch {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}

	if (!wallet || !message || !signature || !mint || !decision) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}
	if (decision !== "approved" && decision !== "rejected") {
		return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
	}

	// Validate as a real PublicKey before ever using it as an object lookup
	// key — an unvalidated string like "__proto__" used as requests[mint]
	// resolves through the prototype chain instead of a normal property,
	// and the writes below would pollute Object.prototype process-wide. A
	// valid base58 pubkey can never collide with a prototype key name.
	let mintKey: PublicKey;
	try {
		mintKey = new PublicKey(mint);
	} catch {
		return NextResponse.json({ error: "Invalid mint address" }, { status: 400 });
	}
	const mintAddress = mintKey.toString();

	let adminPublicKey;
	try {
		adminPublicKey = requireAdmin(
			{ wallet, message, signature },
			"review token request",
			{ mint: mintAddress, decision },
		);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	const requests = await readStore<TokenRequestsById>(TOKEN_REQUESTS_STORE, {});
	const record = requests[mintAddress];
	if (!record) {
		return NextResponse.json({ error: "Request not found" }, { status: 404 });
	}

	record.status = decision;
	record.reviewedBy = adminPublicKey.toString();
	record.reviewedAt = Date.now();
	requests[mintAddress] = record;
	await writeStore(TOKEN_REQUESTS_STORE, requests);

	return NextResponse.json(record);
}
