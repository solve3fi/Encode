import { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import { saleStatus, withSaleLedger } from "@/lib/server/presaleSaleStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public sale state (phase, price, cap progress) and, with ?wallet=, that wallet's purchases and remaining limit. */
export async function GET(request: NextRequest) {
	const wallet = request.nextUrl.searchParams.get("wallet");
	if (wallet) {
		try {
			new PublicKey(wallet);
		} catch {
			return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
		}
	}
	const status = await withSaleLedger(async (state) =>
		saleStatus(state, Date.now(), wallet ?? undefined),
	);
	return NextResponse.json(status, {
		headers: { "Cache-Control": "no-store" },
	});
}
