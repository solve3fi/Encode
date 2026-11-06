import { type NextRequest, NextResponse } from "next/server";
import type { AirdropAllocations } from "@/configs/airdropTypes";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

// Deletes ONE wallet's record from the live airdrop-allocations ledger --
// for clearing a test/QA claim that would otherwise permanently block every
// future draft activation (reconcileAirdropSnapshot refuses to touch any
// address it finds already minted/locked). Not a general "undo a claim"
// tool: real recipients keep their record forever by design. Use only for
// addresses that were never a genuine partner-list allocation.
export async function POST(request: NextRequest) {
	let wallet: string | undefined;
	let message: string | undefined;
	let signature: string | undefined;
	let ethAddress: string | undefined;
	try {
		const body = await request.json();
		wallet = body.wallet;
		message = body.message;
		signature = body.signature;
		ethAddress = body.ethAddress;
	} catch {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}

	if (!wallet || !message || !signature || !ethAddress) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}
	if (!ADDRESS.test(ethAddress)) {
		return NextResponse.json({ error: "Invalid Ethereum address" }, { status: 400 });
	}
	const key = ethAddress.toLowerCase();

	try {
		requireAdmin({ wallet, message, signature }, "clear airdrop claim", { ethAddress: key });
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Not authorized" }, { status: 401 });
	}

	const allocations = await readStore<AirdropAllocations>("airdrop-allocations", {});
	const existing = allocations[key];
	if (!existing) {
		return NextResponse.json({ error: "No allocation found for that address" }, { status: 404 });
	}

	const next = { ...allocations };
	delete next[key];
	await writeStore("airdrop-allocations", next);

	return NextResponse.json({ cleared: key, wasMinted: existing.minted, wasLocked: existing.locked, amountRaw: existing.amountRaw });
}
