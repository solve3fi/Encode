import { SOLVE, XSOLVE } from "@/configs/tokens";

/** Planning values for Genesis. This module does not activate rewards. */
export const GENESIS_PLAN = {
	questReserveSolv3: 2_000_000,
	genesisMaximumSolv3: 600_000,
	initialCommitmentSolv3: 300_000,
	genesisReserveSolv3: 300_000,
	solv3ReferenceValueUsd: 0.3,
	initialWeeklyBoostSolv3: 30_000,
	featuredPools: [
		{ id: "sol-usdc", label: "SOL / USDC", weeklySolv3: 15_000 },
		{ id: "partner-a", label: "Partner pool A", weeklySolv3: 7_500 },
		{ id: "partner-b", label: "Partner pool B", weeklySolv3: 7_500 },
	],
} as const;

/** DOM id of the pool list on /liquidity, the target of the launch quests' "Choose a pool" link. */
export const LAUNCH_POOLS_ANCHOR = "all-pools";

/** Keep campaign navigation hidden until verified progress is available. */
export const GENESIS_PUBLIC_ENABLED =
	process.env.NEXT_PUBLIC_GENESIS_PUBLIC_ENABLED === "true";

/** Known SOLV3 mints are excluded from public soft-launch token actions. */
export const isGenesisRestrictedTokenMint = (address: string) =>
	GENESIS_PUBLIC_ENABLED &&
	(address === SOLVE.address || address === XSOLVE.address);

export const assertGenesisTokenPairAllowed = (mintA: string, mintB: string) => {
	if (
		isGenesisRestrictedTokenMint(mintA) ||
		isGenesisRestrictedTokenMint(mintB)
	) {
		throw new Error("SOLV3 token actions are unavailable during Genesis.");
	}
};

export type GenesisQuestCategory =
	| "Featured"
	| "Trading"
	| "Liquidity"
	| "Community"
	| "Referral";

export type GenesisQuestDefinition = {
	slug: string;
	title: string;
	category: GenesisQuestCategory;
	/** Original narrator copy; never used as an eligibility rule. */
	flavorText: string;
	description: string;
	verification: "indexed" | "derived" | "manual";
};

/** Draft definitions. XP and eligibility rules belong in durable campaign config. */
export const GENESIS_QUEST_CANDIDATES: readonly GenesisQuestDefinition[] = [
	{
		slug: "first-swap",
		title: "First Swap",
		category: "Trading",
		flavorText: "You pressed the swap button. The market survived. So did you.",
		description: "Make a qualifying swap on Solve3.",
		verification: "indexed",
	},
	{
		slug: "trade-three-days",
		title: "Trade on 3 Different Days",
		category: "Trading",
		flavorText: "Three different days? Look at you developing a habit.",
		description: "Trade on three distinct qualifying days.",
		verification: "derived",
	},
	{
		slug: "trade-seven-days",
		title: "Trade on 7 Different Days",
		category: "Trading",
		flavorText:
			"Seven separate days. Your calendar is getting suspiciously ambitious.",
		description: "Trade on seven distinct qualifying days.",
		verification: "derived",
	},
	{
		slug: "provide-liquidity",
		title: "Provide Liquidity",
		category: "Liquidity",
		flavorText:
			"You brought liquidity to the party. Finally, someone remembered the snacks.",
		description: "Add qualifying liquidity to a featured pool.",
		verification: "indexed",
	},
	{
		slug: "lp-seven-days",
		title: "LP for 7 Days",
		category: "Liquidity",
		flavorText: "Seven days in the pool. Patience looks weirdly good on you.",
		description: "Maintain qualifying liquidity for seven days.",
		verification: "derived",
	},
	{
		slug: "refer-trader",
		title: "Refer a Trader",
		category: "Referral",
		flavorText: "You brought a friend. Now let's see if they came to trade.",
		description: "Invite a trader who qualifies after review.",
		verification: "derived",
	},
	{
		slug: "break-solve3",
		title: "Break Solve3",
		category: "Community",
		flavorText:
			"Found a bug? Give us the steps so we can have a productive little panic.",
		description: "Submit a reproducible issue for review.",
		verification: "manual",
	},
];
