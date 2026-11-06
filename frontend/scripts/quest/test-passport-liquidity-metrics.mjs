import assert from "node:assert/strict";
import test from "node:test";
import { projectPassportLiquidityMetrics } from "./passport-liquidity-metrics.mjs";

const start = Date.parse("2026-10-01T00:00:00Z") / 1000;
const walletA = "1".repeat(32),
	walletB = "2".repeat(32);
const passportA = "11111111-1111-4111-8111-111111111111",
	passportB = "22222222-2222-4222-8222-222222222222";
const iso = (seconds) => new Date(seconds * 1000).toISOString();
function segment(
	sourceKey,
	from = 0,
	to = 400,
	value = "600",
	wallet = walletA,
) {
	return {
		sourceKey,
		finality: "finalized",
		startsAtSeconds: start + from,
		endsAtSeconds: start + to,
		valueUsdCents: value,
		wallet,
		valuationSource: "fixture-price",
		valuationVersion: "fixture-v1",
		priceObservedAtSeconds: start + from,
	};
}
function link(wallet, passportId = passportA, from = 0, to = null) {
	return {
		network: "DEVNET",
		wallet,
		passportId,
		linkedAt: iso(start + from),
		unlinkedAt: to === null ? null : iso(start + to),
	};
}
function input() {
	return {
		snapshot: {
			fixtureKind: "SYNTHETIC_DEVNET",
			network: "DEVNET",
			campaignId: "lp-fixture",
			startsAtSeconds: start,
			endsAtSeconds: start + 400,
			startSlot: 10,
			computedThroughSlot: 15,
			nextSlot: 16,
			reconciledThroughSlot: 15,
		},
		policy: {
			fixtureKind: "SYNTHETIC_DEVNET",
			network: "DEVNET",
			revision: 1,
			minimumPoolUsdCents: "500",
			maximumPriceAgeSeconds: 200_000,
			valuationSource: "fixture-price",
			valuationVersion: "fixture-v1",
			featuredPools: ["pool-a", "pool-b"],
		},
		positions: [
			{
				positionAddress: "position-a",
				poolAddress: "pool-a",
				intervals: [segment("initial-a")],
			},
		],
		histories: [
			{ wallet: walletA, links: [link(walletA)] },
			{ wallet: walletB, links: [link(walletB)] },
		],
	};
}
const row = (f) => projectPassportLiquidityMetrics(f).passports[0];

