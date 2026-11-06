// The first-year Quest plan for Devnet testing (docs/wiki/projects/solve3-quest/QUEST-YEAR-PLAN.md, approved by
// Seth 2026-10-06): 13 weekly quest templates, 52 contiguous Thursday epochs from 2026-10-08, three quests a
// week in four quarters of rising difficulty, plus 12 monthly community goals that an operator completes by
// hand. The weekly part is a calendar plan (published through the calendar store); the monthly goals are manual
// goals (migration 024). All XP is Devnet test XP and resets for mainnet.
import { compileQuestCalendar } from "./quest-calendar.mjs";

export const YEAR_CAMPAIGN_ID = "solve3-devnet-quests-y1";
export const YEAR_STARTS_ON = "2026-10-08"; // a Thursday: the next weekly reset
export const YEAR_WEEK_COUNT = 52;

export const YEAR_TEMPLATES = Object.freeze([
	{
		id: "swap-three",
		title: "Three Swaps. Try Not to Trip.",
		flavorText: "The buttons survived. A promising start.",
		description: "Complete three qualifying swaps during this epoch.",
		metric: "qualifyingSwaps",
		target: 3,
		testXp: 250,
	},
	{
		id: "swap-five",
		title: "Five Swaps. Still Standing.",
		flavorText: "Your mouse has filed a complaint.",
		description: "Complete five qualifying swaps during this epoch.",
		metric: "qualifyingSwaps",
		target: 5,
		testXp: 400,
	},
	{
		id: "trade-two-days",
		title: "Back Again? Suspicious.",
		flavorText: "Consistency. We were beginning to worry.",
		description: "Trade on two distinct UTC dates during this epoch.",
		metric: "activeTradingDays",
		target: 2,
		testXp: 500,
	},
	{
		id: "trade-four-days",
		title: "Four Days. Do You Own a Home?",
		flavorText: "Your commitment has been noted, and gently judged.",
		description: "Trade on four distinct UTC dates during this epoch.",
		metric: "activeTradingDays",
		target: 4,
		testXp: 900,
	},
	{
		id: "join-featured-pool",
		title: "Congratulations, You Are the Liquidity.",
		flavorText: "The pool thanks you. Quietly. It is a pool.",
		description:
			"Keep at least 10 devUSDC of liquidity in range in a featured pool for an hour or more during this epoch.",
		metric: "featuredPoolsJoined",
		target: 1,
		testXp: 750,
	},
	{
		id: "invite-trader",
		title: "You Brought a Witness.",
		flavorText: "Make sure they actually trade before taking a bow.",
		description: "Get one qualified trader referral during this epoch.",
		metric: "qualifiedTraderReferrals",
		target: 1,
		testXp: 300,
	},
	{
		id: "invite-lp",
		title: "Recruit an Adult With Liquidity.",
		flavorText: "A friend with a funded pool position. Look at you networking.",
		description: "Get one qualified liquidity-provider referral during this epoch.",
		metric: "qualifiedLpReferrals",
		target: 1,
		testXp: 600,
	},
	{
		id: "volume-100",
		title: "A Hundred Dollars Walks Into a Pool.",
		flavorText: "It was a short walk. It was still a walk.",
		description: "Swap at least $100 of qualifying value in total during this epoch.",
		metric: "swapVolumeUsd",
		target: 100,
		testXp: 300,
	},
	{
		id: "volume-1000",
		title: "A Thousand. Now We Are Cooking.",
		flavorText: "The pool felt that. It would like a moment.",
		description: "Swap at least $1,000 of qualifying value in total during this epoch.",
		metric: "swapVolumeUsd",
		target: 1000,
		testXp: 700,
	},
	{
		id: "explorer-two-pools",
		title: "Two Pools. Look at You Exploring.",
		flavorText: "Variety. The protocol is touched.",
		description: "Swap in two different pools during this epoch.",
		metric: "distinctPoolsTraded",
		target: 2,
		testXp: 350,
	},
	{
		id: "explorer-three-pools",
		title: "Three Pools. Tourist No More.",
		flavorText: "You now have opinions about fee tiers. We are sorry.",
		description: "Swap in three different pools during this epoch.",
		metric: "distinctPoolsTraded",
		target: 3,
		testXp: 550,
	},
	{
		id: "lp-in-range-6h",
		title: "Stay in Range. It Is Not Hard.",
		flavorText: "Price is a river. Your position is a very patient boat.",
		description:
			"Keep your liquidity in range in featured pools for six hours in total during this epoch.",
		metric: "lpInRangeHours",
		target: 6,
		testXp: 600,
	},
	{
		id: "lp-in-range-24h",
		title: "A Full Day In Range. Impressive.",
		flavorText: "The pool would send a card if it could.",
		description:
			"Keep your liquidity in range in featured pools for twenty-four hours in total during this epoch.",
		metric: "lpInRangeHours",
		target: 24,
		testXp: 1000,
	},
]);

