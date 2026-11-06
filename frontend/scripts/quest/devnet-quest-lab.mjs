// Synthetic Devnet Quest Lab catalog. This module never reads chain data,
// inserts ledger rows, or authorizes XP. Every amount below is test-only.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const METRIC_KEYS = Object.freeze([
	"verifiedWalletConnections",
	"verifiedDevnetPassMints",
	"qualifyingSwaps",
	"activeTradingDays",
	"featuredPoolsJoined",
	"longestFeaturedLpStreakDays",
	"qualifiedTraderReferrals",
	"qualifiedLpReferrals",
]);

const definitions = [
	{
		id: "connect-wallet",
		category: "Onboarding",
		title: "Connect Your Wallet",
		flavorText:
			"A wallet has entered the arena. Please keep your excuses nearby.",
		description:
			"Connect a wallet and verify ownership for your Devnet Passport. Counts once per Passport.",
		metric: "verifiedWalletConnections",
		target: 1,
		testXp: 100,
	},
	{
		id: "mint-devnet-pass",
		category: "Onboarding",
		title: "Mint Your Devnet Pass",
		flavorText:
			"You minted a pass. The paperwork has officially become your problem.",
		description:
			"Mint the approved Solve3 Pass on Devnet with a verified linked wallet. Requires a finalized successful mint and counts once per Passport.",
		metric: "verifiedDevnetPassMints",
		target: 1,
		testXp: 250,
	},
	{
		id: "first-swap",
		category: "Trading",
		title: "First Swap",
		flavorText: "You made a trade. The market has been warned.",
		description: "Make one qualifying Solve3 swap.",
		metric: "qualifyingSwaps",
		target: 1,
		testXp: 250,
	},
	{
		id: "ten-swaps",
		category: "Trading",
		title: "Ten Trades Deep",
		flavorText: "Ten swaps. Apparently the first one was not an accident.",
		description: "Make ten qualifying Solve3 swaps.",
		metric: "qualifyingSwaps",
		target: 10,
		testXp: 500,
	},
	{
		id: "trade-three-days",
		category: "Trading",
		title: "Three Different Days",
		flavorText: "Three visits. The calendar is starting to recognize you.",
		description: "Trade on three distinct qualifying days.",
		metric: "activeTradingDays",
		target: 3,
		testXp: 500,
	},
	{
		id: "trade-seven-days",
		category: "Trading",
		title: "Seven Different Days",
		flavorText:
			"A full week of appearances. Your dedication is getting suspicious.",
		description: "Trade on seven distinct qualifying days.",
		metric: "activeTradingDays",
		target: 7,
		testXp: 1000,
	},
	{
		id: "first-featured-pool",
		category: "Liquidity",
		title: "Join a Featured Pool",
		flavorText: "You brought liquidity. Someone finally read the invitation.",
		description: "Add qualifying liquidity to one featured pool.",
		metric: "featuredPoolsJoined",
		target: 1,
		testXp: 1000,
	},
	{
		id: "two-featured-pools",
		category: "Liquidity",
		title: "Pool Explorer",
		flavorText: "Two pools. One was simply too small a stage.",
		description: "Add qualifying liquidity to two distinct featured pools.",
		metric: "featuredPoolsJoined",
		target: 2,
		testXp: 1500,
	},
	{
		id: "lp-seven-days",
		category: "Liquidity",
		title: "Seven Day LP",
		flavorText: "Seven days in the pool. Patience looks oddly heroic on you.",
		description:
			"Maintain qualifying featured-pool liquidity for seven continuous days.",
		metric: "longestFeaturedLpStreakDays",
		target: 7,
		testXp: 1000,
	},
	{
		id: "lp-thirty-days",
		category: "Liquidity",
		title: "Thirty Day LP",
		flavorText: "Thirty days. At this point the pool should know your name.",
		description:
			"Maintain qualifying featured-pool liquidity for thirty continuous days.",
		metric: "longestFeaturedLpStreakDays",
		target: 30,
		testXp: 2500,
	},
	{
		id: "refer-trader",
		category: "Referral",
		title: "Invite a Trader",
		flavorText: "You brought a friend. Better yet, they actually traded.",
		description:
			"Refer one trader who qualifies after activity and abuse review.",
		metric: "qualifiedTraderReferrals",
		target: 1,
		testXp: 250,
	},
	{
		id: "refer-three-traders",
		category: "Referral",
		title: "Trading Crew",
		flavorText: "Three qualified traders. Your group chat has consequences.",
		description: "Refer three distinct qualified traders.",
		metric: "qualifiedTraderReferrals",
		target: 3,
		testXp: 750,
	},
	{
		id: "refer-lp",
		category: "Referral",
		title: "Invite a Liquidity Provider",
		flavorText:
			"A friend joined the pool. You may now claim excellent taste in friends.",
		description:
			"Refer one provider who qualifies after LP activity and abuse review.",
		metric: "qualifiedLpReferrals",
		target: 1,
		testXp: 1000,
	},
	{
		id: "refer-three-lps",
		category: "Referral",
		title: "Liquidity Crew",
		flavorText:
			"Three providers. Your invitations are becoming infrastructure.",
		description: "Refer three distinct qualified liquidity providers.",
		metric: "qualifiedLpReferrals",
		target: 3,
		testXp: 2500,
	},
];

