import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildChallengeMessage,
	CHALLENGE_TTL_MS,
} from "./passport-challenge.mjs";
import {
	createDurablePassportAuth,
	PassportAuthFault,
} from "./passport-durable-auth.mjs";
import { hashCsrfToken } from "./passport-session.mjs";

const passport = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	environmentId = "33333333-3333-4333-8333-333333333333";
const wallet = "11111111111111111111111111111111",
	origin = "https://quest.solve3.test";
const at = Date.parse("2026-10-03T12:00:00.000Z");
const signature = Buffer.alloc(64, 1).toString("base64"),
	csrf = Buffer.alloc(32, 6).toString("base64url");
const context = { origin, clientKey: "trusted-fixture-client" };
const environment = {
	network: "DEVNET",
	environmentId,
	manifestSha256: "a".repeat(64),
};
const ratePolicies = Object.fromEntries(
	["challenge", "authenticate", "session"].map((k) => [
		k,
		{ limit: 10, windowMs: 60000 },
	]),
);
const signed = (patch = {}) =>
	buildChallengeMessage({
		network: "DEVNET",
		domain: new URL(origin).host,
		action: "passport.authenticate",
		passportId: passport,
		wallet,
		nonce: Buffer.alloc(32, 1).toString("base64url"),
		issuedAt: new Date(at).toISOString(),
		expiresAt: new Date(at + CHALLENGE_TTL_MS).toISOString(),
		...patch,
	});
