import { compileQuestCalendar } from "./quest-calendar.mjs";

// Every value is an invented Devnet fixture, including XP and valuations.
// The calendar includes both partial weeks covering the complete calendar year.
export function createQuestCalendarExample(year = 2027) {
	if (!Number.isSafeInteger(year) || year < 2020 || year > 2100)
		throw new Error("Fixture year must be between 2020 and 2100");
	const jan1 = Date.UTC(year, 0, 1),
		nextJan1 = Date.UTC(year + 1, 0, 1),
		day = 86400000;
	const first = jan1 - ((new Date(jan1).getUTCDay() - 4 + 7) % 7) * day;
	const weekCount = Math.ceil((nextJan1 - first) / (7 * day));
	const templates = [
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
			id: "trade-two-days",
			title: "Back Again? Suspicious.",
			flavorText: "Consistency. We were beginning to worry.",
			description: "Trade on two distinct UTC dates during this epoch.",
			metric: "activeTradingDays",
			target: 2,
			testXp: 500,
		},
		{
			id: "join-featured-pool",
			title: "Congratulations, You Are the Liquidity.",
			flavorText: "The pool thanks you. Quietly. It is a pool.",
			description: "Join one featured pool during this epoch.",
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
			flavorText:
				"A friend with a funded pool position. Look at you networking.",
			description:
				"Get one qualified liquidity-provider referral during this epoch.",
			metric: "qualifiedLpReferrals",
			target: 1,
			testXp: 600,
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
	];
	const plan = {
		schemaVersion: 1,
		network: "DEVNET",
		fixtureKind: "SYNTHETIC_DEVNET",
		campaignId: `quest-lab-${year}`,
		timezone: "UTC",
		startsOn: new Date(first).toISOString().slice(0, 10),
		weekCount,
		templates,
		weeks: Array.from({ length: weekCount }, (_, i) => ({
			startsOn: new Date(first + i * 7 * day).toISOString().slice(0, 10),
			questIds: templates.slice((i % 2) * 3, (i % 2) * 3 + 3).map((t) => t.id),
		})),
		communityGoals: Array.from({ length: 12 }, (_, month) => ({
			id: `tvl-${year}-${String(month + 1).padStart(2, "0")}`,
			title: "Half a Million. Collectively, Somehow.",
			flavorText:
				"Teamwork: occasionally more useful than shouting at a chart.",
			startsAt: new Date(Date.UTC(year, month, 1)).toISOString(),
			endsAt: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
			targetUsdCents: "50000000",
			testXp: 1000,
			audience: "PASSPORTS_AT_MILESTONE",
			poolAddresses: ["11111111111111111111111111111111"],
			valuationVersion: "synthetic-price-v1",
			maxAgeSeconds: 300,
		})),
	};
	compileQuestCalendar(plan);
	return plan;
}
