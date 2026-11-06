import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { assertPassportId } from "./passport-id.mjs";

export const WEEKLY_METRICS = Object.freeze([
	"qualifyingSwaps",
	"activeTradingDays",
	"featuredPoolsJoined",
	"qualifiedTraderReferrals",
	"qualifiedLpReferrals",
	// Added for the first-year plan: whole dollars of qualifying swap value, distinct pools swapped in, and
	// whole hours a position spent earning (in range) in featured pools, all inside the epoch.
	"swapVolumeUsd",
	"distinctPoolsTraded",
	"lpInRangeHours",
]);
export function calendarFail(message) {
	throw new Error(`Quest calendar: ${message}`);
}
const fail = calendarFail;
export function calendarHash(value) {
	const canonical = (v) => {
		if (v === null || typeof v === "string" || typeof v === "boolean") return v;
		if (typeof v === "number" && Number.isSafeInteger(v)) return v;
		if (Array.isArray(v)) return v.map(canonical);
		if (v && Object.getPrototypeOf(v) === Object.prototype)
			return Object.fromEntries(
				Object.keys(v)
					.sort()
					.map((k) => [k, canonical(v[k])]),
			);
		fail("noncanonical JSON");
	};
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
}
function exact(v, keys) {
	if (
		!v ||
		Object.getPrototypeOf(v) !== Object.prototype ||
		Object.keys(v).sort().join("|") !== keys.split(" ").sort().join("|")
	)
		fail("unexpected fields");
}
function text(v, max = 256) {
	if (
		typeof v !== "string" ||
		!v.trim() ||
		v.length > max ||
		[...v].some((c) => c.charCodeAt(0) < 32)
	)
		fail("invalid text");
	return v;
}
function id(v) {
	if (typeof v !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(v))
		fail("invalid identifier");
	return v;
}
function integer(v, min, max) {
	if (!Number.isSafeInteger(v) || v < min || v > max) fail("invalid integer");
	return v;
}
export function calendarTime(v) {
	if (!Number.isSafeInteger(v) || v < 0 || v > 8640000000000000)
		fail("invalid clock");
	return v;
}
function date(v) {
	if (
		typeof v !== "string" ||
		!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
		!Number.isFinite(Date.parse(`${v}T00:00:00.000Z`)) ||
		new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) !== v
	)
		fail("invalid date");
	return v;
}
export function calendarIso(v) {
	if (
		typeof v !== "string" ||
		!Number.isFinite(Date.parse(v)) ||
		new Date(v).toISOString() !== v
	)
		fail("canonical millisecond timestamp required");
	calendarTime(Date.parse(v));
	return v;
}
function zone(v) {
	if (v !== "UTC") fail("epoch resets require UTC");
	return v;
}
function key(v) {
	try {
		if (
			typeof v !== "string" ||
			v.length < 32 ||
			v.length > 44 ||
			new PublicKey(v).toBase58() !== v
		)
			fail("invalid pool");
		return v;
	} catch {
		fail("invalid pool");
	}
}
const addDays = (v, n) =>
	new Date(Date.parse(`${date(v)}T00:00:00.000Z`) + n * 86400000)
		.toISOString()
		.slice(0, 10);
