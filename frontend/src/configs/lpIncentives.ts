// Soft-launch LP bootstrap program. On admin-chosen pools the protocol keeps
// `feeShareBps` of every swap fee on-chain (the pool's protocolFeeRate, which
// accrues to protocolFeeOwedA/B until the fee authority collects) and LPs of
// those pools are compensated OFF-CHAIN with veSOLV3 credit:
//
//   credit (veSOLV3) = protocol fees taken (USD) × multiplier ÷ veSolv3Usd
//
// distributed per keeper sample to the positions in range at that sample,
// pro-rata by liquidity (scripts/lp-incentives-keeper.mjs writes the ledger;
// the app only reads it). Credit is granted as permanently locked veSOLV3 at
// the ve launch through an airdrop-style claim — until then it is a promise
// recorded in data/lp-incentives-ledger.json.
//
// Keep this file free of React/DOM imports: the keeper script mirrors the
// shapes below and the API routes import the constants.

export const LP_INCENTIVES_STORE = "lp-incentives";
export const LP_INCENTIVES_LEDGER_STORE = "lp-incentives-ledger";

export const LP_INCENTIVE_SET_ACTION = "set lp incentive";
export const LP_INCENTIVE_REMOVE_ACTION = "remove lp incentive";
export const LP_INCENTIVE_SETTINGS_ACTION = "set lp incentive settings";
export const LP_LEDGER_DOWNLOAD_ACTION = "download lp incentive ledger";

// Decided 2026-09-18: 30% fee share, 1.5× fee-linked credit, $0.30 per
// veSOLV3 for display and for converting USD credit into SOLV3 units.
export const DEFAULT_FEE_SHARE_BPS = 3000;
export const DEFAULT_MULTIPLIER = 1.5;
export const DEFAULT_VESOLV3_USD = 0.3;
export const MAX_FEE_SHARE_BPS = 10_000;
export const MAX_MULTIPLIER = 10;

// Bonus APR is annualized from the trailing 7-day ledger window; before a
// day of samples exists the number would be noise, so the UI says "Accruing".
export const BONUS_APR_MIN_WINDOW_SECONDS = 24 * 60 * 60;
export const BONUS_APR_WINDOW_SECONDS = 7 * 24 * 60 * 60;

export type LpIncentiveStatus = "active" | "paused" | "ended";

export type LpIncentivePool = {
	poolAddress: string;
	/** Share of each swap fee the protocol keeps, bps of 10_000. */
	feeShareBps: number;
	/** veSOLV3 credit per USD of protocol fees taken, before the price divide. */
	multiplier: number;
	/** Optional safety valve: max SOLV3 credited for this pool per epoch week. */
	weeklyCapSolv3?: number;
	status: LpIncentiveStatus;
	notes?: string;
	updatedBy: string;
	updatedAt: number;
};

export type LpIncentivesConfig = {
	veSolv3Usd: number;
	pools: Record<string, LpIncentivePool>;
	updatedBy?: string;
	updatedAt?: number;
};

export const EMPTY_LP_INCENTIVES_CONFIG: LpIncentivesConfig = {
	veSolv3Usd: DEFAULT_VESOLV3_USD,
	pools: {},
};

// ---- Ledger (written only by the keeper) -------------------------------

export type LpLedgerSample = {
	slot: number;
	/** Unix seconds. */
	ts: number;
	/** Raw base units of protocolFeeOwedA/B at the sample, as decimal strings. */
	owedA: string;
	owedB: string;
};

export type LpLedgerWalletWeek = {
	creditSolv3: string;
	creditUsd: string;
	samples: number;
};

export type LpLedgerWeek = {
	feesUsd: string;
	creditSolv3: string;
	/** Fees that fell in a sample with no in-range liquidity — never credited. */
	unallocatedUsd: string;
	samples: number;
	wallets: Record<string, LpLedgerWalletWeek>;
};

export type LpLedgerTrailing = {
	feesUsd: string;
	creditSolv3: string;
	creditUsd: string;
	/** Seconds covered by the samples inside the trailing window. */
	windowSeconds: number;
	samples: number;
};

export type LpLedgerPool = {
	lastSample: LpLedgerSample;
	/** Recent credited samples, kept for the trailing window (ts, feesUsd, creditUsd). */
	recent: Array<{ ts: number; feesUsd: string; creditUsd: string; creditSolv3: string }>;
	weeks: Record<string, LpLedgerWeek>;
	trailing7d: LpLedgerTrailing;
};

export type LpLedgerWallet = {
	totalSolv3: string;
	byPool: Record<string, string>;
};

export type LpIncentiveLedger = {
	version: 1;
	updatedAt: number;
	pools: Record<string, LpLedgerPool>;
	wallets: Record<string, LpLedgerWallet>;
};

export const EMPTY_LP_INCENTIVE_LEDGER: LpIncentiveLedger = {
	version: 1,
	updatedAt: 0,
	pools: {},
	wallets: {},
};

/** What /api/lp-incentives/ledger exposes publicly (no per-wallet map). */
export type LpLedgerPublic = {
	updatedAt: number;
	pools: Record<
		string,
		{ trailing7d: LpLedgerTrailing; currentWeek: Omit<LpLedgerWeek, "wallets"> | null; lastSampleTs: number }
	>;
	/** Present only when the request named a wallet. */
	wallet?: LpLedgerWallet | null;
};

// Epoch weeks run Thursday 00:00 UTC → Thursday 00:00 UTC, matching the ve
// program's epoch clock. 1970-01-01 was a Thursday, so the boundary is a
// plain multiple of a week since the Unix epoch.
const WEEK_SECONDS = 7 * 24 * 60 * 60;

export function weekStartSeconds(tsSeconds: number): number {
	return Math.floor(tsSeconds / WEEK_SECONDS) * WEEK_SECONDS;
}

/** ISO date of the Thursday that starts the epoch week containing `tsSeconds`. */
export function weekKeyFor(tsSeconds: number): string {
	return new Date(weekStartSeconds(tsSeconds) * 1000).toISOString().slice(0, 10);
}

export const isActiveIncentive = (pool: LpIncentivePool | undefined): pool is LpIncentivePool =>
	!!pool && pool.status === "active";
