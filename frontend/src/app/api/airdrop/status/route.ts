import { PublicKey } from "@solana/web3.js";
import { NextResponse, type NextRequest } from "next/server";
import { AIRDROP_TOKEN_DECIMALS } from "@/configs/airdrop";
import type { AirdropAllocations } from "@/configs/airdropTypes";
import type { AirdropSnapshot } from "@/lib/airdropSnapshot";
import {
	isUnprovenClaim,
	reopenUnprovenClaim,
} from "@/lib/server/claimReservation";
import { readStore } from "@/lib/server/dataStore";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
	const ethAddress = request.nextUrl.searchParams.get("ethAddress");
	if (!ethAddress) {
		return NextResponse.json({ error: "Missing ethAddress" }, { status: 400 });
	}
	if (!/^0x[a-fA-F0-9]{40}$/.test(ethAddress)) {
		return NextResponse.json({ error: "Invalid Ethereum address" }, { status: 400 });
	}

	const allocations = await readStore<AirdropAllocations>("airdrop-allocations", {});
	let allocation = allocations[ethAddress.toLowerCase()];

	if (!allocation) {
		const draft = await readStore<AirdropSnapshot | null>("airdrop-draft", null);
		const pending = draft?.allocations[ethAddress.toLowerCase()];
		if (pending) {
			// Visibility is not activation: claim eligibility remains false and the
			// claim endpoint continues to read only the active allocation ledger.
			return NextResponse.json({
				eligible: false,
				state: "pending_activation",
				amount: pending.amount,
				partnerAmountsRaw: pending.partnerAmountsRaw,
			});
		}
		return NextResponse.json({ eligible: false, state: "not_allocated" });
	}

	const claimant = allocation.reservedRecipient ?? allocation.solanaAddress;
	if (isUnprovenClaim(allocation) && claimant) {
		// Shown as claimable when the old stale-reservation check marked it claimed without the claim landing;
		// /api/airdrop/claim re-proves it the same way. On an RPC error the stored state is shown unchanged.
		try {
			allocation = await reopenUnprovenClaim(
				allocation,
				new PublicKey(claimant),
				allocation.amountRaw
					? BigInt(allocation.amountRaw)
					: BigInt(Math.round(allocation.amount * 10 ** AIRDROP_TOKEN_DECIMALS)),
			);
		} catch (error) {
			console.error("unproven claim check failed:", error);
		}
	}

	return NextResponse.json({
		eligible: true,
		state: allocation.minted ? "claimed" : "active",
		amount: allocation.amount,
		partnerAmountsRaw: allocation.partnerAmountsRaw,
		minted: allocation.minted,
		mintedSignature: allocation.mintedSignature,
		solanaAddress: allocation.solanaAddress,
		locked: allocation.locked,
	});
}