export function localMidnight(startsOn, timezone) {
	date(startsOn);
	zone(timezone);
	return `${startsOn}T00:00:00.000Z`;
}
export function compileQuestCalendar(plan) {
	exact(
		plan,
		"schemaVersion network fixtureKind campaignId timezone startsOn weekCount templates weeks communityGoals",
	);
	if (
		plan.schemaVersion !== 1 ||
		plan.network !== "DEVNET" ||
		plan.fixtureKind !== "SYNTHETIC_DEVNET"
	)
		fail("explicit synthetic Devnet plan required");
	id(plan.campaignId);
	zone(plan.timezone);
	date(plan.startsOn);
	integer(plan.weekCount, 1, 54);
	if (new Date(`${plan.startsOn}T00:00:00.000Z`).getUTCDay() !== 4)
		fail("weekly reset must begin on Thursday 00:00 UTC");
	if (
		!Array.isArray(plan.templates) ||
		plan.templates.length < 3 ||
		plan.templates.length > 200 ||
		!Array.isArray(plan.weeks) ||
		plan.weeks.length !== plan.weekCount ||
		!Array.isArray(plan.communityGoals) ||
		plan.communityGoals.length > 16
	)
		fail("bounded complete schedule required");
	const templates = new Map();
	for (const t of plan.templates) {
		exact(t, "id title flavorText description metric target testXp");
		id(t.id);
		text(t.title, 100);
		text(t.flavorText, 300);
		text(t.description, 500);
		if (!WEEKLY_METRICS.includes(t.metric) || templates.has(t.id))
			fail("unknown metric or duplicate template");
		integer(t.target, 1, 1000000);
		integer(t.testXp, 1, 1000000);
		templates.set(t.id, structuredClone(t));
	}
	const weeks = plan.weeks.map((w, index) => {
		exact(w, "startsOn questIds");
		const startsOn = addDays(plan.startsOn, index * 7);
		if (
			w.startsOn !== startsOn ||
			!Array.isArray(w.questIds) ||
			w.questIds.length !== 3 ||
			new Set(w.questIds).size !== 3
		)
			fail("exactly three unique quests per contiguous week required");
		const startsAt = localMidnight(startsOn, plan.timezone),
			endsAt = localMidnight(addDays(startsOn, 7), plan.timezone);
		const quests = w.questIds.map((questId, slot) => {
			const t = templates.get(questId);
			if (!t) fail("unknown quest template");
			return {
				...t,
				slot,
				instanceKey: calendarHash(["weekly", plan.campaignId, startsAt, slot]),
			};
		});
		const set = {
			schemaVersion: 1,
			network: "DEVNET",
			fixtureKind: "SYNTHETIC_DEVNET",
			campaignId: plan.campaignId,
			timezone: plan.timezone,
			startsOn,
			startsAt,
			endsAt,
			quests,
		};
		return { ...set, setSha256: calendarHash(set) };
	});
	const seen = new Set();
	const goals = plan.communityGoals.map((g) => {
		exact(
			g,
			"id title flavorText startsAt endsAt targetUsdCents testXp audience poolAddresses valuationVersion maxAgeSeconds",
		);
		id(g.id);
		text(g.title, 100);
		text(g.flavorText, 300);
		id(g.valuationVersion);
		integer(g.testXp, 1, 1000000);
		integer(g.maxAgeSeconds, 1, 86400);
		const goalStart = Date.parse(calendarIso(g.startsAt)),
			goalEnd = Date.parse(calendarIso(g.endsAt));
		if (goalStart >= goalEnd || goalEnd - goalStart > 366 * 86400000)
			fail("bounded independent community window required");
		if (
			seen.has(g.id) ||
			g.audience !== "PASSPORTS_AT_MILESTONE" ||
			typeof g.targetUsdCents !== "string" ||
			!/^[1-9][0-9]{0,37}$/.test(g.targetUsdCents) ||
			!Array.isArray(g.poolAddresses) ||
			g.poolAddresses.length < 1 ||
			g.poolAddresses.length > 256
		)
			fail("invalid community goal");
		seen.add(g.id);
		const poolAddresses = g.poolAddresses.map(key).sort();
		if (new Set(poolAddresses).size !== poolAddresses.length)
			fail("duplicate pool");
		const goal = { ...structuredClone(g), poolAddresses };
		return { ...goal, goalSha256: calendarHash(goal) };
	});
	return {
		schemaVersion: 1,
		network: "DEVNET",
		fixtureKind: "SYNTHETIC_DEVNET",
		campaignId: plan.campaignId,
		timezone: plan.timezone,
		startsAt: weeks[0].startsAt,
		endsAt: weeks.at(-1).endsAt,
		weekCount: plan.weekCount,
		weeks,
		goals,
	};
}
export function verifyWeeklySet(set) {
	const { setSha256, ...body } = set;
	exact(
		body,
		"schemaVersion network fixtureKind campaignId timezone startsOn startsAt endsAt quests",
	);
	const templates = body.quests.map(({ slot, instanceKey, ...t }) => t);
	const compiled = compileQuestCalendar({
		schemaVersion: 1,
		network: body.network,
		fixtureKind: body.fixtureKind,
		campaignId: body.campaignId,
		timezone: body.timezone,
		startsOn: body.startsOn,
		weekCount: 1,
		templates,
		weeks: [{ startsOn: body.startsOn, questIds: templates.map((t) => t.id) }],
		communityGoals: [],
	}).weeks[0];
	if (
		setSha256 !== calendarHash(body) ||
		calendarHash(set) !== calendarHash(compiled)
	)
		fail("stored weekly set differs");
	return compiled;
}
export function previewWeeklyQuests({ set, nowMs, facts }) {
	set = verifyWeeklySet(set);
	calendarTime(nowMs);
	const start = Date.parse(set.startsAt),
		end = Date.parse(set.endsAt),
		active = nowMs >= start && nowMs < end;
	let metrics = null;
	if (active && facts) {
		exact(
			facts,
			"network fixtureKind passportId startsAt endsAt computedAt metrics",
		);
		assertPassportId(facts.passportId);
		if (
			facts.network !== "DEVNET" ||
			facts.fixtureKind !== "SYNTHETIC_DEVNET" ||
			facts.startsAt !== set.startsAt ||
			facts.endsAt !== set.endsAt ||
			Date.parse(calendarIso(facts.computedAt)) < start ||
			Date.parse(facts.computedAt) > nowMs
		)
			fail("period-scoped fixture facts required");
		exact(facts.metrics, WEEKLY_METRICS.join(" "));
		for (const v of Object.values(facts.metrics))
			if (v !== null) integer(v, 0, 1000000);
		metrics = facts.metrics;
	}
	return {
		state: active ? "ACTIVE" : nowMs < start ? "SCHEDULED" : "EXPIRED",
		awardEligible: false,
		fixtureKind: "SYNTHETIC_DEVNET",
		startsAt: set.startsAt,
		expiresAt: set.endsAt,
		quests: set.quests.map((q) => {
			const progress = metrics?.[q.metric] ?? null;
			return {
				...q,
				progress: active && progress !== null ? Math.min(progress, q.target) : null,
				status: !active
					? nowMs < start
						? "SCHEDULED"
						: "EXPIRED"
					: progress === null
						? "UNAVAILABLE"
						: progress >= q.target
							? "PROVISIONAL_COMPLETE"
							: progress === 0
								? "NOT_STARTED"
								: "IN_PROGRESS",
			};
		}),
	};
}
export function verifyCommunityProof({ goal, proof, manifestSha256, nowMs }) {
	const { goalSha256, ...g } = goal;
	if (goalSha256 !== calendarHash(g)) fail("goal hash differs");
	exact(
		g,
		"id title flavorText startsAt endsAt targetUsdCents testXp audience poolAddresses valuationVersion maxAgeSeconds",
	);
	id(g.id);
	id(g.valuationVersion);
	text(g.title, 100);
	text(g.flavorText, 300);
	integer(g.testXp, 1, 1000000);
	integer(g.maxAgeSeconds, 1, 86400);
	const goalStart = Date.parse(calendarIso(g.startsAt)),
		goalEnd = Date.parse(calendarIso(g.endsAt));
	if (
		goalStart >= goalEnd ||
		goalEnd - goalStart > 366 * 86400000 ||
		g.audience !== "PASSPORTS_AT_MILESTONE" ||
		typeof g.targetUsdCents !== "string" ||
		!/^[1-9][0-9]{0,37}$/.test(g.targetUsdCents) ||
		!Array.isArray(g.poolAddresses) ||
		g.poolAddresses.length < 1 ||
		g.poolAddresses.length > 256 ||
		new Set(g.poolAddresses.map(key)).size !== g.poolAddresses.length ||
		g.poolAddresses.join("|") !== [...g.poolAddresses].sort().join("|")
	)
		fail("invalid community goal");
	if (
		typeof manifestSha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(manifestSha256)
	)
		fail("pinned manifest required");
	exact(
		proof,
		"schemaVersion network fixtureKind manifestSha256 valuationVersion observedAt sourceKey pools",
	);
	if (
		proof.schemaVersion !== 1 ||
		proof.network !== "DEVNET" ||
		proof.fixtureKind !== "SYNTHETIC_DEVNET" ||
		proof.manifestSha256 !== manifestSha256 ||
		proof.valuationVersion !== goal.valuationVersion ||
		!Array.isArray(proof.pools) ||
		proof.pools.length !== goal.poolAddresses.length
	)
		fail("complete pinned synthetic TVL proof required");
	text(proof.sourceKey, 128);
	const observed = Date.parse(calendarIso(proof.observedAt));
	calendarTime(nowMs);
	if (observed > nowMs || nowMs - observed > goal.maxAgeSeconds * 1000)
		fail("future or stale TVL proof");
	if (
		observed < goalStart ||
		observed >= goalEnd ||
		nowMs < goalStart ||
		nowMs >= goalEnd
	)
		fail("community goal is outside its active window");
	const pools = proof.pools
		.map((p) => {
			exact(p, "poolAddress tvlUsdCents");
			key(p.poolAddress);
			if (
				typeof p.tvlUsdCents !== "string" ||
				!/^(0|[1-9][0-9]{0,37})$/.test(p.tvlUsdCents)
			)
				fail("invalid TVL cents");
			return { ...p };
		})
		.sort((a, b) => a.poolAddress.localeCompare(b.poolAddress, "en"));
	if (
		new Set(pools.map((p) => p.poolAddress)).size !== pools.length ||
		pools
			.map((p) => p.poolAddress)
			.sort()
			.join("|") !== goal.poolAddresses.join("|")
	)
		fail("pool scope incomplete or duplicated");
	const total = pools.reduce((sum, p) => sum + BigInt(p.tvlUsdCents), 0n);
	if (total >= 10n ** 38n) fail("TVL total overflow");
	const normalized = { ...structuredClone(proof), pools };
	return {
		proof: normalized,
		proofSha256: calendarHash(normalized),
		observedTvlUsdCents: total.toString(),
		reached: total >= BigInt(goal.targetUsdCents),
		progressBasisPoints: Number(
			(total * 10000n) / BigInt(goal.targetUsdCents) > 10000n
				? 10000n
				: (total * 10000n) / BigInt(goal.targetUsdCents),
		),
		awardEligible: false,
	};
}
export function communityEntitlementKey(campaignId, goalId, passportId) {
	id(campaignId);
	id(goalId);
	assertPassportId(passportId);
	return calendarHash(["community", campaignId, goalId, passportId]);
}

