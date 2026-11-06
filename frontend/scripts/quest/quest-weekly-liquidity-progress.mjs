import { assertPassportId } from "./passport-id.mjs";
import { verifyOwnershipRangeAnchor } from "./position-ownership-block-range.mjs";
import { timelineHash } from "./position-timeline-integrity.mjs";
import { previewPositionTimelineQuests } from "./position-timeline-quest-preview.mjs";
import { createPositionTimelineReader } from "./position-timeline-service.mjs";
import {
	calendarFail,
	calendarHash,
	calendarIso,
	calendarTime,
	verifyWeeklySet,
	WEEKLY_METRICS,
} from "./quest-calendar.mjs";

/** Internal checked reader outputs only. Prices remain synthetic; selected
 * positions provide a lower bound, never a global inventory completeness claim. */
export function projectWeeklyLiquidityProgress({
	set,
	passportId,
	packet,
	sourcePins,
	nowMs,
	maxAgeMs = 300000,
}) {
	set = verifyWeeklySet(set);
	assertPassportId(passportId);
	calendarTime(nowMs);
	if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 300000)
		calendarFail("invalid liquidity freshness");
	const { snapshot, policy, valuations } = packet ?? {},
		context = snapshot?.sourceContext;
	const captured = Date.parse(calendarIso(context?.capturedAt));
	if (
		context.network !== "DEVNET" ||
		context.environmentId !== sourcePins.environmentId ||
		context.manifestSha256 !== sourcePins.manifestSha256 ||
		context.anchorSha256 !== sourcePins.anchorSha256 ||
		snapshot.anchorSha256 !== sourcePins.anchorSha256 ||
		snapshot.network !== "DEVNET" ||
		snapshot.campaignId !== sourcePins.campaignId ||
		snapshot.scope !== "SELECTED_POSITIONS_ONLY" ||
		snapshot.trust !== "HISTORICAL_REPEATABLE_READ_SNAPSHOT" ||
		captured > nowMs ||
		nowMs - captured > maxAgeMs
	)
		calendarFail("liquidity source pins or capture differ");
	const start = Date.parse(set.startsAt) / 1000,
		end = Date.parse(set.endsAt) / 1000;
	if (
		nowMs < start * 1000 ||
		nowMs >= end * 1000 ||
		snapshot.startsAtSeconds >= start ||
		snapshot.endsAtSeconds <= start ||
		snapshot.endsAtSeconds * 1000 > captured ||
		nowMs - snapshot.endsAtSeconds * 1000 > maxAgeMs ||
		snapshot.endsAtSeconds >= end
	)
		calendarFail("liquidity epoch coverage unavailable");
	if (
		calendarHash(policy) !== sourcePins.policySha256 ||
		calendarHash(
			snapshot.intervalPositions
				.map((p) => ({
					positionAddress: p.positionAddress,
					poolAddress: p.poolAddress,
				}))
				.sort((a, b) =>
					a.positionAddress < b.positionAddress
						? -1
						: a.positionAddress > b.positionAddress
							? 1
							: 0,
				),
		) !== sourcePins.positionsSha256
	)
		calendarFail("liquidity inventory or policy differs");
	// Validate full interval coverage/price bindings before any time filtering.
	previewPositionTimelineQuests({ snapshot, policy, valuations });
	const values = new Map(valuations.map((v) => [v.sourceKey, v]));
	function previewWindow(from, to) {
		const clipped = {
			...snapshot,
			startsAtSeconds: from,
			endsAtSeconds: to,
			intervalPositions: snapshot.intervalPositions.map((p) => ({
				...p,
				intervals: p.intervals
					.filter((i) => i.endsAtSeconds > from && i.startsAtSeconds < to)
					.map((i) => ({
						...i,
						startsAtSeconds: Math.max(from, i.startsAtSeconds),
						endsAtSeconds: Math.min(to, i.endsAtSeconds),
						sourceKey: calendarHash(["weekly-lp", i.sourceKey, from, to]),
					})),
			})),
		};
		const clippedValues = snapshot.intervalPositions.flatMap((p, pi) =>
			p.intervals
				.filter((i) => i.endsAtSeconds > from && i.startsAtSeconds < to)
				.flatMap((i, ii) => {
					if (i.liquidityRaw === "0") return [];
					const interval = clipped.intervalPositions[pi].intervals[ii];
					return [
						{
							...values.get(i.sourceKey),
							sourceKey: interval.sourceKey,
							intervalSha256: timelineHash(interval),
						},
					];
				}),
		);
		return previewPositionTimelineQuests({
			snapshot: clipped,
			policy,
			valuations: clippedValues,
		}).metrics.passports.find((p) => p.passportId === passportId);
	}
	const current = previewWindow(start, snapshot.endsAtSeconds),
		prior =
			snapshot.startsAtSeconds < start
				? previewWindow(snapshot.startsAtSeconds, start)
				: null;
	const priorPools = new Set(prior?.featuredPools ?? []),
		joined = (current?.featuredPools ?? []).filter((p) => !priorPools.has(p));
	const metrics = Object.fromEntries(WEEKLY_METRICS.map((k) => [k, null]));
	// Missing positions could add evidence. A selected-inventory zero therefore
	// remains unknown; positive counts are explicitly conservative lower bounds.
	metrics.featuredPoolsJoined = joined.length || null;
	return {
		facts: {
			network: "DEVNET",
			fixtureKind: "SYNTHETIC_DEVNET",
			passportId,
			startsAt: set.startsAt,
			endsAt: set.endsAt,
			computedAt: new Date(nowMs).toISOString(),
			metrics,
		},
		source: {
			state: "HISTORICAL_SELECTED_LIQUIDITY_PREFIX",
			fixtureKind: "SYNTHETIC_DEVNET",
			awardEligible: false,
			scope: "SELECTED_POSITIONS_ONLY",
			counterSemantics: "LOWER_BOUND_NEW_QUALIFYING_PARTICIPATION",
			campaignId: snapshot.campaignId,
			coverageRevision: snapshot.coverageRevision,
			computedThroughSlot: snapshot.endSlot,
			measuredThrough: new Date(snapshot.endsAtSeconds * 1000).toISOString(),
			capturedAt: context.capturedAt,
			packetSha256: calendarHash(packet),
		},
	};
}
export function createWeeklyLiquidityProgressProvider({
	pool,
	anchor,
	environment,
	policy,
	resolveEndSlot,
	resolveValuations,
}) {
	const checked = verifyOwnershipRangeAnchor(anchor),
		reader = createPositionTimelineReader({ pool, anchor, environment });
	if (
		!environment ||
		typeof resolveEndSlot !== "function" ||
		typeof resolveValuations !== "function" ||
		policy?.network !== "DEVNET" ||
		policy.fixtureKind !== "SYNTHETIC_DEVNET"
	)
		calendarFail("trusted synthetic liquidity provider required");
	const pinnedPolicy = structuredClone(policy);
	const positions = checked.bundle.evidence
		.map((e) => ({
			positionAddress: e.observation.positionAddress,
			poolAddress: e.observation.poolAddress,
		}))
		.sort((a, b) =>
			a.positionAddress < b.positionAddress
				? -1
				: a.positionAddress > b.positionAddress
					? 1
					: 0,
		);
	const sourcePins = Object.freeze({
		...structuredClone(environment),
		campaignId: anchor.campaignId,
		anchorSha256: checked.evidenceSetSha256,
		positionsSha256: calendarHash(positions),
		policySha256: calendarHash(pinnedPolicy),
	});
	return Object.freeze({
		sourcePins,
		async read() {
			const snapshot = await reader.read({ endSlot: await resolveEndSlot() });
			return {
				snapshot,
				policy: structuredClone(pinnedPolicy),
				valuations: await resolveValuations(structuredClone(snapshot)),
			};
		},
	});
}
