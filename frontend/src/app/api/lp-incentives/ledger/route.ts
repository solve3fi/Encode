import { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import {
	EMPTY_LP_INCENTIVE_LEDGER,
	LP_INCENTIVES_LEDGER_STORE,
	type LpIncentiveLedger,
	type LpLedgerPublic,
	weekKeyFor,
} from "@/configs/lpIncentives";
import { readStore } from "@/lib/server/dataStore";

export const runtime = "nodejs";

// Public summary of the keeper's ledger (scripts/lp-incentives-keeper.mjs):
// per-pool trailing/current-week totals for the Bonus APR column, plus the
// credit of ONE wallet when ?wallet= names it. The full per-wallet map is
// never exposed here; the Admin page downloads it through the admin route.
export async function GET(request: NextRequest) {
	const ledger = await readStore<LpIncentiveLedger>(
		LP_INCENTIVES_LEDGER_STORE,
		EMPTY_LP_INCENTIVE_LEDGER,
	);
	const currentWeek = weekKeyFor(Math.floor(Date.now() / 1000));

	const pools: LpLedgerPublic["pools"] = {};
	for (const [address, pool] of Object.entries(ledger.pools)) {
		const week = pool.weeks[currentWeek];
		pools[address] = {
			trailing7d: pool.trailing7d,
			currentWeek: week
				? {
						feesUsd: week.feesUsd,
						creditSolv3: week.creditSolv3,
						unallocatedUsd: week.unallocatedUsd,
						samples: week.samples,
					}
				: null,
			lastSampleTs: pool.lastSample.ts,
		};
	}

	const response: LpLedgerPublic = { updatedAt: ledger.updatedAt, pools };
	const wallet = request.nextUrl.searchParams.get("wallet");
	if (wallet) {
		try {
			response.wallet = ledger.wallets[new PublicKey(wallet).toBase58()] ?? null;
		} catch {
			return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
		}
	}
	return NextResponse.json(response, {
		headers: { "Cache-Control": "public, max-age=30" },
	});
}
