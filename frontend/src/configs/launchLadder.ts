import { AIRDROP_TOKEN_MINT } from "@/configs/airdrop";
import { TOTAL_SUPPLY } from "@/configs/tokenomics";
import { USDC } from "@/configs/tokens";

// Launch-liquidity ladder for the SOLV3/USDC pool: three single-sided
// SOLV3 ranges stacked above the launch price, thin at the bottom so the
// first buyers move price quickly, heavy at the top so most of the float
// is sold where it's expensive. Persisted per store below so every admin
// sees the same plan; the deploy script reads the exported JSON rather
// than recomputing ticks from prices.
export const LAUNCH_LADDER_STORE = "launch-ladder";
export const LAUNCH_LADDER_SAVE_ACTION = "save launch ladder";
// Reads are signed too: the ladder is the launch strategy, so it must not be
// readable by anyone who knows the URL before the pool exists.
export const LAUNCH_LADDER_READ_ACTION = "read launch ladder";

// Mainnet mints — the plan is for the production pool even when the app
// is pointed at devnet. SOLV3's key sorts before USDC's, so SOLV3 is token
// A and the pool price reads as USDC per SOLV3 (it sorts *after* WSOL, so
// a SOL pair would be inverted — don't reuse these ticks there).
export const LAUNCH_TOKEN_A_MINT = AIRDROP_TOKEN_MINT.toString();
export const LAUNCH_TOKEN_A_DECIMALS = 9;
export const LAUNCH_TOKEN_B_MINT = USDC.address;
export const LAUNCH_TOKEN_B_DECIMALS = USDC.decimals;
export const LAUNCH_TOTAL_SUPPLY = TOTAL_SUPPLY;

// Mirrors ve33-contracts/tests/configs/solve.ts FEE_TIERS (volatile tiers
// only — the 0.01%/1 and 0.02%/2 stable tiers make no sense for a launch).
export const LAUNCH_FEE_TIERS = [
	{ tickSpacing: 64, feeRate: 3000, label: "0.30%" },
	{ tickSpacing: 96, feeRate: 6500, label: "0.65%" },
	{ tickSpacing: 128, feeRate: 10000, label: "1.00%" },
	{ tickSpacing: 256, feeRate: 20000, label: "2.00%" },
	// The program allows fee rates up to 6.00%; these match the pool-creation tiers.
	{ tickSpacing: 384, feeRate: 30000, label: "3.00%" },
	{ tickSpacing: 512, feeRate: 40000, label: "4.00%" },
	{ tickSpacing: 640, feeRate: 50000, label: "5.00%" },
] as const;
export type LaunchTickSpacing =
	(typeof LAUNCH_FEE_TIERS)[number]["tickSpacing"];

export const TICK_ARRAY_SIZE = 88;
export const MAX_TICK_INDEX = 443636;

export type LaunchLadderInputs = {
	// USDC per SOLV3. launchPrice is where the pool initializes; each band
	// runs from the previous boundary up to its own top.
	launchPrice: number;
	thinTop: number;
	mediumTop: number;
	heavyTop: number;
	// Percent of the deployed float in each band; should total 100.
	thinPercent: number;
	mediumPercent: number;
	heavyPercent: number;
	// Whole SOLV3 deployed across the three bands.
	floatTokens: number;
	tickSpacing: LaunchTickSpacing;
	// Optional USDC-only position below the launch price (retrace cushion).
	// 0 disables it.
	floorUsdc: number;
	floorBottomPrice: number;
};

// Launch at $0.20 — a 1.67× premium over the $0.12 presale, because presale
// tokens are permanently locked veSOLV3 while the ladder sells liquid SOLV3;
// liquid must cost more than locked or presale holders end up worst off.
// 4,000,000 SOLV3 = the "Initial Liquidity" allocation, 1% fee tier. The
// 10/30/60 split gives a 1 : 2.6 : 7.0 depth ratio and ~$1.87M at a full
// fill, with the top held to $0.70 (5.8× presale) rather than scaling every
// band up with the launch price.
export const DEFAULT_LAUNCH_LADDER: LaunchLadderInputs = {
	launchPrice: 0.2,
	thinTop: 0.28,
	mediumTop: 0.45,
	heavyTop: 0.7,
	thinPercent: 10,
	mediumPercent: 30,
	heavyPercent: 60,
	floatTokens: 4_000_000,
	tickSpacing: 128,
	floorUsdc: 0,
	floorBottomPrice: 0.16,
};

export const LAUNCH_LADDER_PRESETS: Record<
	"plan" | "steeper" | "flatter",
	LaunchLadderInputs
> = {
	plan: DEFAULT_LAUNCH_LADDER,
	steeper: {
		...DEFAULT_LAUNCH_LADDER,
		thinTop: 0.26,
		mediumTop: 0.42,
		thinPercent: 5,
		mediumPercent: 25,
		heavyPercent: 70,
	},
	flatter: {
		...DEFAULT_LAUNCH_LADDER,
		thinTop: 0.3,
		mediumTop: 0.48,
		thinPercent: 20,
		mediumPercent: 35,
		heavyPercent: 45,
	},
};

export type SavedLaunchLadder = {
	inputs: LaunchLadderInputs;
	updatedAt: number;
	updatedBy: string;
};

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

// Shared by the API route (untrusted body) and the client (stored JSON):
// returns the validated inputs or a reason they're unusable.
export function validateLaunchLadderInputs(
	value: unknown,
): { inputs: LaunchLadderInputs } | { error: string } {
	if (!value || typeof value !== "object") return { error: "Missing inputs" };
	const v = value as Record<string, unknown>;
	const numeric = [
		"launchPrice",
		"thinTop",
		"mediumTop",
		"heavyTop",
		"thinPercent",
		"mediumPercent",
		"heavyPercent",
		"floatTokens",
		"floorUsdc",
		"floorBottomPrice",
	] as const;
	for (const key of numeric) {
		if (!isFiniteNumber(v[key]) || (v[key] as number) < 0) {
			return { error: `Invalid ${key}` };
		}
	}
	const tickSpacing = v.tickSpacing;
	if (!LAUNCH_FEE_TIERS.some((tier) => tier.tickSpacing === tickSpacing)) {
		return { error: "Unknown fee tier" };
	}
	const inputs: LaunchLadderInputs = {
		launchPrice: v.launchPrice as number,
		thinTop: v.thinTop as number,
		mediumTop: v.mediumTop as number,
		heavyTop: v.heavyTop as number,
		thinPercent: v.thinPercent as number,
		mediumPercent: v.mediumPercent as number,
		heavyPercent: v.heavyPercent as number,
		floatTokens: v.floatTokens as number,
		tickSpacing: tickSpacing as LaunchTickSpacing,
		floorUsdc: v.floorUsdc as number,
		floorBottomPrice: v.floorBottomPrice as number,
	};
	if (
		!(
			inputs.launchPrice > 0 &&
			inputs.launchPrice < inputs.thinTop &&
			inputs.thinTop < inputs.mediumTop &&
			inputs.mediumTop < inputs.heavyTop
		)
	) {
		return { error: "Prices must increase from launch to the heavy band top" };
	}
	if (inputs.floatTokens <= 0) return { error: "Float must be positive" };
	if (inputs.floorUsdc > 0 && inputs.floorBottomPrice >= inputs.launchPrice) {
		return { error: "Floor bottom must be below the launch price" };
	}
	return { inputs };
}
