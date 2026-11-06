import { NextResponse } from "next/server";
import {
	getPersistentDeposits,
	isConfigured,
} from "@/lib/server/auroraIntents";
import { bad, fromError, limit, looksLikeAddress } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = ["received", "success", "failed"] as const;

/** GET ?address=&type=received|success|failed : deposits seen at a persistent address and what became of them. */
export async function GET(request: Request) {
	if (!isConfigured())
		return bad("Cross-chain funding is not available yet.", 503);
	const limited = limit(request, 60);
	if (limited) return limited;
	const url = new URL(request.url);
	const address = url.searchParams.get("address");
	const type = url.searchParams.get("type") as (typeof TYPES)[number] | null;
	if (!looksLikeAddress(address)) return bad("Missing or invalid address.");
	if (!type || !TYPES.includes(type))
		return bad("type must be received, success or failed.");
	try {
		const deposits = await getPersistentDeposits(address, type);
		return NextResponse.json({
			deposits: deposits.slice(0, 25).map((d) => ({
				txHash: d.tx_hash,
				fromChain: d.fromChain,
				amount: d.amount,
				decimals: d.decimals,
				assetId: d.asset_id,
				createdAt: d.created_at,
			})),
		});
	} catch (error) {
		return fromError(error);
	}
}
