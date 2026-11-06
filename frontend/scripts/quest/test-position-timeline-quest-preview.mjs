import assert from "node:assert/strict";
import test from "node:test";
import { liquidityRangeFixture } from "../../tests/fixtures/quest-position-timeline.mjs";
import { decodePositionLiquidityBlockRange } from "./position-liquidity-replay.mjs";
import { timelineClock, timelineHash } from "./position-timeline-integrity.mjs";
import { projectPositionTimelineIntervals } from "./position-timeline-projector.mjs";
import { previewPositionTimelineQuests } from "./position-timeline-quest-preview.mjs";

async function setup() {
	const f = liquidityRangeFixture(),
		snapshot = {
			...projectPositionTimelineIntervals({
				anchor: f.anchor,
				ranges: [await decodePositionLiquidityBlockRange(f)],
				endSlot: 20,
				clock: timelineClock(f.anchor, {
					blockhash: "11111111111111111111111111111112",
					blockTime: 900,
				}),
			}),
			fixtureKind: "SYNTHETIC_DEVNET",
			trust: "SYNTHETIC_SQL_SNAPSHOT",
			coverageRevision: "1",
			histories: [
				{
					wallet: f.anchor.evidence[0].observation.observedOwnerWallet,
					links: [
						{
							network: "DEVNET",
							wallet: f.anchor.evidence[0].observation.observedOwnerWallet,
							passportId: "77777777-7777-4777-8777-777777777777",
							linkedAt: new Date(950000).toISOString(),
							unlinkedAt: null,
						},
					],
				},
			],
		};
	const policy = {
		network: "DEVNET",
		fixtureKind: "SYNTHETIC_DEVNET",
		revision: 1,
		valuationSource: "synthetic-oracle",
		valuationVersion: "test-1",
		maximumPriceAgeSeconds: 1000,
		featuredPools: [snapshot.positions[0].poolAddress],
		minimumPoolUsdCents: "1000",
	};
	const valuations = snapshot.intervalPositions.flatMap((p) =>
		p.intervals.map((i) => ({
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
	return { snapshot, policy, valuations };
}
test("test-only LP quest preview credits linked time without pre-link backfill", async () => {
	const f = await setup(),
		r = previewPositionTimelineQuests(f);
	assert.equal(r.metrics.passports[0].qualifyingMilliseconds, "50000");
	assert.equal(
		r.previews[0].quests.find((q) => q.id === "first-featured-pool").status,
		"provisional",
	);
	assert.equal(
		r.previews[0].quests.find((q) => q.id === "connect-wallet").status,
		"unavailable",
	);
	assert.equal(
		r.previews[0].quests.find((q) => q.id === "mint-devnet-pass").status,
		"unavailable",
	);
	assert.equal(r.awardEligible, false);
	assert.equal(r.sourceTrust, "SYNTHETIC_SQL_SNAPSHOT");
});
test("unlinked interval ends at exact milliseconds and cannot reassign credit", async () => {
	const f = await setup();
	f.snapshot.histories[0].links[0].unlinkedAt = new Date(995500).toISOString();
	assert.equal(
		previewPositionTimelineQuests(f).metrics.passports[0]
			.qualifyingMilliseconds,
		"45500",
	);
});
test("explicit empty link history gives no credit", async () => {
	const f = await setup();
	f.snapshot.histories[0].links = [];
	const r = previewPositionTimelineQuests(f);
	assert.deepEqual(r.metrics.passports, []);
	assert.deepEqual(r.previews, []);
});
for (const [label, alter] of [
	[
		"non-synthetic policy",
		(f) => {
			f.policy.fixtureKind = "LIVE";
		},
	],
	[
		"missing price",
		(f) => {
			f.valuations = [];
		},
	],
	[
		"extra price",
		(f) => {
			f.valuations.push({ ...f.valuations[0], sourceKey: "extra" });
		},
	],
	[
		"duplicate price",
		(f) => {
			f.valuations.push({ ...f.valuations[0] });
		},
	],
	[
		"price identity",
		(f) => {
			f.valuations[0].intervalSha256 = "b".repeat(64);
		},
	],
	[
		"liquidity identity",
		(f) => {
			f.valuations[0].liquidityRaw = "101";
		},
	],
	[
		"price version",
		(f) => {
			f.valuations[0].valuationVersion = "other";
		},
	],
	[
		"stale price",
		(f) => {
			f.valuations[0].priceObservedAtSeconds = 0;
		},
	],
	[
		"future price",
		(f) => {
			f.valuations[0].priceObservedAtSeconds = 901;
		},
	],
	[
		"non-exact cents",
		(f) => {
			f.valuations[0].valueUsdCents = 2500;
		},
	],
	[
		"untrusted snapshot",
		(f) => {
			f.snapshot.trust = "cached-publisher-receipt";
		},
	],
	[
		"live output marker",
		(f) => {
			f.snapshot.awardEligible = true;
		},
	],
])
	test(`refuses ${label}`, async () => {
		const f = await setup();
		alter(f);
		if (label === "stale price") f.policy.maximumPriceAgeSeconds = 999;
		assert.throws(() => previewPositionTimelineQuests(f));
	});
