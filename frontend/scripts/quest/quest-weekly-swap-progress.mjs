import { assertPassportId } from "./passport-id.mjs";
import { createPassportSwapQualificationReader } from "./passport-snapshot-reader.mjs";
import {
	calendarFail,
	calendarHash,
	calendarIso,
	calendarTime,
	verifyWeeklySet,
	WEEKLY_METRICS,
} from "./quest-calendar.mjs";

function exact(v, keys) {
	if (
		!v ||
		Object.getPrototypeOf(v) !== Object.prototype ||
		Object.keys(v).sort().join("|") !== keys.split(" ").sort().join("|")
	)
		calendarFail("invalid qualified progress schema");
}
function integer(v) {
	if (!Number.isSafeInteger(v) || v < 0 || v > 8640000000000000)
		calendarFail("invalid progress integer");
	return v;
}

/**
 * Featured pools this Passport held a qualifying position in during the epoch, and the whole hours it spent in them
 * (in range when the LP policy is range-aware); null when the LP source is unavailable.
 */
function projectLpJoined({ lp, passportId, startMs, endMs, nowMs, captured, maxAgeMs }) {
	if (lp === null) return null;
	// Liquidity transactions cannot prove ownership between transactions. Never award
	// LP or LP-referral progress from that preview; NFT transfers require coverage.
	if (lp.ownershipCoverage === "TRANSACTION_ONLY") return null;
	exact(
		lp,
		"state awardEligible ownershipCoverage capturedAtMs minimumLpUsdCents minimumDwellMs featuredPools passports" +
			(Object.hasOwn(lp,"ownershipProof") ? " ownershipProof" : ""),
	);
	if (
		lp.state !== "SYNTHETIC_DEVNET_LP_QUALIFICATION" ||
		lp.awardEligible !== false ||
		lp.ownershipCoverage !== "HISTORICAL_COVERAGE" ||
		!Number.isSafeInteger(lp.capturedAtMs) ||
		lp.capturedAtMs > captured ||
		nowMs - lp.capturedAtMs > maxAgeMs ||
		!/^[1-9][0-9]{0,37}$/.test(lp.minimumLpUsdCents) ||
		!Number.isSafeInteger(lp.minimumDwellMs) ||
		lp.minimumDwellMs < 0 ||
		!Array.isArray(lp.featuredPools) ||
		!Array.isArray(lp.passports) ||
		lp.passports.length > 20000
	)
		calendarFail("invalid or stale LP qualification");
	const featured = new Set(lp.featuredPools);
	const windowEnd = Math.min(endMs, nowMs, lp.capturedAtMs);
	const heldMs = new Map(); // pool -> qualifying milliseconds inside this epoch for the asked Passport
	const elapsedIntervals = [];
	const seen = new Set();
	for (const row of lp.passports) {
		exact(row, "passportId pools");
		assertPassportId(row.passportId);
		if (seen.has(row.passportId) || !Array.isArray(row.pools))
			calendarFail("duplicate or malformed LP Passport row");
		seen.add(row.passportId);
		const seenPools = new Set();
		for (const pool of row.pools) {
			exact(pool, "poolAddress intervals");
			if (!featured.has(pool.poolAddress) || !Array.isArray(pool.intervals) || seenPools.has(pool.poolAddress))
				calendarFail("LP pool is not a featured pool");
			seenPools.add(pool.poolAddress);
			let previousEnd = -1;
			for (const interval of pool.intervals) {
				if (
					!Array.isArray(interval) ||
					interval.length !== 2 ||
					!interval.every((v) => Number.isSafeInteger(v) && v >= 0) ||
					interval[0] >= interval[1] ||
					interval[1] > lp.capturedAtMs || interval[0] < previousEnd
				)
					calendarFail("invalid LP interval");
				previousEnd = interval[1];
				if (row.passportId === passportId) {
					const overlap = Math.min(interval[1], windowEnd) - Math.max(interval[0], startMs);
					if (overlap > 0) {
						heldMs.set(pool.poolAddress, (heldMs.get(pool.poolAddress) ?? 0) + overlap);
						elapsedIntervals.push([Math.max(interval[0], startMs), Math.min(interval[1], windowEnd)]);
					}
				}
			}
		}
	}
	// Time-weighted: only pools held long enough this epoch count (and zero dwell means any overlap).
	const merged = [];
	for (const [start, end] of elapsedIntervals.sort((a,b) => a[0]-b[0])) {
		const last = merged.at(-1);
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else merged.push([start,end]);
	}
	return {
		joined: [...heldMs.values()].filter((ms) => ms >= Math.max(lp.minimumDwellMs, 1)).length,
		hours: Math.floor(merged.reduce((sum,[a,b]) => sum+b-a, 0) / 3_600_000),
	};
}

