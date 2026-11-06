import { type NextRequest, NextResponse } from "next/server";
import {
	EMPTY_LP_INCENTIVE_LEDGER,
	LP_INCENTIVES_LEDGER_STORE,
	LP_LEDGER_DOWNLOAD_ACTION,
	type LpIncentiveLedger,
} from "@/configs/lpIncentives";
import { readStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

// Full ledger (every wallet's credit) for admins only — this is the input
// for the veSOLV3 claim upload at the ve launch. Signed like every other
// admin action; POST rather than GET so the signature travels in the body.
export async function POST(request: NextRequest) {
	let body: { wallet?: string; message?: string; signature?: string };
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}
	const { wallet, message, signature } = body;
	if (!wallet || !message || !signature) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}
	try {
		requireAdmin({ wallet, message, signature }, LP_LEDGER_DOWNLOAD_ACTION, {});
	} catch (error) {
		const text = error instanceof Error ? error.message : "Unauthorized";
		return NextResponse.json({ error: text }, { status: 401 });
	}
	const ledger = await readStore<LpIncentiveLedger>(
		LP_INCENTIVES_LEDGER_STORE,
		EMPTY_LP_INCENTIVE_LEDGER,
	);
	return NextResponse.json(ledger);
}