function fixture(options = {}) {
	const calls = [],
		releases = [];
	let random = 2,
		verifications = 0;
	const pool = {
		async connect() {
			return {
				async query(sql, params) {
					calls.push({ sql, params });
					if (options.hook) {
						const out = await options.hook(sql, params);
						if (out) return out;
					}
					if (sql.includes("FROM quest.environment_identity"))
						return {
							rows: [
								{
									network: "DEVNET",
									genesis_hash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
									environment_id: environmentId,
									manifest_sha256: "a".repeat(64),
									namespace: "quest",
								},
							],
						};
					if (sql.includes("take_passport_rate_limit"))
						return {
							rows: [
								{
									allowed: true,
									remaining: 9,
									window_ms: 60000,
									request_limit: 10,
									retry_after_seconds: 60,
								},
							],
						};
					if (sql.includes("AS now_ms"))
						return { rows: [{ now_ms: String(at + 1000) }] };
					if (sql.includes("lock_passport_auth_link"))
						return { rows: [{ link_id: "42" }] };
					if (sql.includes("FROM quest.wallet_challenges c"))
						return {
							rows: [{ challenge_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
						};
					if (sql.includes("RETURNING challenge_id"))
						return {
							rows: [{ challenge_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
						};
					if (sql.includes("RETURNING session_id"))
						return {
							rows: [{ session_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }],
						};
					if (sql.includes("FROM quest.passport_sessions s"))
						return {
							rows: [
								{
									session_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
									network: "DEVNET",
									passport_id: passport,
									csrf_hash: hashCsrfToken(csrf),
									issued_ms: String(at),
									expires_ms: String(at + 1800000),
									domain: new URL(origin).host,
									link_id: "42",
									wallet,
								},
							],
						};
					return { rows: [] };
				},
				release(error) {
					releases.push(error);
				},
			};
		},
	};
	const config = {
		pool,
		environment,
		origin,
		ratePolicies,
		rateKeySecret: Buffer.alloc(32, 9),
		randomBytes: (size) => Buffer.alloc(size, random++),
		verifySignature: async () => {
			verifications++;
			return true;
		},
		...options.config,
	};
	return {
		auth: createDurablePassportAuth(config),
		calls,
		releases,
		config,
		verifications: () => verifications,
	};
}
const rejected = (promise, code) =>
	assert.rejects(
		promise,
		(e) => e instanceof PassportAuthFault && e.code === code,
	);

test("wallet challenge resolves immutable owner after rate/environment checks and locks the active link", async () => {
	const f = fixture({
		hook: (sql) =>
			sql.includes("SELECT passport_id::text FROM quest.wallet_links")
				? { rows: [{ passport_id: passport }] }
				: null,
	});
	const out = await f.auth.issueWalletChallenge({ wallet }, context);
	assert.match(out.message, new RegExp(`passport: ${passport}`));
	const owner = f.calls.findIndex((c) =>
		c.sql.includes("SELECT passport_id::text FROM quest.wallet_links"),
	);
	assert.ok(
		owner >
			f.calls.findIndex((c) =>
				c.sql.includes("FROM quest.environment_identity"),
			),
	);
	assert.ok(
		f.calls
			.slice(owner + 1)
			.some((c) => c.sql.includes("lock_passport_auth_link")),
	);
});
test("unprovisioned wallet refuses without creating Passport or challenge", async () => {
	const f = fixture({
		hook: (sql) =>
			sql.includes("SELECT passport_id::text FROM quest.wallet_links")
				? { rows: [] }
				: null,
	});
	await rejected(
		f.auth.issueWalletChallenge({ wallet }, context),
		"UNAUTHORIZED",
	);
	assert.ok(
		!f.calls.some(
			(c) =>
				c.sql.includes("INSERT INTO quest.wallet_challenges") ||
				c.sql.includes("INSERT INTO quest.passports"),
		),
	);
});

test("durable issue pins environment, locks current link and stores only nonce hash", async () => {
	const f = fixture();
	const out = await f.auth.issueChallenge(
		{ passportId: passport, wallet },
		context,
	);
	assert.match(out.message, /network: DEVNET/);
	const insert = f.calls.find((c) =>
		c.sql.includes("INSERT INTO quest.wallet_challenges"),
	);
	assert.equal(insert.params[0].length, 64);
	assert.ok(
		!JSON.stringify(insert).includes(Buffer.alloc(32, 2).toString("base64url")),
	);
	assert.equal(f.calls.filter((c) => c.sql === "COMMIT").length, 2);
	assert.equal(
		f.calls.filter((c) => c.sql.includes("take_passport_rate_limit")).length,
		2,
	);
	assert.ok(
		f.calls.findIndex((c) => c.sql.includes("lock_passport_auth_link")) <
			f.calls.indexOf(insert),
	);
});
test("durable authenticate awaits verifier and commits challenge, hashed session and binding together", async () => {
	const f = fixture();
	const out = await f.auth.authenticate(
		{ message: signed(), signature },
		context,
	);
	assert.equal(f.verifications(), 1);
	assert.equal(out.passportId, passport);
	assert.match(out.cookie, /Secure; SameSite=Strict; HttpOnly/);
	const consume = f.calls.find((c) =>
		c.sql.startsWith("UPDATE quest.wallet_challenges"),
	);
	assert.equal(consume.params.length, 8);
	assert.match(consume.sql, /issued_at=\$6/);
	assert.match(consume.sql, /expires_at=\$7/);
	assert.equal(consume.params[7], "42");
	const insert = f.calls.find((c) =>
		c.sql.includes("INSERT INTO quest.passport_sessions"),
	);
	assert.equal(insert.params[1].length, 64);
	assert.ok(!JSON.stringify(insert).includes(out.csrfToken));
	assert.ok(
		f.calls.findIndex((c) =>
			c.sql.includes("INSERT INTO quest.passport_auth_bindings"),
		) > f.calls.indexOf(insert),
	);
});
test("invalid signature keeps rate consumption but never consumes challenge", async () => {
	const f = fixture({ config: { verifySignature: async () => false } });
	await rejected(
		f.auth.authenticate({ message: signed(), signature }, context),
		"UNAUTHORIZED",
	);
	assert.equal(f.calls.filter((c) => c.sql === "COMMIT").length, 1);
	assert.ok(
		!f.calls.some((c) => c.sql.startsWith("UPDATE quest.wallet_challenges")),
	);
});
test("missing active wallet link fails closed before challenge write", async () => {
	const f = fixture({
		hook: (sql) =>
			sql.includes("lock_passport_auth_link")
				? { rows: [{ link_id: null }] }
				: null,
	});
	await rejected(
		f.auth.issueChallenge({ passportId: passport, wallet }, context),
		"UNAUTHORIZED",
	);
	assert.ok(
		!f.calls.some((c) => c.sql.includes("INSERT INTO quest.wallet_challenges")),
	);
	assert.ok(f.releases.at(-1) instanceof Error);
});
test("stored challenge mismatch/replay returns no session and rolls back", async () => {
	const f = fixture({
		hook: (sql) =>
			sql.startsWith("UPDATE quest.wallet_challenges") ? { rows: [] } : null,
	});
	await rejected(
		f.auth.authenticate({ message: signed(), signature }, context),
		"UNAUTHORIZED",
	);
	assert.ok(
		!f.calls.some((c) => c.sql.includes("INSERT INTO quest.passport_sessions")),
	);
	assert.equal(f.calls.at(-1).sql, "ROLLBACK");
});
for (const stage of [
	"INSERT INTO quest.passport_sessions",
	"INSERT INTO quest.passport_auth_bindings",
	"COMMIT",
])
	test(`failure at ${stage} discards connection and exposes no cookie`, async () => {
		let commits = 0;
		const f = fixture({
			hook: (sql) => {
				if (sql === "COMMIT") commits++;
				if (sql.includes(stage) && (stage !== "COMMIT" || commits === 2))
					throw new Error("sensitive database connection detail");
			},
		});
		await rejected(
			f.auth.authenticate({ message: signed(), signature }, context),
			"UNAVAILABLE",
		);
		assert.equal(f.calls.at(-1).sql, "ROLLBACK");
		assert.ok(f.releases.at(-1) instanceof Error);
	});
test("rate denial commits separately and does not generate/store a challenge", async () => {
	const f = fixture({
		hook: (sql) =>
			sql.includes("take_passport_rate_limit")
				? {
						rows: [
							{
								allowed: false,
								remaining: 0,
								window_ms: 60000,
								request_limit: 10,
								retry_after_seconds: 60,
							},
						],
					}
				: null,
	});
	await rejected(
		f.auth.issueChallenge({ passportId: passport, wallet }, context),
		"RATE_LIMITED",
	);
	assert.equal(
		f.calls.filter((c) => c.sql.includes("take_passport_rate_limit")).length,
		1,
	);
	assert.equal(f.calls.at(-1).sql, "COMMIT");
});
for (const malformed of [
	{ allowed: "true" },
	{ window_ms: 1000 },
	{ request_limit: 100 },
	{ remaining: -1 },
	{ retry_after_seconds: 0 },
])
	test(`rate result refuses ${Object.keys(malformed)[0]}`, async () => {
		const f = fixture({
			hook: (sql) =>
				sql.includes("take_passport_rate_limit")
					? {
							rows: [
								{
									allowed: true,
									remaining: 9,
									window_ms: 60000,
									request_limit: 10,
									retry_after_seconds: 60,
									...malformed,
								},
							],
						}
					: null,
		});
		await rejected(
			f.auth.issueChallenge({ passportId: passport, wallet }, context),
			"UNAVAILABLE",
		);
		assert.ok(!f.calls.some((c) => c.sql.includes("INSERT")));
	});
test("environment mismatch refuses before any state mutation", async () => {
	const f = fixture({
		hook: (sql) =>
			sql.includes("FROM quest.environment_identity")
				? { rows: [{ network: "MAINNET" }] }
				: null,
	});
	await rejected(
		f.auth.issueChallenge({ passportId: passport, wallet }, context),
		"UNAVAILABLE",
	);
	assert.ok(!f.calls.some((c) => c.sql.includes("take_passport_rate_limit")));
});
test("unavailable verifier does not consume nonce and sanitizes raw errors", async () => {
	const f = fixture({
		config: {
			verifySignature: async () => {
				throw new Error("secret detail");
			},
		},
	});
	await rejected(
		f.auth.authenticate({ message: signed(), signature }, context),
		"UNAVAILABLE",
	);
	assert.ok(!f.calls.some((c) => c.sql.startsWith("UPDATE")));
});
for (const patch of [
	{ domain: "evil.test" },
	{ expiresAt: new Date(at + 300001).toISOString() },
	{ wallet: "bad-wallet" },
	{ passportId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB" },
])
	test(`canonical signed ${Object.keys(patch)[0]} refuses before SQL`, async () => {
		const f = fixture();
		let message;
		try {
			message = signed(patch);
		} catch {
			message = signed().replace(
				`passport: ${passport}`,
				`passport: ${patch.passportId}`,
			);
		}
		await rejected(
			f.auth.authenticate({ message, signature }, context),
			"INVALID_REQUEST",
		);
		assert.equal(f.calls.length, 0);
	});
test("expired signature verifier result is rechecked against fresh database time", async () => {
	const f = fixture({
		hook: (sql) =>
			sql.includes("AS now_ms")
				? { rows: [{ now_ms: String(at + CHALLENGE_TTL_MS) }] }
				: null,
	});
	await rejected(
		f.auth.authenticate({ message: signed(), signature }, context),
		"UNAUTHORIZED",
	);
	assert.ok(
		!f.calls.some((c) => c.sql.startsWith("UPDATE quest.wallet_challenges")),
	);
});
test("future issue timestamps cannot authenticate", async () => {
	const f = fixture();
	await rejected(
		f.auth.authenticate(
			{
				message: signed({
					issuedAt: new Date(at + 2000).toISOString(),
					expiresAt: new Date(at + 2000 + CHALLENGE_TTL_MS).toISOString(),
				}),
				signature,
			},
			context,
		),
		"UNAUTHORIZED",
	);
});

test("expiry after session persistence rolls back every auth write before cookie return", async () => {
	let clocks = 0;
	const f = fixture({
		hook: (sql) =>
			sql.includes("AS now_ms")
				? {
						rows: [
							{
								now_ms: String(
									++clocks === 1 ? at + 1000 : at + CHALLENGE_TTL_MS,
								),
							},
						],
					}
				: null,
	});
	await rejected(
		f.auth.authenticate({ message: signed(), signature }, context),
		"UNAUTHORIZED",
	);
	assert.ok(
		f.calls.some((c) =>
			c.sql.startsWith("INSERT INTO quest.passport_auth_bindings"),
		),
	);
	assert.equal(f.calls.at(-1).sql, "ROLLBACK");
});
test("nonce lock is acquired before the authentication clock sample", async () => {
	const f = fixture();
	await f.auth.authenticate({ message: signed(), signature }, context);
	assert.ok(
		f.calls.findIndex((c) => c.sql.includes("FOR UPDATE OF c")) <
			f.calls.findIndex((c) => c.sql.includes("AS now_ms")),
	);
	assert.match(
		f.calls.find((c) => c.sql.startsWith("UPDATE quest.wallet_challenges")).sql,
		/expires_at>clock_timestamp\(\)/,
	);
});
test("rollback failure still discards the connection and keeps original safe fault", async () => {
	const f = fixture({
		hook: (sql) => {
			if (
				sql === "ROLLBACK" ||
				sql.startsWith("INSERT INTO quest.passport_auth_bindings")
			)
				throw new Error("raw storage fault");
		},
	});
	await rejected(
		f.auth.authenticate({ message: signed(), signature }, context),
		"UNAVAILABLE",
	);
	assert.ok(f.releases.at(-1) instanceof Error);
});
test("connection failure is sanitized and cannot produce a challenge", async () => {
	const f = fixture({
		config: {
			pool: {
				connect: async () => {
					throw new Error("raw connection detail");
				},
			},
		},
	});
	await rejected(
		f.auth.issueChallenge({ passportId: passport, wallet }, context),
		"UNAVAILABLE",
	);
});
test("readSession returns only safe metadata and historical trust in a read-only snapshot", async () => {
	const f = fixture();
	const out = await f.auth.readSession(
		{
			cookieHeader: `solve3_passport=${Buffer.alloc(32, 5).toString("base64url")}`,
		},
		context,
	);
	assert.equal(out.trust, "HISTORICAL_SESSION_SNAPSHOT");
	assert.ok(!("csrfHash" in out));
	assert.ok(
		f.calls.some(
			(c) => c.sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
		),
	);
	assert.match(
		f.calls.find((c) => c.sql.includes("FROM quest.passport_sessions s")).sql,
		/passport_auth_bindings/,
	);
});
test("duplicate/malformed session cookies fail before SQL", async () => {
	const f = fixture();
	await rejected(
		f.auth.readSession(
			{ cookieHeader: "solve3_passport=x; solve3_passport=y" },
			context,
		),
		"UNAUTHORIZED",
	);
	assert.equal(f.calls.length, 0);
});
test("protected SQL callback awaits checks and holds session/link locks through commit", async () => {
	const f = fixture();
	let executed = false;
	const out = await f.auth.withSession(
		{
			cookieHeader: `solve3_passport=${Buffer.alloc(32, 5).toString("base64url")}`,
			csrfToken: csrf,
		},
		context,
		async ({ client, session }) => {
			executed = true;
			assert.equal(session.passportId, passport);
			await client.query("SELECT protected_fixture");
			return "done";
		},
	);
	assert.equal(out, "done");
	assert.ok(executed);
	assert.ok(f.calls.some((c) => c.sql.includes("FOR SHARE OF s")));
	assert.equal(f.calls.at(-1).sql, "COMMIT");
});
test("wrong CSRF rejects before protected callback", async () => {
	const f = fixture();
	await rejected(
		f.auth.withSession(
			{
				cookieHeader: `solve3_passport=${Buffer.alloc(32, 5).toString("base64url")}`,
				csrfToken: Buffer.alloc(32, 7).toString("base64url"),
			},
			context,
			() => {
				throw new Error("must not run");
			},
		),
		"FORBIDDEN",
	);
	assert.ok(!f.calls.some((c) => c.sql.includes("lock_passport_auth_link")));
});

test("session expiry after a lock wait denies before protected callback", async () => {
	const f = fixture({
		hook: (sql) =>
			sql.includes("AS now_ms")
				? { rows: [{ now_ms: String(at + 1800000) }] }
				: null,
	});
	let called = false;
	await rejected(
		f.auth.withSession(
			{
				cookieHeader: `solve3_passport=${Buffer.alloc(32, 5).toString("base64url")}`,
				csrfToken: csrf,
			},
			context,
			() => {
				called = true;
			},
		),
		"UNAUTHORIZED",
	);
	assert.equal(called, false);
});
test("relinked wallet cannot revive an old session binding", async () => {
	const f = fixture({
		hook: (sql) =>
			sql.includes("lock_passport_auth_link")
				? { rows: [{ link_id: "43" }] }
				: null,
	});
	await rejected(
		f.auth.withSession(
			{
				cookieHeader: `solve3_passport=${Buffer.alloc(32, 5).toString("base64url")}`,
				csrfToken: csrf,
			},
			context,
			() => {
				throw new Error("must not run");
			},
		),
		"UNAUTHORIZED",
	);
});
test("protected callback error rolls back and discards SQL connection", async () => {
	const f = fixture();
	await rejected(
		f.auth.withSession(
			{
				cookieHeader: `solve3_passport=${Buffer.alloc(32, 5).toString("base64url")}`,
				csrfToken: csrf,
			},
			context,
			() => {
				throw new Error("private detail");
			},
		),
		"UNAVAILABLE",
	);
	assert.equal(f.calls.at(-1).sql, "ROLLBACK");
});
test("logout persists one-way revocation and clears secure cookie after commit", async () => {
	const f = fixture();
	const out = await f.auth.logout(
		{
			cookieHeader: `solve3_passport=${Buffer.alloc(32, 5).toString("base64url")}`,
			csrfToken: csrf,
		},
		context,
	);
	assert.match(out.cookie, /Max-Age=0/);
	assert.ok(
		f.calls.some((c) => c.sql.startsWith("UPDATE quest.passport_sessions")),
	);
	assert.equal(f.calls.at(-1).sql, "COMMIT");
});
test("wrong origin/client key refuses before database access", async () => {
	const f = fixture();
	await rejected(
		f.auth.issueChallenge(
			{ passportId: passport, wallet },
			{ ...context, origin: "https://evil.test" },
		),
		"FORBIDDEN",
	);
	await rejected(
		f.auth.issueChallenge(
			{ passportId: passport, wallet },
			{ origin, clientKey: "" },
		),
		"INVALID_REQUEST",
	);
	assert.equal(f.calls.length, 0);
});
for (const config of [
	{ origin: "http://localhost" },
	{ origin: `${origin}/` },
	{ rateKeySecret: Buffer.alloc(4) },
	{ ratePolicies: {} },
	{ environment: { ...environment, network: "MAINNET" } },
])
	test(`constructor refuses unsafe ${Object.keys(config)[0]}`, () =>
		assert.throws(() => fixture({ config }), PassportAuthFault));