test("one complete position integrates exact value and time without awarding XP", () => {
	const result = projectPassportLiquidityMetrics(input());
	assert.equal(result.awardEligible, false);
	assert.equal("xp" in result, false);
	assert.equal(result.passports[0].qualifyingMilliseconds, "400000");
	assert.equal(result.passports[0].usdCentMilliseconds, "240000000");
	assert.equal(result.passports[0].featuredPoolsJoined, 1);
});
test("overlapping linked-wallet positions add value but count elapsed time once", () => {
	const f = input();
	f.positions.push({
		positionAddress: "position-b",
		poolAddress: "pool-a",
		intervals: [segment("initial-b", 0, 400, "800", walletB)],
	});
	assert.equal(row(f).qualifyingMilliseconds, "400000");
	assert.equal(row(f).usdCentMilliseconds, "560000000");
	assert.equal(row(f).featuredPoolsJoined, 1);
});
test("threshold applies per pool after combining positions, not across separate pools", () => {
	const f = input();
	f.positions[0].intervals[0].valueUsdCents = "300";
	f.positions.push({
		positionAddress: "position-b",
		poolAddress: "pool-a",
		intervals: [segment("initial-b", 0, 400, "300", walletB)],
	});
	assert.equal(row(f).qualifyingMilliseconds, "400000");
	f.positions[1].poolAddress = "pool-b";
	assert.equal(row(f).qualifyingMilliseconds, "0");
});
test("two qualifying pools count as distinct pools without multiplying time", () => {
	const f = input();
	f.positions.push({
		positionAddress: "position-b",
		poolAddress: "pool-b",
		intervals: [segment("b")],
	});
	assert.equal(row(f).qualifyingMilliseconds, "400000");
	assert.equal(row(f).featuredPoolsJoined, 2);
});
test("partial exit below threshold stops qualifying time", () => {
	const f = input();
	f.positions[0].intervals = [
		segment("a", 0, 100),
		segment("partial-exit", 100, 400, "499"),
	];
	assert.equal(row(f).qualifyingMilliseconds, "100000");
	assert.equal(row(f).longestFeaturedLpStreakMilliseconds, "100000");
});
test("withdrawal breaks a streak and later deposit starts a new one", () => {
	const f = input();
	f.positions[0].intervals = [
		segment("a", 0, 100),
		segment("exit", 100, 250, "0", null),
		segment("return", 250, 400),
	];
	assert.equal(row(f).qualifyingMilliseconds, "250000");
	assert.equal(row(f).longestFeaturedLpStreakMilliseconds, "150000");
});
test("link/unlink intersections prevent pre-link credit and preserve gaps", () => {
	const f = input();
	f.histories[0].links = [
		link(walletA, passportA, 50, 100),
		link(walletA, passportA, 200),
	];
	assert.equal(row(f).qualifyingMilliseconds, "250000");
	assert.equal(row(f).longestFeaturedLpStreakMilliseconds, "200000");
});
test("millisecond link boundaries retain exact duration and never round up days", () => {
	const f = input();
	f.histories[0].links[0].linkedAt = iso(start + 0.5);
	assert.equal(row(f).qualifyingMilliseconds, "399500");
	assert.equal(row(f).longestFeaturedLpStreakDays, 0);
});
test("position transfers between Passports split attribution without multiplying value", () => {
	const f = input();
	f.histories[1].links = [link(walletB, passportB)];
	f.positions[0].intervals = [
		segment("a", 0, 200),
		segment("transfer", 200, 400, "600", walletB),
	];
	assert.deepEqual(
		projectPassportLiquidityMetrics(f).passports.map((p) => [
			p.passportId,
			p.qualifyingMilliseconds,
		]),
		[
			[passportA, "200000"],
			[passportB, "200000"],
		],
	);
});
test("transfer between wallets of the same Passport keeps continuous time", () => {
	const f = input();
	f.positions[0].intervals = [
		segment("a", 0, 200),
		segment("transfer", 200, 400, "600", walletB),
	];
	assert.equal(row(f).longestFeaturedLpStreakMilliseconds, "400000");
});
test("unlinked owners and nonfeatured pools cannot earn participation", () => {
	const f = input();
	f.histories[0].links = [];
	assert.deepEqual(projectPassportLiquidityMetrics(f).passports, []);
	f.histories[0].links = [link(walletA)];
	f.positions[0].poolAddress = "not-featured";
	assert.deepEqual(projectPassportLiquidityMetrics(f).passports, []);
});
test("full continuous days are floored from exact elapsed time", () => {
	const f = input();
	f.snapshot.endsAtSeconds = start + 172800;
	f.positions[0].intervals = [segment("two-days", 0, 172800)];
	assert.equal(row(f).longestFeaturedLpStreakDays, 2);
});
test("replay and input order do not change metrics", () => {
	const f = input();
	const expected = projectPassportLiquidityMetrics(f);
	f.positions[0].intervals.push(structuredClone(f.positions[0].intervals[0]));
	f.histories.reverse();
	assert.deepEqual(projectPassportLiquidityMetrics(f), expected);
});
test("zero baseline before opening and after closing is explicit", () => {
	const f = input();
	f.positions[0].intervals = [
		segment("baseline", 0, 50, "0", null),
		segment("open", 50, 350),
		segment("closed", 350, 400, "0", null),
	];
	assert.equal(row(f).qualifyingMilliseconds, "300000");
});
test("large monetary values retain BigInt precision", () => {
	const f = input();
	f.positions[0].intervals[0].valueUsdCents = "900719925474099312345";
	assert.equal(
		row(f).usdCentMilliseconds,
		(900719925474099312345n * 400000n).toString(),
	);
});

test("simultaneous movement between featured pools has no artificial streak break", () => {
	const f = input();
	f.positions[0].intervals = [
		segment("a", 0, 200),
		segment("exit-a", 200, 400, "0", null),
	];
	f.positions.push({
		positionAddress: "position-b",
		poolAddress: "pool-b",
		intervals: [
			segment("baseline-b", 0, 200, "0", null),
			segment("enter-b", 200, 400),
		],
	});
	assert.equal(row(f).qualifyingMilliseconds, "400000");
	assert.equal(row(f).longestFeaturedLpStreakMilliseconds, "400000");
	assert.equal(row(f).featuredPoolsJoined, 2);
});

