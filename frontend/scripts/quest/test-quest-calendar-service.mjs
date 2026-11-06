import assert from "node:assert/strict";
import { test } from "node:test";
import { weeklyLiquidityFixture } from "../../tests/fixtures/quest-weekly-liquidity.mjs";
import { PassportAuthFault } from "./passport-durable-auth.mjs";
import {
	communityEntitlementKey,
	compileQuestCalendar,
} from "./quest-calendar.mjs";
import { createQuestCalendarExample } from "./quest-calendar-example.mjs";
import { createQuestCalendarService } from "./quest-calendar-service.mjs";

const environment = {
	network: "DEVNET",
	environmentId: "33333333-3333-4333-8333-333333333333",
	manifestSha256: "a".repeat(64),
};
const passport = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
	origin = "https://quest.solve3.test";
function fixture(options = {}) {
	const plan = createQuestCalendarExample(),
		calls = [],
		audits = new Map();
	let published = !!options.published,
		revision = 1,
		checks = 0;
	const client = {
		async query(sql, params = []) {
			calls.push({ sql, params });
			if (sql.includes("FROM quest.devnet_onboarding_rules"))
				return {
					rows: [
						{ quest_key: "connect-wallet", xp: 100, title: "Connect your wallet", description: "Sign in once." },
						{ quest_key: "mint-pass", xp: 250, title: "Mint your Devnet Pass", description: "Mint it." },
					],
				};
			if (sql.includes("quest.referral_overview"))
				return { rows: [{ overview: options.referralOverview ?? { code: "ABCDEFGH", ratePercent: 10, maxReferrals: 25, referredCount: 0, bonusXp: 0, referredBy: false } }] };
			if (sql.includes("quest.redeem_referral"))
				return { rows: [{ result: options.redeemResult ?? "OK" }] };
			if (sql.includes("quest.submit_partner_lead")) {
				if (options.leadError) throw new Error(options.leadError);
				return { rows: [{ result: { result: options.leadResult ?? "OK", leadId: 1 } }] };
			}
			if (sql.includes("quest.partner_scout_overview")) {
				if (options.scoutError) throw new Error("private SQL diagnostic");
				return {
					rows: [
						{
							overview: options.scoutOverview ?? { bountyXp: 5000, weeklyLimit: 3, remainingThisWeek: 2, leads: [] },
						},
					],
				};
			}
			if (sql.includes("SAVEPOINT")) return { rows: [] };
			if (sql.includes("voting_overview")) {
				if (options.votingError) throw new Error("private SQL diagnostic");
				return {
					rows: [
						{
							overview: options.votingOverview ?? {
								testOnly: true,
								votingXp: 0,
								xpPerEpoch: 500,
								currentEpoch: null,
								votedThisEpoch: false,
								recentEpochs: [],
							},
						},
					],
				};
			}
			if (sql.includes("sum(e.xp_delta)"))
				return { rows: [{ total: options.xpTotal ?? 0 }] };
			if (sql.includes("FROM quest.xp_events"))
				return { rows: options.xpAwards ?? [] };
			if (sql.includes("lock_calendar_operator_grant"))
				return {
					rows: [
						{
							grant_id:
								options.deny || (options.expire && ++checks > 1)
									? null
									: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
						},
					],
				};
			if (sql.includes("FROM quest.environment_identity"))
				return {
					rows: [
						{
							network: "DEVNET",
							genesis_hash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
							environment_id: environment.environmentId,
							manifest_sha256: options.wrongEnvironment
								? "b".repeat(64)
								: environment.manifestSha256,
							namespace: "quest",
						},
					],
				};
			if (sql.includes("FROM quest.calendar_operator_requests"))
				return { rows: audits.has(params[0]) ? [audits.get(params[0])] : [] };
			if (sql.includes("INSERT INTO quest.calendar_operator_requests")) {
				if (options.auditFailure) throw new Error("private SQL diagnostic");
				audits.set(params[0], {
					actor_passport_id: params[3],
					campaign_id: params[4],
					operation: params[5],
					payload_sha256: params[6],
					response: JSON.parse(params[7]),
				});
				return { rows: [] };
			}
			if (sql.includes("FROM quest.calendar_plans"))
				return {
					rows: published
						? [
								{
									plan_sha256:
										options.hash ??
										(await import("./quest-calendar.mjs")).calendarHash(plan),
									document: plan,
									revision,
								},
							]
						: [],
				};
			if (sql.includes("INSERT INTO quest.calendar_plans")) {
				published = true;
				return { rows: [] };
			}
			if (sql.includes("clock_timestamp() AS now"))
				return {
					rows: [
						{ now: new Date(options.now?.() ?? "2027-01-07T00:00:01.000Z") },
					],
				};
			if (sql.includes("FROM quest.calendar_milestones m"))
				return { rows: options.milestones ?? [] };
			if (sql.includes("FROM quest.weekly_test_receipts"))
				return { rows: options.history ?? [] };
			if (sql.includes("INSERT INTO quest.calendar_plan_revisions")) {
				revision++;
				return { rows: [] };
			}
			return { rows: [] };
		},
	};
	const auth = {
		origin,
		async withSession(authentication, _context, work) {
			if (options.authFailure) throw new PassportAuthFault(options.authFailure);
			if (authentication?.csrfToken !== "fixture-csrf")
				throw new PassportAuthFault("FORBIDDEN");
			const savedPublished = published,
				savedAudits = new Map(audits);
			calls.push({ sql: "AUTH BEGIN" });
			try {
				const out = await work({
					client,
					session: {
						sessionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
						passportId: options.passport ?? passport,
					},
				});
				calls.push({ sql: "AUTH COMMIT" });
				return out;
			} catch (e) {
				published = savedPublished;
				audits.clear();
				for (const [k, v] of savedAudits) audits.set(k, v);
				calls.push({ sql: "AUTH ROLLBACK" });
				if (e instanceof PassportAuthFault) throw e;
				throw new PassportAuthFault("UNAVAILABLE");
			}
		},
	};
	return {
		service: createQuestCalendarService({
			auth,
			environment,
			...options.serviceConfiguration,
		}),
		plan,
		calls,
		audits,
		authArgs: { cookieHeader: "fixture-cookie", csrfToken: "fixture-csrf" },
		context: { origin, clientKey: "fixture-client" },
		published: () => published,
	};
}
const deny = (promise, code) =>
	assert.rejects(
		promise,
		(e) => e instanceof PassportAuthFault && e.code === code,
	);

