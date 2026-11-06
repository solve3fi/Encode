import { NextResponse } from "next/server";
import { describeStatus } from "@/lib/intents/aurora";
import { isConfigured, submitDeposit } from "@/lib/server/auroraIntents";
import { bad, fromError, limit, looksLikeAddress, readJson } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { txHash, depositAddress, memo? }: optional, tells Aurora about the deposit so it can start sooner. */
export async function POST(request: Request) {
	if (!isConfigured())
		return bad("Cross-chain funding is not available yet.", 503);
	const limited = limit(request, 20);
	if (limited) return limited;
	const body = await readJson(request);
	if (!body) return bad("Send a JSON body.");
	if (!looksLikeAddress(body.depositAddress))
		return bad("Missing or invalid deposit address.");
	const txHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
	if (!/^[A-Za-z0-9._:-]{10,200}$/.test(txHash))
		return bad("That does not look like a transaction hash.");
	const memo =
		typeof body.memo === "string" && body.memo ? body.memo : undefined;
	try {
		const result = await submitDeposit({
			txHash,
			depositAddress: body.depositAddress,
			...(memo ? { memo } : {}),
		});
		return NextResponse.json({
			status: result.status,
			view: describeStatus(result.status, result.swapDetails?.refundReason),
		});
	} catch (error) {
		return fromError(error);
	}
}
