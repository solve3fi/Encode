import assert from "node:assert/strict";
import { test } from "node:test";
import { compileQuestCalendar, WEEKLY_METRICS } from "./quest-calendar.mjs";
import { createQuestCalendarExample } from "./quest-calendar-example.mjs";
import { projectWeeklySwapProgress } from "./quest-weekly-swap-progress.mjs";
import {
	previewWeeklyXp,
	weeklyCompletionKey,
} from "./quest-weekly-xp-preview.mjs";

const passportId = "11111111-1111-4111-8111-111111111111",
	other = "22222222-2222-4222-8222-222222222222";
function fixture() {
	const set = compileQuestCalendar(createQuestCalendarExample()).weeks[2],
		start = Date.parse(set.startsAt) / 1000,
		nowMs = (start + 172800) * 1000;
	const sourcePins = {
		environmentId: "33333333-3333-4333-8333-333333333333",
		manifestSha256: "a".repeat(64),
		programId: "fixture-program",
		campaignId: "source-fixture",
		decoderVersion: "fixture-v1",
		startSlot: 10,
		policyRevision: 1,
	};
	const actions = [start - 100, start + 100, start + 200, start + 86401].map(
		(occurredAtSeconds, i) => ({
			actionKey: `action-${i}`,
			sourceKeys: [`event-${i}`],
			valueUsdCents: "600",
			occurredAtSeconds,
		}),
	);
	const qualification = {
		state: "SYNTHETIC_DEVNET_SWAP_QUALIFICATION",
		awardEligible: false,
		network: "DEVNET",
		campaignId: sourcePins.campaignId,
		decoderVersion: sourcePins.decoderVersion,
		computedThroughSlot: 15,
		policyRevision: 1,
		passports: [
			{
				passportId,
				qualifyingSwaps: 4,
				activeUtcDayIndices: [
					...new Set(
						actions.map((a) => Math.floor(a.occurredAtSeconds / 86400)),
					),
				],
				actions,
			},
		],
		sourceContext: {
			network: "DEVNET",
			...sourcePins,
			computedThroughSlot: 15,
			nextSlot: 16,
			reconciledThroughSlot: 15,
			startsAtSeconds: start - 604800,
			endsAtSeconds: start + 604800,
			capturedAt: new Date(nowMs).toISOString(),
		},
	};
	delete qualification.sourceContext.policyRevision;
	return { set, passportId, qualification, sourcePins, nowMs };
}
test("weekly counts exclude prior epochs and distinguish UTC trading days", () => {
	const out = projectWeeklySwapProgress(fixture());
	assert.equal(out.facts.metrics.qualifyingSwaps, 3);
	assert.equal(out.facts.metrics.activeTradingDays, 2);
	// three in-epoch swaps of $6 each; this fixture's actions carry no pool, so distinct pools is unknown
	assert.equal(out.facts.metrics.swapVolumeUsd, 18);
	assert.equal(out.facts.metrics.distinctPoolsTraded, null);
	for (const k of WEEKLY_METRICS.filter(
		(k) => !["qualifyingSwaps", "activeTradingDays", "swapVolumeUsd"].includes(k),
	))
		assert.equal(out.facts.metrics[k], null);
	assert.equal(out.source.awardEligible, false);
	assert.ok(!JSON.stringify(out.source).includes(passportId));
	assert.ok(!JSON.stringify(out.source).includes("event-"));
});
test("complete checked projection with no own actions produces genuine zero", () => {
	const f = fixture();
	f.passportId = other;
	const out = projectWeeklySwapProgress(f);
	assert.equal(out.facts.metrics.qualifyingSwaps, 0);
	assert.equal(out.facts.metrics.activeTradingDays, 0);
});
test("two-hop qualified action counts once", () => {
	const f = fixture();
	f.qualification.passports[0].actions[1].sourceKeys.push("route-hop-2");
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.qualifyingSwaps, 3);
});
for (const [name, change] of [
	[
		"environment rebound",
		(f) => (f.qualification.sourceContext.environmentId = other),
	],
	[
		"manifest rebound",
		(f) => (f.qualification.sourceContext.manifestSha256 = "b".repeat(64)),
	],
	["policy rebound", (f) => (f.qualification.policyRevision = 2)],
	[
		"incomplete cursor",
		(f) => (f.qualification.sourceContext.reconciledThroughSlot = 14),
	],
	[
		"partial source campaign",
		(f) =>
			(f.qualification.sourceContext.startsAtSeconds =
				Date.parse(f.set.startsAt) / 1000 + 1),
	],
	["stale capture", (f) => (f.nowMs += 300001)],
	["future capture", (f) => f.nowMs--],
	["expired epoch", (f) => (f.nowMs = Date.parse(f.set.endsAt))],
	[
		"claimed lifetime count",
		(f) => (f.qualification.passports[0].qualifyingSwaps = 99),
	],
	[
		"claimed trading days",
		(f) => (f.qualification.passports[0].activeUtcDayIndices = []),
	],
	[
		"duplicate source",
		(f) => (f.qualification.passports[0].actions[1].sourceKeys = ["event-0"]),
	],
	[
		"duplicate Passport",
		(f) =>
			f.qualification.passports.push(
				structuredClone(f.qualification.passports[0]),
			),
	],
	[
		"future event",
		(f) =>
			(f.qualification.passports[0].actions[0].occurredAtSeconds =
				f.nowMs / 1000 + 1),
	],
	["live assertion", (f) => (f.qualification.awardEligible = true)],
])
	test(`progress rejects ${name}`, () => {
		const f = fixture();
		change(f);
		assert.throws(() => projectWeeklySwapProgress(f));
	});
