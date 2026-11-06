// Devnet Quest/Pass TEST backend. Composes the reviewed durable Passport auth and the
// calendar service over a dedicated PostgreSQL database and serves ONLY the dispatcher from
// createQuestTestWebHandler (wallet challenge/authenticate/session/logout, calendar
// snapshot/history). No operator endpoint, no XP writer, no award or mint path exists here. The one
// exception is the admin pause route (/admin/pause), which exists only when QUEST_PAUSE_ADMIN_TOKEN and
// QUEST_PAUSE_DB_URL are both set; it can only move the six emergency stops, through its own login.
//
// Run with bun in the quest-backend image. Every setting comes from the environment; secrets
// live in the host's secret files and are never logged.

import { readFileSync, statSync } from "node:fs";
import { Connection, Keypair } from "@solana/web3.js";
import pg from "pg";
import { readQuestDatabaseIdentity } from "../scripts/quest/database-identity.mjs";
import { createUserPaidPassService } from "../scripts/quest/pass-user-paid-mint.mjs";
import { createDurablePassportAuth } from "../scripts/quest/passport-durable-auth.mjs";
import { createPublicPassportAuth } from "../scripts/quest/passport-public-enrollment.mjs";
import { createQuestCalendarService } from "../scripts/quest/quest-calendar-service.mjs";
import { createPauseAdminHandler } from "../scripts/quest/quest-pause-admin.mjs";
import { createQuestAdminHandler } from "../scripts/quest/quest-admin.mjs";
import { createQuestTestWebHandler } from "../scripts/quest/quest-test-web-handler.mjs";
import { createDevnetSwapProgressProvider } from "../scripts/quest/devnet-swap-progress-config.mjs";

