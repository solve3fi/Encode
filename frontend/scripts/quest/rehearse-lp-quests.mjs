// Disposable integration rehearsal for LP quests: real migrations, the real least-privilege grants,
// the real LP valuation SQL and the real qualification reader. It creates and drops its own database;
// point it at a throwaway PostgreSQL server (QUEST_TEST_PG_HOST/PORT/USER/PASSWORD). No chain access.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fingerprintGenesisEvent } from "../../src/lib/genesis/eventFingerprint.ts";
import {
	indexerGrants,
	readerGrants,
} from "../../deploy/quest-backend/swap-grants.mjs";
import { runLpValuations } from "./devnet-lp-valuation.mjs";
import { createPassportSwapQualificationReader } from "./passport-snapshot-reader.mjs";

const pgModule = process.env.QUEST_TEST_PG_MODULE;
const { default: pg } = await import(pgModule ? pathToFileURL(pgModule).href : "pg");
const conn = {
	host: process.env.QUEST_TEST_PG_HOST ?? "127.0.0.1",
	port: Number(process.env.QUEST_TEST_PG_PORT ?? 5432),
	user: process.env.QUEST_TEST_PG_USER ?? "postgres",
	password: process.env.QUEST_TEST_PG_PASSWORD,
};
const stamp = `${Date.now()}_${process.pid}`;
const db = `quest_lp_rehearsal_${stamp}`;
const indexerRole = `quest_lp_indexer_${stamp}`;
const readerRole = `quest_lp_reader_${stamp}`;
const admin = new pg.Client({ ...conn, database: process.env.QUEST_TEST_PG_ADMIN_DB ?? "postgres" });

const USDC = "FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up";
const SOLV3 = "DvGitpT8Qujq6sxXoq7M1vueGf97dGVpoPWY4ifYHCHu";
const POOL = "BtcFcgKWEApuZ1xhp3EKw9GBgxJvhuLjJ87hfZEL3zu5";
const COLD_POOL = "2VQotSRZWY15iD7TbYgCQdQufdmtPWqH8936xc6ZoKn9";
const WALLET = "HRmz8NhLJDXYiSyR6STzBkofJZGb9ZMbbEh3rMHRVXNV";
const PASSPORT = "11111111-1111-4111-8111-111111111111";
const campaignId = "lp-rehearsal";
const environment = {
	environmentId: "33333333-3333-4333-8333-333333333333",
	manifestSha256: "a".repeat(64),
	network: "DEVNET",
};
const policy = (lp) => ({
	fixtureKind: "SYNTHETIC_DEVNET",
	network: "DEVNET",
	revision: 1,
	minimumSwapUsdCents: "100",
	maximumPriceAgeSeconds: 60,
	valuationSource: "devnet-usdc-leg",
	valuationVersion: "devnet-usdc-leg-v1",
	lp,
});
const lpPolicy = {
	featuredPools: [POOL],
	minimumLpUsdCents: "1000",
	minimumDwellSeconds: 3600,
	valuationSource: "devnet-usdc-leg",
	valuationVersion: "devnet-usdc-leg-lp-v1",
};

