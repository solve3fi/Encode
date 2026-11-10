// One-time, idempotent schema setup for the dedicated Devnet Quest database.
// Run as the migration OWNER role (never the serving role):
//   QUEST_OWNER_DB_URL=... QUEST_ENVIRONMENT_ID=... QUEST_MANIFEST_SHA256=... \
//   QUEST_RUNTIME_ROLE=quest_runtime QUEST_OPERATOR_ROLE=quest_operator bun apply-schema.mjs
//
// 1. Genesis migrations (the Quest receipt functions read genesis.*), preserving the historical
//    filenames and checksums, including the two independent 003 files.
// 2. Quest migrations 001..014 in order, once, on an empty quest schema.
// 3. The immutable environment identity row, then least-privilege grants for the serving and
//    operator login roles. No award writer, worker, or public/mainnet object is created.
import pg from "pg";
import {
	genesisMigrationSql,
	loadGenesisMigrations,
} from "../scripts/genesis-migrate.mjs";
import { loadMigrationFiles } from "../scripts/quest/migrate.mjs";
import {
	indexerGrants,
	communityGoalReadGrants,
	partnerScoutRuntimeGrants,
	pauseAdminGrants,
	questAdminGrants,
	readerGrants,
	votingRuntimeGrants,
	xpWriterGrants,
	timelinePublisherGrants,
} from "./swap-grants.mjs";