/** Qualifying pools (held at least the dwell) for one Passport inside [fromMs, toMs); assumes `lp` was validated. */
function lpQualifiedPools(lp, passportId, fromMs, toMs) {
	const held = new Map();
	for (const row of lp.passports) {
		if (row.passportId !== passportId) continue;
		for (const pool of row.pools)
			for (const [a, b] of pool.intervals) {
				const overlap = Math.min(b, toMs, lp.capturedAtMs) - Math.max(a, fromMs);
				if (overlap > 0) held.set(pool.poolAddress, (held.get(pool.poolAddress) ?? 0) + overlap);
			}
	}
	return [...held.values()].filter((ms) => ms >= Math.max(lp.minimumDwellMs, 1)).length;
}

/**
 * Qualified referrals for the asked Passport: friends who redeemed its code and, AFTER redeeming and inside
 * this epoch, made a qualifying swap (trader) or held a qualifying featured-pool position (liquidity).
 * `referrals` null means that source was unavailable; `lp` null/absent keeps the liquidity count null.
 */
function projectReferralMetrics({ referrals, passports, lp, passportId, startMs, endMs, nowMs, captured }) {
	if (referrals === null) return { trader: null, liquidity: null };
	if (!Array.isArray(referrals) || referrals.length > 20000)
		calendarFail("bounded referral list required");
	const referred = new Set();
	for (const row of referrals) {
		exact(row, "referrerPassportId referredPassportId createdAtMs");
		assertPassportId(row.referrerPassportId);
		assertPassportId(row.referredPassportId);
		if (
			row.referrerPassportId === row.referredPassportId ||
			referred.has(row.referredPassportId) ||
			!Number.isSafeInteger(row.createdAtMs) ||
			row.createdAtMs < 0 ||
			row.createdAtMs > captured
		)
			calendarFail("invalid referral row");
		referred.add(row.referredPassportId);
	}
	const windowEnd = Math.min(endMs, nowMs);
	const actionsOf = new Map(passports.map((row) => [row.passportId, row.actions]));
	let trader = 0;
	let liquidity = lp ? 0 : null;
	for (const row of referrals) {
		if (row.referrerPassportId !== passportId) continue;
		const from = Math.max(startMs, row.createdAtMs);
		if (
			(actionsOf.get(row.referredPassportId) ?? []).some((action) => {
				const t = action.occurredAtSeconds * 1000;
				return t >= from && t < windowEnd;
			})
		)
			trader++;
		if (lp && lpQualifiedPools(lp, row.referredPassportId, from, windowEnd) >= 1) liquidity++;
	}
	return { trader, liquidity };
}

/** Consume a checked historical qualification projection; never browser
 * assertions. Unsupported metrics remain null rather than fabricated zero. */
