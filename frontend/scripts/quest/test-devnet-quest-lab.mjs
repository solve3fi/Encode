import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DEVNET_QUEST_LAB_CATALOG,
	previewDevnetQuests,
} from "./devnet-quest-lab.mjs";
import { DEVNET_QUEST_SCENARIOS } from "./devnet-quest-scenarios.mjs";

const byName = (name) =>
	DEVNET_QUEST_SCENARIOS.find((scenario) => scenario.name === name).snapshot;

test("catalog has 14 unique typed Devnet test quests with plain rules", () => {
	assert.equal(DEVNET_QUEST_LAB_CATALOG.network, "DEVNET");
	assert.equal(DEVNET_QUEST_LAB_CATALOG.mode, "SYNTHETIC_TEST_ONLY");
	assert.equal(DEVNET_QUEST_LAB_CATALOG.quests.length, 14);
	assert.equal(
		new Set(DEVNET_QUEST_LAB_CATALOG.quests.map((quest) => quest.id)).size,
		14,
	);
	for (const quest of DEVNET_QUEST_LAB_CATALOG.quests) {
		assert.match(quest.id, /^[a-z][a-z0-9-]+$/);
		assert.ok(Number.isSafeInteger(quest.target) && quest.target > 0);
		assert.ok(Number.isSafeInteger(quest.testXp) && quest.testXp > 0);
		assert.ok(quest.flavorText && quest.description);
	}
});

test("newcomer has fourteen pending quests and no preview XP", () => {
	const preview = previewDevnetQuests(byName("newcomer"));
	assert.equal(preview.awardEligible, false);
	assert.equal(preview.provisionalTestXp, 0);
	assert.equal(
		preview.quests.filter((quest) => quest.status === "pending").length,
		14,
	);
});

test("first trade only previews first-swap XP", () => {
	const preview = previewDevnetQuests(byName("first-trade"));
	assert.equal(preview.provisionalTestXp, 250);
	assert.equal(
		preview.quests.find((quest) => quest.id === "first-swap").status,
		"provisional",
	);
	assert.equal(
		preview.quests.find((quest) => quest.id === "trade-three-days").status,
		"in_progress",
	);
});

test("liquidity builder reaches trade and LP milestones but not two pools", () => {
	const preview = previewDevnetQuests(byName("liquidity-builder"));
	assert.equal(preview.provisionalTestXp, 4500);
	assert.equal(
		preview.quests.find((quest) => quest.id === "lp-seven-days").status,
		"provisional",
	);
	assert.equal(
		preview.quests.find((quest) => quest.id === "two-featured-pools").status,
		"in_progress",
	);
});

test("community champion previews all quests without authorizing an award", () => {
	const preview = previewDevnetQuests(byName("community-champion"));
	assert.equal(
		preview.quests.filter((quest) => quest.status === "provisional").length,
		14,
	);
	assert.equal(preview.provisionalTestXp, 13100);
	assert.equal(preview.awardEligible, false);
});

test("missing evidence is unavailable, never treated as completion", () => {
	const preview = previewDevnetQuests(byName("missing-evidence"));
	assert.equal(preview.provisionalTestXp, 0);
	assert.equal(
		preview.quests.filter((quest) => quest.status === "unavailable").length,
		10,
	);
});

test("verified connection previews only the connection quest; mint remains pending", () => {
	const preview = previewDevnetQuests(byName("wallet-connected"));
	assert.equal(
		preview.quests.find((q) => q.id === "connect-wallet").status,
		"provisional",
	);
	assert.equal(
		preview.quests.find((q) => q.id === "mint-devnet-pass").status,
		"pending",
	);
	assert.equal(preview.provisionalTestXp, 100);
	assert.equal(preview.awardEligible, false);
});

test("verified Devnet mint previews both onboarding quests without an award", () => {
	const preview = previewDevnetQuests(byName("pass-minted"));
	assert.equal(preview.provisionalTestXp, 350);
	assert.equal(
		preview.quests.find((q) => q.id === "mint-devnet-pass").status,
		"provisional",
	);
	assert.equal(preview.awardEligible, false);
});

test("onboarding refuses repeated wallet or mint counts and mint without verified ownership", () => {
	const valid = byName("wallet-connected");
	for (const metrics of [
		{ ...valid.metrics, verifiedWalletConnections: 2 },
		{ ...valid.metrics, verifiedDevnetPassMints: 2 },
		{
			...valid.metrics,
			verifiedWalletConnections: 0,
			verifiedDevnetPassMints: 1,
		},
		{
			...valid.metrics,
			verifiedWalletConnections: null,
			verifiedDevnetPassMints: 1,
		},
	]) {
		assert.throws(
			() => previewDevnetQuests({ ...valid, metrics }),
			/once per Passport|verified wallet/,
		);
	}
});

test("rejects mainnet, non-fixture, malformed and contradictory snapshots", () => {
	const valid = byName("first-trade");
	assert.throws(
		() => previewDevnetQuests({ ...valid, network: "MAINNET" }),
		/synthetic Devnet/,
	);
	assert.throws(
		() => previewDevnetQuests({ ...valid, fixtureKind: "FINALIZED" }),
		/synthetic Devnet/,
	);
	assert.throws(
		() => previewDevnetQuests({ ...valid, passportId: "not-a-uuid" }),
		/synthetic Devnet/,
	);
	assert.throws(
		() =>
			previewDevnetQuests({
				...valid,
				metrics: { ...valid.metrics, extra: 1 },
			}),
		/missing or unknown/,
	);
	assert.throws(
		() =>
			previewDevnetQuests({
				...valid,
				metrics: { ...valid.metrics, qualifyingSwaps: -1 },
			}),
		/nonnegative/,
	);
	assert.throws(
		() =>
			previewDevnetQuests({
				...valid,
				metrics: { ...valid.metrics, activeTradingDays: 2 },
			}),
		/contradict/,
	);
	assert.throws(
		() =>
			previewDevnetQuests({
				...valid,
				metrics: {
					...valid.metrics,
					featuredPoolsJoined: 0,
					longestFeaturedLpStreakDays: 7,
				},
			}),
		/contradict/,
	);
});