let connection;
let created = false;
try {
	await admin.connect();
	assert.ok(Number((await admin.query("SHOW server_version_num")).rows[0].server_version_num) >= 160000);
	await admin.query(`CREATE DATABASE "${db}"`);
	created = true;
	connection = new pg.Client({ ...conn, database: db });
	await connection.connect();
	for (const dir of ["db/migrations", "db/quest/migrations"]) {
		const base = fileURLToPath(new URL(`../../${dir}/`, import.meta.url));
		for (const name of (await readdir(base)).filter((n) => n.endsWith(".sql")).sort())
			await connection.query(await readFile(base + name, "utf8"));
	}
	for (const role of [indexerRole, readerRole]) await admin.query(`CREATE ROLE "${role}" NOLOGIN`);
	for (const sql of indexerGrants(`"${indexerRole}"`)) await connection.query(sql);
	for (const sql of readerGrants(`"${readerRole}"`)) await connection.query(sql);

	await connection.query(
		`INSERT INTO quest.environment_identity (network,genesis_hash,environment_id,manifest_sha256,namespace)
		 VALUES ('DEVNET','EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',$1,$2,'quest')`,
		[environment.environmentId, environment.manifestSha256],
	);
	const now = Math.floor(Date.now() / 1000);
	const hour = 3600;
	await connection.query(
		"INSERT INTO genesis.campaigns (id,cluster,starts_at,ends_at) VALUES ($1,'devnet',to_timestamp($2),to_timestamp($3))",
		[campaignId, now - 30 * 86400, now + 30 * 86400],
	);
	await connection.query(
		"INSERT INTO genesis.indexer_cursors (campaign_id,program_id,decoder_version,next_slot,reconciliation_start_slot) VALUES ($1,'fixture-program','fixture-decoder',1000,10)",
		[campaignId],
	);
	const insertEvent = async (signature, kind, slot, ageSeconds, pool, position, usdcRaw, otherRaw) => {
		const record = {
			campaignId,
			cluster: "devnet",
			signature,
			instructionIndex: 0,
			eventIndex: 0,
			eventKind: kind,
			slot,
			blockTimeSeconds: now - ageSeconds,
			wallet: WALLET,
			poolAddress: pool,
			positionAddress: position,
			payload: {
				kind,
				instructionKind: kind === "liquidity_increase" ? "increase_liquidity_v2" : "decrease_liquidity_v2",
				poolAddress: pool,
				positionAddress: position,
				tickLowerIndex: -443520,
				tickUpperIndex: 443520,
				liquidityRaw: "1000",
				tokenAAmountRaw: otherRaw,
				tokenBAmountRaw: usdcRaw,
				tokenATransferFeeRaw: "0",
				tokenBTransferFeeRaw: "0",
			},
		};
		await connection.query(
			`INSERT INTO genesis.chain_events (campaign_id,cluster,signature,instruction_index,event_index,event_kind,
			 slot,block_time,wallet,pool_address,position_address,payload,event_sha256,decoder_version,verified_at)
			 VALUES ($1,'devnet',$2,0,0,$3,$4,to_timestamp($5),$6,$7,$8,$9::jsonb,$10,'fixture-decoder',now())`,
			[
				campaignId,
				signature,
				kind,
				slot,
				record.blockTimeSeconds,
				WALLET,
				pool,
				position,
				JSON.stringify(record.payload),
				fingerprintGenesisEvent(record).eventSha256,
			],
		);
	};
	// 100 devUSDC deposited 3h ago; 70 devUSDC withdrawn 1h ago -> 30 left, still above the $10 minimum.
	await insertEvent("sig-inc-1", "liquidity_increase", 100, 3 * hour, POOL, "PosHot1", "100000000", "500000000000");
	await insertEvent("sig-dec-1", "liquidity_decrease", 200, 1 * hour, POOL, "PosHot1", "70000000", "350000000000");
	// A position in a non-featured pool (must not create LP rows) and a tiny one below the minimum.
	await insertEvent("sig-inc-2", "liquidity_increase", 300, 2 * hour, COLD_POOL, "PosCold", "900000000", "1");
	await connection.query("UPDATE genesis.indexer_cursors SET reconciled_through_slot = 999");
	await connection.query("INSERT INTO quest.passports (passport_id) VALUES ($1)", [PASSPORT]);
	await connection.query("INSERT INTO quest.wallet_bindings (wallet,passport_id) VALUES ($1,$2)", [WALLET, PASSPORT]);
	await connection.query(
		"INSERT INTO quest.wallet_links (wallet,passport_id,linked_at,link_evidence_sha256) VALUES ($1,$2,to_timestamp($3),repeat('a',64))",
		[WALLET, PASSPORT, now - 4 * hour],
	);

	const makePool = (role) => ({
		async connect() {
			const client = new pg.Client({ ...conn, database: db });
			await client.connect();
			await client.query(`SET ROLE "${role}"`);
			return {
				query: (sql, params) => client.query(sql, params),
				release: () => void client.end(),
			};
		},
	});
	const resolvePoolMints = async () => ({ mintA: SOLV3, mintB: USDC });
	const base = { campaignId, resolvePoolMints, usdcMint: USDC, usdcDecimals: 6 };

	// 1. the indexer role values every liquidity event, in order, exactly once
	const first = await runLpValuations({ pool: makePool(indexerRole), ...base });
	assert.equal(first.valued, 3);
	assert.equal(first.unresolved, 0);
	const second = await runLpValuations({ pool: makePool(indexerRole), ...base });
	assert.equal(second.valued, 0);
	const stored = (
		await connection.query(
			`SELECT position_address, sequence::text, value_usd_cents::text AS value, snapshot_key
			 FROM genesis.lp_value_snapshots WHERE campaign_id=$1 ORDER BY position_address, sequence`,
			[campaignId],
		)
	).rows;
	assert.deepEqual(
		stored.map((r) => [r.position_address, r.sequence, r.value]),
		[["PosCold", "0", "90000"], ["PosHot1", "0", "10000"], ["PosHot1", "1", "3000"]],
	);
	// snapshots are immutable
	await assert.rejects(connection.query("UPDATE genesis.lp_value_snapshots SET value_usd_cents = 1"), /append-only/i);
	// the reader role can read snapshots but never write them
	const readerClient = await makePool(readerRole).connect();
	await assert.rejects(
		readerClient.query("INSERT INTO genesis.lp_value_snapshots (campaign_id) VALUES ('x')"),
		/permission denied/,
	);
	readerClient.release();

	// 2. the qualification reader derives the Passport's LP intervals from stored evidence
	const reader = createPassportSwapQualificationReader({
		pool: makePool(readerRole),
		network: "DEVNET",
		campaignId,
		programId: "fixture-program",
		decoderVersion: "fixture-decoder",
		startSlot: 10,
		environment,
		includeSourceContext: true,
		conservativeLinkTimes: true,
		policy: policy(lpPolicy),
	});
	const out = await reader.read(999);
	assert.ok(out.lp, "LP section must be present and valid");
	assert.equal(out.lp.awardEligible, false);
	assert.equal(out.lp.minimumDwellMs, 3_600_000);
	assert.equal(out.lp.passports.length, 1);
	const [row] = out.lp.passports;
	assert.equal(row.passportId, PASSPORT);
	assert.equal(row.pools.length, 1);
	assert.equal(row.pools[0].poolAddress, POOL);
	const [[from, to]] = row.pools[0].intervals;
	assert.ok(Math.abs(from - (now - 3 * hour) * 1000) < 2000, "interval starts at the deposit");
	assert.ok(to >= Date.now() - 60_000, "interval stays open until capture");

	// 3. a missing valuation makes the LP section unavailable, never fabricated; swaps are unaffected
	await insertEvent("sig-inc-3", "liquidity_increase", 400, 600, POOL, "PosLate", "50000000", "1");
	await connection.query("UPDATE genesis.indexer_cursors SET reconciled_through_slot = 999");
	const incomplete = await reader.read(999);
	assert.equal(incomplete.lp, null);
	assert.equal(incomplete.state, "SYNTHETIC_DEVNET_SWAP_QUALIFICATION");

	// 4. a swap-only policy keeps the original result shape (no lp key)
	const swapOnly = createPassportSwapQualificationReader({
		pool: makePool(readerRole),
		network: "DEVNET",
		campaignId,
		programId: "fixture-program",
		decoderVersion: "fixture-decoder",
		startSlot: 10,
		environment,
		includeSourceContext: true,
		conservativeLinkTimes: true,
		policy: policy(undefined),
	});
	assert.equal(Object.hasOwn(await swapOnly.read(999), "lp"), false);
	// 5. range-aware mode: only time the pool's price sat inside the position's range counts
	await runLpValuations({ pool: makePool(indexerRole), ...base }); // value the late event again for step 3
	const rangedPolicy = { ...lpPolicy, requireInRange: true, maxSampleGapSeconds: 600 };
	const rangedReader = createPassportSwapQualificationReader({
		pool: makePool(readerRole),
		network: "DEVNET",
		campaignId,
		programId: "fixture-program",
		decoderVersion: "fixture-decoder",
		startSlot: 10,
		environment,
		includeSourceContext: true,
		conservativeLinkTimes: true,
		policy: policy(rangedPolicy),
	});
	const noSamples = await rangedReader.read(999);
	assert.ok(noSamples.lp, "no price samples is not an error");
	assert.equal(noSamples.lp.passports.length, 0, "with no samples no time is credited");

	// the reader role cannot write samples; the indexer role can; samples are immutable
	const readerWrite = await makePool(readerRole).connect();
	await assert.rejects(
		readerWrite.query(
			"INSERT INTO quest.pool_tick_samples (pool_address, observed_slot, observed_at, tick_current_index) VALUES ($1,1,now(),0)",
			[POOL],
		),
		/permission denied/,
	);
	readerWrite.release();
	const sampler = await makePool(indexerRole).connect();
	// the price is inside the full-range position from 2h ago until 1h ago, then it is observed outside
	for (let i = 0; i <= 15; i++)
		await sampler.query(
			"INSERT INTO quest.pool_tick_samples (pool_address, observed_slot, observed_at, tick_current_index) VALUES ($1,$2,to_timestamp($3),0)",
			[POOL, 1000 + i, now - 2 * hour + i * 240],
		);
	await sampler.query(
		"INSERT INTO quest.pool_tick_samples (pool_address, observed_slot, observed_at, tick_current_index) VALUES ($1,2000,to_timestamp($2),443600)",
		[POOL, now - hour + 600],
	);
	await assert.rejects(sampler.query("UPDATE quest.pool_tick_samples SET tick_current_index = 1"), /permission denied|append-only/i);
	await assert.rejects(sampler.query("DELETE FROM quest.pool_tick_samples"), /permission denied|append-only/i);
	sampler.release();

	const ranged = await rangedReader.read(999);
	assert.equal(ranged.lp.passports.length, 1);
	const [[rangedFrom, rangedTo]] = ranged.lp.passports[0].pools[0].intervals;
	assert.ok(Math.abs(rangedFrom - (now - 2 * hour) * 1000) < 2000, "credit starts at the first in-range sample");
	assert.ok(rangedTo <= (now - hour + 600) * 1000, "credit stops once the price is observed outside the range");
	assert.ok(rangedTo - rangedFrom >= 3_000_000, "about an hour of in-range time is credited");

	console.log("LP quest rehearsal passed: valuation, grants, immutability, reader, unavailable-LP, swap-only shape and range-aware credit.");
} finally {
	await connection?.end().catch(() => {});
	if (created) {
		await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`).catch(() => {});
		for (const role of [indexerRole, readerRole])
			await admin.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => {});
	}
	await admin.end().catch(() => {});
}
