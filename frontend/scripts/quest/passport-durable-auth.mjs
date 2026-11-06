import { createHmac, randomBytes as nodeRandomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
	assertValidNonce,
	buildChallengeMessage,
	CHALLENGE_TTL_MS,
	createNonce,
	hashNonce,
	parseChallengeMessage,
} from "./passport-challenge.mjs";
import { assertPassportId } from "./passport-id.mjs";
import {
	COOKIE_NAME,
	createCsrfToken,
	createSession,
	createSessionToken,
	hashSessionToken,
	parseCookieHeader,
	SESSION_TTL_MS,
	serializeSessionCookie,
	verifyCsrf,
} from "./passport-session.mjs";
import { verifyPassportSignature } from "./passport-signature.mjs";

export class PassportAuthFault extends Error {
	constructor(code) {
		super(`Passport authentication ${code.toLowerCase()}`);
		this.name = "PassportAuthFault";
		this.code = code;
	}
}
const fail = (code) => {
	throw new PassportAuthFault(code);
};
const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const CLEAR_PASSPORT_COOKIE = `${COOKIE_NAME}=; Max-Age=0; Path=/; Secure; SameSite=Strict; HttpOnly`;
const records = (r, max = 1) => {
	if (!Array.isArray(r?.rows) || r.rows.length > max) fail("UNAVAILABLE");
	return r.rows;
};
const one = (r) => {
	const a = records(r);
	if (a.length !== 1) fail("UNAUTHORIZED");
	return a[0];
};
const walletKey = (value) => {
	try {
		if (
			typeof value !== "string" ||
			value.length < 32 ||
			value.length > 44 ||
			new PublicKey(value).toBase58() !== value
		)
			fail("INVALID_REQUEST");
		return value;
	} catch {
		fail("INVALID_REQUEST");
	}
};
const passportKey = (value) => {
	try {
		return assertPassportId(value);
	} catch {
		fail("INVALID_REQUEST");
	}
};
const token = (value) => {
	try {
		return assertValidNonce(value);
	} catch {
		fail("UNAUTHORIZED");
	}
};
const milliseconds = (value) => {
	if (
		typeof value !== "string" ||
		!/^(0|[1-9][0-9]*)$/.test(value) ||
		!Number.isSafeInteger(Number(value)) ||
		Number(value) > 8640000000000000
	)
		fail("UNAVAILABLE");
	return Number(value);
};
const iso = (value) => new Date(value).toISOString();
export function passportAuthOrigin(value) {
	try {
		const u = new URL(value);
		if (
			u.protocol !== "https:" ||
			u.origin !== value ||
			u.username ||
			u.password ||
			u.host.length > 255
		)
			fail("INVALID_REQUEST");
		return u.origin;
	} catch {
		fail("INVALID_REQUEST");
	}
}
const contextKey = (context) => {
	if (
		typeof context?.clientKey !== "string" ||
		!context.clientKey ||
		context.clientKey.length > 256 ||
		[...context.clientKey].some(
			(c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
		)
	)
		fail("INVALID_REQUEST");
	return context.clientKey;
};
const canonicalChallenge = (message, domain) => {
	try {
		if (typeof message !== "string" || Buffer.byteLength(message) > 2048)
			fail("INVALID_REQUEST");
		const p = parseChallengeMessage(message);
		passportKey(p.passportId);
		walletKey(p.wallet);
		if (
			p.domain !== domain ||
			p.action !== "passport.authenticate" ||
			p.network !== "DEVNET" ||
			iso(Date.parse(p.issuedAt)) !== p.issuedAt ||
			iso(Date.parse(p.expiresAt)) !== p.expiresAt ||
			Date.parse(p.expiresAt) - Date.parse(p.issuedAt) !== CHALLENGE_TTL_MS ||
			buildChallengeMessage(p) !== message
		)
			fail("INVALID_REQUEST");
		return p;
	} catch (e) {
		if (e instanceof PassportAuthFault) throw e;
		fail("INVALID_REQUEST");
	}
};

/** Dormant server-owned async API. It never provisions a database or opens a route. */
export function createDurablePassportAuth({
	pool,
	environment,
	origin,
	ratePolicies,
	rateKeySecret,
	randomBytes = nodeRandomBytes,
	verifySignature = verifyPassportSignature,
	recoverableCsrf = false,
} = {}) {
	if (
		typeof pool?.connect !== "function" ||
		typeof randomBytes !== "function" ||
		typeof verifySignature !== "function"
	)
		fail("INVALID_REQUEST");
	const configuredOrigin = passportAuthOrigin(origin),
		domain = new URL(configuredOrigin).host;
	const manifest = environment?.manifestSha256,
		environmentId = passportKey(environment?.environmentId);
	if (
		environment.network !== "DEVNET" ||
		typeof manifest !== "string" ||
		!/^[a-f0-9]{64}$/.test(manifest)
	)
		fail("INVALID_REQUEST");
	if (
		!(rateKeySecret instanceof Uint8Array) ||
		rateKeySecret.length < 32 ||
		rateKeySecret.length > 128
	)
		fail("INVALID_REQUEST");
	const keySecret = Buffer.from(rateKeySecret);
	const policies = {};
	for (const scope of ["challenge", "authenticate", "session"]) {
		const p = ratePolicies?.[scope];
		if (
			!Number.isInteger(p?.limit) ||
			p.limit < 1 ||
			p.limit > 10000 ||
			!Number.isInteger(p.windowMs) ||
			p.windowMs < 1000 ||
			p.windowMs > 3600000
		)
			fail("INVALID_REQUEST");
		policies[scope] = { limit: p.limit, windowMs: p.windowMs };
	}
	const pins = async (client) => {
		const p = one(
			await client.query(
				"SELECT network,genesis_hash,environment_id::text,manifest_sha256,namespace FROM quest.environment_identity WHERE singleton=true",
			),
		);
		if (
			p.network !== "DEVNET" ||
			p.genesis_hash !== GENESIS ||
			p.environment_id !== environmentId ||
			p.manifest_sha256 !== manifest ||
			p.namespace !== "quest"
		)
			fail("UNAVAILABLE");
	};
	const tx = async (work, readOnly = false) => {
		let client,
			begun = false,
			failed = false;
		try {
			client = await pool.connect();
			await client.query(
				readOnly
					? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
					: "BEGIN ISOLATION LEVEL READ COMMITTED",
			);
			begun = true;
			await client.query("SET LOCAL statement_timeout='10s'");
			await client.query("SET LOCAL lock_timeout='5s'");
			await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
			await pins(client);
			const result = await work(client);
			await client.query("COMMIT");
			begun = false;
			return result;
		} catch (e) {
			failed = true;
			if (begun) {
				try {
					await client.query("ROLLBACK");
				} catch {
					/* Discard. */
				}
			}
			if (e instanceof PassportAuthFault) throw e;
			fail("UNAVAILABLE");
		} finally {
			if (client)
				client.release(
					failed ? new Error("Passport transaction failed") : undefined,
				);
		}
	};
	const now = async (client) =>
		milliseconds(
			one(
				await client.query(
					"SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS now_ms",
				),
			).now_ms,
		);
	const rate = async (scope, context, wallet) => {
		const clientKey = contextKey(context);
		if (context.origin !== configuredOrigin) fail("FORBIDDEN");
		const hashes = [
			["client", clientKey],
			...(wallet ? [["wallet", wallet]] : []),
		].map((parts) =>
			createHmac("sha256", keySecret)
				.update(JSON.stringify([scope, ...parts]))
				.digest("hex"),
		);
		// Commit denied requests too; rolling back authentication cannot refund attempts.
		const allowed = await tx(async (client) => {
			let result = true;
			for (const subject of hashes) {
				const r = one(
					await client.query(
						"SELECT allowed,remaining,window_ms,request_limit,retry_after_seconds FROM quest.take_passport_rate_limit($1,$2)",
						[scope, subject],
					),
				);
				if (
					typeof r.allowed !== "boolean" ||
					r.window_ms !== policies[scope].windowMs ||
					r.request_limit !== policies[scope].limit ||
					!Number.isInteger(r.remaining) ||
					r.remaining < 0 ||
					r.remaining > r.request_limit ||
					!Number.isInteger(r.retry_after_seconds) ||
					r.retry_after_seconds < 1
				)
					fail("UNAVAILABLE");
				result = result && r.allowed;
				if (!result) break;
			}
			return result;
		});
		if (!allowed) fail("RATE_LIMITED");
	};
	const lockLink = async (client, passport, wallet) => {
		const r = one(
			await client.query(
				"SELECT quest.lock_passport_auth_link($1::uuid,$2)::text AS link_id",
				[passport, wallet],
			),
		);
		if (typeof r.link_id !== "string" || !/^[1-9][0-9]*$/.test(r.link_id))
			fail("UNAUTHORIZED");
		return r.link_id;
	};
	const cookieToken = (header) => {
		if (typeof header !== "string" || header.length > 8192)
			fail("UNAUTHORIZED");
		return token(parseCookieHeader(header, COOKIE_NAME));
	};
	const checkSession = async (
		client,
		presented,
		{ lock = false, csrfToken, exclusive = false } = {},
	) => {
		// Legacy sessions without an immutable authentication binding are excluded.
		const r = one(
			await client.query(
				`SELECT s.session_id::text,s.network,s.passport_id::text,s.csrf_hash,
   floor(extract(epoch FROM s.issued_at)*1000)::bigint::text AS issued_ms,
   floor(extract(epoch FROM s.expires_at)*1000)::bigint::text AS expires_ms,
   b.domain,b.link_id::text,l.wallet
   FROM quest.passport_sessions s JOIN quest.passport_auth_bindings b ON b.session_id=s.session_id
   JOIN quest.wallet_links l ON l.link_id=b.link_id AND l.network=s.network AND l.passport_id=s.passport_id
   WHERE s.network='DEVNET' AND s.token_hash=$1 AND s.revoked_at IS NULL
   AND s.issued_at<=clock_timestamp() AND s.expires_at>clock_timestamp()
   AND s.issued_at=date_trunc('milliseconds',s.issued_at) AND s.expires_at=date_trunc('milliseconds',s.expires_at)
   AND l.unlinked_at IS NULL AND l.linked_at<=s.issued_at ${lock ? (exclusive ? "FOR UPDATE OF s" : "FOR SHARE OF s") : ""}`,
				[hashSessionToken(presented)],
			),
		);
		passportKey(r.passport_id);
		walletKey(r.wallet);
		if (
			r.network !== "DEVNET" ||
			r.domain !== domain ||
			milliseconds(r.expires_ms) - milliseconds(r.issued_ms) > SESSION_TTL_MS
		)
			fail("UNAUTHORIZED");
		if (
			csrfToken !== undefined &&
			!verifyCsrf({ csrfHash: r.csrf_hash }, token(csrfToken))
		)
			fail("FORBIDDEN");
		if (lock && (await lockLink(client, r.passport_id, r.wallet)) !== r.link_id)
			fail("UNAUTHORIZED");
		if (lock) {
			const at = await now(client);
			if (milliseconds(r.issued_ms) > at || milliseconds(r.expires_ms) <= at)
				fail("UNAUTHORIZED");
		}
		return {
			sessionId: r.session_id,
			passportId: r.passport_id,
			wallet: r.wallet,
			expiresAt: iso(milliseconds(r.expires_ms)),
			network: "DEVNET",
		};
	};
	async function issue({ passportId, wallet }, context, walletOnly = false) {
		if (!walletOnly) passportKey(passportId);
		walletKey(wallet);
		await rate("challenge", context, wallet);
		const nonce = createNonce(randomBytes);
		token(nonce);
		return tx(async (client) => {
			if (walletOnly) {
				const owner = one(
					await client.query(
						"SELECT passport_id::text FROM quest.wallet_links WHERE network='DEVNET' AND wallet=$1 AND unlinked_at IS NULL AND linked_at<=clock_timestamp()",
						[wallet],
					),
				);
				passportId = owner.passport_id;
				passportKey(passportId);
			}
			const linkId = await lockLink(client, passportId, wallet),
				at = await now(client);
			const p = {
				network: "DEVNET",
				domain,
				action: "passport.authenticate",
				passportId,
				wallet,
				nonce,
				issuedAt: iso(at),
				expiresAt: iso(at + CHALLENGE_TTL_MS),
			};
			const message = buildChallengeMessage(p);
			const stored = one(
				await client.query(
					`INSERT INTO quest.wallet_challenges(network,nonce_hash,action,passport_id,wallet,domain,issued_at,expires_at)
     VALUES('DEVNET',$1,'passport.authenticate',$2,$3,$4,$5::timestamptz,$6::timestamptz) RETURNING challenge_id::text`,
					[
						hashNonce(nonce),
						passportId,
						wallet,
						domain,
						p.issuedAt,
						p.expiresAt,
					],
				),
			);
			one(
				await client.query(
					"INSERT INTO quest.passport_challenge_bindings(challenge_id,link_id) VALUES($1,$2) RETURNING challenge_id::text",
					[stored.challenge_id, linkId],
				),
			);
			return { message, expiresAt: p.expiresAt, network: "DEVNET" };
		});
	}
	return {
		origin: configuredOrigin,
		issueChallenge: (input, context) => issue(input, context),
		issueWalletChallenge: ({ wallet }, context) =>
			issue({ wallet }, context, true),
		async authenticate({ message, signature }, context) {
			const p = canonicalChallenge(message, domain);
			if (
				typeof signature !== "string" ||
				!/^[A-Za-z0-9+/]{86}==$/.test(signature) ||
				Buffer.from(signature, "base64").toString("base64") !== signature
			)
				fail("INVALID_REQUEST");
			await rate("authenticate", context, p.wallet);
			let verified;
			try {
				verified = await verifySignature(p.wallet, message, signature);
			} catch {
				fail("UNAVAILABLE");
			}
			if (verified !== true) fail("UNAUTHORIZED");
			const sessionToken = createSessionToken(randomBytes),
				csrfToken = recoverableCsrf
					? createHmac("sha256", keySecret)
							.update(`passport-csrf-v1:${sessionToken}`)
							.digest("base64url")
					: createCsrfToken(randomBytes);
			token(sessionToken);
			token(csrfToken);
			if (
				sessionToken === csrfToken ||
				sessionToken === p.nonce ||
				csrfToken === p.nonce
			)
				fail("UNAVAILABLE");
			return tx(async (client) => {
				const linkId = await lockLink(client, p.passportId, p.wallet);
				// Acquire the nonce row before sampling time: a row-lock wait must
				// never turn an expired proof into a fresh session.
				one(
					await client.query(
						`SELECT c.challenge_id::text FROM quest.wallet_challenges c
                 JOIN quest.passport_challenge_bindings b ON b.challenge_id=c.challenge_id
                 WHERE c.network='DEVNET' AND c.nonce_hash=$1 AND c.consumed_at IS NULL
                 AND c.passport_id=$2 AND c.wallet=$3 AND c.domain=$4 AND c.action='passport.authenticate'
                 AND c.issued_at=$5::timestamptz AND c.expires_at=$6::timestamptz AND b.link_id=$7 FOR UPDATE OF c`,
						[
							hashNonce(p.nonce),
							p.passportId,
							p.wallet,
							domain,
							p.issuedAt,
							p.expiresAt,
							linkId,
						],
					),
				);
				const at = await now(client);
				if (Date.parse(p.issuedAt) > at || at >= Date.parse(p.expiresAt))
					fail("UNAUTHORIZED");
				const challenge = one(
					await client.query(
						`UPDATE quest.wallet_challenges SET consumed_at=$1::timestamptz
     WHERE network='DEVNET' AND nonce_hash=$2 AND consumed_at IS NULL AND passport_id=$3 AND wallet=$4 AND domain=$5
     AND action='passport.authenticate' AND issued_at=$6::timestamptz AND expires_at=$7::timestamptz
     AND issued_at<=clock_timestamp() AND expires_at>clock_timestamp()
     AND EXISTS(SELECT 1 FROM quest.passport_challenge_bindings b WHERE b.challenge_id=wallet_challenges.challenge_id AND b.link_id=$8)
     RETURNING challenge_id::text`,
						[
							iso(at),
							hashNonce(p.nonce),
							p.passportId,
							p.wallet,
							domain,
							p.issuedAt,
							p.expiresAt,
							linkId,
						],
					),
				);
				const stored = createSession({
					network: "DEVNET",
					passportId: p.passportId,
					sessionToken,
					csrfToken,
					issuedAt: iso(at),
					expiresAt: iso(at + SESSION_TTL_MS),
				});
				const s = one(
					await client.query(
						`INSERT INTO quest.passport_sessions(network,passport_id,token_hash,csrf_hash,issued_at,expires_at)
     VALUES('DEVNET',$1,$2,$3,$4::timestamptz,$5::timestamptz) RETURNING session_id::text`,
						[
							p.passportId,
							stored.tokenHash,
							stored.csrfHash,
							stored.issuedAt,
							stored.expiresAt,
						],
					),
				);
				one(
					await client.query(
						"INSERT INTO quest.passport_auth_bindings(session_id,challenge_id,link_id,domain) VALUES($1,$2,$3,$4) RETURNING session_id::text",
						[s.session_id, challenge.challenge_id, linkId, domain],
					),
				);
				const finishedAt = await now(client);
				if (
					finishedAt >= Date.parse(p.expiresAt) ||
					finishedAt >= Date.parse(stored.expiresAt)
				)
					fail("UNAUTHORIZED");
				return {
					network: "DEVNET",
					passportId: p.passportId,
					wallet: p.wallet,
					expiresAt: stored.expiresAt,
					csrfToken,
					cookie: serializeSessionCookie(sessionToken, {
						maxAgeSeconds: Math.floor(
							(Date.parse(stored.expiresAt) - finishedAt) / 1000,
						),
					}),
				};
			});
		},
		async resume({ cookieHeader }, context) {
			if (!recoverableCsrf) fail("UNAUTHORIZED");
			const presented = cookieToken(cookieHeader);
			await rate("session", context);
			const csrfToken = createHmac("sha256", keySecret)
				.update(`passport-csrf-v1:${presented}`)
				.digest("base64url");
			return tx(async (client) => ({
				...(await checkSession(client, presented, { lock: true, csrfToken })),
				csrfToken,
			}));
		},
		async readSession({ cookieHeader }, context) {
			const presented = cookieToken(cookieHeader);
			await rate("session", context);
			return tx(
				async (client) => ({
					...(await checkSession(client, presented)),
					trust: "HISTORICAL_SESSION_SNAPSHOT",
				}),
				true,
			);
		},
		async withSession({ cookieHeader, csrfToken }, context, work) {
			const presented = cookieToken(cookieHeader);
			token(csrfToken);
			if (typeof work !== "function") fail("INVALID_REQUEST");
			await rate("session", context);
			return tx(async (client) => {
				const session = await checkSession(client, presented, {
					lock: true,
					csrfToken,
				});
				// Callback is server-owned SQL work, never a client function or external side effect.
				const value = await work({ client, session });
				const at = await now(client);
				if (at >= Date.parse(session.expiresAt)) fail("UNAUTHORIZED");
				return value;
			});
		},
		async logout({ cookieHeader, csrfToken }, context) {
			const presented = cookieToken(cookieHeader);
			token(csrfToken);
			await rate("session", context);
			return tx(async (client) => {
				const session = await checkSession(client, presented, {
					lock: true,
					csrfToken,
					exclusive: true,
				});
				const at = await now(client);
				one(
					await client.query(
						"UPDATE quest.passport_sessions SET revoked_at=$1::timestamptz WHERE session_id=$2 AND revoked_at IS NULL RETURNING session_id::text",
						[iso(at), session.sessionId],
					),
				);
				return { cookie: CLEAR_PASSPORT_COOKIE };
			});
		},
	};
}
