// The Quest emergency stops an admin can move. The keys must match quest.pause_switches (migrations 022 and 024).
// Every change is a signed admin action and is recorded in the Quest database's append-only pause audit.
export const QUEST_PAUSES_READ_ACTION = "read quest pauses";
export const QUEST_PAUSE_SET_ACTION = "set quest pause";

export const QUEST_PAUSE_SWITCHES = [
	{
		key: "weekly-xp",
		label: "Weekly quest XP",
		pauses: "New weekly quest completions stop earning XP.",
		resumes: "Completed quests are awarded once released; nothing is lost.",
	},
	{
		key: "voting-xp",
		label: "Voting XP",
		pauses:
			"Governance XP and Levels are not awarded. Votes keep being recorded.",
		resumes: "Ended epochs are awarded once released.",
	},
	{
		key: "onboarding-xp",
		label: "Onboarding XP",
		pauses: "Connect-wallet and Pass-mint XP is held back.",
		resumes: "Held-back awards are made once released.",
	},
	{
		key: "referrals",
		label: "Referrals",
		pauses: "Referral codes cannot be redeemed.",
		resumes: "Redeeming works again.",
	},
	{
		key: "pass-mint",
		label: "New Pass mints",
		pauses:
			"New Pass reservations are refused. Mints already reserved can still finish.",
		resumes: "New Pass mints are accepted again.",
	},
	{
		key: "community-xp",
		label: "Community goal XP",
		pauses:
			"Completing a monthly community goal is refused, so no one is paid.",
		resumes: "Completion works again; nothing was lost.",
	},
] as const;

export type QuestPauseKey = (typeof QUEST_PAUSE_SWITCHES)[number]["key"];

export type QuestPauseEntry = {
	paused: boolean;
	reason: string | null;
	changedBy: string | null;
	changedAt: string | null;
};

export type QuestPauseStatus = Partial<Record<QuestPauseKey, QuestPauseEntry>>;

export const isQuestPauseKey = (value: unknown): value is QuestPauseKey =>
	QUEST_PAUSE_SWITCHES.some((entry) => entry.key === value);

export const QUEST_PAUSE_REASON_MAX = 200;

/** The payload an admin signs. A release carries an empty reason so the signed bytes are unambiguous. */
export const questPauseSetPayload = (
	key: QuestPauseKey,
	paused: boolean,
	reason: string,
) => ({ key, paused, reason: paused ? reason.trim() : "" });
