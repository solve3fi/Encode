import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { createDurablePassportAuth } from "./passport-durable-auth.mjs";
import { createQuestBrowserClient } from "./quest-browser-client.mjs";
import { createQuestCalendarExample } from "./quest-calendar-example.mjs";
import { createQuestCalendarHttpAdapter } from "./quest-calendar-http.mjs";
import { createQuestCalendarService } from "./quest-calendar-service.mjs";
import { createQuestTestWebHandler } from "./quest-test-web-handler.mjs";

const origin = "https://quest.solve3.test",
	context = { origin, clientKey: "calendar-api-fixture" };
const environment = {
	network: "DEVNET",
	environmentId: "33333333-3333-4333-8333-333333333333",
	manifestSha256: "a".repeat(64),
};
const policies = Object.fromEntries(
	["challenge", "authenticate", "session"].map((k) => [
		k,
		{ limit: 1000, windowMs: 3600000 },
	]),
);
const uuid = (n) => `c1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const denied = (promise, code) =>
	assert.rejects(promise, (e) => e.code === code);
function gate() {
	let resolve;
	const promise = new Promise((r) => (resolve = r));
	return { promise, resolve };
}
async function bounded(promise) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise(
				(_, reject) =>
					(timer = setTimeout(
						() => reject(new Error("Calendar API fixture gate timeout")),
						20000,
					)),
			),
		]);
	} finally {
		clearTimeout(timer);
	}
}

export async function rehearseQuestCalendarApi({
	connection,
	makePool,
	calendarRole,
	authRole,
}) {
	await connection.query(`GRANT "${authRole}" TO "${calendarRole}"`);
	await connection.query(
		`GRANT SELECT,INSERT ON quest.calendar_operator_requests TO "${calendarRole}"`,
	);
	await connection.query(
		`GRANT SELECT ON quest.weekly_test_receipts TO "${calendarRole}"`,
	);
	await connection.query(
		`GRANT EXECUTE ON FUNCTION quest.lock_calendar_operator_grant(uuid,text,text) TO "${calendarRole}"`,
	);
	const pool = makePool(calendarRole),
		auth = createDurablePassportAuth({
			pool,
			environment,
			origin,
			ratePolicies: policies,
			rateKeySecret: Buffer.alloc(32, 51),
		}),
		service = createQuestCalendarService({ auth, environment });
	const setup = async (n) => {
		const pair = nacl.sign.keyPair.fromSeed(Buffer.alloc(32, 230 + n)),
			wallet = new PublicKey(pair.publicKey).toBase58(),
			passportId = uuid(n);
		await connection.query(
			"INSERT INTO quest.passports(network,passport_id) VALUES('DEVNET',$1)",
			[passportId],
		);
		await connection.query(
			"INSERT INTO quest.wallet_bindings(network,wallet,passport_id) VALUES('DEVNET',$1,$2)",
			[wallet, passportId],
		);
		const link = (
			await connection.query(
				"INSERT INTO quest.wallet_links(wallet,passport_id,linked_at,link_evidence_sha256) VALUES($1,$2,clock_timestamp()-interval '10 minutes',repeat('c',64)) RETURNING link_id",
				[wallet, passportId],
			)
		).rows[0].link_id;
		const login = async () => {
			const c = await auth.issueWalletChallenge({ wallet }, context);
			const out = await auth.authenticate(
				{
					message: c.message,
					signature: Buffer.from(
						nacl.sign.detached(
							new TextEncoder().encode(c.message),
							pair.secretKey,
						),
					).toString("base64"),
				},
				context,
			);
			return {
				cookieHeader: out.cookie.split(";")[0],
				csrfToken: out.csrfToken,
			};
		};
		return { passportId, wallet, link, login };
	};
	const owner = await setup(1),
		reader = await setup(2),
		ownerAuth = await owner.login(),
		readerAuth = await reader.login();
	const at = new Date(
			(await connection.query("SELECT clock_timestamp() AS now")).rows[0].now,
		),
		plan = createQuestCalendarExample(at.getUTCFullYear());
	plan.campaignId = "calendar-api-fixture";
	let grantSequence = 100;
	const grant = async (
		person,
		campaign,
		capability,
		expiresAt = new Date(at.getTime() + 3600000).toISOString(),
	) => {
		const grantId = uuid(++grantSequence);
		await connection.query(
			"INSERT INTO quest.calendar_operator_grants(grant_id,passport_id,link_id,campaign_id,capability,issued_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
			[
				grantId,
				person.passportId,
				person.link,
				campaign,
				capability,
				new Date(at.getTime() - 1000).toISOString(),
				expiresAt,
			],
		);
		return grantId;
	};
	await denied(
		service.mutate(
			"publish",
			{ requestId: uuid(10), plan },
			readerAuth,
			context,
		),
		"FORBIDDEN",
	);

	// Revocation wins when its exclusive row lock was acquired first.
	const revokedFirstPlan = createQuestCalendarExample(at.getUTCFullYear() + 2);
	revokedFirstPlan.campaignId = "calendar-api-revoked-first";
	const revokedFirstGrant = await grant(
			owner,
			revokedFirstPlan.campaignId,
			"publish",
		),
		revoker = await makePool("postgres").connect();
	await revoker.query("BEGIN");
	await revoker.query(
		"UPDATE quest.calendar_operator_grants SET revoked_at=clock_timestamp() WHERE grant_id=$1",
		[revokedFirstGrant],
	);
	const refused = service.mutate(
		"publish",
		{ requestId: uuid(16), plan: revokedFirstPlan },
		ownerAuth,
		context,
	);
	const refusedCheck = denied(refused, "FORBIDDEN");
	try {
		let waiting = false;
		for (let i = 0; i < 100; i++) {
			waiting = (
				await connection.query(
					"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%SELECT quest.lock_calendar_operator_grant%') AS waiting",
				)
			).rows[0].waiting;
			if (waiting) break;
			await new Promise((r) => setTimeout(r, 20));
		}
		assert.equal(waiting, true);
	} finally {
		await revoker.query("COMMIT");
		revoker.release();
	}
	await bounded(refusedCheck);
	assert.equal(
		Number(
			(
				await connection.query(
					"SELECT count(*) AS n FROM quest.calendar_plans WHERE campaign_id=$1",
					[revokedFirstPlan.campaignId],
				)
			).rows[0].n,
		),
		0,
	);
	for (const cap of ["publish", "revise", "observe"])
		await grant(owner, plan.campaignId, cap);
	const publishInput = { requestId: uuid(11), plan };
	const publications = await Promise.all([
		service.mutate("publish", publishInput, ownerAuth, context),
		service.mutate("publish", publishInput, ownerAuth, context),
	]);
	assert.equal(publications.filter((x) => x.replayed).length, 1);
	// Exercise the exact browser controller through real HTTP adapters and SQL,
	// using an invented signing wallet. Cookie handling here emulates the browser.
	const web = createQuestTestWebHandler({
		auth,
		service,
		resolveClientContext: async () => context,
	});
	let browserCookie = "";
	const browser = createQuestBrowserClient({
		origin,
		campaignId: plan.campaignId,
		fetchImpl: async (url, options) => {
			const parts = url.split("/");
			const response = await web(
				parts.at(-2),
				parts.at(-1),
				new Request(origin + url, {
					...options,
					headers: { ...options.headers, origin, cookie: browserCookie },
				}),
			);
			if (response.headers.get("set-cookie"))
				browserCookie = response.headers.get("set-cookie").split(";")[0];
			return response;
		},
	});
	browser.setIdentity(reader.wallet, "devnet");
	await browser.signIn(async (message) =>
		nacl.sign.detached(
			message,
			nacl.sign.keyPair.fromSeed(Buffer.alloc(32, 232)).secretKey,
		),
	);
	assert.equal(browser.getState().status, "READY");
	assert.equal(browser.getState().snapshot.passportId, reader.passportId);
	assert.equal(browser.getState().snapshot.weekly.quests.length, 3);
	assert.ok(
		browser.getState().snapshot.weekly.quests.every((q) => q.progress === null),
	);
	assert.equal(browser.getState().history.receipts.length, 0);
	await browser.logout();
	assert.equal(browser.getState().snapshot, null);
	assert.equal(browser.getState().status, "SIGNED_OUT");
	assert.equal(
		Number(
			(
				await connection.query(
					"SELECT count(*) AS n FROM quest.calendar_operator_requests WHERE request_id=$1",
					[publishInput.requestId],
				)
			).rows[0].n,
		),
		1,
	);
	const different = structuredClone(publishInput);
	different.plan.templates[0].testXp++;
	await denied(
		service.mutate("publish", different, ownerAuth, context),
		"CONFLICT",
	);
	await denied(
		service.operatorPlan({ campaignId: plan.campaignId }, readerAuth, context),
		"FORBIDDEN",
	);
	assert.equal(
		(
			await service.operatorPlan(
				{ campaignId: plan.campaignId },
				ownerAuth,
				context,
			)
		).revision,
		1,
	);
	await denied(
		service.snapshot(
			{ campaignId: plan.campaignId, passportId: owner.passportId },
			readerAuth,
			context,
		),
		"INVALID_REQUEST",
	);
	const goal = plan.communityGoals[at.getUTCMonth()],
		observedAt = new Date(
			(await connection.query("SELECT clock_timestamp() AS now")).rows[0].now,
		).toISOString();
	const proof = {
		schemaVersion: 1,
		network: "DEVNET",
		fixtureKind: "SYNTHETIC_DEVNET",
		manifestSha256: environment.manifestSha256,
		valuationVersion: goal.valuationVersion,
		observedAt,
		sourceKey: "calendar-api-synthetic-tvl",
		pools: [{ poolAddress: goal.poolAddresses[0], tvlUsdCents: "50000000" }],
	};
	const reached = await service.mutate(
		"observe",
		{
			requestId: uuid(12),
			campaignId: plan.campaignId,
			goalId: goal.id,
			proof,
		},
		ownerAuth,
		context,
	);
	assert.equal(reached.reached, true);
	assert.equal(reached.awardEligible, false);
	assert.ok(!Object.hasOwn(reached, "entitlements"));
	for (const [person, credentials] of [
		[owner, ownerAuth],
		[reader, readerAuth],
	]) {
		const view = await service.snapshot(
			{ campaignId: plan.campaignId },
			credentials,
			context,
		);
		assert.equal(view.passportId, person.passportId);
		assert.equal(view.milestones[0].entitlement.passportId, person.passportId);
		assert.equal(view.milestones[0].entitlement.testXp, 1000);
		assert.ok(
			!JSON.stringify(view).includes(
				person === owner ? reader.passportId : owner.passportId,
			),
		);
	}
	const http = createQuestCalendarHttpAdapter({
		service,
		resolveClientContext: async () => ({ clientKey: context.clientKey }),
	});
	const request = (input, credentials) =>
		new Request(`${origin}/calendar`, {
			method: "POST",
			headers: {
				origin,
				"content-type": "application/json",
				cookie: credentials.cookieHeader,
				"x-solve3-csrf": credentials.csrfToken,
			},
			body: JSON.stringify(input),
		});
	assert.equal(
		(
			await http(
				"snapshot",
				request({ campaignId: plan.campaignId }, readerAuth),
			)
		).status,
		200,
	);
	assert.equal(
		(
			await http(
				"operator-plan",
				request({ campaignId: plan.campaignId }, readerAuth),
			)
		).status,
		403,
	);
	assert.equal(
		(
			await http(
				"snapshot",
				request(
					{ campaignId: plan.campaignId },
					{
						...readerAuth,
						csrfToken: Buffer.alloc(32, 90).toString("base64url"),
					},
				),
			)
		).status,
		403,
	);

	// A failed audit insertion must roll back the calendar itself, not just auth.
	const future = createQuestCalendarExample(at.getUTCFullYear() + 2);
	future.campaignId = "calendar-api-audit-failure";
	await grant(owner, future.campaignId, "publish");
	const badAuth = createDurablePassportAuth({
		pool: makePool(calendarRole, async (sql) => {
			if (sql.includes("INSERT INTO quest.calendar_operator_requests"))
				throw new Error("Injected fixture audit failure");
		}),
		environment,
		origin,
		ratePolicies: policies,
		rateKeySecret: Buffer.alloc(32, 51),
	});
	await denied(
		createQuestCalendarService({ auth: badAuth, environment }).mutate(
			"publish",
			{ requestId: uuid(13), plan: future },
			ownerAuth,
			context,
		),
		"UNAVAILABLE",
	);
	assert.equal(
		Number(
			(
				await connection.query(
					"SELECT count(*) AS n FROM quest.calendar_plans WHERE campaign_id=$1",
					[future.campaignId],
				)
			).rows[0].n,
		),
		0,
	);
	assert.equal(
		Number(
			(
				await connection.query(
					"SELECT count(*) AS n FROM quest.calendar_operator_requests WHERE request_id=$1",
					[uuid(13)],
				)
			).rows[0].n,
		),
		0,
	);

	// Hold a real grant share lock while a second client tries to revoke it.
	const revocationPlan = createQuestCalendarExample(at.getUTCFullYear() + 2);
	revocationPlan.campaignId = "calendar-api-revocation";
	const revokeGrant = await grant(owner, revocationPlan.campaignId, "publish");
	const held = gate(),
		resume = gate();
	let intercepted = false;
	const slowAuth = createDurablePassportAuth({
		pool: makePool(calendarRole, async (sql) => {
			if (sql.includes("INSERT INTO quest.calendar_plans") && !intercepted) {
				intercepted = true;
				held.resolve();
				await bounded(resume.promise);
			}
		}),
		environment,
		origin,
		ratePolicies: policies,
		rateKeySecret: Buffer.alloc(32, 51),
	});
	const write = createQuestCalendarService({
		auth: slowAuth,
		environment,
	}).mutate(
		"publish",
		{ requestId: uuid(14), plan: revocationPlan },
		ownerAuth,
		context,
	);
	await bounded(held.promise);
	const peer = await makePool("postgres").connect();
	let revoke;
	try {
		const pid = (await peer.query("SELECT pg_backend_pid() AS pid")).rows[0]
			.pid;
		revoke = peer.query(
			"UPDATE quest.calendar_operator_grants SET revoked_at=clock_timestamp() WHERE grant_id=$1",
			[revokeGrant],
		);
		let waiting = false;
		for (let i = 0; i < 100; i++) {
			waiting =
				(
					await connection.query(
						"SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
						[pid],
					)
				).rows[0]?.wait_event_type === "Lock";
			if (waiting) break;
			await new Promise((r) => setTimeout(r, 20));
		}
		assert.equal(waiting, true);
	} finally {
		resume.resolve();
	}
	assert.equal((await bounded(write)).created, true);
	await bounded(revoke);
	peer.release();
	await denied(
		service.mutate(
			"publish",
			{ requestId: uuid(14), plan: revocationPlan },
			ownerAuth,
			context,
		),
		"FORBIDDEN",
	);

	// Expiration after the database write but before audit/commit rolls back both.
	const expiresPlan = createQuestCalendarExample(at.getUTCFullYear() + 2);
	expiresPlan.campaignId = "calendar-api-expiry";
	const nowMs = new Date(
		(await connection.query("SELECT clock_timestamp() AS now")).rows[0].now,
	).getTime();
	await grant(
		owner,
		expiresPlan.campaignId,
		"publish",
		new Date(nowMs + 1000).toISOString(),
	);
	const expiredAuth = createDurablePassportAuth({
		pool: makePool(calendarRole, async (sql) => {
			if (sql.includes("INSERT INTO quest.calendar_plans"))
				await new Promise((r) => setTimeout(r, 1200));
		}),
		environment,
		origin,
		ratePolicies: policies,
		rateKeySecret: Buffer.alloc(32, 51),
	});
	await denied(
		createQuestCalendarService({ auth: expiredAuth, environment }).mutate(
			"publish",
			{ requestId: uuid(15), plan: expiresPlan },
			ownerAuth,
			context,
		),
		"UNAVAILABLE",
	);
	assert.equal(
		Number(
			(
				await connection.query(
					"SELECT count(*) AS n FROM quest.calendar_plans WHERE campaign_id=$1",
					[expiresPlan.campaignId],
				)
			).rows[0].n,
		),
		0,
	);
	await assert.rejects(
		connection.query("DELETE FROM quest.calendar_operator_requests"),
		/immutable/,
	);
	await assert.rejects(
		connection.query(
			"UPDATE quest.calendar_operator_grants SET revoked_at=NULL WHERE grant_id=$1",
			[revokeGrant],
		),
		/revoked once/,
	);
	const restricted = await pool.connect();
	try {
		for (const sql of [
			"INSERT INTO quest.calendar_operator_grants DEFAULT VALUES",
			"UPDATE quest.calendar_operator_grants SET revoked_at=clock_timestamp()",
			"INSERT INTO quest.xp_events DEFAULT VALUES",
		])
			await assert.rejects(restricted.query(sql), /permission denied/);
	} finally {
		restricted.release();
	}
	await connection.query(
		"UPDATE quest.wallet_links SET unlinked_at=clock_timestamp(),unlink_evidence_sha256=repeat('d',64) WHERE link_id=$1",
		[owner.link],
	);
	await denied(
		service.operatorPlan({ campaignId: plan.campaignId }, ownerAuth, context),
		"UNAUTHORIZED",
	);
	await connection.query(
		"INSERT INTO quest.wallet_links(wallet,passport_id,linked_at,link_evidence_sha256) VALUES($1,$2,clock_timestamp(),repeat('e',64))",
		[owner.wallet, owner.passportId],
	);
	const relinkAuth = await owner.login();
	await denied(
		service.operatorPlan({ campaignId: plan.campaignId }, relinkAuth, context),
		"FORBIDDEN",
	);
	assert.equal(
		(
			await service.snapshot(
				{ campaignId: plan.campaignId },
				relinkAuth,
				context,
			)
		).milestones[0].entitlement.passportId,
		owner.passportId,
	);
	assert.equal(
		Number(
			(await connection.query("SELECT count(*) AS n FROM quest.xp_events"))
				.rows[0].n,
		),
		0,
	);
	console.log(
		"Calendar API: real signatures, one transaction, scoped capabilities, private views, request replay/conflict, audit rollback, grant lock/revocation/expiry, HTTP/CSRF, role denial and unlink refusal passed.",
	);
	return { auth, environment, context, plan };
}