async function liquidityProvider() {
	const lp = await weeklyLiquidityFixture({ passportId: passport });
	return {
		lp,
		provider: {
			sourcePins: lp.sourcePins,
			read: async () => structuredClone(lp.packet),
		},
	};
}
test("liquidity-only private view exposes selected new participation without swap facts", async () => {
	const { lp, provider } = await liquidityProvider(),
		f = fixture({
			published: true,
			now: () => lp.packet.snapshot.sourceContext.capturedAt,
			serviceConfiguration: { weeklyLiquidityProvider: provider },
		});
	const out = await f.service.snapshot(
		{ campaignId: f.plan.campaignId },
		f.authArgs,
		f.context,
	);
	assert.equal(
		out.weekly.quests.find((q) => q.metric === "featuredPoolsJoined").progress,
		1,
	);
	assert.equal(
		out.weekly.quests.find((q) => q.metric === "qualifyingSwaps").progress,
		null,
	);
	assert.equal(out.liquiditySource.scope, "SELECTED_POSITIONS_ONLY");
	assert.equal(out.progressSource, undefined);
	assert.ok(!JSON.stringify(out).includes("sourceKey"));
});

test("protected history derives only current session Passport and refuses forged identity", async () => {
	const f = fixture({ published: true });
	const input = { campaignId: f.plan.campaignId, before: null, limit: 10 };
	const out = await f.service.history(input, f.authArgs, f.context);
	assert.equal(out.passportId, passport);
	assert.deepEqual(out.receipts, []);
	const query = f.calls.find((c) =>
		c.sql.includes("FROM quest.weekly_test_receipts"),
	);
	assert.equal(query.params[1], passport);
	assert.equal(query.params.at(-1), 11);
	await deny(
		f.service.history(
			{ ...input, passportId: passport },
			f.authArgs,
			f.context,
		),
		"INVALID_REQUEST",
	);
});
test("unauthorized history and budget queries never read receipts or budgets", async () => {
	const f = fixture({ published: true, authFailure: "UNAUTHORIZED" });
	await deny(
		f.service.history(
			{ campaignId: f.plan.campaignId, before: null, limit: 10 },
			f.authArgs,
			f.context,
		),
		"UNAUTHORIZED",
	);
	await deny(
		f.service.budget({ campaignId: f.plan.campaignId }, f.authArgs, f.context),
		"UNAUTHORIZED",
	);
	assert.equal(f.calls.length, 0);
});
test("corrupt personal receipt and missing community policy are unavailable with rollback", async () => {
	const f = fixture({
		published: true,
		history: [
			{
				starts_at: "2027-01-07T00:00:00.000Z",
				source_captured_at: "2027-01-07T00:00:00.000Z",
				recorded_at: "2027-01-07T00:00:00.000Z",
			},
		],
	});
	await deny(
		f.service.history(
			{ campaignId: f.plan.campaignId, before: null, limit: 10 },
			f.authArgs,
			f.context,
		),
		"UNAVAILABLE",
	);
	await deny(
		f.service.budget({ campaignId: f.plan.campaignId }, f.authArgs, f.context),
		"UNAVAILABLE",
	);
	assert.equal(f.calls.filter((c) => c.sql === "AUTH ROLLBACK").length, 2);
});
test("community budget requires scoped observe grant before policy lookup", async () => {
	const f = fixture({ published: true, deny: true });
	await deny(
		f.service.budget({ campaignId: f.plan.campaignId }, f.authArgs, f.context),
		"FORBIDDEN",
	);
	assert.ok(!f.calls.some((c) => c.sql.includes("community_test_policies")));
});
for (const failure of ["none", "swap", "liquidity", "liquidity-deadline"])
	test(`independent progress sources survive ${failure}`, async () => {
		const { lp, provider } = await liquidityProvider();
		const swap = progressProvider(async (read) => {
			if (failure === "swap") throw new Error("private swap failure");
			const q = await read();
			q.sourceContext.capturedAt = lp.packet.snapshot.sourceContext.capturedAt;
			return q;
		});
		if (failure === "liquidity")
			provider.read = async () => {
				throw new Error("private liquidity failure");
			};
		if (failure === "liquidity-deadline")
			provider.read = () => new Promise(() => {});
		const f = fixture({
				published: true,
				now: () => lp.packet.snapshot.sourceContext.capturedAt,
				serviceConfiguration: {
					weeklyProgressProvider: swap,
					weeklyLiquidityProvider: provider,
					progressTimeoutMs: 20,
				},
			}),
			out = await f.service.snapshot(
				{ campaignId: f.plan.campaignId },
				f.authArgs,
				f.context,
			);
		assert.equal(
			out.weekly.quests.find((q) => q.metric === "qualifyingSwaps").progress,
			failure === "swap" ? null : 0,
		);
		assert.equal(
			out.weekly.quests.find((q) => q.metric === "featuredPoolsJoined")
				.progress,
			failure.startsWith("liquidity") ? null : 1,
		);
		assert.ok(!JSON.stringify(out).includes("private "));
	});
