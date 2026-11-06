import assert from "node:assert/strict";
import test from "node:test";
import {
	computeMatches,
	expiredPartners,
	findEnrollments,
	toAllocation,
} from "./lib/accelerator-match.mjs";

const partner = (poolAddress, extra = {}) => ({
	poolAddress,
	status: "active",
	enrolledAtEpoch: 10,
	maxEpochs: 4,
	...extra,
});
const weights = (map) => (pool) => map[pool] ?? 0;

test("a pool under 2% of votes earns no match", () => {
	const [row] = computeMatches({
		partners: [partner("A")],
		currentEpoch: 11,
		totalVotingPowerUnits: 1000,
		acceleratorPowerUnits: 500,
		weightUnitsForPool: weights({ A: 19 }),
	});
	assert.equal(row.eligible, false);
	assert.equal(row.suggestedWalletPct, 0);
});

test("a pool at 5% is matched by 5% of the total, expressed as a share of the wallet's power", () => {
	const [row] = computeMatches({
		partners: [partner("A")],
		currentEpoch: 11,
		totalVotingPowerUnits: 1000,
		acceleratorPowerUnits: 200,
		weightUnitsForPool: weights({ A: 50 }),
	});
	assert.equal(row.eligible, true);
	assert.equal(row.suggestedWalletPct, 25); // 5% of 1000 = 50 of the wallet's 200
});

test("the match is capped at 10% of total votes", () => {
	const [row] = computeMatches({
		partners: [partner("A")],
		currentEpoch: 11,
		totalVotingPowerUnits: 1000,
		acceleratorPowerUnits: 500,
		weightUnitsForPool: weights({ A: 400 }),
	});
	assert.equal(row.suggestedWalletPct, 20); // 10% of 1000 = 100 of 500
});

test("when partners want more than the wallet has, every match is scaled down together", () => {
	const rows = computeMatches({
		partners: [partner("A"), partner("B")],
		currentEpoch: 11,
		totalVotingPowerUnits: 1000,
		acceleratorPowerUnits: 100, // can cast 10% of the total
		weightUnitsForPool: weights({ A: 100, B: 100 }), // each wants 10%
	});
	assert.deepEqual(
		rows.map((row) => row.suggestedWalletPct),
		[50, 50],
	);
});

test("completed and removed partners are not matched", () => {
	const rows = computeMatches({
		partners: [partner("A", { status: "completed" }), partner("B", { status: "removed" })],
		currentEpoch: 11,
		totalVotingPowerUnits: 1000,
		acceleratorPowerUnits: 500,
		weightUnitsForPool: weights({ A: 100, B: 100 }),
	});
	assert.deepEqual(rows, []);
});

test("no votes or no accelerator power gives no allocation", () => {
	assert.deepEqual(
		computeMatches({
			partners: [partner("A")],
			currentEpoch: 11,
			totalVotingPowerUnits: 0,
			acceleratorPowerUnits: 10,
			weightUnitsForPool: weights({ A: 100 }),
		}),
		[],
	);
	const [row] = computeMatches({
		partners: [partner("A")],
		currentEpoch: 11,
		totalVotingPowerUnits: 1000,
		acceleratorPowerUnits: 0,
		weightUnitsForPool: weights({ A: 100 }),
	});
	assert.equal(row.suggestedWalletPct, 0);
});

test("an allocation never adds up to more than 100", () => {
	const pools = toAllocation([
		{ poolAddress: "A", suggestedWalletPct: 34 },
		{ poolAddress: "B", suggestedWalletPct: 34 },
		{ poolAddress: "C", suggestedWalletPct: 34 },
		{ poolAddress: "D", suggestedWalletPct: 0 },
	]);
	assert.equal(
		pools.reduce((sum, pool) => sum + pool.percent, 0),
		100,
	);
	assert.equal(pools.some((pool) => pool.poolAddress === "D"), false);
});

test("partners expire after their maximum number of epochs", () => {
	assert.deepEqual(
		expiredPartners([partner("A"), partner("B", { enrolledAtEpoch: 12 })], 14),
		["A"],
	);
});

const gauge = (poolAddress, tokenMintA, tokenMintB, status, weightUnits = 0) => ({
	poolAddress,
	tokenMintA,
	tokenMintB,
	status,
	weightUnits,
});

test("an application is enrolled only once its token has an active gauge", () => {
	const applications = [{ project: "Acme", mint: "MINT", accelerator: true }];
	assert.deepEqual(
		findEnrollments({
			applications,
			gauges: [gauge("P1", "MINT", "USDC", 1)], // pending activation
			knownPools: new Set(),
			currentEpoch: 20,
		}),
		[],
	);
	const [enrolled] = findEnrollments({
		applications,
		gauges: [gauge("P1", "MINT", "USDC", 2, 5), gauge("P2", "SOL", "MINT", 2, 9)],
		knownPools: new Set(),
		currentEpoch: 20,
		now: 1,
	});
	assert.equal(enrolled.poolAddress, "P2"); // the heavier gauge
	assert.equal(enrolled.enrolledAtEpoch, 20);
	assert.equal(enrolled.maxEpochs, 4);
	assert.equal(enrolled.status, "active");
});

test("applications that did not ask for the program, or are already known, are skipped", () => {
	const gauges = [gauge("P1", "MINT", "USDC", 2)];
	assert.deepEqual(
		findEnrollments({
			applications: [{ project: "Acme", mint: "MINT" }],
			gauges,
			knownPools: new Set(),
			currentEpoch: 20,
		}),
		[],
	);
	assert.deepEqual(
		findEnrollments({
			applications: [{ project: "Acme", mint: "MINT", accelerator: true }],
			gauges,
			knownPools: new Set(["P1"]), // already enrolled or completed: never re-enrolled
			currentEpoch: 20,
		}),
		[],
	);
});
