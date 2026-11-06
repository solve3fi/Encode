import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	loadMigrationFiles,
	planQuestMigrations,
	runQuestMigrations,
	sha256,
} from "./migrate.mjs";

const A_SQL = "CREATE SCHEMA a;\n";
const B_SQL = "CREATE SCHEMA b;\n";
const C_SQL = "CREATE SCHEMA c;\n";

function files() {
	return [
		{ name: "001_a.sql", sql: A_SQL },
		{ name: "002_b.sql", sql: B_SQL },
		{ name: "003_c.sql", sql: C_SQL },
	];
}

function entry(name, sql) {
	return { name, sha256: sha256(sql) };
}

test("loadMigrationFiles reads checked-in Quest migrations in order", () => {
	const loaded = loadMigrationFiles();
	assert.deepEqual(
		loaded.slice(0, 14).map((file) => file.name),
		[
			"001_environment_identity.sql",
			"002_passport_progression_ledgers.sql",
			"003_passport_challenge_session.sql",
			"004_wallet_link_history.sql",
			"005_position_baseline_anchors.sql",
			"006_position_ownership_evidence.sql",
			"007_position_ownership_conflicts.sql",
			"008_position_ownership_coverage.sql",
			"009_position_timeline.sql",
			"010_durable_passport_auth.sql",
			"011_quest_calendar.sql",
			"012_calendar_operator_access.sql",
			"013_weekly_test_receipts.sql",
			"014_community_test_budgets.sql",
		],
	);
	assert.ok(loaded.length >= 14);
	assert.match(
		loaded[13].sql,
		/CREATE TABLE quest.community_test_reservations/,
	);
	assert.match(loaded[12].sql, /CREATE TABLE quest.weekly_test_receipts/);
	assert.match(loaded[11].sql, /CREATE TABLE quest.calendar_operator_requests/);
	assert.match(loaded[10].sql, /CREATE TABLE quest.calendar_milestones/);
	assert.match(loaded[9].sql, /CREATE TABLE quest.passport_auth_bindings/);
	assert.match(loaded[8].sql, /CREATE TABLE quest.position_timeline_ranges/);
	assert.match(loaded[7].sql, /CREATE TABLE quest.position_ownership_coverage/);
	assert.match(
		loaded[6].sql,
		/CREATE TABLE quest.position_ownership_conflicts/,
	);
	assert.match(loaded[5].sql, /CREATE TABLE quest.position_ownership_evidence/);
	assert.match(loaded[0].sql, /CREATE SCHEMA quest;/);
	assert.match(loaded[1].sql, /CREATE TABLE quest.xp_events/);
	assert.match(loaded[2].sql, /CREATE TABLE quest.wallet_challenges/);
	assert.match(loaded[3].sql, /CREATE TABLE quest.wallet_links/);
});

test("fresh apply plans all files in lexical order", () => {
	const plan = planQuestMigrations({ files: files(), applied: [] });
	assert.deepEqual(
		plan.pending.map((migration) => migration.name),
		["001_a.sql", "002_b.sql", "003_c.sql"],
	);
	assert.deepEqual(plan.applied, []);
});

test("fully applied history plans zero pending", () => {
	const all = files();
	const applied = [entry("001_a.sql", A_SQL), entry("002_b.sql", B_SQL)];
	const plan = planQuestMigrations({
		files: all,
		applied: [...applied, entry("003_c.sql", C_SQL)],
	});
	assert.deepEqual(plan.pending, []);
	assert.deepEqual(
		plan.applied.map((migration) => migration.name),
		["001_a.sql", "002_b.sql", "003_c.sql"],
	);
});

test("applied checksum drift throws", () => {
	assert.throws(
		() =>
			planQuestMigrations({
				files: files(),
				applied: [{ name: "001_a.sql", sha256: sha256("tampered") }],
			}),
		/Quest migration checksum drift/,
	);
});

test("out-of-order or missing applied file throws", () => {
	assert.throws(
		() =>
			planQuestMigrations({
				files: files(),
				applied: [entry("002_b.sql", B_SQL)],
			}),
		/Quest migration history is out of order/,
	);

	assert.throws(
		() =>
			planQuestMigrations({
				files: files(),
				applied: [entry("001_a.sql", A_SQL), entry("003_c.sql", C_SQL)],
			}),
		/Quest migration history is out of order/,
	);

	assert.throws(
		() =>
			planQuestMigrations({
				files: files(),
				applied: [{ name: "004_missing.sql", sha256: sha256("x") }],
			}),
		/Quest migration history is out of order/,
	);
});

test("executor runs once per pending file, in order, with that file's SQL", async () => {
	const calls = [];
	const executor = async (sql) => {
		calls.push(sql);
	};

	const newlyApplied = await runQuestMigrations({
		executor,
		files: files(),
		applied: [entry("001_a.sql", A_SQL)],
	});

	assert.deepEqual(calls, [B_SQL, C_SQL]);
	assert.deepEqual(
		newlyApplied.map((migration) => migration.name),
		["002_b.sql", "003_c.sql"],
	);
});

test("module imports no database driver and makes no connection", async () => {
	const { readFileSync } = await import("node:fs");
	const source = readFileSync(
		fileURLToPath(new URL("./migrate.mjs", import.meta.url)),
		"utf8",
	);
	assert.doesNotMatch(source, /pg|postgres|mysql|sqlite/i);
});