test("liquidity wait across Thursday returns new epoch without old progress", async () => {
	const { lp, provider } = await liquidityProvider();
	let now = lp.packet.snapshot.sourceContext.capturedAt;
	provider.read = async () => {
		now = "2027-01-21T00:00:00.000Z";
		return lp.packet;
	};
	const f = fixture({
			published: true,
			now: () => now,
			serviceConfiguration: { weeklyLiquidityProvider: provider },
		}),
		out = await f.service.snapshot(
			{ campaignId: f.plan.campaignId },
			f.authArgs,
			f.context,
		);
	assert.equal(out.weekly.startsAt, now);
	assert.equal(out.liquiditySource.state, "EPOCH_CHANGED");
	assert.ok(out.weekly.quests.every((q) => q.progress === null));
});
test("liquidity provider is never called before signed session authorization", async () => {
	const { provider } = await liquidityProvider();
	let reads = 0;
	provider.read = async () => {
		reads++;
	};
	const f = fixture({
		published: true,
		authFailure: "UNAUTHORIZED",
		serviceConfiguration: { weeklyLiquidityProvider: provider },
	});
	await deny(
		f.service.snapshot(
			{ campaignId: f.plan.campaignId },
			f.authArgs,
			f.context,
		),
		"UNAUTHORIZED",
	);
	assert.equal(reads, 0);
});

