// Local fixture generator. No RPC, database, wallet signing, UI or XP writes.
import { pathToFileURL } from "node:url";
import { transferEvidenceFixture } from "../../tests/fixtures/quest-position-ownership.mjs";
import {
	liquidityRangeFixture,
	timelineExtension,
} from "../../tests/fixtures/quest-position-timeline.mjs";
import {
	DEVNET_QUEST_LAB_CATALOG,
	previewDevnetQuests,
} from "./devnet-quest-lab.mjs";
import { decodePositionLiquidityBlockRange } from "./position-liquidity-replay.mjs";
import { timelineClock, timelineHash } from "./position-timeline-integrity.mjs";
import { projectPositionTimelineIntervals } from "./position-timeline-projector.mjs";
import { previewPositionTimelineQuests } from "./position-timeline-quest-preview.mjs";

const passport = "77777777-7777-4777-8777-777777777777",
	otherPassport = "88888888-8888-4888-8888-888888888888";
const initialOwner = "11111111111111111111111111111111",
	nextOwner = "11111111111111111111111111111113";
const history = (wallet, id, from, to = null) => ({
	wallet,
	links:
		from === null
			? []
			: [
					{
						network: "DEVNET",
						wallet,
						passportId: id,
						linkedAt: new Date(from * 1000).toISOString(),
						unlinkedAt: to === null ? null : new Date(to * 1000).toISOString(),
					},
				],
});
const unknown = () => ({
	verifiedWalletConnections: null,
	verifiedDevnetPassMints: null,
	qualifyingSwaps: null,
	activeTradingDays: null,
	qualifiedTraderReferrals: null,
	qualifiedLpReferrals: null,
});

export async function buildPositionTimelineLab() {
	const profiles = [];
	for (const scenario of [
		"new-provider",
		"late-link",
		"unlinked",
		"withdrawn",
		"transferred",
		"seven-day-fixture",
		"missing-price",
		"stale-price",
	]) {
		const f = liquidityRangeFixture({ campaignId: `lab-${scenario}` });
		if (scenario === "withdrawn") {
			const withdrawn = liquidityRangeFixture({
				campaignId: f.anchor.campaignId,
				kind: "decrease_liquidity",
				delta: "100",
			});
			f.blocks = withdrawn.blocks;
		}
		if (scenario === "transferred")
			f.blocks[0].block.transactions = [
				transferEvidenceFixture().transactions[0],
			];
		const next = timelineExtension(f, {
			time: scenario === "seven-day-fixture" ? 900 + 7 * 86400 : 1100,
		});
		next.blocks[0].block.transactions = [];
		const ranges = [
			await decodePositionLiquidityBlockRange(f),
			await decodePositionLiquidityBlockRange(next),
		];
		const snapshot = {
			...projectPositionTimelineIntervals({
				anchor: f.anchor,
				ranges,
				endSlot: 21,
				clock: timelineClock(f.anchor, {
					blockhash: "11111111111111111111111111111112",
					blockTime: 900,
				}),
			}),
			fixtureKind: "SYNTHETIC_DEVNET",
			trust: "SYNTHETIC_SQL_SNAPSHOT",
			coverageRevision: "fixture-1",
			histories: [
				history(
					initialOwner,
					passport,
					scenario === "unlinked" ? null : scenario === "late-link" ? 950 : 900,
					null,
				),
			],
		};
		if (scenario === "transferred")
			snapshot.histories.push(history(nextOwner, otherPassport, 900));
		const policy = {
			network: "DEVNET",
			fixtureKind: "SYNTHETIC_DEVNET",
			revision: 1,
			valuationSource: "synthetic-oracle",
			valuationVersion: "test-1",
			maximumPriceAgeSeconds: 7 * 86400,
			featuredPools: [f.anchor.evidence[0].observation.poolAddress],
			minimumPoolUsdCents: "1000",
		};
		const valuations = snapshot.intervalPositions.flatMap((p) =>
			p.intervals
				.filter((i) => i.liquidityRaw !== "0")
				.map((i) => ({
					fixtureKind: "SYNTHETIC_DEVNET",
					sourceKey: i.sourceKey,
					positionAddress: p.positionAddress,
					liquidityRaw: i.liquidityRaw,
					intervalSha256: timelineHash(i),
					valueUsdCents: "2500",
					priceObservedAtSeconds: i.startsAtSeconds,
					valuationSource: policy.valuationSource,
					valuationVersion: policy.valuationVersion,
				})),
		);
		if (scenario === "missing-price") valuations.pop();
		if (scenario === "stale-price") policy.maximumPriceAgeSeconds = 50;
		try {
			const preview = previewPositionTimelineQuests({
				snapshot,
				policy,
				valuations,
			});
			const primary =
				preview.previews.find((p) => p.passportId === passport) ??
				previewDevnetQuests({
					network: "DEVNET",
					fixtureKind: "SYNTHETIC_DEVNET",
					passportId: passport,
					computedThroughSlot: 21,
					metrics: {
						...unknown(),
						featuredPoolsJoined: 0,
						longestFeaturedLpStreakDays: 0,
					},
				});
			profiles.push({
				id: scenario,
				fixtureKind: "SYNTHETIC_DEVNET",
				awardEligible: false,
				preview: { ...preview, primary },
				measuredWindowSeconds:
					snapshot.endsAtSeconds - snapshot.startsAtSeconds,
			});
		} catch (error) {
			profiles.push({
				id: scenario,
				fixtureKind: "SYNTHETIC_DEVNET",
				awardEligible: false,
				state: "UNAVAILABLE",
				reason: error.message,
			});
		}
	}
	return {
		state: "SYNTHETIC_POSITION_TIMELINE_LAB",
		fixtureKind: "SYNTHETIC_DEVNET",
		awardEligible: false,
		warning:
			"All blocks, clocks, prices, wallets and time gaps are invented fixtures. No live RPC or production economics. The seven-day case deliberately compresses synthetic slot history and is not a chain capture.",
		catalog: DEVNET_QUEST_LAB_CATALOG,
		profiles,
	};
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
	console.log(JSON.stringify(await buildPositionTimelineLab(), null, 2));