const need = (name) => {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required setting ${name}`);
	return value;
};
const ident = (value) => {
	if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value))
		throw new Error("Invalid role name");
	return `"${value}"`;
};

const client = new pg.Client({ connectionString: need("QUEST_OWNER_DB_URL") });
await client.connect();
const runtime = ident(need("QUEST_RUNTIME_ROLE"));
const operator = ident(need("QUEST_OPERATOR_ROLE"));

try {
	// 1. Genesis schema.
	const applied = new Map();
	const hasHistory = (
		await client.query(
			"SELECT to_regclass('public.genesis_schema_migrations') IS NOT NULL AS present",
		)
	).rows[0].present;
	if (hasHistory)
		for (const row of (
			await client.query(
				"SELECT filename, sha256 FROM public.genesis_schema_migrations",
			)
		).rows)
			applied.set(row.filename, row.sha256);
	for (const migration of loadGenesisMigrations()) {
		const prior = applied.get(migration.name);
		if (prior) {
			if (prior !== migration.sha256)
				throw new Error(
					`Genesis migration checksum changed: ${migration.name}`,
				);
			continue;
		}
		await client.query(genesisMigrationSql(migration));
		console.log(`applied genesis ${migration.name}`);
	}

	// 2. Quest schema (no history table by design: apply once to an empty schema).
	const questPresent = (
		await client.query("SELECT to_regnamespace('quest') IS NOT NULL AS present")
	).rows[0].present;
	if (questPresent) {
		console.log("quest schema already present; skipping Quest migrations");
	} else {
		for (const file of loadMigrationFiles()) {
			await client.query(file.sql);
			console.log(`applied quest ${file.name}`);
		}
		// 3a. Immutable environment identity.
		await client.query(
			"INSERT INTO quest.environment_identity(network,genesis_hash,environment_id,manifest_sha256,namespace) VALUES('DEVNET','EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',$1,$2,'quest')",
			[need("QUEST_ENVIRONMENT_ID"), need("QUEST_MANIFEST_SHA256")],
		);
		console.log("environment identity written");
	}

	// Append-only upgrades for the deployed 001..014 schema. Original SQL stays unchanged.
	for (const [name, marker] of [
		["015_user_paid_pass.sql", "quest.pass_mint_reservations"],
		["016_public_passport_enrollment.sql", "quest.passport_enrollment_proofs"],
		["017_devnet_onboarding_xp.sql", "quest.devnet_onboarding_rules"],
		["018_weekly_test_xp.sql", "fn:quest.award_weekly_test_xp()"],
		["019_referrals.sql", "quest.referral_rules"],
		["020_voting_participation.sql", "quest.vote_observations"],
		["021_devnet_pass_minters.sql", "quest.devnet_pass_minters"],
		["022_quest_pauses.sql", "quest.pause_switches"],
		["023_pool_tick_samples.sql", "quest.pool_tick_samples"],
		["024_manual_community_goals.sql", "quest.manual_goals"],
		["025_partner_scout.sql", "quest.partner_leads"],
		["026_social_quests.sql", "quest.social_quest_claims"],
		["027_abuse_hardening.sql", "quest.abuse_hardening_revision"],
		["028_calendar_admin_audit.sql", "quest.calendar_admin_audit"],
		["029_genesis_reset.sql", "quest_genesis.resets"],
		["030_referral_eligibility.sql", "quest.referral_eligible_sources"],
		["031_lp_receipt_coverage.sql", "fn:quest.lock_lp_test_source(text,text,bigint,bigint)"],
        ["032_lp_inventory_cohorts.sql", "quest.lp_inventory_cohorts"],
		["033_clans.sql", "quest.clans"],
		["034_clan_rallies.sql", "quest.clan_rallies"],
	]) {
		const exists = marker.startsWith("fn:")
			? (
					await client.query(
						"SELECT to_regprocedure($1) IS NOT NULL AS present",
						[marker.slice(3)],
					)
				).rows[0].present
			: (
					await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [
						marker,
					])
				).rows[0].present;
		if (!exists) {
			const file = loadMigrationFiles().find((f) => f.name === name);
			if (!file) throw new Error("Missing public upgrade");
			await client.query(file.sql);
			console.log(`applied quest ${name}`);
		}
	}
	// 3b. Grants. The serving role reads the calendar and runs durable sign-in; only the
	// operator role (used by provisioning, never exposed over HTTP) can write calendars.
	const db = (await client.query("SELECT current_database() AS name")).rows[0]
		.name;
	const statements = [
		`GRANT SELECT, INSERT ON quest.pass_mint_reservations TO ${runtime}`,
		`GRANT UPDATE(verified_at,prepared) ON quest.pass_mint_reservations TO ${runtime}`,
		`REVOKE ALL ON SCHEMA genesis FROM ${runtime}, ${operator}`,
		`GRANT CONNECT ON DATABASE "${db}" TO ${runtime}, ${operator}`,
		`GRANT USAGE ON SCHEMA quest TO ${runtime}, ${operator}`,
		// Durable Passport sign-in.
		`GRANT SELECT ON quest.environment_identity, quest.wallet_challenges, quest.passport_sessions, quest.passport_challenge_bindings, quest.passport_auth_bindings, quest.wallet_links TO ${runtime}, ${operator}`,
		`GRANT INSERT ON quest.wallet_challenges, quest.passport_sessions, quest.passport_challenge_bindings, quest.passport_auth_bindings TO ${runtime}, ${operator}`,
		`GRANT UPDATE(consumed_at) ON quest.wallet_challenges TO ${runtime}, ${operator}`,
		`GRANT UPDATE(revoked_at) ON quest.passport_sessions TO ${runtime}, ${operator}`,
		`GRANT EXECUTE ON FUNCTION quest.take_passport_rate_limit(text,text), quest.lock_passport_auth_link(uuid,text) TO ${runtime}, ${operator}`,
		// Private calendar and history reads.
		`GRANT SELECT ON quest.passports, quest.calendar_plans, quest.calendar_milestones, quest.calendar_plan_revisions, quest.calendar_operator_requests, quest.community_test_policies, quest.community_test_reservations, quest.weekly_test_policies, quest.weekly_test_receipts, quest.calendar_operator_grants TO ${runtime}, ${operator}`,
		`GRANT EXECUTE ON FUNCTION quest.lock_calendar_operator_grant(uuid,text,text) TO ${runtime}, ${operator}`,
		// Devnet test XP is read through the signed session; only SECURITY DEFINER functions write it.
		`GRANT SELECT ON quest.xp_events, quest.devnet_onboarding_rules TO ${runtime}, ${operator}`,
		// Referrals are written only by these SECURITY DEFINER functions (and the bonus trigger).
		`GRANT EXECUTE ON FUNCTION quest.referral_overview(uuid), quest.redeem_referral(uuid,text) TO ${runtime}, ${operator}`,
		// Clans (migration 033): the tables stay closed; only these SECURITY DEFINER functions are callable.
		`GRANT EXECUTE ON FUNCTION quest.clan_overview(uuid), quest.clan_board(uuid,text,integer,integer), quest.clan_create(uuid,text,text), quest.clan_join(uuid,uuid,text), quest.clan_leave(uuid), quest.clan_invite(uuid), quest.clan_kick(uuid,uuid), quest.clan_rally(uuid,text,text,text,boolean) TO ${runtime}, ${operator}`,
		// Voting XP is read through a SECURITY DEFINER function; the tables stay closed to the serving roles.
	...votingRuntimeGrants(runtime),
	...votingRuntimeGrants(operator),
	...communityGoalReadGrants(runtime),
	...communityGoalReadGrants(operator),
	...partnerScoutRuntimeGrants(runtime),
	...partnerScoutRuntimeGrants(operator),
	// Calendar writes: operator role only.
		`GRANT INSERT ON quest.calendar_plans, quest.calendar_milestones, quest.calendar_plan_revisions, quest.calendar_operator_requests TO ${operator}`,
	];
	for (const sql of statements) await client.query(sql);
	if (process.env.QUEST_ENROLLMENT_ROLE) {
		const enrollment = ident(process.env.QUEST_ENROLLMENT_ROLE);
		await client.query(`GRANT CONNECT ON DATABASE "${db}" TO ${enrollment}`);
		await client.query(`GRANT USAGE ON SCHEMA quest TO ${enrollment}`);
		await client.query(
			`GRANT SELECT ON quest.environment_identity TO ${enrollment}`,
		);
		await client.query(
			`GRANT EXECUTE ON FUNCTION quest.take_passport_rate_limit(text,text),quest.issue_passport_enrollment(text,text,uuid,text,uuid,text),quest.complete_passport_enrollment(text,text,uuid,text,timestamptz,timestamptz,uuid,text,text) TO ${enrollment}`,
		);
	}
	// Devnet swap source roles (optional): the worker writes the ledger, the backend only reads it.
	if (process.env.QUEST_INDEXER_ROLE)
		for (const sql of indexerGrants(ident(process.env.QUEST_INDEXER_ROLE)))
			await client.query(sql);
	if (process.env.QUEST_LP_TIMELINE_ROLE)
        for (const sql of timelinePublisherGrants(ident(process.env.QUEST_LP_TIMELINE_ROLE)))
            await client.query(sql);
	if (process.env.QUEST_SOURCE_READER_ROLE)
		for (const sql of readerGrants(ident(process.env.QUEST_SOURCE_READER_ROLE)))
			await client.query(sql);
	if (process.env.QUEST_ADMIN_ROLE)
		for (const sql of questAdminGrants(ident(process.env.QUEST_ADMIN_ROLE)))
			await client.query(sql);
	if (process.env.QUEST_PAUSE_ADMIN_ROLE)
		for (const sql of pauseAdminGrants(ident(process.env.QUEST_PAUSE_ADMIN_ROLE)))
			await client.query(sql);
	if (process.env.QUEST_XP_WRITER_ROLE)
		for (const sql of xpWriterGrants(ident(process.env.QUEST_XP_WRITER_ROLE)))
			await client.query(sql);
	console.log("grants applied");
} finally {
	await client.end();
}
