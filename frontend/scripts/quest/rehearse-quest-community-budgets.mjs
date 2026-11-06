import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { calendarHash, communityEntitlementKey } from "./quest-calendar.mjs";
import { createQuestCalendarExample } from "./quest-calendar-example.mjs";
import { createQuestCalendarHttpAdapter } from "./quest-calendar-http.mjs";
import { createQuestCalendarService } from "./quest-calendar-service.mjs";
import { createQuestCalendarStore } from "./quest-calendar-store.mjs";

/** Guarded disposable fixture only; keys and grants below are invented. */
export async function rehearseCommunityBudgets({
	connection,
	calendarApi,
	pool,
	calendarRole,
}) {
	const { environment, auth, context } = calendarApi;
	await connection.query(
		`GRANT SELECT ON quest.community_test_policies,quest.community_test_reservations TO "${calendarRole}"`,
	);
	const store = createQuestCalendarStore({
		pool,
		environment,
		requireCommunityBudget: true,
	});
	const now = new Date(
		(await connection.query("SELECT clock_timestamp() AS now")).rows[0].now,
	);
	const plan = createQuestCalendarExample(now.getUTCFullYear());
	plan.campaignId = "community-budget-sql-fixture";
	const g = plan.communityGoals[now.getUTCMonth()];
	plan.communityGoals.push({ ...g, id: "same-month-second-goal" });
	await store.publish(plan);
	const proof = {
		schemaVersion: 1,
		network: "DEVNET",
		fixtureKind: "SYNTHETIC_DEVNET",
		manifestSha256: environment.manifestSha256,
		valuationVersion: g.valuationVersion,
		observedAt: now.toISOString(),
		sourceKey: "community-budget-fixture",
		pools: [{ poolAddress: g.poolAddresses[0], tvlUsdCents: "50000000" }],
	};
	const args = { campaignId: plan.campaignId, goalId: g.id, proof };
	await assert.rejects(store.observeCommunity(args), /policy not provisioned/);
	const n = Number(
		(
			await connection.query(
				"SELECT count(*) AS n FROM quest.passports WHERE created_at<=$1",
				[proof.observedAt],
			)
		).rows[0].n,
	);
	assert.ok(n > 0);
	const amount = String(n * g.testXp);
	const policy = {
		fixtureKind: "SYNTHETIC_DEVNET",
		network: "DEVNET",
		revision: 1,
		perCampaignMonthXp: amount,
		perCampaignYearXp: String(n * g.testXp * 2),
	};
	await assert.rejects(
		connection.query(
			"INSERT INTO quest.community_test_policies VALUES($1,$2::jsonb)",
			[
				plan.campaignId,
				JSON.stringify({ ...policy, perCampaignMonthXp: "01" }),
			],
		),
		/ceiling/,
	);
	await connection.query(
		"INSERT INTO quest.community_test_policies VALUES($1,$2::jsonb)",
		[plan.campaignId, JSON.stringify(policy)],
	);
	assert.equal(
		(await store.communityBudget(plan.campaignId)).reservedTestXp,
		"0",
	);
	// Two distinct goals compete for one remaining full-audience allocation.
	const outcomes = await Promise.allSettled([
		store.observeCommunity(args),
		store.observeCommunity({ ...args, goalId: "same-month-second-goal" }),
	]);
	assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
	assert.match(
		outcomes.find((o) => o.status === "rejected").reason.message,
		/budget exceeded/,
	);
	const winner = outcomes.find((o) => o.status === "fulfilled").value;
	const replay = await store.observeCommunity({
		...args,
		goalId: winner.receipt.goalId,
		proof: null,
	});
	assert.equal(replay.created, false);
	assert.deepEqual(replay.receipt, winner.receipt);
	const budget = await store.communityBudget(plan.campaignId);
	assert.equal(budget.reservedTestXp, amount);
	assert.equal(budget.months[0].remainingTestXp, "0");
	assert.equal(budget.remainingTestXp, amount);
	assert.ok(!JSON.stringify(budget).includes("passportId"));
	assert.equal(
		Number(
			(
				await connection.query(
					"SELECT count(*) AS n FROM quest.calendar_milestones WHERE campaign_id=$1",
					[plan.campaignId],
				)
			).rows[0].n,
		),
		1,
	);
	assert.equal(
		Number(
			(
				await connection.query(
					"SELECT count(*) AS n FROM quest.community_test_reservations WHERE campaign_id=$1",
					[plan.campaignId],
				)
			).rows[0].n,
		),
		1,
	);
	// Direct SQL bypass attempts must also roll back the milestone itself.
	const losingGoal =
		winner.receipt.goalId === g.id ? "same-month-second-goal" : g.id;
	const raw = { ...winner.receipt, goalId: losingGoal, entitlements: [] };
	await assert.rejects(
		connection.query(
			"INSERT INTO quest.calendar_milestones VALUES($1,$2,$3,$4::jsonb,clock_timestamp())",
			[plan.campaignId, losingGoal, calendarHash(raw), JSON.stringify(raw)],
		),
		/audience differs/,
	);
	const expired = {
		...raw,
		audienceCutoff: new Date(now.getTime() - 600000).toISOString(),
	};
	await assert.rejects(
		connection.query(
			"INSERT INTO quest.calendar_milestones VALUES($1,$2,$3,$4::jsonb,clock_timestamp())",
			[
				plan.campaignId,
				losingGoal,
				calendarHash(expired),
				JSON.stringify(expired),
			],
		),
		/expired or differs/,
	);
	const repeatable = await pool.connect();
	try {
		await repeatable.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
		await assert.rejects(
			repeatable.query(
				"INSERT INTO quest.calendar_milestones VALUES($1,$2,$3,$4::jsonb,clock_timestamp())",
				[plan.campaignId, losingGoal, calendarHash(raw), JSON.stringify(raw)],
			),
			/read committed/,
		);
		await repeatable.query("ROLLBACK");
	} finally {
		repeatable.release();
	}
	// A distinct campaign verifies the year ceiling even with monthly headroom.
	const yearPlan = {
		...structuredClone(plan),
		campaignId: "community-year-budget-fixture",
	};
	await store.publish(yearPlan);
	await connection.query(
		"INSERT INTO quest.community_test_policies VALUES($1,$2::jsonb)",
		[
			yearPlan.campaignId,
			JSON.stringify({
				...policy,
				perCampaignMonthXp: String(Number(amount) * 2),
				perCampaignYearXp: amount,
			}),
		],
	);
	const identical = await Promise.all([
		store.observeCommunity({ ...args, campaignId: yearPlan.campaignId }),
		store.observeCommunity({ ...args, campaignId: yearPlan.campaignId }),
	]);
	assert.equal(identical.filter((o) => o.created).length, 1);
	await assert.rejects(
		store.observeCommunity({
			...args,
			campaignId: yearPlan.campaignId,
			goalId: "same-month-second-goal",
		}),
		/budget exceeded/,
	);
	const yearBudget = await store.communityBudget(yearPlan.campaignId);
	assert.equal(yearBudget.remainingTestXp, "0");
	assert.equal(yearBudget.months[0].remainingTestXp, amount);
	// Prove the campaign lock is acquired before the unique milestone row.
	// B must wait without inserting a conflicting row that would deadlock A.
	const lockPlan = {
		...structuredClone(plan),
		campaignId: "community-lock-order-fixture",
	};
	await store.publish(lockPlan);
	await connection.query(
		"INSERT INTO quest.community_test_policies VALUES($1,$2::jsonb)",
		[lockPlan.campaignId, JSON.stringify(policy)],
	);
	const lockReceipt = {
		...winner.receipt,
		campaignId: lockPlan.campaignId,
		entitlements: winner.receipt.entitlements.map((e) => ({
			...e,
			entitlementKey: communityEntitlementKey(
				lockPlan.campaignId,
				winner.receipt.goalId,
				e.passportId,
			),
		})),
	};
	const lockArgs = [
		lockPlan.campaignId,
		lockReceipt.goalId,
		calendarHash(lockReceipt),
		JSON.stringify(lockReceipt),
	];
	const a = await pool.connect(),
		b = await pool.connect();
	let waiting;
	try {
		await a.query("BEGIN");
		await a.query("SET LOCAL statement_timeout='5000ms'");
		await a.query("SELECT pg_advisory_xact_lock(hashtextextended($1,61748))", [
			lockPlan.campaignId,
		]);
		await b.query("BEGIN");
		await b.query("SET LOCAL statement_timeout='5000ms'");
		const pid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
		waiting = b
			.query(
				"INSERT INTO quest.calendar_milestones VALUES($1,$2,$3,$4::jsonb,clock_timestamp())",
				lockArgs,
			)
			.then(
				() => null,
				(e) => e,
			);
		let blocked = false;
		for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
			blocked =
				Number(
					(
						await connection.query(
							"SELECT count(*) AS n FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted",
							[pid],
						)
					).rows[0].n,
				) > 0;
			if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.ok(blocked, "direct insert must wait on the campaign lock");
		await a.query(
			"INSERT INTO quest.calendar_milestones VALUES($1,$2,$3,$4::jsonb,clock_timestamp())",
			lockArgs,
		);
		await a.query("COMMIT");
		assert.equal((await waiting).code, "23505");
		await b.query("ROLLBACK");
	} finally {
		await a.query("ROLLBACK");
		await b.query("ROLLBACK");
		if (waiting) await waiting;
		a.release();
		b.release();
	}
	assert.equal(
		(await store.communityBudget(lockPlan.campaignId)).reservedTestXp,
		amount,
	);
	await assert.rejects(
		connection.query(
			"INSERT INTO quest.community_test_policies VALUES($1,$2::jsonb)",
			[calendarApi.plan.campaignId, JSON.stringify(policy)],
		),
		/precede all milestones/,
	);
	for (const table of [
		"community_test_policies",
		"community_test_reservations",
		"weekly_test_receipts",
		"weekly_test_policies",
		"calendar_milestones",
		"calendar_plans",
		"calendar_plan_revisions",
	]) {
		await assert.rejects(
			connection.query(`TRUNCATE quest.${table} CASCADE`),
			/immutable/,
		);
		await assert.rejects(
			connection.query(`DELETE FROM quest.${table}`),
			/immutable/,
		);
	}
	const restricted = await pool.connect();
	try {
		for (const sql of [
			"INSERT INTO quest.community_test_policies DEFAULT VALUES",
			"INSERT INTO quest.community_test_reservations DEFAULT VALUES",
			"INSERT INTO quest.xp_events DEFAULT VALUES",
		])
			await assert.rejects(restricted.query(sql), /permission denied/);
	} finally {
		restricted.release();
	}
	// Authenticate the weekly fixture's actual owner and prove caller identity
	// cannot be replaced by a body field. Its source was invalidated previously;
	// reserved history remains visible and explicitly test-only.
	const pair = nacl.sign.keyPair.fromSeed(Buffer.alloc(32, 221)),
		wallet = new PublicKey(pair.publicKey).toBase58(),
		passportId = "d1000000-0000-4000-8000-000000000001";
	const challenge = await auth.issueChallenge({ passportId, wallet }, context);
	const session = await auth.authenticate(
		{
			message: challenge.message,
			signature: Buffer.from(
				nacl.sign.detached(
					new TextEncoder().encode(challenge.message),
					pair.secretKey,
				),
			).toString("base64"),
		},
		context,
	);
	const authentication = {
		cookieHeader: session.cookie.split(";")[0],
		csrfToken: session.csrfToken,
	};
	const service = createQuestCalendarService({
		auth,
		environment,
		requireCommunityBudget: true,
	});
	const page = {
		campaignId: calendarApi.plan.campaignId,
		before: null,
		limit: 1,
	};
	const history = await service.history(page, authentication, context);
	assert.equal(history.passportId, passportId);
	assert.equal(history.receipts.length, 1);
	assert.equal(history.receipts[0].awardEligible, false);
	assert.ok(!JSON.stringify(history).includes("f1000000"));
	await assert.rejects(
		service.history(
			{ ...page, passportId: "f1000000-0000-4000-8000-000000000001" },
			authentication,
			context,
		),
		(e) => e.code === "INVALID_REQUEST",
	);
	await assert.rejects(
		service.history(
			page,
			{
				...authentication,
				csrfToken: Buffer.alloc(32, 22).toString("base64url"),
			},
			context,
		),
		(e) => e.code === "FORBIDDEN",
	);
	await assert.rejects(
		service.budget({ campaignId: plan.campaignId }, authentication, context),
		(e) => e.code === "FORBIDDEN",
	);
	const link = (
		await connection.query(
			"SELECT link_id FROM quest.wallet_links WHERE passport_id=$1 AND unlinked_at IS NULL",
			[passportId],
		)
	).rows[0].link_id;
	await connection.query(
		"INSERT INTO quest.calendar_operator_grants(grant_id,passport_id,link_id,campaign_id,capability,issued_at,expires_at) VALUES('a1000000-0000-4000-8000-000000000999',$1,$2,$3,'observe',date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',clock_timestamp())+interval '1 hour')",
		[passportId, link, plan.campaignId],
	);
	assert.deepEqual(
		await service.budget(
			{ campaignId: plan.campaignId },
			authentication,
			context,
		),
		budget,
	);
	await assert.rejects(
		service.mutate(
			"observe",
			{
				...args,
				goalId: losingGoal,
				requestId: "a1000000-0000-4000-8000-000000000998",
			},
			authentication,
			context,
		),
		(e) => e.code === "CONFLICT",
	);
	assert.equal(
		Number(
			(
				await connection.query(
					"SELECT count(*) AS n FROM quest.calendar_operator_requests WHERE request_id='a1000000-0000-4000-8000-000000000998'",
				)
			).rows[0].n,
		),
		0,
	);
	const audited = await service.mutate(
		"observe",
		{
			...args,
			goalId: winner.receipt.goalId,
			requestId: "a1000000-0000-4000-8000-000000000997",
		},
		authentication,
		context,
	);
	assert.equal(audited.created, false);
	assert.equal(
		(await store.communityBudget(plan.campaignId)).reservedTestXp,
		amount,
	);
	const handle = createQuestCalendarHttpAdapter({
		service,
		resolveClientContext: async () => context,
	});
	for (const [operation, body] of [
		["history", page],
		["budget", { campaignId: plan.campaignId }],
	]) {
		const res = await handle(
			operation,
			new Request(`${context.origin}/quest`, {
				method: "POST",
				headers: {
					origin: context.origin,
					"content-type": "application/json",
					cookie: authentication.cookieHeader,
					"x-solve3-csrf": authentication.csrfToken,
				},
				body: JSON.stringify(body),
			}),
		);
		assert.equal(res.status, 200);
		assert.equal(res.headers.get("cache-control"), "no-store");
	}
	assert.equal(
		Number(
			(await connection.query("SELECT count(*) AS n FROM quest.xp_events"))
				.rows[0].n,
		),
		0,
	);
	console.log(
		"Community budgets: full-audience atomic monthly cap race/retry, immutable policy/history/TRUNCATE, restricted roles, protected private weekly history/budget HTTP and zero XP passed.",
	);
}
