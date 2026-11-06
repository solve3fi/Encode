import { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import { PRESALE_TOKEN_DECIMALS } from "@/configs/presale";
import type { PresaleAllocations } from "@/configs/presaleTypes";
import type { PresaleSnapshot } from "@/lib/presaleSnapshot";
import {
	isUnprovenClaim,
	reopenUnprovenClaim,
} from "@/lib/server/claimReservation";
import { readStore } from "@/lib/server/dataStore";
import {
	claimStoreFor,
	parsePresaleRound,
} from "@/lib/server/presaleClaimRound";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
	const solanaAddress = request.nextUrl.searchParams.get("solanaAddress");
	if (!solanaAddress) {
		return NextResponse.json(
			{ error: "Missing solanaAddress" },
			{ status: 400 },
		);
	}
	try {
		new PublicKey(solanaAddress);
	} catch {
		return NextResponse.json(
			{ error: "Invalid Solana address" },
			{ status: 400 },
		);
	}

	const round = parsePresaleRound(request.nextUrl.searchParams.get("round"));
	if (round === null)
		return NextResponse.json(
			{ error: "Invalid presale round" },
			{ status: 400 },
		);
	const allocations = await readStore<PresaleAllocations>(
		claimStoreFor(round),
		{},
	);
	let allocation = allocations[solanaAddress];

	// Round 2 has no draft stage: its list is published from the sale ledger in one step.
	if (!allocation && round === 2)
		return NextResponse.json({ eligible: false, state: "not_allocated" });
	if (!allocation) {
		const draft = await readStore<PresaleSnapshot | null>(
			"presale-draft",
			null,
		);
		const pending = draft?.allocations[solanaAddress];
		if (pending) {
			return NextResponse.json({
				eligible: false,
				state: "pending_activation",
				veSolv3Amount: pending.veSolv3Amount,
				amountUsd: pending.amountUsd,
			});
		}
		return NextResponse.json({ eligible: false, state: "not_allocated" });
	}

	if (isUnprovenClaim(allocation)) {
		// Shown as claimable when the old stale-reservation check marked it claimed without the claim landing;
		// /api/presale/claim re-proves it the same way. On an RPC error the stored state is shown unchanged.
		try {
			allocation = await reopenUnprovenClaim(
				allocation,
				new PublicKey(solanaAddress),
				allocation.amountRaw
					? BigInt(allocation.amountRaw)
					: BigInt(
							Math.round(
								allocation.veSolv3Amount * 10 ** PRESALE_TOKEN_DECIMALS,
							),
						),
			);
		} catch (error) {
			console.error("unproven claim check failed:", error);
		}
	}

	return NextResponse.json({
		eligible: true,
		state: allocation.minted ? "claimed" : "active",
		veSolv3Amount: allocation.veSolv3Amount,
		amountUsd: allocation.amountUsd,
		minted: allocation.minted,
		mintedSignature: allocation.mintedSignature,
		locked: allocation.locked,
	});
}
