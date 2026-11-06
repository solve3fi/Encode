import { type NextRequest, NextResponse } from "next/server";
import type { PresaleAllocations } from "@/configs/presaleTypes";
import { reconcilePresaleSnapshot, type PresaleSnapshot } from "@/lib/presaleSnapshot";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

// Promotes the prepared presale-draft to the live presale-allocations
// ledger — same two-step draft/activate pattern as the airdrop, and for the
// same reason: reconcilePresaleSnapshot refuses to alter or drop any
// allocation that's already been claimed.
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
			"activate presale draft",
			{},
		);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	const draft = await readStore<PresaleSnapshot | null>("presale-draft", null);
	if (!draft) {
		return NextResponse.json(
			{ error: "No draft to activate" },
			{ status: 400 },
		);
	}

	const existing = await readStore<PresaleAllocations>(
		"presale-allocations",
		{},
	);
	try {
		const result = reconcilePresaleSnapshot(existing, draft);
		await writeStore("presale-allocations", result.allocations);
		return NextResponse.json({
			added: result.added,
			updated: result.updated,
			removed: result.removed,
			totalAllocations: Object.keys(result.allocations).length,
			totalUsd: draft.totalUsd,
			totalVeSolv3: draft.totalVeSolv3,
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
