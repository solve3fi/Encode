// Disposable integration rehearsal only. No production endpoint or credentials.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { fingerprintGenesisEvent } from "../../src/lib/genesis/eventFingerprint.ts";
import {
	ownershipBlockConnection,
	ownershipBlockRangeFixture,
} from "../../tests/fixtures/quest-ownership-block-range.mjs";
import { positionBaselineFixture } from "../../tests/fixtures/quest-position-baseline.mjs";
import {
	closureEvidenceFixture,
	ownershipAnchorInput,
	transferEvidenceFixture,
} from "../../tests/fixtures/quest-position-ownership.mjs";
import {
	createPassportPositionEvidenceReader,
	createPassportSwapEvidenceReader,
	createPassportSwapQualificationReader,
} from "./passport-snapshot-reader.mjs";
import { createPositionBaselineAnchorStore } from "./position-baseline-anchor.mjs";
import { createPositionOwnershipEvidenceStore } from "./position-ownership-evidence-store.mjs";
import {
	createPositionOwnershipCoveragePublisher,
	createPositionOwnershipReconciler,
} from "./position-ownership-reconciliation.mjs";
import { createPositionOwnershipStateReader } from "./position-ownership-state-reader.mjs";
import { rehearseDurablePassportAuth } from "./rehearse-passport-durable-auth.mjs";
import { rehearsePositionTimeline } from "./rehearse-position-timeline.mjs";
import { rehearsePublicPassport } from "./rehearse-public-passport.mjs";
import { rehearseQuestCalendar } from "./rehearse-quest-calendar.mjs";
import { rehearseQuestCalendarApi } from "./rehearse-quest-calendar-api.mjs";
import { rehearseCommunityBudgets } from "./rehearse-quest-community-budgets.mjs";
import { rehearseWeeklyLiquidity } from "./rehearse-quest-weekly-liquidity.mjs";
import { rehearseWeeklyProgress } from "./rehearse-quest-weekly-progress.mjs";

