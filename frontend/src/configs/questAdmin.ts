// The Quest calendar and manual community goal controls an admin can use. Every call is a signed admin action;
// the signed payload is exactly the parameters below, so a captured signature cannot be reused for a different
// plan, goal or campaign. The server (src/app/api/admin/quests/route.ts) checks the action name and the payload hash.
export const QUEST_ADMIN_ACTIONS = {
	overview: "quest admin overview",
	publish: "quest admin publish calendar",
	revise: "quest admin revise calendar",
	"save-goal": "quest admin save goal",
	"remove-goal": "quest admin remove goal",
	"complete-goal": "quest admin complete goal",
	leads: "quest admin partner leads",
	"reject-lead": "quest admin reject partner lead",
	"onboard-lead": "quest admin onboard partner lead",
} as const;

export type QuestAdminAction = keyof typeof QUEST_ADMIN_ACTIONS;

export const isQuestAdminAction = (value: unknown): value is QuestAdminAction =>
	typeof value === "string" && Object.hasOwn(QUEST_ADMIN_ACTIONS, value);

/** The weekly quest metrics the engine can measure (quest-calendar.mjs WEEKLY_METRICS), with plain labels. */
export const QUEST_METRICS = [
	{ key: "qualifyingSwaps", label: "Qualifying swaps" },
	{ key: "activeTradingDays", label: "Active trading days" },
	{ key: "swapVolumeUsd", label: "Swap volume (whole dollars)" },
	{ key: "distinctPoolsTraded", label: "Different pools swapped in" },
	{ key: "featuredPoolsJoined", label: "Featured pools joined" },
	{ key: "lpInRangeHours", label: "Hours in range (featured pools)" },
	{ key: "qualifiedTraderReferrals", label: "Qualified trader referrals" },
	{ key: "qualifiedLpReferrals", label: "Qualified LP referrals" },
] as const;

export type QuestTemplate = {
	id: string;
	title: string;
	flavorText: string;
	description: string;
	metric: (typeof QUEST_METRICS)[number]["key"];
	target: number;
	testXp: number;
};

export type QuestPlan = {
	schemaVersion: 1;
	network: "DEVNET";
	fixtureKind: "SYNTHETIC_DEVNET";
	campaignId: string;
	timezone: "UTC";
	startsOn: string;
	weekCount: number;
	templates: QuestTemplate[];
	weeks: { startsOn: string; questIds: string[] }[];
	communityGoals: unknown[];
};

export type QuestManualGoal = {
	goalId: string;
	title: string;
	flavorText: string;
	startsAt: string;
	endsAt: string;
	xpEach: number;
	revision: number;
	status: "UPCOMING" | "ACTIVE" | "EXPIRED" | "COMPLETED";
	completedAt: string | null;
	recipients: number | null;
	note: string | null;
};

export type QuestAdminOverview = {
	campaignId: string;
	plan: { plan: QuestPlan; revision: number; planSha256: string } | null;
	goals: QuestManualGoal[];
};

export type PartnerLead = {
	leadId: number;
	partnerName: string;
	partnerUrl: string;
	note: string | null;
	partnerKey: string;
	status: "SUBMITTED" | "REJECTED" | "ONBOARDED";
	adminNote: string | null;
	decidedAt: string | null;
	submittedAt: string;
	passportId: string;
	scoutWallet: string | null;
};

export const QUEST_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
