/** Pure projection over metrics produced by trusted Genesis indexing and review. */

export type QuestMetric =
	| "first_swap"
	| "active_trading_days"
	| "qualifying_lp_seconds"
	| "featured_pools_joined"
	| "qualified_trader_referrals"
	| "qualified_lp_referrals"
	| "manual";
export type QuestCategory =
	| "Featured"
	| "Trading"
	| "Liquidity"
	| "Community"
	| "Referral";
export type QuestVerification = "indexed" | "derived" | "manual";
export type QuestStatus = "pending" | "in_progress" | "provisional";

export type QuestRule = {
	slug: string;
	category: QuestCategory;
	verification: QuestVerification;
	enabled: boolean;
	metric: QuestMetric;
	target: bigint;
	xp: bigint;
};
export type QuestRuleRevision = {
	schemaVersion: 1;
	campaignId: string;
	revision: number;
	quests: readonly QuestRule[];
};
export type TrustedQuestMetrics = {
	qualifyingSwaps: number;
	activeTradingDays: number;
	qualifyingLpSeconds: bigint;
	lpUsdCentSeconds: bigint;
	featuredPoolsJoined: number;
	qualifiedTraderReferrals: number;
	qualifiedLpReferrals: number;
};
export type QuestProgress = {
	slug: string;
	progressValue: bigint;
	progressTarget: bigint;
	status: QuestStatus;
	provisionalXp: bigint;
};

const MAX_BIGINT = BigInt("9223372036854775807");
const CATEGORIES = new Set<QuestCategory>([
	"Featured",
	"Trading",
	"Liquidity",
	"Community",
	"Referral",
]);
const VERIFICATIONS = new Set<QuestVerification>([
	"indexed",
	"derived",
	"manual",
]);
const METRIC_CATEGORY: Record<QuestMetric, QuestCategory> = {
	first_swap: "Trading",
	active_trading_days: "Trading",
	qualifying_lp_seconds: "Liquidity",
	featured_pools_joined: "Liquidity",
	qualified_trader_referrals: "Referral",
	qualified_lp_referrals: "Referral",
	manual: "Community",
};

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("Genesis quest rules must be objects.");
	return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0)
		throw new TypeError(`${label} must be a positive safe integer.`);
	return value as number;
}

function rawUnits(value: unknown, label: string, allowZero: boolean): bigint {
	if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value))
		throw new TypeError(
			`${label} must be a canonical non-negative integer string.`,
		);
	const parsed = BigInt(value);
	if (parsed > MAX_BIGINT || (!allowZero && parsed === BigInt(0)))
		throw new RangeError(`${label} is outside the supported range.`);
	return parsed;
}

/** Strict versioned validation before any rule revision is used for projection. */
export function validateQuestRuleRevision(value: unknown): QuestRuleRevision {
	const raw = object(value);
	if (raw.schemaVersion !== 1 || !Array.isArray(raw.quests))
		throw new TypeError("Unsupported Genesis quest rule schema.");
	if (typeof raw.campaignId !== "string" || !raw.campaignId)
		throw new TypeError("Genesis quest rule campaign is missing.");
	const revision = positiveInteger(raw.revision, "Rule revision");
	const seen = new Set<string>();
	const quests = raw.quests.map((item): QuestRule => {
		const rule = object(item);
		if (
			typeof rule.slug !== "string" ||
			!/^[a-z][a-z0-9_-]{0,63}$/.test(rule.slug) ||
			seen.has(rule.slug)
		)
			throw new TypeError("Invalid or repeated Genesis quest slug.");
		seen.add(rule.slug);
		if (
			!CATEGORIES.has(rule.category as QuestCategory) ||
			!VERIFICATIONS.has(rule.verification as QuestVerification) ||
			typeof rule.enabled !== "boolean" ||
			!Object.hasOwn(METRIC_CATEGORY, rule.metric as PropertyKey)
		)
			throw new TypeError(
				"Invalid Genesis quest category, verification or metric.",
			);
		const metric = rule.metric as QuestMetric;
		const category = rule.category as QuestCategory;
		const verification = rule.verification as QuestVerification;
		if (
			category !== METRIC_CATEGORY[metric] ||
			(verification === "manual") !== (metric === "manual")
		)
			throw new TypeError("Genesis quest metric and verification disagree.");
		const target = rawUnits(rule.target, "Quest target", false);
		const xp = rawUnits(rule.xp, "Quest XP", true);
		if (
			(metric === "first_swap" || metric === "manual") &&
			target !== BigInt(1)
		)
			throw new TypeError(
				"First-swap and manual quests have a single completion target.",
			);
		return {
			slug: rule.slug,
			category,
			verification,
			enabled: rule.enabled,
			metric,
			target,
			xp,
		};
	});
	return { schemaVersion: 1, campaignId: raw.campaignId, revision, quests };
}