const host = process.env.QUEST_TEST_PG_HOST ?? "/var/run/postgresql";
const port = Number(process.env.QUEST_TEST_PG_PORT ?? 5432);
if (
	!["/var/run/postgresql", "127.0.0.1"].includes(host) ||
	!Number.isSafeInteger(port) ||
	port < 1 ||
	port > 65535
) {
	throw new Error("Only a local disposable PostgreSQL test server is allowed");
}
const pgModule = process.env.QUEST_TEST_PG_MODULE;
const { default: pg } = await import(
	pgModule ? pathToFileURL(pgModule).href : "pg"
);
const db = `quest_q5_it_${Date.now()}_${process.pid}`;
const role = `quest_q5_read_test_${Date.now()}_${process.pid}`;
const anchorRole = `quest_q5_anchor_test_${Date.now()}_${process.pid}`;
const publicationRole = `quest_q5_publish_test_${Date.now()}_${process.pid}`;
const authRole = `quest_q2_auth_test_${Date.now()}_${process.pid}`;
const calendarRole = `quest_calendar_test_${Date.now()}_${process.pid}`;
const admin = new pg.Client({
	host,
	port,
	user: "postgres",
	database: "postgres",
});
const ends = [];
let connection;
let created = false;
let roleCreated = false;
let anchorRoleCreated = false;
let publicationRoleCreated = false;
let authRoleCreated = false;
let calendarRoleCreated = false;
try {
	await admin.connect();
	const version = Number(
		(await admin.query("SHOW server_version_num")).rows[0].server_version_num,
	);
	assert.ok(version >= 160000, "PostgreSQL 16 or newer required");
	await admin.query(`CREATE DATABASE "${db}"`);
	created = true;
	connection = new pg.Client({ host, port, user: "postgres", database: db });
	await connection.connect();
	for (const path of [
		"../../db/migrations/001_genesis_core.sql",
		"../../db/migrations/002_genesis_swap_valuations.sql",
		"../../db/migrations/003_genesis_reconciliation_watermark.sql",
		"../../db/quest/migrations/001_environment_identity.sql",
		"../../db/quest/migrations/002_passport_progression_ledgers.sql",
		"../../db/quest/migrations/003_passport_challenge_session.sql",
		"../../db/quest/migrations/004_wallet_link_history.sql",
		"../../db/quest/migrations/005_position_baseline_anchors.sql",
		"../../db/quest/migrations/006_position_ownership_evidence.sql",
		"../../db/quest/migrations/007_position_ownership_conflicts.sql",
		"../../db/quest/migrations/008_position_ownership_coverage.sql",
		"../../db/quest/migrations/009_position_timeline.sql",
		"../../db/quest/migrations/010_durable_passport_auth.sql",
		"../../db/quest/migrations/011_quest_calendar.sql",
		"../../db/quest/migrations/012_calendar_operator_access.sql",
		"../../db/quest/migrations/013_weekly_test_receipts.sql",
		"../../db/quest/migrations/014_community_test_budgets.sql",
	])
		await connection.query(
			await readFile(new URL(path, import.meta.url), "utf8"),
		);
	await admin.query(`CREATE ROLE "${role}" NOLOGIN`);
	roleCreated = true;
	await connection.query(`GRANT USAGE ON SCHEMA genesis, quest TO "${role}"`);
	await connection.query(`GRANT SELECT ON genesis.campaigns, genesis.indexer_cursors, genesis.chain_events,
		genesis.ingest_conflicts, genesis.swap_valuations, quest.wallet_links, quest.environment_identity TO "${role}"`);
	await admin.query(`CREATE ROLE "${anchorRole}" NOLOGIN`);
	anchorRoleCreated = true;
	await connection.query(`GRANT USAGE ON SCHEMA quest TO "${anchorRole}"`);
	await connection.query(
		`GRANT SELECT ON quest.environment_identity, quest.position_baseline_anchors, quest.position_ownership_evidence, quest.position_ownership_conflicts TO "${anchorRole}"`,
	);
	await connection.query(
		`GRANT INSERT ON quest.position_baseline_anchors, quest.position_ownership_evidence, quest.position_ownership_conflicts TO "${anchorRole}"`,
	);
	await admin.query(`CREATE ROLE "${publicationRole}" NOLOGIN`);
	publicationRoleCreated = true;
	await connection.query(`GRANT USAGE ON SCHEMA quest TO "${publicationRole}"`);
	await connection.query(
		`GRANT SELECT ON quest.environment_identity,quest.position_baseline_anchors,quest.position_ownership_evidence,quest.position_ownership_conflicts,quest.position_ownership_coverage TO "${publicationRole}"`,
	);
	await connection.query(
		`GRANT INSERT ON quest.position_ownership_conflicts,quest.position_ownership_coverage TO "${publicationRole}"`,
	);
	await connection.query(
		`GRANT UPDATE(covered_through_slot,last_range_start,last_range_end,last_range_sha256,last_stored_sha256,last_produced_slot,last_block_hash,revision,invalidation_reason) ON quest.position_ownership_coverage TO "${publicationRole}"`,
	);
	await connection.query(`INSERT INTO quest.environment_identity
		(network,genesis_hash,environment_id,manifest_sha256,namespace)
		VALUES ('DEVNET','EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','33333333-3333-4333-8333-333333333333',repeat('a',64),'quest')`);
	const wallet = "1".repeat(32);
	const passport = "11111111-1111-4111-8111-111111111111";
	const start = Date.parse("2026-10-01T00:00:00Z") / 1000;
	const record = {
		campaignId: "snapshot-integration",
		cluster: "devnet",
		signature: "test-finalized-swap",
		instructionIndex: 0,
		eventIndex: 0,
		eventKind: "swap",
		slot: 12,
		blockTimeSeconds: start + 100,
		wallet,
		poolAddress: "fixture-pool",
		positionAddress: null,
		payload: { inputRaw: "100", instructionKind: "swap" },
	};
	await connection.query(
		"INSERT INTO genesis.campaigns (id,cluster,starts_at,ends_at) VALUES ($1,'devnet',to_timestamp($2),to_timestamp($3))",
		[record.campaignId, start, start + 86400],
	);
	await connection.query(
		"INSERT INTO genesis.indexer_cursors (campaign_id,program_id,decoder_version,next_slot,reconciliation_start_slot) VALUES ($1,'fixture-program','fixture-decoder',16,10)",
		[record.campaignId],
	);
	await connection.query(
		`INSERT INTO genesis.chain_events (campaign_id,cluster,signature,instruction_index,event_index,event_kind,
		slot,block_time,wallet,pool_address,position_address,payload,event_sha256,decoder_version,verified_at)
		VALUES ($1,'devnet',$2,0,0,'swap',12,to_timestamp($3),$4,$5,NULL,$6::jsonb,$7,'fixture-decoder',now())`,
		[
			record.campaignId,
			record.signature,
			record.blockTimeSeconds,
			wallet,
			record.poolAddress,
			JSON.stringify(record.payload),
			fingerprintGenesisEvent(record).eventSha256,
		],
	);
	await connection.query(
		"UPDATE genesis.indexer_cursors SET reconciled_through_slot = 15",
	);
	const lpRecord = {
		...record,
		signature: "test-finalized-lp",
		eventKind: "liquidity_increase",
		poolAddress: wallet,
		positionAddress: "So11111111111111111111111111111111111111112",
		payload: {
			kind: "liquidity_increase",
			instructionKind: "increase_liquidity_v2",
			poolAddress: wallet,
			positionAddress: "So11111111111111111111111111111111111111112",
			tickLowerIndex: -100,
			tickUpperIndex: 100,
			liquidityRaw: "9007199254740993",
			tokenAAmountRaw: "100",
			tokenBAmountRaw: "200",
			tokenATransferFeeRaw: "0",
			tokenBTransferFeeRaw: "0",
		},
	};
	await connection.query(
		`INSERT INTO genesis.chain_events (campaign_id,cluster,signature,instruction_index,event_index,event_kind,
		slot,block_time,wallet,pool_address,position_address,payload,event_sha256,decoder_version,verified_at)
		VALUES ($1,'devnet',$2,0,0,'liquidity_increase',12,to_timestamp($3),$4,$4,$5,$6::jsonb,$7,'fixture-decoder',now())`,
		[
			lpRecord.campaignId,
			lpRecord.signature,
			lpRecord.blockTimeSeconds,
			wallet,
			lpRecord.positionAddress,
			JSON.stringify(lpRecord.payload),
			fingerprintGenesisEvent(lpRecord).eventSha256,
		],
	);
	// Late fixture insertion invalidates the old watermark; republish explicitly.
	await connection.query(
		"UPDATE genesis.indexer_cursors SET reconciled_through_slot = 15",
	);
	await connection.query(
		"INSERT INTO quest.passports (passport_id) VALUES ($1)",
		[passport],
	);
	await connection.query(
		"INSERT INTO quest.wallet_bindings (wallet,passport_id) VALUES ($1,$2)",
		[wallet, passport],
	);
	await connection.query(
		"INSERT INTO quest.wallet_links (wallet,passport_id,linked_at,link_evidence_sha256) VALUES ($1,$2,to_timestamp($3),repeat('a',64))",
		[wallet, passport, start],
	);
	let afterCursor = null;
	const makePool = (selectedRole, afterQuery) => ({
		async connect() {
			const client = new pg.Client({
				host,
				port,
				user: "postgres",
				database: db,
			});
			await client.connect();
			await client.query(`SET ROLE "${selectedRole}"`);
			return {
				async query(sql, params) {
					const result = await client.query(sql, params);
					await afterQuery?.(sql);
					if (sql.includes("FROM genesis.indexer_cursors") && afterCursor) {
						const hook = afterCursor;
						afterCursor = null;
						await hook();
					}
					return result;
				},
				release() {
					ends.push(client.end());
				},
			};
		},
	});
	const pool = makePool(role);
	const anchorPool = makePool(anchorRole);
	await admin.query(`CREATE ROLE "${authRole}" NOLOGIN`);
	authRoleCreated = true;
	await rehearseDurablePassportAuth({ connection, makePool, authRole });
	await admin.query(`CREATE ROLE "${calendarRole}" NOLOGIN`);
	calendarRoleCreated = true;
	await rehearseQuestCalendar({ connection, makePool, calendarRole });
	const calendarApi = await rehearseQuestCalendarApi({
		connection,
		makePool,
		calendarRole,
		authRole,
	});
	await rehearsePositionTimeline({
		connection,
		anchorPool,
		makePool,
		role,
		publicationRole,
	});
	const snapshot = positionBaselineFixture();
	const anchorPins = {
		pool: anchorPool,
		network: "DEVNET",
		campaignId: "baseline-integration",
		programId: snapshot.programId,
		layoutVersion: snapshot.layoutVersion,
		manifestSha256: "a".repeat(64),
	};
	const anchorInput = {
		anchorSlot: snapshot.slot,
		inventory: [
			{
				positionAddress: snapshot.positionAccount.address,
				positionMint: snapshot.mintAccount.address,
				tokenAccountAddress: snapshot.tokenAccount.address,
			},
		],
		snapshots: [snapshot],
	};
	const anchorStore = createPositionBaselineAnchorStore(anchorPins);
	const identical = await Promise.all([
		anchorStore.record(anchorInput),
		anchorStore.record(anchorInput),
	]);
	assert.equal(identical.filter((r) => r.inserted).length, 1);
	assert.equal(identical[0].evidenceSetSha256, identical[1].evidenceSetSha256);
	const altered = structuredClone(anchorInput);
	const changedBytes = Buffer.from(
		altered.snapshots[0].positionAccount.dataBase64,
		"base64",
	);
	changedBytes[100] ^= 1;
	altered.snapshots[0].positionAccount.dataBase64 =
		changedBytes.toString("base64");
	await assert.rejects(anchorStore.record(altered), /conflicting immutable/);
	const competingStore = createPositionBaselineAnchorStore({
		...anchorPins,
		campaignId: "baseline-competing",
	});
	const competing = await Promise.allSettled([
		competingStore.record(anchorInput),
		competingStore.record(altered),
	]);
	assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
	assert.equal(competing.filter((r) => r.status === "rejected").length, 1);
	assert.match(
		competing.find((r) => r.status === "rejected").reason.message,
		/conflicting immutable/,
	);
	for (const sql of [
		"UPDATE quest.position_baseline_anchors SET anchor_slot=13",
		"DELETE FROM quest.position_baseline_anchors",
		"TRUNCATE quest.position_baseline_anchors CASCADE",
	])
		await assert.rejects(connection.query(sql), /immutable/);
	await assert.rejects(
		connection.query(`INSERT INTO quest.position_baseline_anchors
		(campaign_id,network,program_id,layout_version,anchor_slot,manifest_sha256,inventory_sha256,evidence_set_sha256,position_count,evidence_bundle)
		SELECT 'wrong-manifest',network,program_id,layout_version,anchor_slot,repeat('b',64),inventory_sha256,evidence_set_sha256,position_count,evidence_bundle
		FROM quest.position_baseline_anchors LIMIT 1`),
		/environment pins/,
	);
	const storedAnchor = (
		await connection.query(
			"SELECT evidence_bundle FROM quest.position_baseline_anchors WHERE campaign_id='baseline-integration'",
		)
	).rows[0];
	assert.deepEqual(storedAnchor.evidence_bundle, identical[0].bundle);
	const ownershipInput = ownershipAnchorInput();
	const ownershipAnchor = await createPositionBaselineAnchorStore({
		...ownershipInput,
		pool: anchorPool,
	}).record(ownershipInput);
	const ownershipStore = createPositionOwnershipEvidenceStore({
		pool: anchorPool,
		anchor: ownershipAnchor.bundle,
	});
	const sourceInput = () => ({
		slot: 20,
		blockTimeSeconds: 1000,
		transferTransactions: transferEvidenceFixture().transactions,
	});
	const ownershipIdentical = await Promise.all([
		ownershipStore.record(sourceInput()),
		ownershipStore.record(sourceInput()),
	]);
	assert.equal(
		ownershipIdentical.reduce((sum, r) => sum + r.inserted, 0),
		1,
	);
	const changedSource = sourceInput();
	for (const balances of [
		changedSource.transferTransactions[0].meta.preTokenBalances,
		changedSource.transferTransactions[0].meta.postTokenBalances,
	])
		balances[1].owner = "11111111111111111111111111111115";
	await assert.rejects(
		ownershipStore.record(changedSource),
		/conflicting immutable/,
	);
	const raceInput = { ...ownershipInput, campaignId: "ownership-race" };
	const raceAnchor = await createPositionBaselineAnchorStore({
		...raceInput,
		pool: anchorPool,
	}).record(raceInput);
	const raceStore = createPositionOwnershipEvidenceStore({
		pool: anchorPool,
		anchor: raceAnchor.bundle,
	});
	const sourceRace = await Promise.allSettled([
		raceStore.record(sourceInput()),
		raceStore.record(changedSource),
	]);
	assert.equal(sourceRace.filter((r) => r.status === "fulfilled").length, 1);
	assert.equal(sourceRace.filter((r) => r.status === "rejected").length, 1);
	const closureAnchorInput = {
		...ownershipInput,
		campaignId: "ownership-closure",
	};
	const closureAnchor = await createPositionBaselineAnchorStore({
		...closureAnchorInput,
		pool: anchorPool,
	}).record(closureAnchorInput);
	const closureStore = createPositionOwnershipEvidenceStore({
		pool: anchorPool,
		anchor: closureAnchor.bundle,
	});
	assert.equal(
		(
			await closureStore.record({
				slot: 20,
				blockTimeSeconds: 1000,
				closureTransactions: closureEvidenceFixture().transactions,
			})
		).inserted,
		1,
	);
	// First source of this batch must roll back when a later source conflicts.
	const newSource = transferEvidenceFixture().transactions[0];
	newSource.transaction.signatures[0] = "aaa-new-source";
	newSource.transactionIndex = 1;
	await assert.rejects(
		ownershipStore.record({
			...changedSource,
			transferTransactions: [newSource, ...changedSource.transferTransactions],
		}),
		/conflicting immutable/,
	);
	assert.equal(
		(
			await connection.query(
				"SELECT count(*)::int AS count FROM quest.position_ownership_evidence WHERE signature='aaa-new-source'",
			)
		).rows[0].count,
		0,
	);
	const wrongIndex = sourceInput();
	wrongIndex.transferTransactions[0].transaction.signatures[0] =
		"new-signature-same-index";
	await assert.rejects(
		ownershipStore.record(wrongIndex),
		/block ordering conflicts/,
	);
	const wrongTime = sourceInput();
	wrongTime.blockTimeSeconds = 1001;
	wrongTime.transferTransactions[0].blockTime = 1001;
	await assert.rejects(
		ownershipStore.record(wrongTime),
		/block ordering conflicts/,
	);
	const roundTrip = (
		await connection.query(
			"SELECT evidence_record,evidence_sha256 FROM quest.position_ownership_evidence WHERE campaign_id='ownership-fixture'",
		)
	).rows[0];
	assert.deepEqual(
		roundTrip.evidence_record,
		ownershipIdentical[0].observations[0].record,
	);
	assert.equal(
		roundTrip.evidence_sha256,
		ownershipIdentical[0].observations[0].evidenceSha256,
	);
	for (const sql of [
		"UPDATE quest.position_ownership_evidence SET decoder_version=decoder_version",
		"DELETE FROM quest.position_ownership_evidence",
		"TRUNCATE quest.position_ownership_evidence",
	])
		await assert.rejects(connection.query(sql), /immutable/);
	await assert.rejects(
		connection.query(`INSERT INTO quest.position_ownership_evidence
	 (campaign_id,network,program_id,decoder_version,anchor_sha256,signature,instruction_index,position_address,position_mint,slot,transaction_index,block_time_seconds,event_kind,source_key,evidence_sha256,evidence_record)
	 SELECT campaign_id,network,program_id,decoder_version,repeat('b',64),signature,instruction_index,position_address,position_mint,slot,transaction_index,block_time_seconds,event_kind,source_key,evidence_sha256,evidence_record FROM quest.position_ownership_evidence LIMIT 1`),
		/anchor pins/,
	);
	await assert.rejects(
		connection.query(`INSERT INTO quest.position_ownership_evidence
	 (campaign_id,network,program_id,decoder_version,anchor_sha256,signature,instruction_index,position_address,position_mint,slot,transaction_index,block_time_seconds,event_kind,source_key,evidence_sha256,evidence_record)
	 SELECT campaign_id,network,program_id,decoder_version,anchor_sha256,signature,instruction_index+1,position_address,position_mint,slot,transaction_index,block_time_seconds,event_kind,source_key,evidence_sha256,evidence_record FROM quest.position_ownership_evidence LIMIT 1`),
		/record metadata differs/,
	);
	// Different positions bypass per-position unique keys; campaign ordering must still reject.
	const globalInput = ownershipAnchorInput();
	globalInput.campaignId = "ownership-global-order";
	const second = positionBaselineFixture(),
		secondMint = new PublicKey("11111111111111111111111111111117"),
		secondToken = new PublicKey("11111111111111111111111111111116");
	const positionBytes = Buffer.from(
		second.positionAccount.dataBase64,
		"base64",
	);
	secondMint.toBuffer().copy(positionBytes, 40);
	second.positionAccount.dataBase64 = positionBytes.toString("base64");
	second.positionAccount.address = PublicKey.findProgramAddressSync(
		[Buffer.from("position"), secondMint.toBuffer()],
		new PublicKey(second.programId),
	)[0].toBase58();
	second.mintAccount.address = secondMint.toBase58();
	second.tokenAccount.address = secondToken.toBase58();
	const tokenBytes = Buffer.from(second.tokenAccount.dataBase64, "base64");
	secondMint.toBuffer().copy(tokenBytes, 0);
	second.tokenAccount.dataBase64 = tokenBytes.toString("base64");
	globalInput.snapshots.push(second);
	globalInput.inventory.push({
		positionAddress: second.positionAccount.address,
		positionMint: secondMint.toBase58(),
		tokenAccountAddress: secondToken.toBase58(),
	});
	const globalAnchor = await createPositionBaselineAnchorStore({
		...globalInput,
		pool: anchorPool,
	}).record(globalInput);
	const globalStore = createPositionOwnershipEvidenceStore({
		pool: anchorPool,
		anchor: globalAnchor.bundle,
	});
	const secondSource = sourceInput(),
		secondRpc = secondSource.transferTransactions[0];
	secondRpc.transaction.signatures[0] = "second-position-same-index";
	secondRpc.transaction.message.accountKeys =
		secondRpc.transaction.message.accountKeys.map((key) =>
			key.toBase58() === globalInput.inventory[0].positionMint
				? secondMint
				: key.toBase58() === globalInput.inventory[0].tokenAccountAddress
					? secondToken
					: key,
		);
	for (const rows of [
		secondRpc.meta.preTokenBalances,
		secondRpc.meta.postTokenBalances,
	])
		for (const row of rows) row.mint = secondMint.toBase58();
	const globalRace = await Promise.allSettled([
		globalStore.record(sourceInput()),
		globalStore.record(secondSource),
	]);
	assert.equal(globalRace.filter((r) => r.status === "fulfilled").length, 1);
	assert.equal(globalRace.filter((r) => r.status === "rejected").length, 1);
	assert.match(
		globalRace.find((r) => r.status === "rejected").reason.message,
		/block ordering conflicts/,
	);
	const denied = await pool.connect();
	try {
		await assert.rejects(
			denied.query(
				"INSERT INTO quest.position_ownership_evidence SELECT * FROM quest.position_ownership_evidence",
			),
			/permission denied/,
		);
	} finally {
		denied.release();
	}
	const rangeFixture = ownershipBlockRangeFixture();
	const reconciler = createPositionOwnershipReconciler({
		pool: anchorPool,
		connection: ownershipBlockConnection(rangeFixture),
		anchor: ownershipAnchor.bundle,
	});
	assert.equal(
		(await reconciler.reconcile(rangeFixture)).state,
		"TEST_ONLY_OWNERSHIP_RANGE_MATCHED",
	);
	const missingAnchorInput = {
		...ownershipInput,
		campaignId: "ownership-coverage-missing",
	};
	const missingAnchor = await createPositionBaselineAnchorStore({
		...missingAnchorInput,
		pool: anchorPool,
	}).record(missingAnchorInput);
	const missingRange = ownershipBlockRangeFixture();
	const missingReconciler = createPositionOwnershipReconciler({
		pool: anchorPool,
		connection: ownershipBlockConnection(missingRange),
		anchor: missingAnchor.bundle,
	});
	const conflictRace = await Promise.all([
		missingReconciler.reconcile(missingRange),
		missingReconciler.reconcile(missingRange),
	]);
	assert.equal(conflictRace.filter((r) => r.conflictInserted).length, 1);
	assert.equal(conflictRace[0].reasonCode, "MISSING_SOURCE");
	await createPositionOwnershipEvidenceStore({
		pool: anchorPool,
		anchor: missingAnchor.bundle,
	}).record(sourceInput());
	const repairedComparison = await missingReconciler.reconcile(missingRange);
	assert.equal(repairedComparison.state, "TEST_ONLY_OWNERSHIP_RANGE_MATCHED");
	assert.equal(repairedComparison.quarantined, true);
	assert.equal(repairedComparison.watermarkPublished, false);
	const changedRange = ownershipBlockRangeFixture();
	for (const rows of [
		changedRange.blocks[0].block.transactions[0].meta.preTokenBalances,
		changedRange.blocks[0].block.transactions[0].meta.postTokenBalances,
	])
		rows[1].owner = "11111111111111111111111111111115";
	const changedReconciler = createPositionOwnershipReconciler({
		pool: anchorPool,
		connection: ownershipBlockConnection(changedRange),
		anchor: ownershipAnchor.bundle,
	});
	assert.equal(
		(await changedReconciler.reconcile(changedRange)).reasonCode,
		"CHANGED_SOURCE",
	);
	const extraRange = ownershipBlockRangeFixture();
	extraRange.blocks[0].block.transactions = [];
	const extraReconciler = createPositionOwnershipReconciler({
		pool: anchorPool,
		connection: ownershipBlockConnection(extraRange),
		anchor: ownershipAnchor.bundle,
	});
	assert.equal(
		(await extraReconciler.reconcile(extraRange)).reasonCode,
		"EXTRA_SOURCE",
	);
	const incompleteRange = ownershipBlockRangeFixture();
	incompleteRange.blocks[0].block = null;
	const priorConflicts = (
		await connection.query(
			"SELECT count(*)::int AS count FROM quest.position_ownership_conflicts",
		)
	).rows[0].count;
	await assert.rejects(
		createPositionOwnershipReconciler({
			pool: anchorPool,
			connection: ownershipBlockConnection(incompleteRange),
			anchor: ownershipAnchor.bundle,
		}).reconcile(incompleteRange),
		/full block/,
	);
	assert.equal(
		(
			await connection.query(
				"SELECT count(*)::int AS count FROM quest.position_ownership_conflicts",
			)
		).rows[0].count,
		priorConflicts,
	);
	for (const sql of [
		"UPDATE quest.position_ownership_conflicts SET reason_code=reason_code",
		"DELETE FROM quest.position_ownership_conflicts",
		"TRUNCATE quest.position_ownership_conflicts",
	])
		await assert.rejects(connection.query(sql), /immutable/);
	await assert.rejects(
		connection.query(`INSERT INTO quest.position_ownership_conflicts
	 (campaign_id,anchor_sha256,decoder_version,start_slot,end_slot,reason_code,observed_range_sha256,stored_range_sha256,observed_count,stored_count)
	 SELECT campaign_id,repeat('b',64),decoder_version,start_slot,end_slot,reason_code,observed_range_sha256,stored_range_sha256,observed_count,stored_count FROM quest.position_ownership_conflicts LIMIT 1`),
		/anchor differs/,
	);
	const publishPool = makePool(publicationRole);
	await connection.query(
		`GRANT SELECT ON quest.environment_identity,quest.position_baseline_anchors,quest.position_ownership_evidence,quest.position_ownership_conflicts,quest.position_ownership_coverage TO "${role}"`,
	);
	const stateInput = {
		...ownershipInput,
		campaignId: "ownership-state-reader",
	};
	const stateAnchor = await createPositionBaselineAnchorStore({
		...stateInput,
		pool: anchorPool,
	}).record(stateInput);
	const stateStore = createPositionOwnershipEvidenceStore({
		pool: anchorPool,
		anchor: stateAnchor.bundle,
	});
	await stateStore.record(sourceInput());
	const stateRange = ownershipBlockRangeFixture();
	await createPositionOwnershipCoveragePublisher({
		pool: publishPool,
		anchor: stateAnchor.bundle,
		connection: ownershipBlockConnection(stateRange),
	}).publish(stateRange);
	const stateReader = createPositionOwnershipStateReader({
		pool,
		anchor: stateAnchor.bundle,
	});
	const ownerState = await stateReader.read({ endSlot: 20 });
	assert.equal(
		ownerState.positions[0].ownerWallet,
		"11111111111111111111111111111113",
	);
	assert.equal(ownerState.positions[0].transitions.length, 1);
	assert.equal(ownerState.coverageRevision, "1");
	assert.equal(ownerState.awardEligible, false);
	await assert.rejects(
		stateReader.read({ endSlot: 21 }),
		/contiguous coverage/,
	);
	// Publication does not imply a consistent state chain: duplicate prior-owner
	// transfer at an earlier slot passes source checks but must fail state replay.
	let insertedLate = false;
	const historicalPool = makePool(role, async (sql) => {
		if (
			sql.includes("FROM quest.position_ownership_coverage") &&
			!insertedLate
		) {
			insertedLate = true;
			const tx = transferEvidenceFixture().transactions[0];
			tx.slot = 19;
			tx.blockTime = 999;
			tx.transaction.signatures[0] = "state-late";
			await stateStore.record({
				slot: 19,
				blockTimeSeconds: 999,
				transferTransactions: [tx],
			});
		}
	});
	const historical = await createPositionOwnershipStateReader({
		pool: historicalPool,
		anchor: stateAnchor.bundle,
	}).read({ endSlot: 20 });
	assert.equal(historical.coverageRevision, "1");
	assert.equal(historical.positions[0].transitions.length, 1);
	assert.equal(historical.trust, "HISTORICAL_REPEATABLE_READ_SNAPSHOT");
	await assert.rejects(
		stateReader.read({ endSlot: 20 }),
		/contiguous coverage/,
	);
	const lateBlock = ownershipBlockRangeFixture().blocks[0];
	lateBlock.slot = 19;
	lateBlock.block.blockTime = 999;
	lateBlock.block.blockhash = "11111111111111111111111111111113";
	lateBlock.block.transactions = [transferEvidenceFixture().transactions[0]];
	lateBlock.block.transactions[0].transaction.signatures[0] = "state-late";
	stateRange.producedSlots = [19, 20];
	stateRange.blocks[0].block.parentSlot = 19;
	stateRange.blocks[0].block.previousBlockhash = lateBlock.block.blockhash;
	stateRange.blocks.unshift(lateBlock);
	await createPositionOwnershipCoveragePublisher({
		pool: publishPool,
		anchor: stateAnchor.bundle,
		connection: ownershipBlockConnection(stateRange),
	}).publish(stateRange);
	await assert.rejects(stateReader.read({ endSlot: 20 }), /prior ownership/);
	const readOnlyClient = await pool.connect();
	try {
		for (const sql of [
			"UPDATE quest.position_ownership_coverage SET revision=revision",
			"INSERT INTO quest.position_ownership_conflicts DEFAULT VALUES",
			"DELETE FROM quest.position_ownership_evidence",
		])
			await assert.rejects(readOnlyClient.query(sql), /permission denied/);
	} finally {
		readOnlyClient.release();
	}
	const publishAnchorInput = {
		...ownershipInput,
		campaignId: "ownership-publish",
	};
	const publishAnchor = await createPositionBaselineAnchorStore({
		...publishAnchorInput,
		pool: anchorPool,
	}).record(publishAnchorInput);
	const publishStore = createPositionOwnershipEvidenceStore({
		pool: anchorPool,
		anchor: publishAnchor.bundle,
	});
	await publishStore.record(sourceInput());
	const publishRange = ownershipBlockRangeFixture();
	const publisher = createPositionOwnershipCoveragePublisher({
		pool: publishPool,
		connection: ownershipBlockConnection(publishRange),
		anchor: publishAnchor.bundle,
	});
	const publicationRace = await Promise.all([
		publisher.publish(publishRange),
		publisher.publish(publishRange),
	]);
	assert.equal(publicationRace.filter((r) => r.publicationChanged).length, 1);
	assert.equal(publicationRace[0].coveredThroughSlot, 20);
	assert.equal(publicationRace[0].coverageRevision, "1");
	Object.assign(publishRange, {
		startSlot: 21,
		endSlot: 23,
		producedSlots: [],
		blocks: [],
	});
	assert.equal((await publisher.publish(publishRange)).coveredThroughSlot, 23);
	const coverageState = async () =>
		(
			await connection.query(
				"SELECT covered_through_slot::text,revision::text,invalidation_reason,last_produced_slot::text FROM quest.position_ownership_coverage WHERE campaign_id='ownership-publish'",
			)
		).rows[0];
	const future = transferEvidenceFixture().transactions[0];
	future.slot = 25;
	future.blockTime = 1002;
	future.transaction.signatures[0] = "future-source";
	await publishStore.record({
		slot: 25,
		blockTimeSeconds: 1002,
		transferTransactions: [future],
	});
	assert.equal((await coverageState()).covered_through_slot, "23");
	assert.equal(
		(
			await connection.query(
				"SELECT has_table_privilege($1,'quest.position_ownership_coverage','UPDATE') AS can_update",
				[anchorRole],
			)
		).rows[0].can_update,
		false,
	);
	const late = transferEvidenceFixture().transactions[0];
	late.slot = 22;
	late.blockTime = 1001;
	late.transaction.signatures[0] = "late-source";
	await publishStore.record({
		slot: 22,
		blockTimeSeconds: 1001,
		transferTransactions: [late],
	});
	assert.deepEqual(await coverageState(), {
		covered_through_slot: null,
		revision: "3",
		invalidation_reason: "LATE_EVIDENCE",
		last_produced_slot: null,
	});
	// Invalidated prefix must be freshly rechecked from the anchor, not just extended.
	Object.assign(publishRange, { startSlot: 24, endSlot: 24 });
	await assert.rejects(publisher.publish(publishRange), /contiguous prefix/);
	const rebuild = ownershipBlockRangeFixture();
	rebuild.endSlot = 23;
	rebuild.producedSlots.push(22);
	rebuild.blocks.push({
		slot: 22,
		block: {
			blockhash: "11111111111111111111111111111114",
			previousBlockhash: rebuild.blocks[0].block.blockhash,
			parentSlot: 20,
			blockTime: 1001,
			transactions: [late],
		},
	});
	const rebuiltPublisher = createPositionOwnershipCoveragePublisher({
		pool: publishPool,
		connection: ownershipBlockConnection(rebuild),
		anchor: publishAnchor.bundle,
	});
	assert.equal((await rebuiltPublisher.publish(rebuild)).coverageRevision, "4");
	// Exact evidence retry performs no insert and must preserve coverage.
	await publishStore.record({
		slot: 22,
		blockTimeSeconds: 1001,
		transferTransactions: [late],
	});
	assert.equal((await coverageState()).revision, "4");
	const disconnected = ownershipBlockRangeFixture();
	Object.assign(disconnected, {
		startSlot: 24,
		endSlot: 25,
		producedSlots: [25],
		blocks: [
			{
				slot: 25,
				block: {
					blockhash: "11111111111111111111111111111115",
					previousBlockhash: "11111111111111111111111111111111",
					parentSlot: 20,
					blockTime: 1002,
					transactions: [future],
				},
			},
		],
	});
	await assert.rejects(
		createPositionOwnershipCoveragePublisher({
			pool: publishPool,
			connection: ownershipBlockConnection(disconnected),
			anchor: publishAnchor.bundle,
		}).publish(disconnected),
		/cross-range block chain/,
	);
	assert.equal((await coverageState()).covered_through_slot, "23");
	// Durable conflict outside the prefix still quarantines the entire campaign.
	const futureMismatch = ownershipBlockRangeFixture();
	Object.assign(futureMismatch, {
		startSlot: 24,
		endSlot: 25,
		producedSlots: [25],
		blocks: [
			{
				slot: 25,
				block: {
					blockhash: "11111111111111111111111111111115",
					previousBlockhash: "11111111111111111111111111111114",
					parentSlot: 22,
					blockTime: 1002,
					transactions: [],
				},
			},
		],
	});
	const mismatchPublisher = createPositionOwnershipCoveragePublisher({
		pool: publishPool,
		connection: ownershipBlockConnection(futureMismatch),
		anchor: publishAnchor.bundle,
	});
	assert.equal(
		(await mismatchPublisher.publish(futureMismatch)).reasonCode,
		"EXTRA_SOURCE",
	);
	assert.equal((await coverageState()).invalidation_reason, "CONFLICT");
	const quarantinedRetry = await rebuiltPublisher.publish(rebuild);
	assert.equal(quarantinedRetry.watermarkPublished, false);
	assert.equal(quarantinedRetry.quarantined, true);
	for (const sql of [
		"DELETE FROM quest.position_ownership_coverage",
		"TRUNCATE quest.position_ownership_coverage",
		"UPDATE quest.position_ownership_coverage SET start_slot=start_slot+1,revision=revision+1",
	])
		await assert.rejects(connection.query(sql), /immutable|anchor differs/);
	const signal = () => {
		let resolve;
		const promise = new Promise((r) => {
			resolve = r;
		});
		return { promise, resolve };
	};
	const waitSignal = async (gate) => {
		let timer;
		try {
			await Promise.race([
				gate.promise,
				new Promise((_resolve, reject) => {
					timer = setTimeout(
						() => reject(new Error("Coverage race gate timed out")),
						5000,
					);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	};
	for (const first of ["publication", "evidence"]) {
		const raceAnchorInput = {
			...ownershipInput,
			campaignId: `ownership-lock-order-${first}`,
		};
		const raceAnchor = await createPositionBaselineAnchorStore({
			...raceAnchorInput,
			pool: anchorPool,
		}).record(raceAnchorInput);
		const raceStore = createPositionOwnershipEvidenceStore({
			pool: anchorPool,
			anchor: raceAnchor.bundle,
		});
		await raceStore.record(sourceInput());
		const raceRange = ownershipBlockRangeFixture();
		const ordinaryPublisher = createPositionOwnershipCoveragePublisher({
			pool: publishPool,
			connection: ownershipBlockConnection(raceRange),
			anchor: raceAnchor.bundle,
		});
		if (first === "evidence") await ordinaryPublisher.publish(raceRange);
		const actorReady = signal(),
			releaseActor = signal(),
			peerConnected = signal();
		const actorPool = makePool(
			first === "publication" ? publicationRole : anchorRole,
			async (sql) => {
				if (
					sql.startsWith(
						first === "publication"
							? "UPDATE quest.position_ownership_coverage"
							: "INSERT INTO quest.position_ownership_evidence",
					)
				) {
					actorReady.resolve();
					await releaseActor.promise;
				}
			},
		);
		const peerBase = makePool(
			first === "publication" ? anchorRole : publicationRole,
		);
		const peerPool = {
			async connect() {
				const client = await peerBase.connect();
				peerConnected.resolve();
				return client;
			},
		};
		const lateResponse = transferEvidenceFixture().transactions[0];
		lateResponse.slot = 19;
		lateResponse.blockTime = 999;
		lateResponse.transaction.signatures[0] = `racing-late-${first}`;
		const lateInput = {
			slot: 19,
			blockTimeSeconds: 999,
			transferTransactions: [lateResponse],
		};
		const actor =
			first === "publication"
				? createPositionOwnershipCoveragePublisher({
						pool: actorPool,
						connection: ownershipBlockConnection(raceRange),
						anchor: raceAnchor.bundle,
					}).publish(raceRange)
				: createPositionOwnershipEvidenceStore({
						pool: actorPool,
						anchor: raceAnchor.bundle,
					}).record(lateInput);
		let peer;
		try {
			await waitSignal(actorReady);
			peer =
				first === "publication"
					? createPositionOwnershipEvidenceStore({
							pool: peerPool,
							anchor: raceAnchor.bundle,
						}).record(lateInput)
					: createPositionOwnershipCoveragePublisher({
							pool: peerPool,
							connection: ownershipBlockConnection(raceRange),
							anchor: raceAnchor.bundle,
						}).publish(raceRange);
			await waitSignal(peerConnected);
		} finally {
			releaseActor.resolve();
		}
		const results = await Promise.all([actor, peer]);
		const finalCoverage = (
			await connection.query(
				"SELECT covered_through_slot FROM quest.position_ownership_coverage WHERE campaign_id=$1",
				[raceAnchorInput.campaignId],
			)
		).rows[0];
		assert.equal(finalCoverage.covered_through_slot, null);
		if (first === "publication")
			assert.equal(results[0].watermarkPublished, true);
		else {
			assert.equal(results[1].watermarkPublished, false);
			assert.equal(results[1].reasonCode, "EXTRA_SOURCE");
			assert.equal(results[1].quarantined, true);
		}
	}
	console.log(
		"Ownership coverage: publication/insert lock orders, insert-only invalidation, prefix rebuild, block linkage and durable quarantine passed.",
	);
	const reader = createPassportSwapEvidenceReader({
		pool,
		network: "DEVNET",
		campaignId: record.campaignId,
		programId: "fixture-program",
		decoderVersion: "fixture-decoder",
		startSlot: 10,
	});
	assert.equal((await reader.read(15)).passports[0].finalizedSwapEvents, 1);
	const lpReader = createPassportPositionEvidenceReader({
		pool,
		network: "DEVNET",
		campaignId: record.campaignId,
		programId: "fixture-program",
		decoderVersion: "fixture-decoder",
		startSlot: 10,
	});
	const lpResult = await lpReader.read(15);
	assert.equal(lpResult.positions[0].observations[0].passportId, passport);
	assert.equal(
		lpResult.positions[0].observations[0].liquidityRaw,
		"9007199254740993",
	);
	assert.equal(lpResult.ownershipCoverage, "TRANSACTION_ONLY");
	assert.equal(lpResult.awardEligible, false);
	const qualified = createPassportSwapQualificationReader({
		pool,
		network: "DEVNET",
		campaignId: record.campaignId,
		programId: "fixture-program",
		decoderVersion: "fixture-decoder",
		startSlot: 10,
		policy: {
			fixtureKind: "SYNTHETIC_DEVNET",
			network: "DEVNET",
			revision: 1,
			minimumSwapUsdCents: "500",
			maximumPriceAgeSeconds: 10,
			valuationSource: "fixture-price",
			valuationVersion: "fixture-v1",
		},
	});
	await assert.rejects(qualified.read(15), /complete valuations/);
	// A valuation committed after snapshot start must not leak into this read.
	afterCursor = () =>
		connection.query(
			`INSERT INTO genesis.swap_valuations
		(campaign_id,chain_event_id,value_usd_cents,price_observed_at,valuation_source,valuation_version,price_evidence)
		SELECT campaign_id,id,600,to_timestamp($1),'fixture-price','fixture-v1','{"fixture":true}'::jsonb FROM genesis.chain_events WHERE event_kind='swap'`,
			[start + 100],
		);
	await assert.rejects(qualified.read(15), /complete valuations/);
	const qualifiedResult = await qualified.read(15);
	assert.equal(qualifiedResult.passports[0].qualifyingSwaps, 1);
	assert.equal(qualifiedResult.awardEligible, false);
	// A concurrent unlink cannot split event/cursor and historical ownership reads.
	afterCursor = () =>
		connection.query(
			"UPDATE quest.wallet_links SET unlinked_at=to_timestamp($1), unlink_evidence_sha256=repeat('b',64) WHERE network='DEVNET' AND wallet=$2 AND unlinked_at IS NULL",
			[start + 50, wallet],
		);
	assert.equal(
		(await lpReader.read(15)).positions[0].observations[0].passportId,
		passport,
	);
	assert.equal(
		(await lpReader.read(15)).positions[0].observations[0].attributionState,
		"UNLINKED",
	);
	assert.equal((await reader.read(15)).unattributedSources.length, 1);
	// A late conflict is likewise visible to the next snapshot, which must refuse.
	afterCursor = () =>
		connection.query(
			"INSERT INTO genesis.ingest_conflicts (existing_event_id,observed_event_sha256,observed_decoder_version) SELECT id,repeat('c',64),'fixture-decoder' FROM genesis.chain_events",
		);
	assert.equal(
		(await lpReader.read(15)).positions[0].observations[0].attributionState,
		"UNLINKED",
	);
	await assert.rejects(reader.read(15), /reconciled/);
	await assert.rejects(qualified.read(15), /reconciled/);
	await assert.rejects(lpReader.read(15), /reconciled/);
	await connection.query(
		"UPDATE genesis.ingest_conflicts SET resolution='source_error',resolved_at=now()",
	);
	await connection.query(
		"UPDATE genesis.indexer_cursors SET reconciled_through_slot=15",
	);
	// The LP family query must include closes, even while their schema is unsupported.
	const closeRecord = {
		...lpRecord,
		signature: "test-unsupported-close",
		eventKind: "position_close",
		payload: {},
	};
	await connection.query(
		`INSERT INTO genesis.chain_events (campaign_id,cluster,signature,instruction_index,event_index,event_kind,
		slot,block_time,wallet,pool_address,position_address,payload,event_sha256,decoder_version,verified_at)
		VALUES ($1,'devnet',$2,0,0,'position_close',12,to_timestamp($3),$4,$4,$5,'{}'::jsonb,$6,'fixture-decoder',now())`,
		[
			closeRecord.campaignId,
			closeRecord.signature,
			closeRecord.blockTimeSeconds,
			wallet,
			closeRecord.positionAddress,
			fingerprintGenesisEvent(closeRecord).eventSha256,
		],
	);
	await connection.query(
		"UPDATE genesis.indexer_cursors SET reconciled_through_slot=15",
	);
	await assert.rejects(lpReader.read(15), /pinned position snapshot/);
	await connection.query(
		"INSERT INTO quest.wallet_links (wallet,passport_id,linked_at,link_evidence_sha256) VALUES ($1,$2,to_timestamp($3) + interval '1 microsecond',repeat('d',64))",
		[wallet, passport, start + 60],
	);
	await assert.rejects(reader.read(15), /sub-millisecond/);
	await assert.rejects(lpReader.read(15), /sub-millisecond/);
	// Independently prove the test role cannot write, even outside READ ONLY.
	const client = await pool.connect();
	try {
		await assert.rejects(
			client.query("UPDATE genesis.indexer_cursors SET next_slot=17"),
			/permission denied/,
		);
	} finally {
		client.release();
	}
	console.log(
		`Passport snapshot SQL and concurrent unlink/conflict checks passed on PostgreSQL ${version}.`,
	);
	await connection.query(
		`GRANT SELECT ON quest.weekly_test_policies,quest.weekly_test_receipts TO "${calendarRole}"`,
	);
	await connection.query(
		`GRANT INSERT ON quest.weekly_test_receipts TO "${calendarRole}"`,
	);
	await connection.query(
		`GRANT EXECUTE ON FUNCTION quest.lock_weekly_test_source(text) TO "${calendarRole}"`,
	);
	await rehearseWeeklyProgress({
		connection,
		pool,
		calendarApi,
		receiptPool: makePool(calendarRole),
	});
	await rehearseWeeklyLiquidity({
		connection,
		anchorPool,
		readPool: pool,
		writePool: makePool(publicationRole),
		calendarApi,
	});
	await rehearseCommunityBudgets({
		connection,
		calendarApi,
		pool: makePool(calendarRole),
		calendarRole,
	});
	await rehearsePublicPassport({
		connection,
		makePool,
		authRole,
		capabilityRole: anchorRole,
	});
} finally {
	await Promise.all(ends);
	if (connection) await connection.end();
	if (created) {
		await admin.query(`DROP DATABASE "${db}" WITH (FORCE)`);
		assert.equal(
			(
				await admin.query(
					"SELECT count(*)::int AS count FROM pg_database WHERE datname=$1",
					[db],
				)
			).rows[0].count,
			0,
		);
	}
	if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
	if (anchorRoleCreated) await admin.query(`DROP ROLE "${anchorRole}"`);
	if (publicationRoleCreated)
		await admin.query(`DROP ROLE "${publicationRole}"`);
	if (authRoleCreated) await admin.query(`DROP ROLE "${authRole}"`);
	if (calendarRoleCreated) await admin.query(`DROP ROLE "${calendarRole}"`);
	await admin.end();
	if (created) console.log("Disposable test database and read role removed.");
}
