import { NextResponse } from "next/server";
import type { AirdropAllocations } from "@/configs/airdropTypes";
import { AIRDROP_PARTNERS, PARTNER_BUDGETS } from "@/lib/airdropSnapshot";
import { readStore } from "@/lib/server/dataStore";

export const runtime = "nodejs";

// Read-only aggregate: no addresses, just per-partner totals for the admin
// dashboard. allocatedRaw is recomputed from the live ledger rather than
// trusting PARTNER_BUDGETS directly, so a partner that hasn't had an active
// snapshot yet (e.g. Scale, before the first post-split activation) shows
// zero allocated instead of a budget nothing has actually assigned.
export async function GET() {
	const allocations = await readStore<AirdropAllocations>("airdrop-allocations", {});
	const values = Object.values(allocations);

	const partners = AIRDROP_PARTNERS.map((partner) => {
		let allocatedRaw = BigInt(0);
		let claimedRaw = BigInt(0);
		let lockedRaw = BigInt(0);
		let wallets = 0;
		let claimedWallets = 0;
		for (const allocation of values) {
			const raw = allocation.partnerAmountsRaw?.[partner];
			if (!raw) continue;
			wallets++;
			allocatedRaw += BigInt(raw);
			if (allocation.minted) {
				claimedRaw += BigInt(raw);
				claimedWallets++;
			}
			if (allocation.locked) lockedRaw += BigInt(raw);
		}
		return {
			partner,
			budget: PARTNER_BUDGETS[partner],
			wallets,
			claimedWallets,
			allocatedRaw: allocatedRaw.toString(),
			claimedRaw: claimedRaw.toString(),
			lockedRaw: lockedRaw.toString(),
		};
	});

	const totalAllocatedRaw = values.reduce((sum, a) => sum + BigInt(a.amountRaw ?? 0), BigInt(0));
	const totalClaimedRaw = values.filter((a) => a.minted).reduce((sum, a) => sum + BigInt(a.amountRaw ?? 0), BigInt(0));
	const totalLockedRaw = values.filter((a) => a.locked).reduce((sum, a) => sum + BigInt(a.amountRaw ?? 0), BigInt(0));

	return NextResponse.json({
		partners,
		totalWallets: values.length,
		totalMinted: values.filter((a) => a.minted).length,
		totalLocked: values.filter((a) => a.locked).length,
		totalAllocatedRaw: totalAllocatedRaw.toString(),
		totalClaimedRaw: totalClaimedRaw.toString(),
		totalLockedRaw: totalLockedRaw.toString(),
	});
}
