// Synthetic wallets only, called by the guarded disposable SQL rehearsal.
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { createPassportAuthHttpAdapter } from "./passport-auth-http.mjs";
import {
	buildChallengeMessage,
	hashNonce,
	parseChallengeMessage,
} from "./passport-challenge.mjs";
import {
	createDurablePassportAuth,
	PassportAuthFault,
} from "./passport-durable-auth.mjs";
import { hashCsrfToken, hashSessionToken } from "./passport-session.mjs";

const origin = "https://quest.solve3.test",
	context = { origin, clientKey: "auth-sql-fixture" };
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
const sign = (pair, message) =>
	Buffer.from(
		nacl.sign.detached(new TextEncoder().encode(message), pair.secretKey),
	).toString("base64");
const cookie = (out) => out.cookie.split(";")[0];
const deny = (promise, code) =>
	assert.rejects(
		promise,
		(e) => e instanceof PassportAuthFault && e.code === code,
	);
function gate() {
	let release;
	const promise = new Promise((resolve) => {
		release = resolve;
	});
	return { promise, release };
}
async function reached(promise) {
	let timer;
	try {
		await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Auth SQL gate timeout")),
					30000,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
export async function rehearseDurablePassportAuth({
	connection,
	makePool,
	authRole,
}) {
	await connection.query(`GRANT USAGE ON SCHEMA quest TO "${authRole}"`);
	await connection.query(
		`GRANT SELECT ON quest.environment_identity,quest.wallet_challenges,quest.passport_sessions,quest.passport_challenge_bindings,quest.passport_auth_bindings,quest.wallet_links TO "${authRole}"`,
	);
	await connection.query(
		`GRANT INSERT ON quest.wallet_challenges,quest.passport_sessions,quest.passport_challenge_bindings,quest.passport_auth_bindings TO "${authRole}"`,
	);
	await connection.query(
		`GRANT UPDATE(consumed_at) ON quest.wallet_challenges TO "${authRole}"`,
	);
	await connection.query(
		`GRANT UPDATE(revoked_at) ON quest.passport_sessions TO "${authRole}"`,
	);
	await connection.query(
		`GRANT EXECUTE ON FUNCTION quest.take_passport_rate_limit(text,text),quest.lock_passport_auth_link(uuid,text) TO "${authRole}"`,
	);
	for (const [scope, p] of Object.entries(policies))
		await connection.query(
			"INSERT INTO quest.passport_rate_policies(scope,request_limit,window_ms) VALUES($1,$2,$3)",
			[scope, p.limit, p.windowMs],
		);
	const pool = makePool(authRole),
		rootPool = makePool("postgres");
	const create = (patch = {}) =>
		createDurablePassportAuth({
			pool,
			environment,
			origin,
			ratePolicies: policies,
			rateKeySecret: Buffer.alloc(32, 23),
			...patch,
		});
	const auth = create();
	let sequence = 0;
	const setup = async () => {
		sequence++;
		const pair = nacl.sign.keyPair.fromSeed(Buffer.alloc(32, 100 + sequence));
		const wallet = new PublicKey(pair.publicKey).toBase58(),
			passportId = `d0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
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
				"INSERT INTO quest.wallet_links(wallet,passport_id,linked_at,link_evidence_sha256) VALUES($1,$2,clock_timestamp()-interval '10 minutes',repeat('c',64)) RETURNING link_id::text",
				[wallet, passportId],
			)
		).rows[0].link_id;
		return { pair, wallet, passportId, link };
	};
	const issue = (f) => auth.issueChallenge(f, context);
	const login = async (f) => {
		const c = await issue(f);
		return auth.authenticate(
			{ message: c.message, signature: sign(f.pair, c.message) },
			context,
		);
	};
	const unlink = (client, f) =>
		client.query(
			"UPDATE quest.wallet_links SET unlinked_at=clock_timestamp(),unlink_evidence_sha256=repeat('d',64) WHERE link_id=$1",
			[f.link],
		);
	const relink = async (f) => {
		const r = await connection.query(
			"INSERT INTO quest.wallet_links(wallet,passport_id,linked_at,link_evidence_sha256) VALUES($1,$2,clock_timestamp(),repeat('e',64)) RETURNING link_id::text",
			[f.wallet, f.passportId],
		);
		return { ...f, link: r.rows[0].link_id };
	};
	const count = async (table) =>
		Number(
			(await connection.query(`SELECT count(*)::int AS n FROM quest.${table}`))
				.rows[0].n,
		);
	const waitForLock = async (pid) => {
		for (let i = 0; i < 100; i++) {
			const r = await connection.query(
				"SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
				[pid],
			);
			if (r.rows[0]?.wait_event_type === "Lock") return;
			await new Promise((r) => setTimeout(r, 20));
		}
		throw new Error("Expected actual PostgreSQL row lock wait");
	};

	const f = await setup(),
		c = await issue(f);
	const contenders = await Promise.allSettled([
		auth.authenticate(
			{ message: c.message, signature: sign(f.pair, c.message) },
			context,
		),
		auth.authenticate(
			{ message: c.message, signature: sign(f.pair, c.message) },
			context,
		),
	]);
	assert.equal(contenders.filter((r) => r.status === "fulfilled").length, 1);
	assert.equal(
		contenders.filter(
			(r) => r.status === "rejected" && r.reason.code === "UNAUTHORIZED",
		).length,
		1,
	);
	let session = contenders.find((r) => r.status === "fulfilled").value;
	assert.equal(await count("passport_auth_bindings"), 1);
	assert.equal(
		(await auth.readSession({ cookieHeader: cookie(session) }, context))
			.passportId,
		f.passportId,
	);
	await deny(
		auth.authenticate(
			{ message: c.message, signature: sign(f.pair, c.message) },
			context,
		),
		"UNAUTHORIZED",
	);
	await deny(
		auth.withSession(
			{
				cookieHeader: cookie(session),
				csrfToken: Buffer.alloc(32, 0).toString("base64url"),
			},
			context,
			() => {
				throw new Error("Must not run");
			},
		),
		"FORBIDDEN",
	);
	await deny(
		auth.authenticate(
			{
				message: (await issue(f)).message,
				signature: Buffer.alloc(64, 0).toString("base64"),
			},
			context,
		),
		"UNAUTHORIZED",
	);
	const forged = await issue(f),
		p = parseChallengeMessage(forged.message),
		other = await setup();
	const forgedMessage = buildChallengeMessage({
		...p,
		passportId: other.passportId,
	});
	await deny(
		auth.authenticate(
			{ message: forgedMessage, signature: sign(f.pair, forgedMessage) },
			context,
		),
		"UNAUTHORIZED",
	);
	assert.equal(
		(
			await connection.query(
				"SELECT consumed_at FROM quest.wallet_challenges WHERE nonce_hash=$1",
				[hashNonce(p.nonce)],
			)
		).rows[0].consumed_at,
		null,
	);

	// Creation failure rolls nonce consumption back, enabling a legitimate retry.
	const atomic = await issue(f),
		atomicInput = {
			message: atomic.message,
			signature: sign(f.pair, atomic.message),
		};
	const brokenPool = {
		async connect() {
			const client = await pool.connect();
			return {
				query(sql, params) {
					if (sql.startsWith("INSERT INTO quest.passport_auth_bindings"))
						throw new Error("Injected persistence failure");
					return client.query(sql, params);
				},
				release(error) {
					client.release(error);
				},
			};
		},
	};
	await deny(
		create({ pool: brokenPool }).authenticate(atomicInput, context),
		"UNAVAILABLE",
	);
	assert.equal(
		(
			await connection.query(
				"SELECT consumed_at FROM quest.wallet_challenges WHERE nonce_hash=$1",
				[hashNonce(parseChallengeMessage(atomic.message).nonce)],
			)
		).rows[0].consumed_at,
		null,
	);
	await auth.authenticate(atomicInput, context);

	// Shared counter never grants more than its policy across independent clients.
	const rateKey = "7".repeat(64);
	const attempts = await Promise.all(
		Array.from({ length: 12 }, async () => {
			const client = await pool.connect();
			try {
				return (
					await client.query(
						"SELECT * FROM quest.take_passport_rate_limit('challenge',$1)",
						[rateKey],
					)
				).rows[0];
			} finally {
				client.release();
			}
		}),
	);
	assert.equal(attempts.filter((r) => r.allowed).length, 12);
	// Saturation/clock cases use separately installed immutable low-limit policy in
	// a transaction then roll back so the service's pinned policies remain intact.
	await connection.query("BEGIN");
	await connection.query(
		"ALTER TABLE quest.passport_rate_policies DISABLE TRIGGER passport_rate_policies_immutable",
	);
	await connection.query(
		"UPDATE quest.passport_rate_policies SET request_limit=3 WHERE scope='challenge'",
	);
	const rateResults = [];
	for (let i = 0; i < 7; i++)
		rateResults.push(
			(
				await connection.query(
					"SELECT * FROM quest.take_passport_rate_limit('challenge',$1)",
					["8".repeat(64)],
				)
			).rows[0],
		);
	assert.deepEqual(
		rateResults.map((r) => r.allowed),
		[true, true, true, false, false, false, false],
	);
	assert.equal(
		(
			await connection.query(
				"SELECT attempts FROM quest.passport_rate_buckets WHERE subject_hash=$1",
				["8".repeat(64)],
			)
		).rows[0].attempts,
		4,
	);
	await connection.query(
		"UPDATE quest.passport_rate_buckets SET window_start_ms=window_start_ms+7200000 WHERE subject_hash=$1",
		["8".repeat(64)],
	);
	assert.equal(
		(
			await connection.query(
				"SELECT * FROM quest.take_passport_rate_limit('challenge',$1)",
				["8".repeat(64)],
			)
		).rows[0].allowed,
		false,
	);
	await connection.query(
		"UPDATE quest.passport_rate_buckets SET window_start_ms=window_start_ms-10800000 WHERE subject_hash=$1",
		["8".repeat(64)],
	);
	assert.equal(
		(
			await connection.query(
				"SELECT * FROM quest.take_passport_rate_limit('challenge',$1)",
				["8".repeat(64)],
			)
		).rows[0].allowed,
		true,
	);
	await connection.query(
		"UPDATE quest.passport_rate_policies SET request_limit=10000 WHERE scope='challenge'",
	);
	await connection.query(
		"INSERT INTO quest.passport_rate_buckets(scope,subject_hash,window_start_ms,attempts) VALUES('challenge',$1,floor(extract(epoch FROM clock_timestamp())*1000)::bigint-(floor(extract(epoch FROM clock_timestamp())*1000)::bigint%3600000),10000)",
		["6".repeat(64)],
	);
	assert.equal(
		(
			await connection.query(
				"SELECT * FROM quest.take_passport_rate_limit('challenge',$1)",
				["6".repeat(64)],
			)
		).rows[0].allowed,
		false,
	);
	assert.equal(
		(
			await connection.query(
				"SELECT attempts FROM quest.passport_rate_buckets WHERE subject_hash=$1",
				["6".repeat(64)],
			)
		).rows[0].attempts,
		10001,
	);
	await connection.query("ROLLBACK");
	// Actual concurrent saturation against the fixed 1000 limit.
	await connection.query(
		"INSERT INTO quest.passport_rate_buckets(scope,subject_hash,window_start_ms,attempts) VALUES('challenge',$1,floor(extract(epoch FROM clock_timestamp())*1000)::bigint-(floor(extract(epoch FROM clock_timestamp())*1000)::bigint%3600000),998)",
		["9".repeat(64)],
	);
	const scarce = await Promise.all(
		Array.from({ length: 8 }, async () => {
			const client = await pool.connect();
			try {
				return (
					await client.query(
						"SELECT * FROM quest.take_passport_rate_limit('challenge',$1)",
						["9".repeat(64)],
					)
				).rows[0];
			} finally {
				client.release();
			}
		}),
	);
	assert.equal(scarce.filter((r) => r.allowed).length, 2);

	// Challenge and session bindings survive as immutable history, but unlink
	// and relink cannot resurrect a nonce or cookie tied to the earlier link ID.
	const oldChallenge = await issue(f);
	await unlink(connection, f);
	await deny(
		auth.readSession({ cookieHeader: cookie(session) }, context),
		"UNAUTHORIZED",
	);
	const linkedAgain = await relink(f);
	await deny(
		auth.authenticate(
			{
				message: oldChallenge.message,
				signature: sign(f.pair, oldChallenge.message),
			},
			context,
		),
		"UNAUTHORIZED",
	);
	await deny(
		auth.readSession({ cookieHeader: cookie(session) }, context),
		"UNAUTHORIZED",
	);
	session = await login(linkedAgain);
	const logout = await auth.logout(
		{ cookieHeader: cookie(session), csrfToken: session.csrfToken },
		context,
	);
	assert.match(logout.cookie, /Max-Age=0/);
	await deny(
		auth.readSession({ cookieHeader: cookie(session) }, context),
		"UNAUTHORIZED",
	);

	const logoutRaceFixture = await setup(),
		logoutRaceSession = await login(logoutRaceFixture);
	const logoutRace = await Promise.allSettled([
		auth.logout(
			{
				cookieHeader: cookie(logoutRaceSession),
				csrfToken: logoutRaceSession.csrfToken,
			},
			context,
		),
		auth.logout(
			{
				cookieHeader: cookie(logoutRaceSession),
				csrfToken: logoutRaceSession.csrfToken,
			},
			context,
		),
	]);
	assert.equal(logoutRace.filter((r) => r.status === "fulfilled").length, 1);
	assert.equal(
		logoutRace.filter(
			(r) => r.status === "rejected" && r.reason.code === "UNAUTHORIZED",
		).length,
		1,
	);

	// A nonce-row lock wait must be followed by a fresh database expiry check.
	const expiring = await setup();
	const dbNow = Number(
		(
			await connection.query(
				"SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS ms",
			)
		).rows[0].ms,
	);
	const expiry = dbNow + 2000,
		expiryNonce = Buffer.alloc(32, 44).toString("base64url");
	const expiryMessage = buildChallengeMessage({
		network: "DEVNET",
		domain: new URL(origin).host,
		action: "passport.authenticate",
		passportId: expiring.passportId,
		wallet: expiring.wallet,
		nonce: expiryNonce,
		issuedAt: new Date(expiry - 300000).toISOString(),
		expiresAt: new Date(expiry).toISOString(),
	});
	const expiryId = (
		await connection.query(
			"INSERT INTO quest.wallet_challenges(network,nonce_hash,action,passport_id,wallet,domain,issued_at,expires_at) VALUES('DEVNET',$1,'passport.authenticate',$2,$3,$4,$5,$6) RETURNING challenge_id::text",
			[
				hashNonce(expiryNonce),
				expiring.passportId,
				expiring.wallet,
				new URL(origin).host,
				new Date(expiry - 300000).toISOString(),
				new Date(expiry).toISOString(),
			],
		)
	).rows[0].challenge_id;
	await connection.query(
		"INSERT INTO quest.passport_challenge_bindings(challenge_id,link_id) VALUES($1,$2)",
		[expiryId, expiring.link],
	);
	const holder = await rootPool.connect();
	await holder.query("BEGIN");
	await holder.query(
		"SELECT challenge_id FROM quest.wallet_challenges WHERE challenge_id=$1 FOR UPDATE",
		[expiryId],
	);
	let expiryResult;
	try {
		expiryResult = auth.authenticate(
			{ message: expiryMessage, signature: sign(expiring.pair, expiryMessage) },
			context,
		);
		// Server-side sleep crosses the exact stored boundary; no production clock seam.
		await connection.query(
			"SELECT pg_sleep(GREATEST(0,($1-extract(epoch FROM clock_timestamp())*1000)/1000.0)+0.05)",
			[expiry],
		);
		await holder.query("COMMIT");
		await deny(expiryResult, "UNAUTHORIZED");
		assert.equal(
			(
				await connection.query(
					"SELECT consumed_at FROM quest.wallet_challenges WHERE challenge_id=$1",
					[expiryId],
				)
			).rows[0].consumed_at,
			null,
		);
	} finally {
		await holder.query("ROLLBACK");
		if (expiryResult) await Promise.allSettled([expiryResult]);
		holder.release();
	}

	// Unlink-first: signature work may finish, but the current-link recheck denies.
	const before = await setup(),
		beforeChallenge = await issue(before),
		verifyEntered = gate(),
		finishVerify = gate();
	const slow = create({
		verifySignature: async (wallet, message, sig) => {
			verifyEntered.release();
			await finishVerify.promise;
			return nacl.sign.detached.verify(
				new TextEncoder().encode(message),
				Buffer.from(sig, "base64"),
				new PublicKey(wallet).toBytes(),
			);
		},
	});
	const waiting = slow.authenticate(
		{
			message: beforeChallenge.message,
			signature: sign(before.pair, beforeChallenge.message),
		},
		context,
	);
	try {
		await reached(verifyEntered.promise);
		await unlink(connection, before);
	} finally {
		finishVerify.release();
	}
	await deny(waiting, "UNAUTHORIZED");

	// Auth-first: a real unlink waits for the held wallet-link lock through commit.
	const during = await setup(),
		duringChallenge = await issue(during),
		locked = gate(),
		finishAuth = gate();
	let pause = true;
	const blockingPool = makePool(authRole, async (sql) => {
		if (pause && sql.includes("lock_passport_auth_link")) {
			pause = false;
			locked.release();
			await finishAuth.promise;
		}
	});
	const publishing = create({ pool: blockingPool }).authenticate(
		{
			message: duringChallenge.message,
			signature: sign(during.pair, duringChallenge.message),
		},
		context,
	);
	const unlinker = await rootPool.connect();
	let unlinkPromise;
	try {
		await reached(locked.promise);
		const pid = (await unlinker.query("SELECT pg_backend_pid() AS pid")).rows[0]
			.pid;
		unlinkPromise = unlink(unlinker, during);
		await waitForLock(pid);
		finishAuth.release();
		const result = await publishing;
		await unlinkPromise;
		await deny(
			auth.readSession({ cookieHeader: cookie(result) }, context),
			"UNAUTHORIZED",
		);
	} finally {
		finishAuth.release();
		await Promise.allSettled([
			publishing,
			...(unlinkPromise ? [unlinkPromise] : []),
		]);
		unlinker.release();
	}

	// A protected SQL callback holds session and exact link locks until its commit;
	// logout cannot revoke midway and unlink cannot invalidate during the callback.
	const protectedFixture = await setup(),
		protectedSession = await login(protectedFixture),
		entered = gate(),
		finishWork = gate();
	const protectedPromise = auth.withSession(
		{
			cookieHeader: cookie(protectedSession),
			csrfToken: protectedSession.csrfToken,
		},
		context,
		async ({ client }) => {
			entered.release();
			await finishWork.promise;
			await client.query("SELECT 1");
			return "protected-complete";
		},
	);
	const closer = await rootPool.connect();
	let closePromise;
	try {
		await reached(entered.promise);
		const pid = (await closer.query("SELECT pg_backend_pid() AS pid")).rows[0]
			.pid;
		closePromise = unlink(closer, protectedFixture);
		await waitForLock(pid);
		finishWork.release();
		assert.equal(await protectedPromise, "protected-complete");
		await closePromise;
	} finally {
		finishWork.release();
		await Promise.allSettled([
			protectedPromise,
			...(closePromise ? [closePromise] : []),
		]);
		closer.release();
	}
	await deny(
		auth.withSession(
			{
				cookieHeader: cookie(protectedSession),
				csrfToken: protectedSession.csrfToken,
			},
			context,
			() => {
				throw new Error("Must not run");
			},
		),
		"UNAUTHORIZED",
	);

	// A stable read may describe the session before a concurrent unlink. Its
	// historical receipt cannot substitute for withSession's current locked check.
	const historicalFixture = await setup(),
		historicalSession = await login(historicalFixture);
	let inRead = false;
	const historicalAuth = create({
		pool: makePool(authRole, async (sql) => {
			if (sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
				inRead = true;
			else if (inRead && sql.includes("FROM quest.environment_identity")) {
				inRead = false;
				await unlink(connection, historicalFixture);
			}
		}),
	});
	assert.equal(
		(
			await historicalAuth.readSession(
				{ cookieHeader: cookie(historicalSession) },
				context,
			)
		).trust,
		"HISTORICAL_SESSION_SNAPSHOT",
	);
	await deny(
		auth.readSession({ cookieHeader: cookie(historicalSession) }, context),
		"UNAUTHORIZED",
	);

	// Actual logout waits for the protected session lock rather than revoking
	// the identity underneath work already authorized in that SQL transaction.
	const logoutFixture = await setup(),
		logoutSession = await login(logoutFixture),
		workEntered = gate(),
		workFinish = gate(),
		logoutConnected = gate();
	let logoutPid;
	const activeWork = auth.withSession(
		{ cookieHeader: cookie(logoutSession), csrfToken: logoutSession.csrfToken },
		context,
		async () => {
			workEntered.release();
			await workFinish.promise;
			return "finished-before-logout";
		},
	);
	const logoutPool = {
		async connect() {
			const client = await pool.connect();
			logoutPid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0]
				.pid;
			logoutConnected.release();
			return client;
		},
	};
	let logoutPromise;
	try {
		await reached(workEntered.promise);
		logoutPromise = create({ pool: logoutPool }).logout(
			{
				cookieHeader: cookie(logoutSession),
				csrfToken: logoutSession.csrfToken,
			},
			context,
		);
		await reached(logoutConnected.promise);
		// The first connection is the separately committed rate check. Wait until
		// logout reaches its second connection before checking the session-row wait.
		for (let i = 0; i < 100; i++) {
			const r = await connection.query(
				"SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
				[logoutPid],
			);
			if (r.rows[0]?.wait_event_type === "Lock") break;
			await new Promise((r) => setTimeout(r, 20));
		}
		await waitForLock(logoutPid);
		workFinish.release();
		assert.equal(await activeWork, "finished-before-logout");
		assert.match((await logoutPromise).cookie, /Max-Age=0/);
	} finally {
		workFinish.release();
		await Promise.allSettled([
			activeWork,
			...(logoutPromise ? [logoutPromise] : []),
		]);
	}
	await deny(
		auth.readSession({ cookieHeader: cookie(logoutSession) }, context),
		"UNAUTHORIZED",
	);

	// End-to-end HTTP adapter with genuine signatures and stored session checks.
	const httpFixture = await setup(),
		http = createPassportAuthHttpAdapter({
			auth,
			resolveClientContext: async () => ({ clientKey: "auth-http-fixture" }),
		});
	const request = (value, extra = {}) =>
		new Request(origin, {
			method: "POST",
			headers: { origin, "content-type": "application/json", ...extra },
			body: JSON.stringify(value),
		});
	const challengeResponse = await http(
		"challenge",
		request({ passportId: httpFixture.passportId, wallet: httpFixture.wallet }),
	);
	assert.equal(challengeResponse.status, 200);
	const httpChallenge = await challengeResponse.json();
	const response = await http(
		"authenticate",
		request({
			message: httpChallenge.message,
			signature: sign(httpFixture.pair, httpChallenge.message),
		}),
	);
	assert.equal(response.status, 200);
	const responseBody = await response.json(),
		httpCookie = response.headers.get("set-cookie").split(";")[0];
	assert.ok(!responseBody.cookie);
	assert.equal(
		(await http("session", request({}, { cookie: httpCookie }))).status,
		200,
	);
	assert.equal(
		(
			await http(
				"logout",
				request(
					{},
					{ cookie: httpCookie, "x-solve3-csrf": responseBody.csrfToken },
				),
			)
		).status,
		200,
	);
	assert.equal(
		(await http("session", request({}, { cookie: httpCookie }))).status,
		401,
	);

	const legacy = await setup(),
		legacyToken = Buffer.alloc(32, 77).toString("base64url"),
		legacyNonce = Buffer.alloc(32, 78).toString("base64url");
	const legacyAt = Number(
		(
			await connection.query(
				"SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS ms",
			)
		).rows[0].ms,
	);
	await connection.query(
		"INSERT INTO quest.passport_sessions(network,passport_id,token_hash,csrf_hash,issued_at,expires_at) VALUES('DEVNET',$1,$2,$3,$4,$5)",
		[
			legacy.passportId,
			hashSessionToken(legacyToken),
			hashCsrfToken(Buffer.alloc(32, 79).toString("base64url")),
			new Date(legacyAt).toISOString(),
			new Date(legacyAt + 1800000).toISOString(),
		],
	);
	await deny(
		auth.readSession(
			{ cookieHeader: `solve3_passport=${legacyToken}` },
			context,
		),
		"UNAUTHORIZED",
	);
	const legacyMessage = buildChallengeMessage({
		network: "DEVNET",
		domain: new URL(origin).host,
		action: "passport.authenticate",
		passportId: legacy.passportId,
		wallet: legacy.wallet,
		nonce: legacyNonce,
		issuedAt: new Date(legacyAt).toISOString(),
		expiresAt: new Date(legacyAt + 300000).toISOString(),
	});
	await connection.query(
		"INSERT INTO quest.wallet_challenges(network,nonce_hash,action,passport_id,wallet,domain,issued_at,expires_at) VALUES('DEVNET',$1,'passport.authenticate',$2,$3,$4,$5,$6)",
		[
			hashNonce(legacyNonce),
			legacy.passportId,
			legacy.wallet,
			new URL(origin).host,
			new Date(legacyAt).toISOString(),
			new Date(legacyAt + 300000).toISOString(),
		],
	);
	await deny(
		auth.authenticate(
			{ message: legacyMessage, signature: sign(legacy.pair, legacyMessage) },
			context,
		),
		"UNAUTHORIZED",
	);

	// Legacy unbound rows cannot grant sessions. Auth role has no XP/link/policy
	// update, binding mutation, bucket mutation or role provisioning authority.
	const restricted = await pool.connect();
	try {
		for (const sql of [
			"UPDATE quest.wallet_links SET unlinked_at=clock_timestamp()",
			"DELETE FROM quest.passport_rate_buckets",
			"UPDATE quest.passport_rate_policies SET request_limit=999",
			"UPDATE quest.passport_auth_bindings SET domain='evil.test'",
			"TRUNCATE quest.passport_challenge_bindings",
			"INSERT INTO quest.xp_events DEFAULT VALUES",
		])
			await assert.rejects(restricted.query(sql), /permission denied/);
	} finally {
		restricted.release();
	}
	await assert.rejects(
		connection.query(
			"UPDATE quest.passport_auth_bindings SET domain='evil.test'",
		),
		/immutable/,
	);
	await assert.rejects(
		connection.query("DELETE FROM quest.passport_challenge_bindings"),
		/immutable/,
	);
	assert.equal(await count("xp_events"), 0);
	console.log(
		"Durable Passport auth: real signatures, atomic session creation/replay, concurrent shared rates, both auth/unlink lock orders, protected SQL/link locks, immutable bindings, HTTP/CSRF/logout and role denial passed.",
	);
}