function xpFixture() {
	const f = fixture();
	return {
		set: f.set,
		facts: projectWeeklySwapProgress(f).facts,
		nowMs: f.nowMs,
		priorPlans: [],
		policy: {
			fixtureKind: "SYNTHETIC_DEVNET",
			network: "DEVNET",
			revision: 1,
			perPassportEpochXp: "1000",
			perCampaignEpochXp: "10000",
			perCampaignYearXp: "100000",
		},
	};
}
function prior(f, slot = 0, passport = f.facts.passportId) {
	const q = f.set.quests[slot];
	return {
		campaignId: f.set.campaignId,
		startsAt: f.set.startsAt,
		slot,
		passportId: passport,
		instanceKey: q.instanceKey,
		testXp: q.testXp,
		completionKey: weeklyCompletionKey(
			f.set.campaignId,
			q.instanceKey,
			passport,
		),
	};
}
test("planner yields stable pending test-only completions with unsupported metrics unavailable", () => {
	const f = xpFixture(),
		out = previewWeeklyXp(f);
	assert.deepEqual(
		out.results.map((q) => q.state),
		["PENDING_TEST_ONLY", "PENDING_TEST_ONLY", "UNAVAILABLE"],
	);
	assert.equal(out.usedTestXp.passportEpoch, "750");
	assert.equal(out.awardEligible, false);
	assert.deepEqual(out, previewWeeklyXp(f));
});
test("prior completion replay consumes budget once and never plans another reward", () => {
	const f = xpFixture();
	f.priorPlans = [prior(f)];
	const out = previewWeeklyXp(f);
	assert.equal(out.results[0].state, "ALREADY_PLANNED");
	assert.equal(out.usedTestXp.passportEpoch, "750");
});
for (const cap of [
	"perPassportEpochXp",
	"perCampaignEpochXp",
	"perCampaignYearXp",
])
	test(`${cap} enforced deterministically in slot order`, () => {
		const f = xpFixture();
		f.policy[cap] = "500";
		const out = previewWeeklyXp(f);
		assert.deepEqual(
			out.results.map((q) => q.state),
			["PENDING_TEST_ONLY", "TEST_CAP_EXHAUSTED", "UNAVAILABLE"],
		);
	});
