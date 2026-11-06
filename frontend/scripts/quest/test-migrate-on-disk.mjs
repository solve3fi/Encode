import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMigrationFiles, planQuestMigrations, sha256 } from "./migrate.mjs";

// Exercise `loadMigrationFiles` against the real on-disk `db/quest/migrations`
// directory instead of synthetic fixtures, so a drift in the checked-in
// migration file (or its checksum handling) is caught here. No database driver
// is imported and no connection is opened.
const files = loadMigrationFiles();
const realNames = files.map((file) => file.name);

test("the real on-disk migration set is non-empty, sorted and checksummed", () => {
	assert.ok(files.length >= 1, "expected at least one Quest migration on disk");
	assert.ok(
		realNames.includes("001_environment_identity.sql"),
		"expected the checked-in Quest identity migration on disk",
	);
	assert.deepEqual([...realNames].sort(), realNames);
	for (const file of files) {
		assert.match(file.name, /^\d{3}_[\w-]+\.sql$/);
		assert.ok(file.sql.length > 0, `${file.name} should not be empty`);
	}
});

test("fresh apply plans all real migrations as pending", () => {
	const plan = planQuestMigrations({ files, applied: [] });

	assert.deepEqual(
		plan.pending.map((migration) => migration.name),
		realNames,
	);
	assert.deepEqual(plan.applied, []);
	for (const migration of plan.pending) {
		const file = files.find((candidate) => candidate.name === migration.name);
		assert.equal(migration.sha256, sha256(file.sql));
	}
});

test("already-applied with the correct sha256 plans zero pending", () => {
	const applied = files.map((file) => ({
		name: file.name,
		sha256: sha256(file.sql),
	}));

	const plan = planQuestMigrations({ files, applied });

	assert.deepEqual(plan.pending, []);
	assert.deepEqual(
		plan.applied.map((migration) => migration.name),
		realNames,
	);
});

test("a wrong sha256 for the applied entry throws checksum drift", () => {
	const applied = files.map((file) => ({
		name: file.name,
		sha256: sha256(file.sql),
	}));
	const last = applied[applied.length - 1];
	applied[applied.length - 1] = {
		name: last.name,
		sha256: sha256("tampered-on-disk-migration"),
	};

	assert.throws(
		() => planQuestMigrations({ files, applied }),
		/Quest migration checksum drift/,
	);
});

test("migrate.mjs imports no database driver and opens no connection", () => {
	const source = readFileSync(
		fileURLToPath(new URL("./migrate.mjs", import.meta.url)),
		"utf8",
	);
	assert.doesNotMatch(source, /pg|postgres|mysql|sqlite/i);
});