const need = (name) => {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required setting ${name}`);
	return value;
};
const int = (name, fallback, min, max) => {
	const value =
		process.env[name] === undefined ? fallback : Number(process.env[name]);
	if (!Number.isInteger(value) || value < min || value > max)
		throw new Error(`Invalid setting ${name}`);
	return value;
};

const webOrigin = need("QUEST_WEB_ORIGIN");
const environment = {
	network: "DEVNET",
	environmentId: need("QUEST_ENVIRONMENT_ID"),
	manifestSha256: need("QUEST_MANIFEST_SHA256"),
};
const rateKeySecret = Buffer.from(need("QUEST_RATE_KEY_SECRET"), "base64");
const window = int("QUEST_RATE_WINDOW_MS", 3_600_000, 1000, 3_600_000);
const ratePolicies = {
	challenge: {
		limit: int("QUEST_RATE_CHALLENGE", 600, 1, 10_000),
		windowMs: window,
	},
	authenticate: {
		limit: int("QUEST_RATE_AUTHENTICATE", 600, 1, 10_000),
		windowMs: window,
	},
	session: {
		limit: int("QUEST_RATE_SESSION", 6000, 1, 10_000),
		windowMs: window,
	},
};

const pool = new pg.Pool({
	connectionString: need("QUEST_DB_URL"),
	max: int("QUEST_DB_POOL_MAX", 5, 1, 20),
	connectionTimeoutMillis: 3000,
	idleTimeoutMillis: 30_000,
	statement_timeout: int("QUEST_SQL_TIMEOUT_MS", 5000, 500, 15_000),
	query_timeout: int("QUEST_SQL_TIMEOUT_MS", 5000, 500, 15_000) + 1000,
	idle_in_transaction_session_timeout: 10_000,
	application_name: "solve3-quest-test",
});
pool.on("error", () => {
	/* idle client errors are surfaced by the next query as UNAVAILABLE */
});

// Startup checks on the SAME login role the service uses: the serving role must hold no
// create/mutate-identity power, and the database must carry exactly this environment's pins.
const probe = await pool.connect();
try {
	const db = await readQuestDatabaseIdentity(probe);
	const id = db.identity;
	if (
		db.superuser ||
		db.canCreateQuestObjects ||
		db.canCreatePublicObjects ||
		db.canCreateDatabaseObjects ||
		db.canMutateIdentity ||
		!id ||
		id.network !== "DEVNET" ||
		id.environmentId !== environment.environmentId ||
		id.manifestSha256 !== environment.manifestSha256
	)
		throw new Error("Quest database identity or privileges are not acceptable");
} finally {
	probe.release();
}

let auth = createDurablePassportAuth({
	recoverableCsrf: true,
	pool,
	environment,
	origin: webOrigin,
	ratePolicies,
	rateKeySecret,
});
let enrollmentPool;
if (process.env.QUEST_PUBLIC_ENROLLMENT === "true") {
	enrollmentPool = new pg.Pool({
		connectionString: need("QUEST_ENROLLMENT_DB_URL"),
		max: 3,
		connectionTimeoutMillis: 3000,
		statement_timeout: 5000,
		query_timeout: 6000,
		idle_in_transaction_session_timeout: 10000,
	});
	const c = await enrollmentPool.connect();
	try {
		const id = await readQuestDatabaseIdentity(c);
		if (
			id.superuser ||
			id.canCreateQuestObjects ||
			id.canCreatePublicObjects ||
			id.canCreateDatabaseObjects ||
			id.canMutateIdentity ||
			id.identity?.environmentId !== environment.environmentId ||
			id.identity?.manifestSha256 !== environment.manifestSha256 ||
			id.identity?.network !== "DEVNET"
		)
			throw new Error("Enrollment role or environment differs");
		const powers = await c.query(
			"SELECT has_table_privilege(current_user,'quest.passports','INSERT') OR has_table_privilege(current_user,'quest.wallet_bindings','INSERT') OR has_table_privilege(current_user,'quest.wallet_links','INSERT') AS broad",
		);
		if (powers.rows[0].broad)
			throw new Error("Enrollment role must have only narrow functions");
	} finally {
		c.release();
	}
	auth = createPublicPassportAuth({
		auth,
		enrollmentPool,
		environment,
		rateKeySecret,
	});
}
let passService;
if (process.env.QUEST_PASS_MINT_ENABLED === "true") {
	const authorityPath = need("QUEST_PASS_AUTHORITY_FILE");
	const authorityStat = statSync(authorityPath);
	if (!authorityStat.isFile() || (authorityStat.mode & 0o077) !== 0)
		throw new Error("Pass authority file must have private file permissions");
	let key;
	try {
		key = Keypair.fromSecretKey(
			Uint8Array.from(JSON.parse(readFileSync(authorityPath, "utf8"))),
		);
	} catch {
		// JSON parser diagnostics can quote fragments of secret input.
		throw new Error("Pass authority file is invalid or unavailable");
	}
	const rpc = need("QUEST_DEVNET_RPC_URL");
	if (new URL(rpc).protocol !== "https:")
		throw new Error("Pass RPC must use HTTPS");
	const connection = new Connection(rpc, {
		commitment: "confirmed",
		confirmTransactionInitialTimeout: 30000,
		fetch: async (input, init) =>
			fetch(input, {
				...init,
				signal: AbortSignal.any([
					...(init?.signal ? [init.signal] : []),
					AbortSignal.timeout(5000),
				]),
			}),
	});
	try {
		if (
			(await connection.getGenesisHash()) !==
			"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
		)
			throw new Error("Wrong genesis");
	} catch {
		throw new Error("Pass RPC Devnet verification failed");
	}
	passService = createUserPaidPassService({
		auth,
		connection,
		seed: key.secretKey.slice(0, 32),
		origin: webOrigin,
	});
}
// Weekly swap progress (TEST ONLY). Reads the finalized swap ledger that the swap worker fills,
// through a separate read-only login. Anything missing leaves progress unavailable; the rest of
// the backend is unaffected.
let weeklyProgressProvider;
let sourceReaderPool;
if (process.env.QUEST_SWAP_PROGRESS_ENABLED === "true") {
	try {
		sourceReaderPool = new pg.Pool({
			connectionString: need("QUEST_SOURCE_READER_DB_URL"),
			max: 3,
			connectionTimeoutMillis: 2000,
			idleTimeoutMillis: 10_000,
			query_timeout: 4000,
			statement_timeout: 4000,
			idle_in_transaction_session_timeout: 5000,
		});
		weeklyProgressProvider = await createDevnetSwapProgressProvider({
			pool: sourceReaderPool,
			campaignId: need("QUEST_SWAP_CAMPAIGN_ID"),
			environment,
		});
		console.log("weekly swap progress enabled (test policy)");
	} catch (error) {
		weeklyProgressProvider = undefined;
		console.log(
			`weekly swap progress disabled: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}`,
		);
	}
}
// Admin pause switches. Its own login (execute set_pause / pause_status only) and a long shared token; the
// website's server calls it after verifying an admin wallet signature. Anything missing leaves it disabled.
let pausePool;
let pauseAdmin;
if (process.env.QUEST_PAUSE_ADMIN_TOKEN && process.env.QUEST_PAUSE_DB_URL) {
	try {
		pausePool = new pg.Pool({
			connectionString: need("QUEST_PAUSE_DB_URL"),
			max: 2,
			connectionTimeoutMillis: 3000,
			idleTimeoutMillis: 10_000,
			statement_timeout: 5000,
			query_timeout: 6000,
			idle_in_transaction_session_timeout: 5000,
		});
		const c = await pausePool.connect();
		try {
			const id = await readQuestDatabaseIdentity(c);
			if (
				id.superuser ||
				id.canCreateQuestObjects ||
				id.canCreatePublicObjects ||
				id.canCreateDatabaseObjects ||
				id.canMutateIdentity ||
				id.identity?.environmentId !== environment.environmentId ||
				id.identity?.manifestSha256 !== environment.manifestSha256 ||
				id.identity?.network !== "DEVNET"
			)
				throw new Error("Pause admin role or environment differs");
			const powers = await c.query(
				"SELECT has_table_privilege(current_user,'quest.pause_switches','UPDATE') OR has_table_privilege(current_user,'quest.xp_events','INSERT') OR has_table_privilege(current_user,'quest.level_events','INSERT') AS broad",
			);
			if (powers.rows[0].broad)
				throw new Error("Pause admin role must only execute the pause functions");
		} finally {
			c.release();
		}
		pauseAdmin = createPauseAdminHandler({
			token: process.env.QUEST_PAUSE_ADMIN_TOKEN,
			pool: pausePool,
		});
		console.log("admin pause route enabled");
	} catch (error) {
		pauseAdmin = undefined;
		await pausePool?.end().catch(() => {});
		pausePool = undefined;
		console.log(
			`admin pause route disabled: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}`,
		);
	}
}
// Admin quest controls: the calendar plan and the manual community goals (see quest-admin.mjs). Its own login
// (the calendar store's writes and the manual goal functions only) and its own long shared token; the website's
// server calls it after verifying an admin wallet signature. Anything missing leaves it disabled.
let questAdminPool;
let questAdmin;
if (process.env.QUEST_ADMIN_TOKEN && process.env.QUEST_ADMIN_DB_URL) {
	try {
		questAdminPool = new pg.Pool({
			connectionString: need("QUEST_ADMIN_DB_URL"),
			max: 3,
			connectionTimeoutMillis: 3000,
			idleTimeoutMillis: 10_000,
			statement_timeout: 20_000,
			query_timeout: 22_000,
			idle_in_transaction_session_timeout: 20_000,
		});
		const c = await questAdminPool.connect();
		try {
			const id = await readQuestDatabaseIdentity(c);
			if (
				id.superuser ||
				id.canCreateQuestObjects ||
				id.canCreatePublicObjects ||
				id.canCreateDatabaseObjects ||
				id.canMutateIdentity ||
				id.identity?.environmentId !== environment.environmentId ||
				id.identity?.manifestSha256 !== environment.manifestSha256 ||
				id.identity?.network !== "DEVNET"
			)
				throw new Error("Quest admin role or environment differs");
			const powers = await c.query(
				"SELECT has_table_privilege(current_user,'quest.xp_events','INSERT') OR has_table_privilege(current_user,'quest.xp_events','SELECT') OR has_table_privilege(current_user,'quest.level_events','INSERT') OR has_table_privilege(current_user,'quest.pause_switches','UPDATE') OR has_table_privilege(current_user,'quest.manual_goals','INSERT') AS broad",
			);
			if (powers.rows[0].broad)
				throw new Error("Quest admin role must only execute the goal functions and write calendar plans");
		} finally {
			c.release();
		}
		questAdmin = createQuestAdminHandler({
			token: process.env.QUEST_ADMIN_TOKEN,
			pool: questAdminPool,
			environment,
		});
		console.log("admin quest route enabled");
	} catch (error) {
		questAdmin = undefined;
		await questAdminPool?.end().catch(() => {});
		questAdminPool = undefined;
		console.log(
			`admin quest route disabled: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}`,
		);
	}
}
const service = createQuestCalendarService({
	auth,
	environment,
	...(weeklyProgressProvider ? { weeklyProgressProvider } : {}),
});
// Every request arrives through the website's own server-side gateway, so the only trustworthy
// peer is that gateway. Browser-supplied forwarding headers are deliberately ignored; all
// testers therefore share one rate bucket (see the integration notes).
const handle = createQuestTestWebHandler({
	passService,
	auth,
	service,
	resolveClientContext: async () => ({
		origin: webOrigin,
		clientKey: "website-gateway",
	}),
});

const json = (status, body) =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		},
	});

const server = Bun.serve({
	port: int("PORT", 8080, 1, 65535),
	hostname: "0.0.0.0",
	// The public handlers enforce their own, smaller caps while streaming; only the admin quest route needs room
	// for a full-year plan (up to 512 KiB) and it checks its bearer token before it reads any body.
	maxRequestBodySize: questAdmin ? 655_360 : 16_384,
	idleTimeout: 10,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/healthz" && request.method === "GET") {
			try {
				await pool.query("SELECT 1");
				return json(200, { ok: true });
			} catch {
				return json(503, { error: "UNAVAILABLE" });
			}
		}
		if (url.pathname === "/admin/quests") {
			if (!questAdmin || url.search) return json(404, { error: "NOT_FOUND" });
			try {
				return await questAdmin(request);
			} catch {
				return json(503, { error: "UNAVAILABLE" });
			}
		}
		if (url.pathname === "/admin/pause") {
			if (!pauseAdmin || url.search) return json(404, { error: "NOT_FOUND" });
			try {
				return await pauseAdmin(request);
			} catch {
				return json(503, { error: "UNAVAILABLE" });
			}
		}
		const match = /^\/(passport|calendar|pass)\/([a-z-]+)$/.exec(url.pathname);
		if (!match || url.search) return json(404, { error: "NOT_FOUND" });
		try {
			return await handle(match[1], match[2], request);
		} catch {
			return json(503, { error: "UNAVAILABLE" });
		}
	},
});
console.log(`quest test backend listening on :${server.port} for ${webOrigin}`);

const stop = async () => {
	server.stop();
	await pool.end().catch(() => {});
	await enrollmentPool?.end().catch(() => {});
	await sourceReaderPool?.end().catch(() => {});
	await pausePool?.end().catch(() => {});
	await questAdminPool?.end().catch(() => {});
	process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
