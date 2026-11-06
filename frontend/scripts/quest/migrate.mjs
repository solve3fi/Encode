import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Load Quest migration files from a directory.
 *
 * Driver-free and connection-free: reads only `*.sql` files (no recursion) and
 * returns them sorted lexically by file name.
 *
 * @param {URL | string} [directory]
 * @returns {Array<{ name: string, sql: string }>}
 */
export function loadMigrationFiles(
	directory = new URL("../../db/quest/migrations/", import.meta.url),
) {
	const entries = readdirSync(directory, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
		.map((entry) => entry.name)
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
		.map((name) => ({
			name,
			sql: readFileSync(new URL(name, directory), "utf8"),
		}));
}

/**
 * @param {string} text
 * @returns {string}
 */
export function sha256(text) {
	return createHash("sha256").update(text).digest("hex");
}

/**
 * @param {{ files: Array<{ name: string, sql: string }>, applied: Array<{ name: string, sha256: string }> }} params
 * @returns {{ pending: Array<{ name: string, sha256: string }>, applied: Array<{ name: string, sha256: string }> }}
 */
export function planQuestMigrations({ files, applied }) {
	const fileNames = files.map((file) => file.name);
	const appliedNames = applied.map((entry) => entry.name);

	const isPrefix =
		appliedNames.length <= fileNames.length &&
		appliedNames.every((name, index) => name === fileNames[index]);
	if (!isPrefix) {
		throw new Error("Quest migration history is out of order");
	}

	for (const entry of applied) {
		const file = files.find((candidate) => candidate.name === entry.name);
		if (sha256(file.sql) !== entry.sha256) {
			throw new Error("Quest migration checksum drift");
		}
	}

	const pending = files.slice(applied.length).map((file) => ({
		name: file.name,
		sha256: sha256(file.sql),
	}));

	return { pending, applied: [...applied] };
}

/**
 * Apply pending Quest migrations through a caller-supplied executor.
 *
 * The executor receives the migration SQL text; this module never opens a
 * database connection and imports no SQL driver.
 *
 * @param {{ executor: (sql: string) => Promise<unknown>, files: Array<{ name: string, sql: string }>, applied: Array<{ name: string, sha256: string }> }} params
 * @returns {Promise<Array<{ name: string, sha256: string }>>}
 */
export async function runQuestMigrations({ executor, files, applied }) {
	const { pending } = planQuestMigrations({ files, applied });
	for (const migration of pending) {
		const file = files.find((candidate) => candidate.name === migration.name);
		await executor(file.sql);
	}
	return pending;
}
