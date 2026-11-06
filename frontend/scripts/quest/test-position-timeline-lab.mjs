import assert from "node:assert/strict";
import test from "node:test";
import { buildPositionTimelineLab } from "./position-timeline-lab.mjs";

test("fixture lab exposes eight labeled profiles and the existing onboarding/LP quest catalogue", async () => {
	const r = await buildPositionTimelineLab();
	assert.equal(r.profiles.length, 8);
	assert.equal(r.awardEligible, false);
	assert(
		r.profiles.every(
			(p) => p.awardEligible === false && p.fixtureKind === "SYNTHETIC_DEVNET",
		),
	);
	assert(r.catalog.quests.some((q) => q.id === "connect-wallet"));
	assert(r.catalog.quests.some((q) => q.id === "mint-devnet-pass"));
	const seven = r.profiles.find((p) => p.id === "seven-day-fixture");
	assert.equal(
		seven.preview.primary.quests.find((q) => q.id === "lp-seven-days").status,
		"provisional",
	);
	const late = r.profiles.find((p) => p.id === "late-link"),
		early = r.profiles.find((p) => p.id === "new-provider");
	assert(
		BigInt(late.preview.metrics.passports[0].qualifyingMilliseconds) <
			BigInt(early.preview.metrics.passports[0].qualifyingMilliseconds),
	);
	assert.equal(
		r.profiles.find((p) => p.id === "transferred").preview.metrics.passports
			.length,
		2,
	);
	for (const id of ["missing-price", "stale-price"])
		assert.equal(r.profiles.find((p) => p.id === id).state, "UNAVAILABLE");
	assert.equal(
		r.profiles
			.find((p) => p.id === "unlinked")
			.preview.primary.quests.find((q) => q.id === "first-featured-pool")
			.status,
		"pending",
	);
	assert.equal(
		early.preview.primary.quests.find((q) => q.id === "mint-devnet-pass")
			.status,
		"unavailable",
	);
});