test("other Passport history consumes shared epoch and year ceilings only", () => {
	const f = xpFixture();
	f.priorPlans = [prior(f, 0, other)];
	f.policy.perCampaignEpochXp = "750";
	const out = previewWeeklyXp(f);
	assert.equal(out.results[0].state, "PENDING_TEST_ONLY");
	assert.equal(out.results[1].state, "TEST_CAP_EXHAUSTED");
	assert.equal(out.usedTestXp.passportEpoch, "250");
});
test("expired quests cannot produce new pending XP while preserving prior completion history", () => {
	const f = xpFixture();
	f.priorPlans = [prior(f)];
	f.nowMs = Date.parse(f.set.endsAt);
	assert.deepEqual(
		previewWeeklyXp(f).results.map((q) => q.state),
		["ALREADY_PLANNED", "EXPIRED", "EXPIRED"],
	);
});
for (const [name, change] of [
	["duplicate history", (f) => (f.priorPlans = [prior(f), prior(f)])],
	[
		"changed source identity",
		(f) => {
			f.priorPlans = [prior(f)];
			f.priorPlans[0].completionKey = "b".repeat(64);
		},
	],
	[
		"understated prior XP",
		(f) => {
			f.priorPlans = [prior(f)];
			f.priorPlans[0].testXp = 1;
		},
	],
	[
		"overdrawn prior budget",
		(f) => {
			f.priorPlans = [prior(f)];
			f.policy.perPassportEpochXp = "100";
		},
	],
	[
		"malformed expired facts",
		(f) => {
			f.nowMs = Date.parse(f.set.endsAt);
			f.facts.metrics.qualifyingSwaps = -1;
		},
	],
	[
		"future facts",
		(f) => (f.facts.computedAt = new Date(f.nowMs + 1).toISOString()),
	],
	["live policy", (f) => (f.policy.fixtureKind = "LIVE")],
	["missing complete history", (f) => delete f.priorPlans],
])
	test(`XP planner rejects ${name}`, () => {
		const f = xpFixture();
		change(f);
		assert.throws(() => previewWeeklyXp(f));
	});

// ---- LP (featured pools) ----
const POOL = "6ybsFQhg2Rj9ceQM9T978fNArMNr7TRJkXGphJwaiknY";
function withLp(f, rows, overrides = {}) {
	const nowMs = f.nowMs;
	f.qualification.lp = {
		state: "SYNTHETIC_DEVNET_LP_QUALIFICATION",
		awardEligible: false,
		ownershipCoverage: "HISTORICAL_COVERAGE",
		capturedAtMs: nowMs,
		minimumLpUsdCents: "1000",
		minimumDwellMs: 0,
		featuredPools: [POOL],
		passports: rows,
		...overrides,
	};
	return f;
}
const lpRow = (id, intervals) => ({ passportId: id, pools: [{ poolAddress: POOL, intervals }] });

test("concurrent LP pools count elapsed time once, while disjoint hours accumulate", () => {
	const f = fixture(), start = Date.parse(f.set.startsAt);
	const secondPool = "1".repeat(32);
	withLp(f, [{ passportId, pools: [
		{ poolAddress: POOL, intervals: [[start, start + 2 * 3_600_000]] },
		{ poolAddress: secondPool, intervals: [[start, start + 2 * 3_600_000], [start + 3 * 3_600_000, start + 4 * 3_600_000]] },
	] }], { featuredPools: [POOL,secondPool] });
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.lpInRangeHours, 3);
});

test("transaction-only LP previews cannot complete LP or LP-referral quests", () => {
	const f = fixture();
	withLp(f, [lpRow(passportId, [[Date.parse(f.set.startsAt),f.nowMs]])], { ownershipCoverage:"TRANSACTION_ONLY" });
	f.qualification.referrals = [];
	const metrics = projectWeeklySwapProgress(f).facts.metrics;
	assert.equal(metrics.featuredPoolsJoined,null);
	assert.equal(metrics.lpInRangeHours,null);
	assert.equal(metrics.qualifiedLpReferrals,null);
});

test("a qualifying LP interval inside the epoch counts one featured pool", () => {
	const f = fixture();
	const start = Date.parse(f.set.startsAt);
	withLp(f, [lpRow(passportId, [[start + 1000, f.nowMs]])]);
	const out = projectWeeklySwapProgress(f);
	assert.equal(out.facts.metrics.featuredPoolsJoined, 1);
	assert.equal(out.facts.metrics.qualifyingSwaps, 3);
});

test("an LP interval carried in from before the epoch still counts while it overlaps", () => {
	const f = fixture();
	const start = Date.parse(f.set.startsAt);
	withLp(f, [lpRow(passportId, [[start - 5 * 86400000, f.nowMs]])]);
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.featuredPoolsJoined, 1);
});

test("an interval that ended before the epoch does not count", () => {
	const f = fixture();
	const start = Date.parse(f.set.startsAt);
	withLp(f, [lpRow(passportId, [[start - 5 * 86400000, start - 1000]])]);
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.featuredPoolsJoined, 0);
});

