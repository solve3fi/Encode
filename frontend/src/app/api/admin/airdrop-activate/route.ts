import { type NextRequest, NextResponse } from "next/server";
import type { AirdropAllocations } from "@/configs/airdropTypes";
import {
	type AirdropSnapshot,
	reconcileAirdropSnapshot,
} from "@/lib/airdropSnapshot";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

// Promotes the prepared airdrop-draft to the live airdrop-allocations ledger
// — the step /api/admin/airdrop/upload deliberately never takes on its own
// (see the note in that route). Reuses reconcileAirdropSnapshot, which
// already refuses to alter or drop any allocation that's been claimed.
export async function POST(request: NextRequest) {
	let wallet: string | undefined;
	let message: string | undefined;
	let signature: string | undefined;
	try {
		const body = await request.json();
		wallet = body.wallet;
		message = body.message;
		signature = body.signature;
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	if (!wallet || !message || !signature) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	try {
		requireAdmin(
			{ wallet, message, signature },
			"activate airdrop draft",
			{},
		);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	const draft = await readStore<AirdropSnapshot | null>("airdrop-draft", null);
	if (!draft) {
		return NextResponse.json(
			{ error: "No draft to activate" },
			{ status: 400 },
		);
	}

	const existing = await readStore<AirdropAllocations>(
		"airdrop-allocations",
		{},
	);
	try {
		const result = reconcileAirdropSnapshot(existing, draft);
		await writeStore("airdrop-allocations", result.allocations);
		return NextResponse.json({
			added: result.added,
			updated: result.updated,
			removed: result.removed,
			totalAllocations: Object.keys(result.allocations).length,
			totalAmount: draft.totalAmount,
		});
	} catch (error) {
		return NextResponse.json(
			{
				error:
					error instanceof Error ? error.message : "Could not activate draft",
			},
			{ status: 409 },
		);
	}
}
