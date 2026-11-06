import { NextResponse } from "next/server";
import { destinationTokens } from "@/lib/intents/aurora";
import { INTENTS_CHAINS } from "@/lib/intents/chains";
import { getTokens, isConfigured, isMock } from "@/lib/server/auroraIntents";
import { fromError, limit } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Source assets on the chains we offer plus the Solana destinations (SOL, USDC). Cached upstream for a few minutes. */
export async function GET(request: Request) {
	if (!isConfigured())
		return NextResponse.json({ configured: false, mock: false, tokens: [] });
	const limited = limit(request, 60);
	if (limited) return limited;
	try {
		const all = await getTokens();
		const chains = new Set(INTENTS_CHAINS.map((c) => c.slug));
		const sources = all.filter(
			(t) => chains.has(t.blockchain) && t.blockchain !== "sol",
		);
		const tokens = [...sources, ...destinationTokens(all)].map((t) => ({
			assetId: t.assetId,
			symbol: t.symbol,
			decimals: t.decimals,
			blockchain: t.blockchain,
			price: t.price ?? null,
		}));
		return NextResponse.json({ configured: true, mock: isMock(), tokens });
	} catch (error) {
		return fromError(error);
	}
}