test("another Passport's LP does not count and a valid projection without rows is a genuine zero", () => {
	const f = fixture();
	withLp(f, [lpRow(other, [[Date.parse(f.set.startsAt) + 1000, f.nowMs]])]);
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.featuredPoolsJoined, 0);
});

test("unavailable LP (null) keeps the metric null; swap-only qualification is unchanged", () => {
	const f = fixture();
	f.qualification.lp = null;
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.featuredPoolsJoined, null);
	assert.equal(projectWeeklySwapProgress(fixture()).facts.metrics.featuredPoolsJoined, null);
});

test("malformed, stale, future or unfeatured LP evidence is refused", () => {
	const start = Date.parse(fixture().set.startsAt);
	const refuse = (mutate) => {
		const f = withLp(fixture(), [lpRow(passportId, [[start + 1000, fixture().nowMs]])]);
		mutate(f.qualification.lp, f);
		assert.throws(() => projectWeeklySwapProgress(f));
	};
	refuse((lp) => { lp.awardEligible = true; });
	refuse((lp) => { lp.capturedAtMs -= 400000; });
	refuse((lp, f) => { lp.capturedAtMs = f.nowMs + 1; });
	refuse((lp) => { lp.passports[0].pools[0].poolAddress = "1".repeat(32); });
	refuse((lp) => { lp.passports[0].pools[0].intervals = [[5, 5]]; });
	refuse((lp) => { lp.extra = true; });
	refuse((lp, f) => { lp.passports.push(lp.passports[0]); });
});

test("LP quest completion reaches the XP preview", () => {
	const f = fixture();
	const set = f.set;
	const lpQuest = set.quests.find((q) => q.metric === "featuredPoolsJoined");
	if (!lpQuest) return; // this fixture week has no LP quest
	withLp(f, [lpRow(passportId, [[Date.parse(set.startsAt) + 1000, f.nowMs]])]);
	const progress = projectWeeklySwapProgress(f);
	const preview = previewWeeklyXp({
		set,
		facts: progress.facts,
		nowMs: f.nowMs,
		policy: { network: "DEVNET", revision: 1, fixtureKind: "SYNTHETIC_DEVNET", perCampaignYearXp: "20000000", perCampaignEpochXp: "500000", perPassportEpochXp: "5000" },
		priorPlans: [],
	});
	assert.ok(preview.results.some((q) => q.state === "PENDING_TEST_ONLY" && q.instanceKey));
});

// ---- LP dwell (time-weighted anti-JIT) ----
const HOUR = 3_600_000;
test("a pool joins only after the minimum dwell inside this epoch", () => {
	const f = fixture();
	const start = Date.parse(f.set.startsAt);
	withLp(f, [lpRow(passportId, [[start + 1000, start + 1000 + HOUR / 2]])], { minimumDwellMs: HOUR });
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.featuredPoolsJoined, 0);
	const g = fixture();
	withLp(g, [lpRow(passportId, [[start + 1000, start + 1000 + HOUR]])], { minimumDwellMs: HOUR });
	assert.equal(projectWeeklySwapProgress(g).facts.metrics.featuredPoolsJoined, 1);
});

test("dwell adds up across intervals in a pool and ignores time before the epoch", () => {
	const f = fixture();
	const start = Date.parse(f.set.startsAt);
	withLp(
		f,
		[
			lpRow(passportId, [
				[start + 1000, start + 1000 + 0.6 * HOUR],
				[start + 5 * HOUR, start + 5 * HOUR + 0.6 * HOUR],
			]),
		],
		{ minimumDwellMs: HOUR },
	);
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.featuredPoolsJoined, 1);
	const g = fixture();
	// two hours before the epoch plus ten minutes inside it is only ten minutes of dwell
	withLp(g, [lpRow(passportId, [[start - 2 * HOUR, start + HOUR / 6]])], { minimumDwellMs: HOUR });
	assert.equal(projectWeeklySwapProgress(g).facts.metrics.featuredPoolsJoined, 0);
});

test("a negative or fractional dwell is refused", () => {
	for (const bad of [-1, 1.5, "3600"]) {
		const f = withLp(fixture(), [lpRow(passportId, [[Date.parse(fixture().set.startsAt) + 1000, fixture().nowMs]])], {
			minimumDwellMs: bad,
		});
		assert.throws(() => projectWeeklySwapProgress(f));
	}
});

