import { type NextRequest, NextResponse } from "next/server";
import {
	LAUNCH_LADDER_READ_ACTION,
	LAUNCH_LADDER_STORE,
	type SavedLaunchLadder,
} from "@/configs/launchLadder";
import { readStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

// Signed read of the saved launch ladder. A POST rather than a GET because
// the proof of admin identity is a wallet-signed message over the request
// body, and the other admin stores' public GETs are exactly what this
// store must not have before the pool exists. Returns `null` until an
// admin has saved a plan.
export async function POST(request: NextRequest) {
	let body: { wallet?: string; message?: string; signature?: string };
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	const { wallet, message, signature } = body;
	if (!wallet || !message || !signature) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	try {
		requireAdmin({ wallet, message, signature }, LAUNCH_LADDER_READ_ACTION);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	const saved = await readStore<SavedLaunchLadder | null>(
		LAUNCH_LADDER_STORE,
		null,
	);
	return NextResponse.json(saved);
}
