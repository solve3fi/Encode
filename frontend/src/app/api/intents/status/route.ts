import { NextResponse } from "next/server";
import { describeStatus } from "@/lib/intents/aurora";
import { getSwapStatus, isConfigured } from "@/lib/server/auroraIntents";
import { bad, fromError, limit, looksLikeAddress } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?depositAddress=&depositMemo= : where a swap is. The UI polls this every 5-10 seconds (Aurora's guidance). */
export async function GET(request: Request) {
	if (!isConfigured())
		return bad("Cross-chain funding is not available yet.", 503);
	const limited = limit(request, 90);
	if (limited) return limited;
	const url = new URL(request.url);
	const depositAddress = url.searchParams.get("depositAddress");
	const depositMemo = url.searchParams.get("depositMemo") ?? undefined;
	if (!looksLikeAddress(depositAddress))
		return bad("Missing or invalid deposit address.");
	if (depositMemo !== undefined && !/^[A-Za-z0-9._-]{1,64}$/.test(depositMemo))
		return bad("Invalid memo.");
	try {
		const result = await getSwapStatus(depositAddress, depositMemo);
		return NextResponse.json({
			status: result.status,
			view: describeStatus(result.status, result.swapDetails?.refundReason),
			updatedAt: result.updatedAt ?? null,
			details: {
				amountIn: result.swapDetails?.amountInFormatted ?? null,
				amountOut: result.swapDetails?.amountOutFormatted ?? null,
				refunded: result.swapDetails?.refundedAmountFormatted ?? null,
				originTx: result.swapDetails?.originChainTxHashes?.[0] ?? null,
				destinationTx:
					result.swapDetails?.destinationChainTxHashes?.[0] ?? null,
			},
		});
	} catch (error) {
		return fromError(error);
	}
}