// ---- Qualified referrals ----
const REFERRED = "33333333-3333-4333-8333-333333333333";
const refRow = (referrer, referred, createdAtMs) => ({
	referrerPassportId: referrer,
	referredPassportId: referred,
	createdAtMs,
});
function withReferrals(f, rows, { swapAt = [], lpIntervals = null, dwellMs = HOUR } = {}) {
	f.qualification.referrals = rows;
	f.qualification.passports.push({
		passportId: REFERRED,
		qualifyingSwaps: swapAt.length,
		activeUtcDayIndices: [...new Set(swapAt.map((t) => Math.floor(t / 86400)))],
		actions: swapAt.map((occurredAtSeconds, i) => ({
			actionKey: `referred-${i}`,
			sourceKeys: [`referred-event-${i}`],
			valueUsdCents: "600",
			occurredAtSeconds,
		})),
	});
	if (lpIntervals) withLp(f, [lpRow(REFERRED, lpIntervals)], { minimumDwellMs: dwellMs });
	return f;
}
test("a friend who swaps after redeeming is a qualified trader referral", () => {
	const f = fixture();
	const start = Date.parse(f.set.startsAt) / 1000;
	withReferrals(f, [refRow(passportId, REFERRED, (start + 50) * 1000)], { swapAt: [start + 100] });
	const out = projectWeeklySwapProgress(f);
	assert.equal(out.facts.metrics.qualifiedTraderReferrals, 1);
	assert.equal(out.facts.metrics.qualifiedLpReferrals, null);
});
test("a swap before the code was redeemed, or outside the epoch, does not count", () => {
	const f = fixture();
	const start = Date.parse(f.set.startsAt) / 1000;
	withReferrals(f, [refRow(passportId, REFERRED, (start + 200) * 1000)], { swapAt: [start + 100] });
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.qualifiedTraderReferrals, 0);
	const g = fixture();
	withReferrals(g, [refRow(passportId, REFERRED, (start - 9000) * 1000)], { swapAt: [start - 5000] });
	assert.equal(projectWeeklySwapProgress(g).facts.metrics.qualifiedTraderReferrals, 0);
});
test("only the asked Passport's own referrals count", () => {
	const f = fixture();
	const start = Date.parse(f.set.startsAt) / 1000;
	withReferrals(f, [refRow(other, REFERRED, (start + 50) * 1000)], { swapAt: [start + 100] });
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.qualifiedTraderReferrals, 0);
	f.passportId = other;
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.qualifiedTraderReferrals, 1);
});
test("a friend holding a qualifying featured-pool position after redeeming is a qualified liquidity referral", () => {
	const f = fixture();
	const startMs2 = Date.parse(f.set.startsAt);
	withReferrals(f, [refRow(passportId, REFERRED, startMs2 + 10_000)], {
		lpIntervals: [[startMs2 + 20_000, startMs2 + 20_000 + 2 * HOUR]],
	});
	const out = projectWeeklySwapProgress(f);
	assert.equal(out.facts.metrics.qualifiedLpReferrals, 1);
	assert.equal(out.facts.metrics.qualifiedTraderReferrals, 0);
});
test("liquidity held mostly before redeeming falls short of the dwell and does not count", () => {
	const f = fixture();
	const startMs2 = Date.parse(f.set.startsAt);
	// held for two hours, but the code was redeemed with only 30 minutes left
	withReferrals(f, [refRow(passportId, REFERRED, startMs2 + 20_000 + 1.5 * HOUR)], {
		lpIntervals: [[startMs2 + 20_000, startMs2 + 20_000 + 2 * HOUR]],
	});
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.qualifiedLpReferrals, 0);
});
test("unavailable sources keep the referral metrics null, never zero", () => {
	const f = fixture();
	f.qualification.referrals = null;
	const out = projectWeeklySwapProgress(f);
	assert.equal(out.facts.metrics.qualifiedTraderReferrals, null);
	assert.equal(out.facts.metrics.qualifiedLpReferrals, null);
	const g = fixture();
	const start = Date.parse(g.set.startsAt) / 1000;
	withReferrals(g, [refRow(passportId, REFERRED, (start + 50) * 1000)], { swapAt: [start + 100] });
	g.qualification.lp = null;
	const unavailableLp = projectWeeklySwapProgress(g);
	assert.equal(unavailableLp.facts.metrics.qualifiedTraderReferrals, 1);
	assert.equal(unavailableLp.facts.metrics.qualifiedLpReferrals, null);
});
test("a complete empty referral list is a genuine zero", () => {
	const f = withLp(fixture(), []);
	f.qualification.referrals = [];
	const out = projectWeeklySwapProgress(f);
	assert.equal(out.facts.metrics.qualifiedTraderReferrals, 0);
	assert.equal(out.facts.metrics.qualifiedLpReferrals, 0);
});
test("malformed referral rows are refused", () => {
	const start = Date.parse(fixture().set.startsAt);
	const refuse = (mutate) => {
		const f = fixture();
		f.qualification.referrals = [refRow(passportId, REFERRED, start + 1)];
		mutate(f.qualification.referrals, f);
		assert.throws(() => projectWeeklySwapProgress(f));
	};
	refuse((rows) => {
		rows[0].referredPassportId = passportId;
	});
	refuse((rows) => {
		rows.push(refRow(other, REFERRED, start + 2));
	});
	refuse((rows) => {
		rows[0].createdAtMs = -1;
	});
	refuse((rows, f) => {
		rows[0].createdAtMs = f.nowMs + 1;
	});
	refuse((rows) => {
		rows[0].extra = true;
	});
	refuse((rows) => {
		rows[0].referrerPassportId = "not-a-passport";
	});
});

