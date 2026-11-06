import { type NextRequest, NextResponse } from "next/server";
import {
	PARTNER_APPLICATIONS_READ_ACTION,
	PARTNER_APPLICATIONS_STORE,
	type PartnerApplication,
} from "@/configs/partnerApplications";
import { readStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

// Signed read: applications contain contact details, so only an admin wallet
// can list them (same pattern as the launch-ladder read).
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
		requireAdmin({ wallet, message, signature }, PARTNER_APPLICATIONS_READ_ACTION);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}
	const stored = await readStore<PartnerApplication[]>(PARTNER_APPLICATIONS_STORE, []);
	return NextResponse.json([...stored].sort((a, b) => b.submittedAt - a.submittedAt));
}