export function projectWeeklySwapProgress({
	set,
	passportId,
	qualification,
	sourcePins,
	nowMs,
	maxAgeMs = 300000,
}) {
	set = verifyWeeklySet(set);
	assertPassportId(passportId);
	calendarTime(nowMs);
	if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 300000)
		calendarFail("invalid progress freshness limit");
	// `lp` is optional: present only when the reader was configured with an LP policy. null means the
	// LP source was unavailable (the metric then stays null, never zero).
	exact(
		qualification,
		`state awardEligible network campaignId decoderVersion computedThroughSlot policyRevision passports sourceContext${
			Object.hasOwn(qualification ?? {}, "lp") ? " lp" : ""
		}${Object.hasOwn(qualification ?? {}, "referrals") ? " referrals" : ""}`,
	);
	const q = qualification,
		c = q.sourceContext;
	exact(
		c,
		"network environmentId manifestSha256 programId campaignId decoderVersion startSlot computedThroughSlot nextSlot reconciledThroughSlot startsAtSeconds endsAtSeconds capturedAt",
	);
	if (
		q.state !== "SYNTHETIC_DEVNET_SWAP_QUALIFICATION" ||
		q.awardEligible !== false ||
		q.network !== "DEVNET" ||
		c.network !== "DEVNET" ||
		q.campaignId !== sourcePins.campaignId ||
		q.decoderVersion !== sourcePins.decoderVersion ||
		c.campaignId !== q.campaignId ||
		c.decoderVersion !== q.decoderVersion ||
		c.programId !== sourcePins.programId ||
		c.environmentId !== sourcePins.environmentId ||
		c.manifestSha256 !== sourcePins.manifestSha256 ||
		c.startSlot !== sourcePins.startSlot ||
		q.policyRevision !== sourcePins.policyRevision ||
		c.computedThroughSlot !== q.computedThroughSlot
	)
		calendarFail("qualified progress pins differ");
	assertPassportId(c.environmentId);
	if (!/^[a-f0-9]{64}$/.test(c.manifestSha256))
		calendarFail("invalid source manifest");
	for (const v of [
		q.policyRevision,
		c.startSlot,
		c.computedThroughSlot,
		c.nextSlot,
		c.reconciledThroughSlot,
		c.startsAtSeconds,
		c.endsAtSeconds,
	])
		integer(v);
	if (
		q.policyRevision < 1 ||
		c.startSlot > c.computedThroughSlot ||
		c.nextSlot <= c.computedThroughSlot ||
		c.reconciledThroughSlot < c.computedThroughSlot ||
		c.reconciledThroughSlot >= c.nextSlot ||
		c.startsAtSeconds >= c.endsAtSeconds ||
		c.endsAtSeconds > 8640000000000
	)
		calendarFail("source prefix incomplete");
	const captured = Date.parse(calendarIso(c.capturedAt));
	if (captured > nowMs || nowMs - captured > maxAgeMs)
		calendarFail("source capture future or stale");
	const start = Date.parse(set.startsAt),
		end = Date.parse(set.endsAt);
	if (nowMs < start || nowMs >= end)
		calendarFail("weekly progress requires active epoch");
	if (c.startsAtSeconds * 1000 > start || c.endsAtSeconds * 1000 <= captured)
		calendarFail("source campaign does not cover epoch");
	if (!Array.isArray(q.passports) || q.passports.length > 20000)
		calendarFail("bounded Passport projection required");
	const passportIds = new Set(),
		actions = new Set(),
		sources = new Set();
	let count = 0;
	let volumeCents = 0n;
	let poolsKnown = true;
	const pools = new Set();
	const days = new Set();
	for (const row of q.passports) {
		exact(row, "passportId qualifyingSwaps activeUtcDayIndices actions");
		assertPassportId(row.passportId);
		if (
			passportIds.has(row.passportId) ||
			!Array.isArray(row.actions) ||
			row.actions.length > 20000 ||
			!Array.isArray(row.activeUtcDayIndices)
		)
			calendarFail("duplicate or oversized Passport progress");
		passportIds.add(row.passportId);
		if (row.qualifyingSwaps !== row.actions.length)
			calendarFail("claimed swap count differs");
		const allDays = new Set();
		for (const action of row.actions) {
			exact(
				action,
				`actionKey sourceKeys valueUsdCents occurredAtSeconds${
					Object.hasOwn(action ?? {}, "poolAddresses") ? " poolAddresses" : ""
				}`,
			);
			integer(action.occurredAtSeconds);
			if (
				Object.hasOwn(action, "poolAddresses") &&
				(!Array.isArray(action.poolAddresses) ||
					action.poolAddresses.length !== action.sourceKeys?.length ||
					action.poolAddresses.some((pool) => typeof pool !== "string" || !pool || pool.length > 64))
			)
				calendarFail("invalid qualified action pools");
			if (
				typeof action.actionKey !== "string" ||
				action.actionKey.length > 2048 ||
				!action.actionKey ||
				actions.has(action.actionKey) ||
				!Array.isArray(action.sourceKeys) ||
				action.sourceKeys.length < 1 ||
				action.sourceKeys.length > 2 ||
				typeof action.valueUsdCents !== "string" ||
				!/^[1-9][0-9]{0,37}$/.test(action.valueUsdCents)
			)
				calendarFail("invalid qualified action");
			actions.add(action.actionKey);
			if (actions.size > 20000)
				calendarFail("bounded complete action projection required");
			for (const key of action.sourceKeys) {
				if (
					typeof key !== "string" ||
					!key ||
					key.length > 2048 ||
					sources.has(key)
				)
					calendarFail("duplicate action source");
				sources.add(key);
			}
			const time = action.occurredAtSeconds * 1000;
			if (
				time > captured ||
				time < c.startsAtSeconds * 1000 ||
				time >= c.endsAtSeconds * 1000
			)
				calendarFail("action outside checked source window");
			allDays.add(Math.floor(action.occurredAtSeconds / 86400));
			if (row.passportId === passportId && time >= start && time < end) {
				count++;
				volumeCents += BigInt(action.valueUsdCents);
				if (Object.hasOwn(action, "poolAddresses"))
					for (const pool of action.poolAddresses) pools.add(pool);
				else poolsKnown = false;
				days.add(Math.floor(action.occurredAtSeconds / 86400));
			}
		}
		if (
			calendarHash(row.activeUtcDayIndices) !==
			calendarHash([...allDays].sort((a, b) => a - b))
		)
			calendarFail("claimed trading days differ");
	}
	const metrics = Object.fromEntries(WEEKLY_METRICS.map((k) => [k, null]));
	metrics.qualifyingSwaps = count;
	metrics.activeTradingDays = days.size;
	metrics.swapVolumeUsd = Number(volumeCents / 100n);
	metrics.distinctPoolsTraded = poolsKnown ? pools.size : null;
	if (Object.hasOwn(q, "lp")) {
		const held = projectLpJoined({
			lp: q.lp,
			passportId,
			startMs: start,
			endMs: end,
			nowMs,
			captured,
			maxAgeMs,
		});
		metrics.featuredPoolsJoined = held === null ? null : held.joined;
		metrics.lpInRangeHours = held === null ? null : held.hours;
	}
	if (Object.hasOwn(q, "referrals")) {
		const referral = projectReferralMetrics({
			referrals: q.referrals,
			passports: q.passports,
			lp: Object.hasOwn(q, "lp") && q.lp?.ownershipCoverage === "HISTORICAL_COVERAGE" ? q.lp : null,
			passportId,
			startMs: start,
			endMs: end,
			nowMs,
			captured,
		});
		metrics.qualifiedTraderReferrals = referral.trader;
		metrics.qualifiedLpReferrals = referral.liquidity;
	}
	const facts = {
		network: "DEVNET",
		fixtureKind: "SYNTHETIC_DEVNET",
		passportId,
		startsAt: set.startsAt,
		endsAt: set.endsAt,
		computedAt: new Date(nowMs).toISOString(),
		metrics,
	};
	return {
		facts,
		source: {
			state: "HISTORICAL_QUALIFIED_PREFIX",
			fixtureKind: "SYNTHETIC_DEVNET",
			awardEligible: false,
			campaignId: c.campaignId,
			decoderVersion: c.decoderVersion,
			computedThroughSlot: c.computedThroughSlot,
			policyRevision: q.policyRevision,
			capturedAt: c.capturedAt,
			qualificationSha256: calendarHash(q),
		},
	};
}

/** Server-owned reader/resolver only. Fresh stable evidence is fetched per
 * request; no cache, timer, grant, route or XP writer is activated. */
export function createWeeklySwapProgressProvider({
	configuration,
	resolveComputedThroughSlot,
}) {
	if (typeof resolveComputedThroughSlot !== "function")
		throw new TypeError("Weekly provider: trusted slot resolver required");
	const reader = createPassportSwapQualificationReader({
		...configuration,
		includeSourceContext: true,
	});
	const sourcePins = Object.freeze({
		environmentId: configuration.environment.environmentId,
		manifestSha256: configuration.environment.manifestSha256,
		programId: configuration.programId,
		campaignId: configuration.campaignId,
		decoderVersion: configuration.decoderVersion,
		startSlot: configuration.startSlot,
		policyRevision: configuration.policy.revision,
	});
	return Object.freeze({
		sourcePins,
		async read() {
			return reader.read(await resolveComputedThroughSlot());
		},
	});
}
