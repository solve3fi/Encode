import { NextResponse } from "next/server";
import { buildQuoteRequest } from "@/lib/intents/aurora";
import {
	getTokens,
	isConfigured,
	requestQuote,
} from "@/lib/server/auroraIntents";
import { bad, fromError, limit, readJson } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { originAsset, destinationAsset, amount (base units), recipient (Solana), refundTo (origin chain), slippageBps?, dry }.
 * Validated against the live token list before anything is sent to Aurora. dry=true prices the swap without reserving
 * a deposit address; dry=false returns the one-time deposit address, deadline and refund terms.
 */
export async function POST(request: Request) {
	if (!isConfigured())
		return bad("Cross-chain funding is not available yet.", 503);
	const limited = limit(request, 30);
	if (limited) return limited;
	const body = await readJson(request);
	if (!body) return bad("Send a JSON body.");
	try {
		const tokens = await getTokens();
		const built = buildQuoteRequest(
			{
				originAsset: String(body.originAsset ?? ""),
				destinationAsset: String(body.destinationAsset ?? ""),
				amount: String(body.amount ?? ""),
				recipient: String(body.recipient ?? ""),
				refundTo: String(body.refundTo ?? ""),
				slippageBps:
					body.slippageBps === undefined ? undefined : Number(body.slippageBps),
				dry: body.dry !== false,
			},
			tokens,
		);
		if (!built.ok) return bad(built.error);
		const quote = await requestQuote(built.body);
		return NextResponse.json({
			request: {
				slippageBps: built.body.slippageTolerance,
				refundTo: built.body.refundTo,
			},
			...quote,
		});
	} catch (error) {
		return fromError(error);
	}
}