// ---- first-year metrics: swap volume, distinct pools, in-range LP hours ----
test("swap volume is whole dollars of the Passport's own in-epoch qualifying swaps", () => {
	const f = fixture();
	const own = f.qualification.passports[0].actions;
	own[1].valueUsdCents = "12345"; // $123.45 -> 123
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.swapVolumeUsd, 123 + 6 + 6);
	assert.equal(projectWeeklySwapProgress({ ...fixture(), passportId: other }).facts.metrics.swapVolumeUsd, 0);
});

test("distinct pools counts each pool once, including both hops of a route", () => {
	const f = fixture();
	const own = f.qualification.passports[0].actions;
	own[0].poolAddresses = ["PoolBeforeEpoch11111111111111111111111"]; // before the epoch: ignored
	own[1].poolAddresses = ["PoolA111111111111111111111111111111111"];
	own[2].sourceKeys.push("route-hop-2");
	own[2].poolAddresses = ["PoolA111111111111111111111111111111111", "PoolB111111111111111111111111111111111"];
	own[3].poolAddresses = ["PoolB111111111111111111111111111111111"];
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.distinctPoolsTraded, 2);
});

test("distinct pools stays unknown when any in-epoch action lacks its pools, and refuses malformed pools", () => {
	const f = fixture();
	const own = f.qualification.passports[0].actions;
	own[1].poolAddresses = ["PoolA111111111111111111111111111111111"];
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.distinctPoolsTraded, null);
	own[1].poolAddresses = ["PoolA111111111111111111111111111111111", "extra"]; // one source key, two pools
	assert.throws(() => projectWeeklySwapProgress(f), /invalid qualified action pools/);
});

test("in-range LP hours count whole elapsed hours inside the epoch", () => {
	const f = fixture();
	const start = Date.parse(f.set.startsAt);
	// 5h30m before the epoch is clipped away; 3h30m inside it counts as 3 whole hours
	withLp(f, [lpRow(passportId, [[start - 5.5 * 3600000, start + 3.5 * 3600000]])]);
	const metrics = projectWeeklySwapProgress(f).facts.metrics;
	assert.equal(metrics.lpInRangeHours, 3);
	assert.equal(metrics.featuredPoolsJoined, 1);
});

test("in-range LP hours: another Passport is a genuine zero and unavailable LP stays null", () => {
	const f = fixture();
	withLp(f, [lpRow(other, [[Date.parse(f.set.startsAt) + 1000, f.nowMs]])]);
	assert.equal(projectWeeklySwapProgress(f).facts.metrics.lpInRangeHours, 0);
	const g = fixture();
	g.qualification.lp = null;
	assert.equal(projectWeeklySwapProgress(g).facts.metrics.lpInRangeHours, null);
	assert.equal(projectWeeklySwapProgress(fixture()).facts.metrics.lpInRangeHours, null);
});