function assertMetrics(metrics: TrustedQuestMetrics) {
	for (const [label, value] of Object.entries(metrics)) {
		if (typeof value === "bigint") {
			if (value < BigInt(0))
				throw new RangeError(`${label} cannot be negative.`);
		} else if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError(`${label} must be a non-negative safe integer.`);
		}
	}
}

/** Manual quests are excluded so rebuilding automatic progress cannot overwrite review decisions. */
export function projectQuestProgress(input: {
	campaignId: string;
	rules: QuestRuleRevision;
	wallet: string;
	computedThroughSlot: number;
	metrics: TrustedQuestMetrics;
}) {
	const { campaignId, rules, wallet, computedThroughSlot, metrics } = input;
	if (
		!campaignId ||
		campaignId !== rules.campaignId ||
		!wallet ||
		!Number.isSafeInteger(computedThroughSlot) ||
		computedThroughSlot < 0
	)
		throw new TypeError("Invalid Genesis projection identity or watermark.");
	assertMetrics(metrics);
	if (
		metrics.activeTradingDays > metrics.qualifyingSwaps ||
		(metrics.qualifyingLpSeconds === BigInt(0) &&
			metrics.lpUsdCentSeconds !== BigInt(0))
	)
		throw new Error("Genesis quest metrics disagree with verified activity.");
	const values: Record<Exclude<QuestMetric, "manual">, bigint> = {
		first_swap: metrics.qualifyingSwaps > 0 ? BigInt(1) : BigInt(0),
		active_trading_days: BigInt(metrics.activeTradingDays),
		qualifying_lp_seconds: metrics.qualifyingLpSeconds,
		featured_pools_joined: BigInt(metrics.featuredPoolsJoined),
		qualified_trader_referrals: BigInt(metrics.qualifiedTraderReferrals),
		qualified_lp_referrals: BigInt(metrics.qualifiedLpReferrals),
	};
	const quests: QuestProgress[] = [];
	let provisionalXp = BigInt(0);
	for (const rule of rules.quests) {
		if (!rule.enabled || rule.metric === "manual") continue;
		const progressValue =
			values[rule.metric] < rule.target ? values[rule.metric] : rule.target;
		const status: QuestStatus =
			progressValue === BigInt(0)
				? "pending"
				: progressValue === rule.target
					? "provisional"
					: "in_progress";
		const xp = status === "provisional" ? rule.xp : BigInt(0);
		provisionalXp += xp;
		if (provisionalXp > MAX_BIGINT)
			throw new RangeError(
				"Genesis provisional XP exceeds the database range.",
			);
		quests.push({
			slug: rule.slug,
			progressValue,
			progressTarget: rule.target,
			status,
			provisionalXp: xp,
		});
	}
	return {
		campaignId,
		wallet,
		ruleRevision: rules.revision,
		computedThroughSlot,
		qualifyingSwaps: metrics.qualifyingSwaps,
		activeTradingDays: metrics.activeTradingDays,
		lpUsdCentSeconds: metrics.lpUsdCentSeconds,
		provisionalXp,
		quests,
	};
}
