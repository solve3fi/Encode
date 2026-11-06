import {
	DEVNET_VALUATION_SOURCE,
	DEVNET_VALUATION_VERSION,
} from "./devnet-swap-valuation.mjs";
import {
	LP_VALUATION_SOURCE,
	LP_VALUATION_VERSION,
} from "./devnet-lp-valuation.mjs";
import { createWeeklySwapProgressProvider } from "./quest-weekly-swap-progress.mjs";
import { createLpInventoryTimelineReader } from "./lp-inventory-cohorts.mjs";

// TEST-ONLY LP policy: the SOLV3/devUSDC pools are featured and a Passport joins one by holding at
// least 10 devUSDC (1000 cents) of devUSDC-side value in it for at least an hour within the epoch. Backend and settler read the same
// settings, so what a player sees is what is rewarded. Override with QUEST_LP_FEATURED_POOLS
// (comma-separated pool addresses) and QUEST_LP_MIN_USD_CENTS.
export const DEFAULT_LP_FEATURED_POOLS = Object.freeze([
	"7vRYZ3PqRZt9AoDksSVo4bEKY7CU61Ees5PXMvnZdYpk",
	"7bNGJpmcMLG1qSVv1RRSbR5HX6RBAFwVhPH2ScndH176",
	"BtcFcgKWEApuZ1xhp3EKw9GBgxJvhuLjJ87hfZEL3zu5",
]);
export function devnetLpPolicy(env = process.env) {
	const pools = (env.QUEST_LP_FEATURED_POOLS ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	return Object.freeze({
		featuredPools: pools.length ? pools : [...DEFAULT_LP_FEATURED_POOLS],
		minimumLpUsdCents: env.QUEST_LP_MIN_USD_CENTS?.trim() || "1000",
		// Time-weighted anti-JIT: a pool must stay qualifying this long inside the epoch (default 1 hour).
		minimumDwellSeconds: Number(env.QUEST_LP_MIN_DWELL_SECONDS ?? 3600),
		valuationSource: LP_VALUATION_SOURCE,
		valuationVersion: LP_VALUATION_VERSION,
		// Range-aware: a position only counts while the pool's price is inside its range. Set
		// QUEST_LP_REQUIRE_IN_RANGE=0 to fall back to counting any position that holds value.
		requireInRange: env.QUEST_LP_REQUIRE_IN_RANGE?.trim() !== "0",
		maxSampleGapSeconds: Number(env.QUEST_LP_MAX_SAMPLE_GAP_SECONDS ?? 600),
	});
}

// TEST-ONLY qualification policy shared by the backend (reads progress) and the settler (records
// XP receipts), so what the player sees is exactly what is rewarded.
export const DEVNET_SWAP_POLICY = Object.freeze({
	fixtureKind: "SYNTHETIC_DEVNET",
	network: "DEVNET",
	revision: 1,
	// A swap counts from 1 devUSDC (100 cents) of moved value.
	minimumSwapUsdCents: "100",
	maximumPriceAgeSeconds: 60,
	valuationSource: DEVNET_VALUATION_SOURCE,
	valuationVersion: DEVNET_VALUATION_VERSION,
});

/**
 * Build the weekly swap provider over a read connection pool. Pins come from the seeded cursor row,
 * so the process cannot drift from the worker's campaign. Throws when the source is not seeded.
 */
export async function createDevnetSwapProgressProvider({
	pool,
	campaignId,
	environment,
}) {
	const { rows } = await pool.query(
		"SELECT program_id, decoder_version, reconciliation_start_slot::text AS start_slot FROM genesis.indexer_cursors WHERE campaign_id = $1",
		[campaignId],
	);
	if (rows.length !== 1 || rows[0].start_slot === null)
		throw new Error("Swap source cursor is missing");
	let lpOwnershipReader = null;
	try {
		const { rows: anchors } = await pool.query(
			"SELECT evidence_bundle FROM quest.position_baseline_anchors WHERE campaign_id=$1", [campaignId]);
		if (anchors.length === 1) lpOwnershipReader = createLpInventoryTimelineReader({
			pool, campaignId, environment,
		});
	} catch {
		// LP coverage is independent of swaps. Its absence must never fall back to
		// attributing a transferred NFT to the wallet of the last liquidity event.
	}
	return createWeeklySwapProgressProvider({
		configuration: {
			pool,
			network: "DEVNET",
			campaignId,
			programId: rows[0].program_id,
			decoderVersion: rows[0].decoder_version,
			startSlot: Number(rows[0].start_slot),
			lpOwnershipReader,
			environment,
			// Test Passports were provisioned with microsecond link times. Round link starts up and
			// ends down so attribution can only shrink; the strict reader default is unchanged.
			conservativeLinkTimes: true,
			policy: { ...DEVNET_SWAP_POLICY, lp: devnetLpPolicy(), referrals: true },
		},
		// The reconciled watermark is the only slot readers may treat as complete.
		resolveComputedThroughSlot: async () => {
			const { rows: marks } = await pool.query(
				"SELECT reconciled_through_slot::text AS slot FROM genesis.indexer_cursors WHERE campaign_id = $1",
				[campaignId],
			);
			if (marks.length !== 1 || marks[0].slot === null)
				throw new Error("Swap source is not reconciled");
			return Number(marks[0].slot);
		},
	});
}