// Retain every already-started occurrence, including expired history. Shared
// template edits are checked through their compiled occurrences, not just IDs.
export function validateCalendarRevision({ previous, next, nowMs }) {
	calendarTime(nowMs);
	const before = compileQuestCalendar(previous),
		after = compileQuestCalendar(next);
	if (
		before.campaignId !== after.campaignId ||
		before.startsAt !== after.startsAt ||
		before.endsAt !== after.endsAt ||
		before.weekCount !== after.weekCount
	)
		fail("revision cannot change campaign or horizon");
	for (let i = 0; i < before.weeks.length; i++)
		if (
			Date.parse(before.weeks[i].startsAt) <= nowMs &&
			calendarHash(before.weeks[i]) !== calendarHash(after.weeks[i])
		)
			fail("started weekly quests cannot be changed");
	const oldGoals = new Map(before.goals.map((g) => [g.id, g])),
		newGoals = new Map(after.goals.map((g) => [g.id, g]));
	for (const g of before.goals)
		if (
			Date.parse(g.startsAt) <= nowMs &&
			calendarHash(g) !== calendarHash(newGoals.get(g.id) ?? null)
		)
			fail("started community goals cannot be changed");
	for (const g of after.goals)
		if (
			Date.parse(g.startsAt) <= nowMs &&
			(!oldGoals.has(g.id) || Date.parse(oldGoals.get(g.id).startsAt) > nowMs)
		)
			fail("retroactive community goal forbidden");
	return after;
}

