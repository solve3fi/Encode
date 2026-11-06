import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarHash } from "./quest-calendar.mjs";
import { createQuestCalendarExample } from "./quest-calendar-example.mjs";
import { createWeeklyTestReceiptStore } from "./quest-weekly-test-store.mjs";

const environment = {
	network: "DEVNET",
	environmentId: "33333333-3333-4333-8333-333333333333",
	manifestSha256: "a".repeat(64),
};
const sourcePins = {
	...environment,
	programId: "fixture-program",
	campaignId: "source-fixture",
	decoderVersion: "fixture-v1",
	startSlot: 10,
	policyRevision: 1,
};
const passportId = "11111111-1111-4111-8111-111111111111";
function fixture(options = {}) {
	const plan = createQuestCalendarExample(),
		calls = [],
		released = [];
	const client = {
		async query(sql) {
			calls.push(sql);
			if (
				(options.fail && sql.includes(options.fail)) ||
				(options.failRollback && sql === "ROLLBACK")
			)
				throw new Error("fixture failure");
			if (sql.includes("FROM quest.environment_identity"))
				return {
					rows: [
						{
							network: "DEVNET",
							genesis_hash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
							environment_id: environment.environmentId,
							manifest_sha256: options.badEnvironment
								? "b".repeat(64)
								: environment.manifestSha256,
							namespace: "quest",
						},
					],
				};
			if (sql.includes("FROM quest.calendar_plans"))
				return {
					rows: [
						{ document: plan, plan_sha256: calendarHash(plan), revision: 1 },
					],
				};
			if (sql.includes("FROM quest.weekly_test_policies"))
				return {
					rows: options.noPolicy
						? []
						: [
								{
									document: {
										fixtureKind: "SYNTHETIC_DEVNET",
										network: "DEVNET",
										revision: 1,
										perPassportEpochXp: "1000",
										perCampaignEpochXp: "10000",
										perCampaignYearXp: "100000",
									},
								},
							],
				};
			if (sql.includes("FROM quest.weekly_test_receipts"))
				return { rows: options.history ?? [] };
			if (sql.includes("lock_lp_test_source") || sql.includes("lock_lp_inventory_source")) return { rows:[{valid:options.lpCoverageValid === true}] };
			if (sql.includes("lock_weekly_test_source"))
				return {
					rows: [
						{
							program_id: sourcePins.programId,
							decoder_version: sourcePins.decoderVersion,
							reconciliation_start_slot: 10,
							next_slot: 16,
							reconciled_through_slot: options.invalidated ? null : 15,
						},
					],
				};
			if (sql.includes("clock_timestamp() AS now"))
				return { rows: [{ now: new Date("2027-01-07T00:00:01.000Z") }] };
			return { rows: [] };
		},
		release(error) {
			released.push(error);
		},
	};
	const pool = {
			async connect() {
				return client;
			},
		},
		store = createWeeklyTestReceiptStore({ pool, environment, sourcePins });
	return { store, calls, released, plan, pool };
}
const qualification = () => ({
	state: "SYNTHETIC_DEVNET_SWAP_QUALIFICATION",
	awardEligible: false,
	network: "DEVNET",
	campaignId: sourcePins.campaignId,
	decoderVersion: sourcePins.decoderVersion,
	computedThroughSlot: 15,
	policyRevision: 1,
	passports: [],
	sourceContext: {
		network: "DEVNET",
		environmentId: environment.environmentId,
		manifestSha256: environment.manifestSha256,
		programId: sourcePins.programId,
		campaignId: sourcePins.campaignId,
		decoderVersion: sourcePins.decoderVersion,
		startSlot: 10,
		computedThroughSlot: 15,
		nextSlot: 16,
		reconciledThroughSlot: 15,
		startsAtSeconds: Date.parse("2027-01-01T00:00:00Z") / 1000,
		endsAtSeconds: Date.parse("2028-01-01T00:00:00Z") / 1000,
		capturedAt: "2027-01-07T00:00:01.000Z",
	},
});
test("LP ownership coverage is rechecked before receipt commit", async () => {
	for (const valid of [false,true]) for(const cohort of [false,true]) {
		const f=fixture({lpCoverageValid:valid}), q=qualification();
		q.lp={state:"SYNTHETIC_DEVNET_LP_QUALIFICATION",awardEligible:false,ownershipCoverage:"HISTORICAL_COVERAGE",
			capturedAtMs:Date.parse(q.sourceContext.capturedAt),minimumLpUsdCents:"1000",minimumDwellMs:0,
			featuredPools:["1".repeat(32)],passports:[],ownershipProof:{campaignId:sourcePins.campaignId,
				anchorSha256:"a".repeat(64),coverageRevision:"1",computedThroughSlot:15}};
		if(cohort) q.lp.ownershipProof={campaignId:sourcePins.campaignId,computedThroughSlot:15,inventoryRevision:"1",sources:[{campaignId:sourcePins.campaignId,anchorSha256:"a".repeat(64),coverageRevision:"1"}]};
        const result=await f.store.reserve({campaignId:f.plan.campaignId,passportId,qualification:q});
		assert.equal(result.created,0);
		assert.ok(f.calls.some(sql=>sql.includes(cohort ? "lock_lp_inventory_source" : "lock_lp_test_source")));
		assert.equal(f.calls.at(-1),"COMMIT");
	}
});
test("test reservations need server-owned pool and matching environment pins", () => {
	assert.throws(() =>
		createWeeklyTestReceiptStore({ environment, sourcePins }),
	);
	assert.throws(() =>
		createWeeklyTestReceiptStore({
			pool: fixture().pool,
			environment,
			sourcePins: { ...sourcePins, manifestSha256: "b".repeat(64) },
		}),
	);
});
test("complete zero activity reserves nothing and releases one committed transaction", async () => {
	const f = fixture(),
		out = await f.store.reserve({
			campaignId: f.plan.campaignId,
			passportId,
			qualification: qualification(),
		});
	assert.equal(out.created, 0);
	assert.deepEqual(out.receipts, []);
	assert.equal(out.awardEligible, false);
	assert.equal(f.calls.at(-1), "COMMIT");
	assert.deepEqual(f.released, [undefined]);
	assert.ok(!f.calls.some((s) => s.includes("INSERT")));
});
for (const [name, options] of [
	["environment", { badEnvironment: true }],
	["missing policy", { noPolicy: true }],
	["invalidated source", { invalidated: true }],
	["driver", { fail: "FROM quest.weekly_test_policies" }],
	["oversized history", { history: Array(20001).fill({}) }],
])
	test(`${name} fails before reservation with rollback and discard`, async () => {
		const f = fixture(options);
		await assert.rejects(
			f.store.reserve({
				campaignId: f.plan.campaignId,
				passportId,
				qualification: qualification(),
			}),
		);
		assert.equal(f.calls.at(-1), "ROLLBACK");
		assert.ok(f.released[0] instanceof Error);
		assert.ok(!f.calls.some((s) => s.includes("INSERT")));
	});
test("source staleness cannot reserve even when current cursor matches", async () => {
	const f = fixture(),
		q = qualification();
	q.sourceContext.capturedAt = "2027-01-06T00:00:00.000Z";
	await assert.rejects(
		f.store.reserve({
			campaignId: f.plan.campaignId,
			passportId,
			qualification: q,
		}),
		/stale/,
	);
	assert.equal(f.calls.at(-1), "ROLLBACK");
});
test("failed rollback preserves original validation error and discards client", async () => {
	const f = fixture({ failRollback: true });
	await assert.rejects(
		f.store.reserve({
			campaignId: f.plan.campaignId,
			passportId,
			qualification: null,
		}),
		/current source prefix differs/,
	);
	assert.ok(f.released[0] instanceof Error);
});
test("personal history has no source read or writer and needs verified environment", async () => {
	const f = fixture();
	assert.deepEqual(
		await f.store.personalHistory(f.plan.campaignId, passportId),
		[],
	);
	assert.ok(
		!f.calls.some(
			(s) => s.includes("lock_weekly_test_source") || s.includes("INSERT"),
		),
	);
});
