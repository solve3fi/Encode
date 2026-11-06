import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COINBASE_SOL_USD = "https://api.coinbase.com/v2/prices/SOL-USD/spot";
const CACHE_MS = 30_000;

let cached: { usd: number; updatedAt: string; at: number } | null = null;

/**
 * Public: the SOL/USD spot price (Coinbase), cached for 30 seconds on the server so the "Just Ask" bar can answer
 * "What's the SOL price?" without every visitor calling Coinbase. Read-only; no wallet or user data involved.
 */
export async function GET() {
	if (cached && Date.now() - cached.at < CACHE_MS) {
		return NextResponse.json({ usd: cached.usd, updatedAt: cached.updatedAt });
	}
	try {
		const response = await fetch(COINBASE_SOL_USD, {
			cache: "no-store",
			signal: AbortSignal.timeout(6000),
		});
		if (!response.ok) throw new Error("price_unavailable");
		const body = (await response.json()) as { data?: { amount?: string } };
		const usd = Number(body?.data?.amount);
		if (!Number.isFinite(usd) || usd <= 0) throw new Error("price_unavailable");
		cached = { usd, updatedAt: new Date().toISOString(), at: Date.now() };
		return NextResponse.json({ usd, updatedAt: cached.updatedAt });
	} catch {
		// A slightly old price is better than none, but never older than 5 minutes.
		if (cached && Date.now() - cached.at < 5 * 60_000) {
			return NextResponse.json({
				usd: cached.usd,
				updatedAt: cached.updatedAt,
			});
		}
		return NextResponse.json(
			{ error: "SOL price unavailable." },
			{ status: 503 },
		);
	}
}