test("splitting a constant-value interval and reordering rows preserves metrics", () => {
	const f = input();
	const expected = projectPassportLiquidityMetrics(f);
	f.positions[0].intervals = [
		segment("second", 100, 400),
		segment("first", 0, 100),
	];
	assert.deepEqual(projectPassportLiquidityMetrics(f), expected);
});

test("one millisecond missing from a day never rounds up a continuous day", () => {
	const f = input();
	f.snapshot.endsAtSeconds = start + 86400;
	f.positions[0].intervals = [segment("day", 0, 86400)];
	f.histories[0].links[0].linkedAt = iso(start + 0.001);
	assert.equal(row(f).longestFeaturedLpStreakMilliseconds, "86399999");
	assert.equal(row(f).longestFeaturedLpStreakDays, 0);
});

for (const [name, mutate, pattern] of [
	[
		"Mainnet",
		(f) => {
			f.snapshot.network = "MAINNET";
		},
		/synthetic/,
	],
	[
		"live policy",
		(f) => {
			f.policy.fixtureKind = "LIVE";
		},
		/synthetic/,
	],
	[
		"unreconciled claims",
		(f) => {
			f.snapshot.reconciledThroughSlot = 14;
		},
		/unreconciled/,
	],
	[
		"zero minimum",
		(f) => {
			f.policy.minimumPoolUsdCents = "0";
		},
		/positive/,
	],
	[
		"missing history",
		(f) => {
			f.histories = [];
		},
		/history missing/,
	],
	[
		"wallet reassignment",
		(f) => {
			f.histories[0].links = [
				link(walletA, passportA, 0, 100),
				link(walletA, passportB, 200),
			];
		},
		/changes Passport/,
	],
	[
		"fractional cents",
		(f) => {
			f.positions[0].intervals[0].valueUsdCents = "0.1";
		},
		/USD/,
	],
	[
		"pending source",
		(f) => {
			f.positions[0].intervals[0].finality = "confirmed";
		},
		/finalized/,
	],
	[
		"gap",
		(f) => {
			f.positions[0].intervals = [segment("a", 0, 100), segment("b", 200, 400)];
		},
		/incomplete/,
	],
	[
		"overlap",
		(f) => {
			f.positions[0].intervals = [segment("a", 0, 200), segment("b", 100, 400)];
		},
		/overlapping/,
	],
	[
		"missing end",
		(f) => {
			f.positions[0].intervals[0].endsAtSeconds -= 1;
		},
		/incomplete/,
	],
	[
		"unowned value",
		(f) => {
			f.positions[0].intervals[0].wallet = null;
		},
		/owner missing/,
	],
	[
		"price expiring during interval",
		(f) => {
			f.policy.maximumPriceAgeSeconds = 399;
		},
		/stale/,
	],
	[
		"future price",
		(f) => {
			f.positions[0].intervals[0].priceObservedAtSeconds += 1;
		},
		/stale/,
	],
	[
		"wrong price version",
		(f) => {
			f.positions[0].intervals[0].valuationVersion = "other";
		},
		/pins/,
	],
	[
		"duplicate position",
		(f) => {
			f.positions.push(structuredClone(f.positions[0]));
		},
		/repeated/,
	],
	[
		"same source on two positions",
		(f) => {
			f.positions.push({
				...structuredClone(f.positions[0]),
				positionAddress: "other",
			});
		},
		/conflicting/,
	],
	[
		"conflicting replay",
		(f) => {
			f.positions[0].intervals.push({
				...f.positions[0].intervals[0],
				valueUsdCents: "700",
			});
		},
		/conflicting/,
	],
	[
		"microsecond history",
		(f) => {
			f.histories[0].links[0].linkedAt = "2026-10-01T00:00:00.000001Z";
		},
		/millisecond/,
	],
])
	test(`LP metrics refuse ${name}`, () => {
		const f = input();
		mutate(f);
		assert.throws(() => projectPassportLiquidityMetrics(f), pattern);
	});
