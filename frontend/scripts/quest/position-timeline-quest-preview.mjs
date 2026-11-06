import { previewDevnetQuests } from "./devnet-quest-lab.mjs";
import { projectPassportLiquidityMetrics } from "./passport-liquidity-metrics.mjs";
import {
	timelineFail as fail,
	timelineHash,
} from "./position-timeline-integrity.mjs";

/** Explicit synthetic valuations only. Never authenticates price or grants XP. */
export function previewPositionTimelineQuests({
	snapshot,
	policy,
	valuations,
}) {
	if (
		snapshot?.state !== "TEST_ONLY_POSITION_TIMELINE" ||
		snapshot.awardEligible !== false ||
		!(
			snapshot.trust === "HISTORICAL_REPEATABLE_READ_SNAPSHOT" ||
			(snapshot.trust === "SYNTHETIC_SQL_SNAPSHOT" &&
				snapshot.fixtureKind === "SYNTHETIC_DEVNET")
		) ||
		snapshot.endsAtSeconds <= snapshot.startsAtSeconds ||
		!Array.isArray(valuations) ||
		valuations.length > 8192
	)
		fail("complete test-only timed snapshot required");
	if (policy?.fixtureKind !== "SYNTHETIC_DEVNET" || policy.network !== "DEVNET")
		fail("explicit synthetic valuation policy required");
	const byKey = new Map();
	for (const v of valuations) {
		if (
			v.fixtureKind !== "SYNTHETIC_DEVNET" ||
			byKey.has(v.sourceKey) ||
			typeof v.valueUsdCents !== "string" ||
			!/^(0|[1-9][0-9]{0,37})$/.test(v.valueUsdCents)
		)
			fail("invalid or duplicate synthetic valuation");
		byKey.set(v.sourceKey, v);
	}
	const consumed = new Set();
	const positions = snapshot.intervalPositions.map((p) => ({
		positionAddress: p.positionAddress,
		poolAddress: p.poolAddress,
		intervals: p.intervals.map((i) => {
			if (i.liquidityRaw === "0") {
				if (byKey.has(i.sourceKey))
					fail("zero liquidity cannot accept a valuation");
				return { ...i, valueUsdCents: "0" };
			}
			const v = byKey.get(i.sourceKey);
			if (
				!v ||
				v.positionAddress !== p.positionAddress ||
				v.liquidityRaw !== i.liquidityRaw ||
				v.valuationSource !== policy.valuationSource ||
				v.valuationVersion !== policy.valuationVersion ||
				v.intervalSha256 !== timelineHash(i)
			)
				fail("exact synthetic interval valuation required");
			consumed.add(i.sourceKey);
			return {
				...i,
				valueUsdCents: v.valueUsdCents,
				priceObservedAtSeconds: v.priceObservedAtSeconds,
				valuationSource: v.valuationSource,
				valuationVersion: v.valuationVersion,
			};
		}),
	}));
	if (consumed.size !== valuations.length)
		fail("extra valuation outside interval snapshot");
	const metrics = projectPassportLiquidityMetrics({
		snapshot: {
			network: "DEVNET",
			fixtureKind: "SYNTHETIC_DEVNET",
			campaignId: snapshot.campaignId,
			startSlot: snapshot.startSlot,
			computedThroughSlot: snapshot.endSlot,
			nextSlot: snapshot.endSlot + 1,
			reconciledThroughSlot: snapshot.endSlot,
			startsAtSeconds: snapshot.startsAtSeconds,
			endsAtSeconds: snapshot.endsAtSeconds,
		},
		policy,
		positions,
		histories: snapshot.histories,
	});
	const passportIds = new Set(
		snapshot.histories.flatMap((h) => h.links.map((l) => l.passportId)),
	);
	const previews = [...passportIds].sort().map((passportId) => {
		const m = metrics.passports.find((p) => p.passportId === passportId);
		return previewDevnetQuests({
			network: "DEVNET",
			fixtureKind: "SYNTHETIC_DEVNET",
			passportId,
			computedThroughSlot: snapshot.endSlot,
			metrics: {
				verifiedWalletConnections: null,
				verifiedDevnetPassMints: null,
				qualifyingSwaps: null,
				activeTradingDays: null,
				featuredPoolsJoined: m?.featuredPoolsJoined ?? 0,
				longestFeaturedLpStreakDays: m?.longestFeaturedLpStreakDays ?? 0,
				qualifiedTraderReferrals: null,
				qualifiedLpReferrals: null,
			},
		});
	});
	return {
		sourceTrust: snapshot.trust,
		state: "TEST_ONLY_POSITION_TIMELINE_QUEST_PREVIEW",
		awardEligible: false,
		fixtureKind: "SYNTHETIC_DEVNET",
		campaignId: snapshot.campaignId,
		coverageRevision: snapshot.coverageRevision,
		metrics,
		previews,
	};
}