// This snapshot computes rotation without a cron job. No XP ledger writes occur.
export function previewQuestCalendar({ plan, nowMs, facts = null }) {
	const calendar = compileQuestCalendar(plan);
	calendarTime(nowMs);
	const set = calendar.weeks.find(
		(w) => Date.parse(w.startsAt) <= nowMs && nowMs < Date.parse(w.endsAt),
	);
	return {
		campaignId: calendar.campaignId,
		fixtureKind: "SYNTHETIC_DEVNET",
		awardEligible: false,
		weekly: set ? previewWeeklyQuests({ set, nowMs, facts }) : null,
		communityGoals: calendar.goals.map((g) => ({
			...g,
			state:
				nowMs < Date.parse(g.startsAt)
					? "SCHEDULED"
					: nowMs >= Date.parse(g.endsAt)
						? "EXPIRED"
						: "ACTIVE",
		})),
	};
}

// Capture an entire synthetic audience atomically in memory. Persistence must
// enforce a unique campaign/goal occurrence and preserve this first receipt.
export function previewCommunityEntitlements({
	campaignId,
	goal,
	proof,
	manifestSha256,
	nowMs,
	passports,
}) {
	id(campaignId);
	const checked = verifyCommunityProof({ goal, proof, manifestSha256, nowMs });
	if (!Array.isArray(passports) || passports.length > 20000)
		fail("complete bounded audience required");
	const seen = new Set();
	const audience = passports
		.map((p) => {
			exact(p, "passportId createdAt");
			assertPassportId(p.passportId);
			calendarIso(p.createdAt);
			if (seen.has(p.passportId)) fail("duplicate Passport");
			seen.add(p.passportId);
			return { ...p };
		})
		.filter((p) => Date.parse(p.createdAt) <= Date.parse(proof.observedAt))
		.sort((a, b) =>
			a.passportId < b.passportId ? -1 : a.passportId > b.passportId ? 1 : 0,
		);
	return {
		...checked,
		campaignId,
		goalId: goal.id,
		goalSha256: goal.goalSha256,
		audienceCutoff: proof.observedAt,
		entitlements: checked.reached
			? audience.map((p) => ({
					passportId: p.passportId,
					entitlementKey: communityEntitlementKey(
						campaignId,
						goal.id,
						p.passportId,
					),
					testXp: goal.testXp,
					state: "PENDING_TEST_ONLY",
				}))
			: [],
	};
}