export const DEVNET_QUEST_LAB_CATALOG = Object.freeze({
	schemaVersion: 2,
	network: "DEVNET",
	mode: "SYNTHETIC_TEST_ONLY",
	seasonKey: "devnet-lab-01",
	revision: 2,
	quests: Object.freeze(
		definitions.map((definition) => Object.freeze(definition)),
	),
});

function assertSnapshot(snapshot) {
	if (
		snapshot?.network !== "DEVNET" ||
		snapshot.fixtureKind !== "SYNTHETIC_DEVNET" ||
		typeof snapshot.passportId !== "string" ||
		!UUID.test(snapshot.passportId) ||
		!Number.isSafeInteger(snapshot.computedThroughSlot) ||
		snapshot.computedThroughSlot < 0 ||
		!snapshot.metrics ||
		typeof snapshot.metrics !== "object" ||
		Array.isArray(snapshot.metrics)
	) {
		throw new TypeError(
			"Quest Lab requires a synthetic Devnet Passport snapshot",
		);
	}
	const keys = Object.keys(snapshot.metrics).sort();
	if (JSON.stringify(keys) !== JSON.stringify([...METRIC_KEYS].sort())) {
		throw new TypeError("Quest Lab snapshot has missing or unknown metrics");
	}
	for (const key of METRIC_KEYS) {
		const value = snapshot.metrics[key];
		if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
			throw new TypeError(
				`Quest Lab ${key} must be null or a nonnegative safe integer`,
			);
		}
	}
	for (const key of ["verifiedWalletConnections", "verifiedDevnetPassMints"]) {
		if (snapshot.metrics[key] !== null && snapshot.metrics[key] > 1) {
			throw new Error("Quest Lab onboarding counts at most once per Passport");
		}
	}
	if (
		snapshot.metrics.verifiedDevnetPassMints === 1 &&
		snapshot.metrics.verifiedWalletConnections !== 1
	) {
		throw new Error("Quest Lab mint requires verified wallet ownership");
	}
	const {
		qualifyingSwaps,
		activeTradingDays,
		featuredPoolsJoined,
		longestFeaturedLpStreakDays,
	} = snapshot.metrics;
	if (
		(qualifyingSwaps !== null &&
			activeTradingDays !== null &&
			activeTradingDays > qualifyingSwaps) ||
		(featuredPoolsJoined === 0 &&
			longestFeaturedLpStreakDays !== null &&
			longestFeaturedLpStreakDays > 0)
	) {
		throw new Error("Quest Lab metrics contradict qualifying activity");
	}
}

/** Preview only: this function emits no award intent or ledger mutation. */
export function previewDevnetQuests(snapshot) {
	assertSnapshot(snapshot);
	let provisionalTestXp = 0;
	const quests = DEVNET_QUEST_LAB_CATALOG.quests.map((quest) => {
		const measured = snapshot.metrics[quest.metric];
		const progress =
			measured === null ? null : Math.min(measured, quest.target);
		const status =
			progress === null
				? "unavailable"
				: progress === 0
					? "pending"
					: progress === quest.target
						? "provisional"
						: "in_progress";
		const previewXp = status === "provisional" ? quest.testXp : 0;
		provisionalTestXp += previewXp;
		return { ...quest, progress, status, previewXp };
	});
	return {
		network: "DEVNET",
		fixtureKind: "SYNTHETIC_DEVNET",
		revision: DEVNET_QUEST_LAB_CATALOG.revision,
		seasonKey: DEVNET_QUEST_LAB_CATALOG.seasonKey,
		passportId: snapshot.passportId,
		computedThroughSlot: snapshot.computedThroughSlot,
		awardEligible: false,
		provisionalTestXp,
		quests,
	};
}