function progressProvider(readOverride) {
	const sourcePins = {
		...environment,
		campaignId: "source-fixture",
		programId: "fixture-program",
		decoderVersion: "fixture-v1",
		startSlot: 10,
		policyRevision: 1,
	};
	const read = async () => ({
		state: "SYNTHETIC_DEVNET_SWAP_QUALIFICATION",
		awardEligible: false,
		network: "DEVNET",
		campaignId: sourcePins.campaignId,
		decoderVersion: sourcePins.decoderVersion,
		policyRevision: 1,
		computedThroughSlot: 15,
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
	return { sourcePins, read: readOverride ? () => readOverride(read) : read };
}
test("private snapshot uses backend evidence without an operator grant or exposing sources", async () => {
	const f = fixture({
		published: true,
		deny: true,
		serviceConfiguration: { weeklyProgressProvider: progressProvider() },
	});
	const out = await f.service.snapshot(
		{ campaignId: f.plan.campaignId },
		f.authArgs,
		f.context,
	);
	assert.equal(out.progressSource.state, "HISTORICAL_QUALIFIED_PREFIX");
	assert.equal(
		out.weekly.quests.find((q) => q.metric === "qualifyingSwaps").progress,
		0,
	);
	assert.ok(
		out.weekly.quests
			.filter((q) => q.metric.includes("Referrals"))
			.every((q) => q.progress === null),
	);
	assert.ok(
		!f.calls.some(
			(c) =>
				c.sql.includes("lock_calendar_operator_grant") ||
				c.sql.includes("INSERT INTO quest.xp"),
		),
	);
	assert.ok(!JSON.stringify(out).includes("sourceKeys"));
});
for (const [name, reader] of [
	[
		"driver failure",
		async () => {
			throw new Error("private SQL diagnostic");
		},
	],
	["deadline", () => new Promise(() => {})],
	[
		"wrong source manifest",
		async (read) => {
			const q = await read();
			q.sourceContext.manifestSha256 = "b".repeat(64);
			return q;
		},
	],
	[
		"stale source",
		async (read) => {
			const q = await read();
			q.sourceContext.capturedAt = "2027-01-06T00:00:00.000Z";
			return q;
		},
	],
])
	test(`progress ${name} is unavailable rather than zero or leaked diagnostics`, async () => {
		const f = fixture({
			published: true,
			serviceConfiguration: {
				weeklyProgressProvider: progressProvider(reader),
				progressTimeoutMs: 20,
			},
		});
		const out = await f.service.snapshot(
			{ campaignId: f.plan.campaignId },
			f.authArgs,
			f.context,
		);
		assert.equal(out.progressSource.state, "UNAVAILABLE");
		assert.ok(out.weekly.quests.every((q) => q.progress === null));
		assert.ok(!JSON.stringify(out).includes("diagnostic"));
	});
test("epoch rollover while source is pending returns newly active quests without stale facts", async () => {
	let now = "2027-01-07T00:00:01.000Z";
	const f = fixture({
		published: true,
		now: () => now,
		serviceConfiguration: {
			weeklyProgressProvider: progressProvider(async (read) => {
				now = "2027-01-14T00:00:00.000Z";
				return read();
			}),
		},
	});
	const out = await f.service.snapshot(
		{ campaignId: f.plan.campaignId },
		f.authArgs,
		f.context,
	);
	assert.equal(out.weekly.startsAt, now);
	assert.equal(out.progressSource.state, "EPOCH_CHANGED");
	assert.ok(out.weekly.quests.every((q) => q.progress === null));
});
test("provider cannot bypass signed Passport authentication", async () => {
	let reads = 0;
	const f = fixture({
		published: true,
		authFailure: "UNAUTHORIZED",
		serviceConfiguration: {
			weeklyProgressProvider: progressProvider(async (read) => {
				reads++;
				return read();
			}),
		},
	});
	await deny(
		f.service.snapshot(
			{ campaignId: f.plan.campaignId },
			f.authArgs,
			f.context,
		),
		"UNAUTHORIZED",
	);
	assert.equal(reads, 0);
});
test("publish uses one protected transaction, current scoped grant and immutable audit", async () => {
	const f = fixture(),
		out = await f.service.mutate(
			"publish",
			{ requestId, plan: f.plan },
			f.authArgs,
			f.context,
		);
	assert.equal(out.created, true);
	assert.equal(out.awardEligible, false);
	assert.equal(out.replayed, false);
	assert.equal(f.audits.size, 1);
	assert.ok(
		!f.calls.some((c) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(c.sql)),
	);
	assert.equal(f.calls.at(-1).sql, "AUTH COMMIT");
	assert.equal(
		f.calls.filter((c) => c.sql.includes("lock_calendar_operator_grant"))
			.length,
		2,
	);
});
test("identical request replay returns same result without another publication or audit", async () => {
	const f = fixture(),
		input = { requestId, plan: f.plan };
	await f.service.mutate("publish", input, f.authArgs, f.context);
	assert.equal(
		(await f.service.mutate("publish", input, f.authArgs, f.context)).replayed,
		true,
	);
	assert.equal(
		f.calls.filter((c) => c.sql.includes("INSERT INTO quest.calendar_plans"))
			.length,
		1,
	);
	assert.equal(f.audits.size, 1);
	const changed = structuredClone(input);
	changed.plan.templates[0].testXp++;
	await deny(
		f.service.mutate("publish", changed, f.authArgs, f.context),
		"CONFLICT",
	);
});
for (const code of ["UNAUTHORIZED", "RATE_LIMITED", "FORBIDDEN"])
	test(`auth ${code} prevents every calendar operation`, async () => {
		const f = fixture({ authFailure: code });
		await deny(
			f.service.mutate(
				"publish",
				{ requestId, plan: f.plan },
				f.authArgs,
				f.context,
			),
			code,
		);
		assert.equal(f.calls.length, 0);
	});
test("missing capability prevents publication and scoped operator plan reads", async () => {
	const f = fixture({ deny: true });
	await deny(
		f.service.mutate(
			"publish",
			{ requestId, plan: f.plan },
			f.authArgs,
			f.context,
		),
		"FORBIDDEN",
	);
	await deny(
		f.service.operatorPlan(
			{ campaignId: f.plan.campaignId },
			f.authArgs,
			f.context,
		),
		"FORBIDDEN",
	);
	assert.ok(!f.calls.some((c) => c.sql.includes("calendar_plans")));
});
test("audit failure and grant expiry after work roll back the entire mutation", async () => {
	for (const options of [{ auditFailure: true }, { expire: true }]) {
		const f = fixture(options);
		await deny(
			f.service.mutate(
				"publish",
				{ requestId, plan: f.plan },
				f.authArgs,
				f.context,
			),
			options.expire ? "FORBIDDEN" : "UNAVAILABLE",
		);
		assert.equal(f.published(), false);
		assert.equal(f.audits.size, 0);
	}
});
test("snapshot derives Passport from session and excludes caller-provided identity", async () => {
	const f = fixture({ published: true });
	const out = await f.service.snapshot(
		{ campaignId: f.plan.campaignId },
		f.authArgs,
		f.context,
	);
	assert.equal(out.passportId, passport);
	assert.equal(out.weekly.quests.length, 3);
	assert.equal(out.awardEligible, false);
	assert.equal(
		f.calls.find((c) => c.sql.includes("personal_entitlements")).params[1],
		passport,
	);
	await deny(
		f.service.snapshot(
			{ campaignId: f.plan.campaignId, passportId: "other" },
			f.authArgs,
			f.context,
		),
		"INVALID_REQUEST",
	);
});
test("private projection validates own entitlement and never exposes audience arrays", async () => {
	const p = createQuestCalendarExample(),
		g = compileQuestCalendar(p).goals[0];
	const row = {
		goal_id: g.id,
		receipt_sha256: "c".repeat(64),
		goal_sha256: g.goalSha256,
		audience_cutoff: "2027-01-07T00:00:00.000Z",
		observed_tvl_usd_cents: "50000000",
		recipient_count: 5,
		personal_entitlements: [
			{
				passportId: passport,
				entitlementKey: communityEntitlementKey(p.campaignId, g.id, passport),
				testXp: g.testXp,
				state: "PENDING_TEST_ONLY",
			},
		],
	};
	const f = fixture({ published: true, milestones: [row] }),
		out = await f.service.snapshot(
			{ campaignId: p.campaignId },
			f.authArgs,
			f.context,
		);
	assert.equal(out.milestones[0].entitlement.testXp, 1000);
	assert.equal(out.milestones[0].recipientCount, 5);
	assert.ok(!JSON.stringify(out).includes("personal_entitlements"));
	const bad = fixture({
		published: true,
		milestones: [
			{
				...row,
				personal_entitlements: [
					{ ...row.personal_entitlements[0], passportId: "other" },
				],
			},
		],
	});
	await deny(
		bad.service.snapshot(
			{ campaignId: p.campaignId },
			bad.authArgs,
			bad.context,
		),
		"UNAVAILABLE",
	);
});
test("environment mismatch and stored hash corruption fail closed", async () => {
	for (const options of [
		{ wrongEnvironment: true },
		{ hash: "b".repeat(64) },
	]) {
		const f = fixture({ published: true, ...options });
		await deny(
			f.service.snapshot(
				{ campaignId: f.plan.campaignId },
				f.authArgs,
				f.context,
			),
			"UNAVAILABLE",
		);
	}
});
test("operator plan reads require revise capability and include optimistic revision", async () => {
	const f = fixture({ published: true });
	const out = await f.service.operatorPlan(
		{ campaignId: f.plan.campaignId },
		f.authArgs,
		f.context,
	);
	assert.equal(out.revision, 1);
	assert.deepEqual(out.plan, f.plan);
	assert.equal(
		f.calls.find((c) => c.sql.includes("lock_calendar_operator_grant"))
			.params[2],
		"revise",
	);
});
test("grant expiry during a protected operator read is refused", async () => {
	const f = fixture({ published: true, expire: true });
	await deny(
		f.service.operatorPlan(
			{ campaignId: f.plan.campaignId },
			f.authArgs,
			f.context,
		),
		"FORBIDDEN",
	);
});
test("invalid fields, missing request IDs, noncanonical payloads and unknown operations refuse", async () => {
	const f = fixture();
	await deny(
		f.service.mutate("toString", {}, f.authArgs, f.context),
		"NOT_FOUND",
	);
	await deny(
		f.service.mutate(
			"publish",
			{ requestId: "bad", plan: f.plan },
			f.authArgs,
			f.context,
		),
		"INVALID_REQUEST",
	);
	await deny(
		f.service.mutate(
			"publish",
			{ requestId, plan: f.plan, passportId: passport },
			f.authArgs,
			f.context,
		),
		"INVALID_REQUEST",
	);
	assert.equal(f.calls.length, 0);
});

test("test XP is read for the session Passport only and marks completed onboarding quests", async () => {
	const f = fixture({
		published: true,
		xpTotal: 350,
		xpAwards: [
			{ qualification_key: "connect-wallet", xp: 100, recorded_at: new Date("2026-10-04T12:00:00Z") },
			{ qualification_key: "mint-pass", xp: 250, recorded_at: new Date("2026-10-04T12:05:00Z") },
		],
	});
	const out = await f.service.xp({ campaignId: f.plan.campaignId }, f.authArgs, f.context);
	assert.equal(out.passportId, passport);
	assert.equal(out.testOnly, true);
	assert.equal(out.totalXp, 350);
	assert.deepEqual(out.onboarding.map((q) => [q.id, q.xp, q.completed]), [
		["connect-wallet", 100, true],
		["mint-pass", 250, true],
	]);
	for (const query of f.calls.filter((c) => c.sql.includes("FROM quest.xp_events")))
		assert.equal(query.params[0], passport);
	await deny(
		f.service.xp({ campaignId: f.plan.campaignId, passportId: passport }, f.authArgs, f.context),
		"INVALID_REQUEST",
	);
});

test("a Passport with no awards shows both onboarding quests open and zero XP", async () => {
	const f = fixture({ published: true });
	const out = await f.service.xp({ campaignId: f.plan.campaignId }, f.authArgs, f.context);
	assert.equal(out.totalXp, 0);
	assert.deepEqual(out.onboarding.map((q) => q.completed), [false, false]);
	assert.deepEqual(out.onboarding.map((q) => q.awardedAt), [null, null]);
});

test("referral overview is read for the session Passport only", async () => {
	const f = fixture({ published: true, referralOverview: { code: "ABCDEFGH", ratePercent: 10, maxReferrals: 25, referredCount: 2, bonusXp: 25, referredBy: true } });
	const out = await f.service.referral({ campaignId: f.plan.campaignId }, f.authArgs, f.context);
	assert.equal(out.passportId, passport);
	assert.equal(out.testOnly, true);
	assert.equal(out.code, "ABCDEFGH");
	assert.equal(out.bonusXp, 25);
	assert.equal(out.referredBy, true);
	const query = f.calls.find((c) => c.sql.includes("referral_overview"));
	assert.deepEqual(query.params, [passport]);
	await deny(
		f.service.referral({ campaignId: f.plan.campaignId, passportId: passport }, f.authArgs, f.context),
		"INVALID_REQUEST",
	);
});

test("redeeming passes the session Passport and a validated code, and returns the server's verdict", async () => {
	const f = fixture({ published: true, redeemResult: "FULL" });
	const out = await f.service.redeemReferral({ campaignId: f.plan.campaignId, code: "abcd2345" }, f.authArgs, f.context);
	assert.equal(out.result, "FULL");
	assert.equal(out.passportId, passport);
	const call = f.calls.find((c) => c.sql.includes("redeem_referral"));
	assert.deepEqual(call.params, [passport, "abcd2345"]);
	for (const code of ["short", "ABCDEFG!", "ABCDEFGHI", 12345678, null])
		await deny(
			f.service.redeemReferral({ campaignId: f.plan.campaignId, code }, f.authArgs, f.context),
			"INVALID_REQUEST",
		);
	await deny(
		f.service.redeemReferral({ campaignId: f.plan.campaignId, code: "ABCD2345", passportId: passport }, f.authArgs, f.context),
		"INVALID_REQUEST",
	);
});

test("Voting XP is read for the session Passport only and returned beside Quest XP", async () => {
	const overview = { testOnly: true, votingXp: 1500, xpPerEpoch: 500, currentEpoch: 9, votedThisEpoch: true, recentEpochs: [{ epoch: 8, earned: true }] };
	const f = fixture({ published: true, xpTotal: 350, votingOverview: overview });
	const out = await f.service.xp({ campaignId: f.plan.campaignId }, f.authArgs, f.context);
	assert.deepEqual(out.voting, overview);
	assert.equal(out.totalXp, 350);
	const votingQuery = f.calls.find((c) => c.sql.includes("voting_overview") && !c.sql.includes("SAVEPOINT"));
	assert.deepEqual(votingQuery.params, [passport]);
});

test("a Voting XP read failure leaves the Quest XP response intact and exposes nothing", async () => {
	const f = fixture({ published: true, xpTotal: 350, votingError: true });
	const out = await f.service.xp({ campaignId: f.plan.campaignId }, f.authArgs, f.context);
	assert.equal(out.voting, null);
	assert.equal(out.totalXp, 350);
	assert.ok(!JSON.stringify(out).includes("private SQL diagnostic"));
	assert.ok(f.calls.some((c) => c.sql.includes("ROLLBACK TO SAVEPOINT voting_overview")));
});

test("Quest XP excludes governance (Voting XP), including a reversal of a governance award", async () => {
	const f = fixture({ published: true, xpTotal: 350 });
	await f.service.xp({ campaignId: f.plan.campaignId }, f.authArgs, f.context);
	const totalQuery = f.calls.find((c) => c.sql.includes("sum(e.xp_delta)"));
	assert.match(totalQuery.sql, /IS DISTINCT FROM 'governance-epoch'/);
	assert.match(totalQuery.sql, /LEFT JOIN quest\.xp_events o ON o\.event_id=e\.reverses_event_id/);
	assert.deepEqual(totalQuery.params, [passport]);
});

test("a partner lead passes the session Passport and trimmed fields, and returns the verdict and the refreshed overview", async () => {
	const f = fixture({ published: true });
	const out = await f.service.partnerLead(
		{ campaignId: f.plan.campaignId, name: "  Acme Labs ", url: " https://acme.example/team ", note: " a DEX aggregator " },
		f.authArgs,
		f.context,
	);
	assert.equal(out.result, "OK");
	assert.equal(out.passportId, passport);
	assert.equal(out.partnerScout.bountyXp, 5000);
	const call = f.calls.find((c) => c.sql.includes("quest.submit_partner_lead"));
	assert.deepEqual(call.params, [passport, "Acme Labs", "https://acme.example/team", "a DEX aggregator"]);
	const empty = fixture({ published: true });
	await empty.service.partnerLead({ campaignId: empty.plan.campaignId, name: "Acme", url: "https://acme.example", note: "   " }, empty.authArgs, empty.context);
	assert.equal(empty.calls.find((c) => c.sql.includes("quest.submit_partner_lead")).params[3], null);
});

test("a partner lead refuses malformed input before it reaches the database", async () => {
	const f = fixture({ published: true });
	const good = { campaignId: f.plan.campaignId, name: "Acme", url: "https://acme.example", note: "" };
	for (const bad of [
		{ ...good, name: "A" },
		{ ...good, name: "x".repeat(81) },
		{ ...good, name: 5 },
		{ ...good, url: "ftp://acme.example" },
		{ ...good, url: "acme.example" },
		{ ...good, url: "https://" },
		{ ...good, url: "https://a.example/" + "x".repeat(200) },
		{ ...good, note: "n".repeat(301) },
		{ ...good, note: null },
		{ ...good, passportId: passport },
		{ campaignId: good.campaignId, name: good.name, url: good.url },
	])
		await deny(f.service.partnerLead(bad, f.authArgs, f.context), "INVALID_REQUEST");
	assert.ok(!f.calls.some((c) => c.sql.includes("quest.submit_partner_lead")));
});

test("a partner lead maps the weekly limit to RATE_LIMITED and reports a duplicate without an error", async () => {
	const limited = fixture({ published: true, leadError: "Too many leads this week" });
	await deny(
		limited.service.partnerLead({ campaignId: limited.plan.campaignId, name: "Acme", url: "https://acme.example", note: "" }, limited.authArgs, limited.context),
		"RATE_LIMITED",
	);
	const dup = fixture({ published: true, leadResult: "DUPLICATE" });
	const out = await dup.service.partnerLead({ campaignId: dup.plan.campaignId, name: "Acme", url: "https://acme.example", note: "" }, dup.authArgs, dup.context);
	assert.equal(out.result, "DUPLICATE");
	const broken = fixture({ published: true, leadError: "private SQL diagnostic" });
	await deny(
		broken.service.partnerLead({ campaignId: broken.plan.campaignId, name: "Acme", url: "https://acme.example", note: "" }, broken.authArgs, broken.context),
		"UNAVAILABLE",
	);
});

test("xp carries the Partner Scout overview, and a failure there never breaks the XP read", async () => {
	const overview = { bountyXp: 5000, weeklyLimit: 3, remainingThisWeek: 1, leads: [{ name: "Acme", url: "https://acme.example", status: "SUBMITTED", submittedAt: "2026-10-06T00:00:00Z", note: null }] };
	const f = fixture({ published: true, xpTotal: 350, scoutOverview: overview });
	const out = await f.service.xp({ campaignId: f.plan.campaignId }, f.authArgs, f.context);
	assert.deepEqual(out.partnerScout, overview);
	assert.equal(out.totalXp, 350);
	const broken = fixture({ published: true, xpTotal: 350, scoutError: true });
	const safe = await broken.service.xp({ campaignId: broken.plan.campaignId }, broken.authArgs, broken.context);
	assert.equal(safe.partnerScout, null);
	assert.equal(safe.totalXp, 350);
	assert.ok(broken.calls.some((c) => c.sql.includes("ROLLBACK TO SAVEPOINT partner_scout")));
});
