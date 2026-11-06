import assert from "node:assert/strict";
import { test } from "node:test";
import { weeklyLiquidityFixture } from "../../tests/fixtures/quest-weekly-liquidity.mjs";
import { calendarHash } from "./quest-calendar.mjs";
import { projectWeeklyLiquidityProgress } from "./quest-weekly-liquidity-progress.mjs";

test("new valued linked pool participation is an epoch-scoped selected-inventory lower bound", async () => {
	const f = await weeklyLiquidityFixture(),
		out = projectWeeklyLiquidityProgress(f);
	assert.equal(out.facts.metrics.featuredPoolsJoined, 1);
	assert.equal(out.facts.metrics.qualifyingSwaps, null);
	assert.equal(out.source.scope, "SELECTED_POSITIONS_ONLY");
	assert.equal(out.source.awardEligible, false);
	assert.ok(!JSON.stringify(out.source).includes(f.passportId));
	assert.ok(!JSON.stringify(out.source).includes("sourceKey"));
});
test("carry-in pool participation is not a new weekly join", async () => {
	const f = await weeklyLiquidityFixture({ baselineLiquidityRaw: "100" });
	assert.equal(
		projectWeeklyLiquidityProgress(f).facts.metrics.featuredPoolsJoined,
		null,
	);
});
test("unlinked and other Passport selected-inventory zeros remain unavailable", async () => {
	const f = await weeklyLiquidityFixture();
	f.passportId = "22222222-2222-4222-8222-222222222222";
	assert.equal(
		projectWeeklyLiquidityProgress(f).facts.metrics.featuredPoolsJoined,
		null,
	);
	f.packet.snapshot.histories[0].links = [];
	assert.equal(
		projectWeeklyLiquidityProgress(f).facts.metrics.featuredPoolsJoined,
		null,
	);
});
test("link after the valued interval does not create weekly progress", async () => {
	const f = await weeklyLiquidityFixture();
	f.packet.snapshot.histories[0].links[0].linkedAt = new Date(
		f.nowMs,
	).toISOString();
	assert.equal(
		projectWeeklyLiquidityProgress(f).facts.metrics.featuredPoolsJoined,
		null,
	);
});
for (const [name, change] of [
	["expired epoch", (f) => (f.nowMs = Date.parse(f.set.endsAt))],
	["stale capture", (f) => (f.nowMs += 300001)],
	["stale measured prefix", (f) => (f.packet.snapshot.endsAtSeconds -= 301)],
	["future measured block", (f) => f.packet.snapshot.endsAtSeconds++],
	[
		"partial epoch baseline",
		(f) =>
			(f.packet.snapshot.startsAtSeconds =
				Date.parse(f.set.startsAt) / 1000 + 1),
	],
	[
		"baseline exactly at epoch",
		(f) =>
			(f.packet.snapshot.startsAtSeconds = Date.parse(f.set.startsAt) / 1000),
	],
	[
		"wrong environment",
		(f) =>
			(f.packet.snapshot.sourceContext.environmentId =
				"22222222-2222-4222-8222-222222222222"),
	],
	["wrong anchor", (f) => (f.packet.snapshot.anchorSha256 = "b".repeat(64))],
	["wrong inventory", (f) => (f.sourcePins.positionsSha256 = "b".repeat(64))],
	["missing valuations", (f) => (f.packet.valuations = [])],
	[
		"extra valuation",
		(f) =>
			f.packet.valuations.push({
				...f.packet.valuations[0],
				sourceKey: "unused-price",
			}),
	],
	[
		"changed interval price",
		(f) => (f.packet.valuations[0].intervalSha256 = "b".repeat(64)),
	],
	["changed policy", (f) => f.packet.policy.revision++],
	[
		"synthetic trust substituted",
		(f) => (f.packet.snapshot.trust = "SYNTHETIC_SQL_SNAPSHOT"),
	],
	["global scope claim", (f) => (f.packet.snapshot.scope = "ALL_POSITIONS")],
	[
		"gap in nonzero history",
		(f) =>
			f.packet.snapshot.intervalPositions[0].intervals[1].startsAtSeconds++,
	],
])
	test(`liquidity progress refuses ${name} before weekly filtering`, async () => {
		const f = await weeklyLiquidityFixture();
		change(f);
		assert.throws(() => projectWeeklyLiquidityProgress(f));
	});
test("nonfeatured valued pool remains unavailable without inventing global zero", async () => {
	const f = await weeklyLiquidityFixture();
	f.packet.policy.featuredPools = [];
	f.sourcePins.policySha256 = calendarHash(f.packet.policy);
	assert.equal(
		projectWeeklyLiquidityProgress(f).facts.metrics.featuredPoolsJoined,
		null,
	);
});
