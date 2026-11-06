import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDirectory = fileURLToPath(
	new URL("../db/migrations/", import.meta.url),
);
const migrationName = /^\d{3}_[a-z0-9_]+\.sql$/;

function sqlString(value) {
	return `'${value.replaceAll("'", "''")}'`;
}

export function loadGenesisMigrations(directory = migrationsDirectory) {
	const names = readdirSync(directory)
		.filter((name) => name.endsWith(".sql"))
		.sort();
	if (names.length === 0 || names.some((name) => !migrationName.test(name)))
		throw new Error("Genesis migration filenames are missing or invalid.");
	// Two historical branches used ordinal 003 for independent migrations.
	// Keep full filenames/checksums stable for already migrated databases.
	let previous = 0,
		previousName;
	return names.map((name) => {
		const number = Number(name.slice(0, 3));
		if (number < 1 || (number !== previous && number !== previous + 1))
			throw new Error(
				"Genesis migration ordinals must be ordered without gaps.",
			);
		if (
			number === previous &&
			!(
				previousName === "003_genesis_lp_snapshot_coverage.sql" &&
				name === "003_genesis_reconciliation_watermark.sql"
			)
		)
			throw new Error(
				"Genesis migration ordinals must be unique except the historic 003 pair.",
			);
		previous = number;
		previousName = name;
		const source = readFileSync(resolve(directory, name), "utf8").replaceAll(
			"\r\n",
			"\n",
		);
		const lines = source.split("\n");
		const begin = lines.findIndex((line) => line.trim() === "BEGIN;");
		const commit = lines.findLastIndex((line) => line.trim() === "COMMIT;");
		if (
			begin < 0 ||
			commit <= begin ||
			lines
				.slice(0, begin)
				.some((line) => line.trim() && !line.trim().startsWith("--")) ||
			lines.slice(commit + 1).some((line) => line.trim()) ||
			lines
				.slice(begin + 1, commit)
				.some((line) => ["BEGIN;", "COMMIT;"].includes(line.trim()))
		)
			throw new Error(
				`Genesis migration has an invalid transaction wrapper: ${name}`,
			);
		return {
			name,
			sha256: createHash("sha256").update(source).digest("hex"),
			body: lines.slice(begin + 1, commit).join("\n"),
		};
	});
}

export function genesisMigrationSql(migration) {
	if (
		!migrationName.test(migration.name) ||
		!/^[0-9a-f]{64}$/.test(migration.sha256)
	)
		throw new TypeError("Invalid Genesis migration identity.");
	const name = sqlString(migration.name);
	const digest = sqlString(migration.sha256);
	return `BEGIN;
SELECT pg_advisory_xact_lock(193676119);
CREATE TABLE IF NOT EXISTS public.genesis_schema_migrations (
    filename text PRIMARY KEY,
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    applied_at timestamptz NOT NULL DEFAULT now()
);
DO $genesis_guard$
BEGIN
    IF EXISTS (SELECT 1 FROM public.genesis_schema_migrations WHERE filename = ${name}) THEN
        RAISE EXCEPTION 'Genesis migration was applied concurrently';
    END IF;
END;
$genesis_guard$;
${migration.body}
INSERT INTO public.genesis_schema_migrations (filename, sha256)
VALUES (${name}, ${digest});
COMMIT;
`;
}

function psql(args, input = "") {
	const result = spawnSync(
		"psql",
		["-X", "-w", "-v", "ON_ERROR_STOP=1", "-At", ...args],
		{
			input,
			encoding: "utf8",
			windowsHide: true,
			env: {
				...process.env,
				PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT ?? "10",
			},
		},
	);
	if (result.error || result.status !== 0) {
		// psql reports the failing statement or connection problem on stderr.
		const detail = result.stderr?.trim();
		throw new Error(
			`PostgreSQL migration command failed. Check psql and PG* connection settings.${detail ? `\n${detail}` : ""}`,
		);
	}
	return result.stdout.trim();
}

function appliedMigrations() {
	if (
		psql([
			"-c",
			"SELECT to_regclass('public.genesis_schema_migrations') IS NOT NULL",
		]) !== "t"
	)
		return new Map();
	const output = psql([
		"-F",
		"\t",
		"-c",
		"SELECT filename, sha256 FROM public.genesis_schema_migrations ORDER BY filename",
	]);
	return new Map(
		output ? output.split(/\r?\n/).map((line) => line.split("\t")) : [],
	);
}

export function runGenesisMigrations(migrations = loadGenesisMigrations()) {
	if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER)
		throw new Error(
			"Set PGHOST, PGDATABASE, and PGUSER before applying Genesis migrations.",
		);
	psql(["--version"]);
	const applied = appliedMigrations();
	for (const name of applied.keys())
		if (!migrations.some((migration) => migration.name === name))
			throw new Error(`Database has an unknown Genesis migration: ${name}`);
	for (const migration of migrations) {
		const prior = applied.get(migration.name);
		if (prior) {
			if (prior !== migration.sha256)
				throw new Error(
					`Genesis migration checksum changed: ${migration.name}`,
				);
			continue;
		}
		psql(["-f", "-"], genesisMigrationSql(migration));
		process.stdout.write(`Applied ${migration.name}\n`);
	}
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
	try {
		const migrations = loadGenesisMigrations();
		if (process.argv[2] === "--plan") {
			for (const migration of migrations)
				process.stdout.write(`${migration.name} ${migration.sha256}\n`);
		} else if (process.argv.length === 2) {
			runGenesisMigrations(migrations);
		} else {
			throw new Error("Usage: node scripts/genesis-migrate.mjs [--plan]");
		}
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : "Genesis migration failed."}\n`,
		);
		process.exitCode = 1;
	}
}