// Quarter -> [odd weeks, even weeks] (week numbers start at 1).
const SCHEDULE = [
	[
		["swap-three", "join-featured-pool", "explorer-two-pools"],
		["trade-two-days", "join-featured-pool", "invite-trader"],
	],
	[
		["swap-five", "join-featured-pool", "explorer-three-pools"],
		["volume-100", "lp-in-range-6h", "invite-lp"],
	],
	[
		["trade-four-days", "lp-in-range-24h", "explorer-two-pools"],
		["volume-1000", "join-featured-pool", "invite-trader"],
	],
	[
		["trade-four-days", "lp-in-range-24h", "explorer-three-pools"],
		["volume-1000", "lp-in-range-6h", "invite-lp"],
	],
];

/** The quest ids of week `week` (1-based, 1..52). */
export function yearWeekQuestIds(week) {
	const quarter = Math.min(3, Math.floor((week - 1) / 13));
	return [...SCHEDULE[quarter][week % 2 === 1 ? 0 : 1]];
}

const addDays = (isoDate, days) =>
	new Date(Date.parse(`${isoDate}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The calendar plan to publish (weekly quests only; the monthly goals are manual goals). */
export function createYearPlan() {
	const plan = {
		schemaVersion: 1,
		network: "DEVNET",
		fixtureKind: "SYNTHETIC_DEVNET",
		campaignId: YEAR_CAMPAIGN_ID,
		timezone: "UTC",
		startsOn: YEAR_STARTS_ON,
		weekCount: YEAR_WEEK_COUNT,
		templates: YEAR_TEMPLATES.map((t) => ({ ...t })),
		weeks: Array.from({ length: YEAR_WEEK_COUNT }, (_, i) => ({
			startsOn: addDays(YEAR_STARTS_ON, i * 7),
			questIds: yearWeekQuestIds(i + 1),
		})),
		communityGoals: [],
	};
	compileQuestCalendar(plan);
	return plan;
}

export const MANUAL_GOAL_XP = 1000;

/**
 * The twelve monthly manual goals: October 2026 (from the first epoch) through September 2027. Each is a calendar
 * month in UTC; every one defaults to "Get a partner onboarded" and can be retitled in the Admin page before it starts.
 */
export function createYearManualGoals() {
	const months = [];
	for (let i = 0; i < 12; i++) {
		const first = new Date(Date.UTC(2026, 9 + i, 1));
		const next = new Date(Date.UTC(2026, 10 + i, 1));
		const label = first.toISOString().slice(0, 7);
		months.push({
			id: `partner-${label}`,
			title: "Get a partner onboarded",
			flavorText: "Somebody important said yes. Make sure they actually mean it.",
			startsAt: i === 0 ? `${YEAR_STARTS_ON}T00:00:00.000Z` : first.toISOString(),
			endsAt: next.toISOString(),
			xp: MANUAL_GOAL_XP,
		});
	}
	return months;
}

/** Maximum Quest XP the plan can pay one Passport, for the budget table in the wiki. */
export function yearXpCeiling() {
	const xp = new Map(YEAR_TEMPLATES.map((t) => [t.id, t.testXp]));
	let weekly = 0;
	for (let week = 1; week <= YEAR_WEEK_COUNT; week++)
		for (const id of yearWeekQuestIds(week)) weekly += xp.get(id);
	return { weekly, monthly: MANUAL_GOAL_XP * 12, total: weekly + MANUAL_GOAL_XP * 12 };
}
