// Disposable integration rehearsal for the permanent Devnet Pass minter record (migration 021): the real
// migrations, including a backfill of mints verified BEFORE the migration. It creates and drops its own
// database; point it at a throwaway PostgreSQL 16 server (QUEST_TEST_PG_HOST/PORT/USER/PASSWORD).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import bs58 from "bs58";

const pgModule = process.env.QUEST_TEST_PG_MODULE;
const { default: pg } = await import(pgModule ? pathToFileURL(pgModule).href : "pg");
const conn = {
	host: process.env.QUEST_TEST_PG_HOST ?? "127.0.0.1",
	port: Number(process.env.QUEST_TEST_PG_PORT ?? 5432),
	user: process.env.QUEST_TEST_PG_USER ?? "postgres",
	password: process.env.QUEST_TEST_PG_PASSWORD,
};
const stamp = `${Date.now()}_${process.pid}`;
const db = `quest_minters_rehearsal_${stamp}`;
const outsider = `quest_minters_outsider_${stamp}`;
const admin = new pg.Client({ ...conn, database: process.env.QUEST_TEST_PG_ADMIN_DB ?? "postgres" });

const key = (n) => bs58.encode(Buffer.alloc(32, n));
const WALLETS = [key(1), key(2), key(3), key(4)];
const MINTS = [key(11), key(12), key(13), key(14)];
const PASSPORTS = [
	"11111111-1111-4111-8111-111111111111",
	"22222222-2222-4222-8222-222222222222",
	"33333333-3333-4333-8333-333333333333",
	"44444444-4444-4444-8444-444444444444",
];

let connection;
let created = false;
let passed = 0;
const check = (label) => {
	passed += 1;
	console.log(`ok ${passed} - ${label}`);
};
const refused = async (promise, pattern, label) => {
	await assert.rejects(promise, pattern, label);
	check(label);
};
const migrationFiles = async (dir) => {
	const base = fileURLToPath(new URL(`../../${dir}/`, import.meta.url));
	return (await readdir(base)).filter((n) => n.endsWith(".sql")).sort().map((name) => ({ name, path: base + name }));
};

try {
	await admin.connect();
	assert.ok(Number((await admin.query("SHOW server_version_num")).rows[0].server_version_num) >= 160000);
	await admin.query(`CREATE DATABASE "${db}"`);
	created = true;
	connection = new pg.Client({ ...conn, database: db });
	await connection.connect();

	// Everything BEFORE 021, so mints can exist before the registry does.
	for (const file of await migrationFiles("db/migrations")) await connection.query(await readFile(file.path, "utf8"));
	const quest = await migrationFiles("db/quest/migrations");
	const registry = quest.find((f) => f.name.startsWith("021_"));
	assert.ok(registry, "migration 021 exists");
	for (const file of quest.filter((f) => f !== registry)) await connection.query(await readFile(file.path, "utf8"));

	for (let i = 0; i < 4; i++) {
		await connection.query("INSERT INTO quest.passports (passport_id) VALUES ($1)", [PASSPORTS[i]]);
		await connection.query("INSERT INTO quest.wallet_bindings (wallet, passport_id) VALUES ($1, $2)", [WALLETS[i], PASSPORTS[i]]);
		await connection.query(
			"INSERT INTO quest.pass_mint_reservations (wallet, passport_id, mint, created_at) VALUES ($1, $2, $3, now() - interval '3 hours')",
			[WALLETS[i], PASSPORTS[i], MINTS[i]],
		);
	}
	// Wallets 0 and 1 minted before the registry existed; wallet 2 and 3 are reserved but not minted.
	for (const i of [0, 1])
		await connection.query("UPDATE quest.pass_mint_reservations SET verified_at = now() - interval '2 hours' WHERE wallet = $1", [WALLETS[i]]);
	check("two Pass mints are verified before the registry exists");

	await connection.query(await readFile(registry.path, "utf8"));
	let rows = (await connection.query("SELECT * FROM quest.devnet_pass_minters ORDER BY wallet")).rows;
	assert.equal(rows.length, 2);
	assert.deepEqual(rows.map((r) => r.wallet).sort(), [WALLETS[0], WALLETS[1]].sort());
	assert.ok(rows.every((r) => r.source === "BACKFILL" && /^[0-9a-f]{64}$/.test(r.evidence_sha256)));
	const mintFor = (wallet) => MINTS[WALLETS.indexOf(wallet)];
	assert.ok(rows.every((r) => r.pass_mint === mintFor(r.wallet)));
	check("applying the migration backfills exactly the mints verified before it, with their Pass mints");

	// A mint verified afterwards is recorded by the trigger, once.
	await connection.query("UPDATE quest.pass_mint_reservations SET verified_at = now() - interval '1 hour' WHERE wallet = $1", [WALLETS[2]]);
	rows = (await connection.query("SELECT * FROM quest.devnet_pass_minters ORDER BY wallet")).rows;
	assert.equal(rows.length, 3);
	const live = rows.find((r) => r.wallet === WALLETS[2]);
	assert.equal(live.source, "LIVE");
	assert.equal(live.pass_mint, MINTS[2]);
	check("a mint verified after the migration is recorded as LIVE in the same transaction");
	assert.equal(rows.find((r) => r.wallet === WALLETS[3]), undefined);
	check("a reservation that was never verified is not recorded");

	// The reservation itself is immutable once verified, so a second verification cannot add or change a record.
	await refused(
		connection.query("UPDATE quest.pass_mint_reservations SET verified_at = now() WHERE wallet = $1", [WALLETS[2]]),
		/immutable/,
		"a verified mint cannot be re-verified to change its record",
	);

	// Re-running the backfill is a no-op, and the record is append-only.
	const before = (await connection.query("SELECT count(*)::int AS n FROM quest.devnet_pass_minters")).rows[0].n;
	await connection.query(`INSERT INTO quest.devnet_pass_minters (wallet, pass_mint, minted_at, source, evidence_sha256)
		SELECT wallet, mint, verified_at, 'BACKFILL', repeat('a', 64) FROM quest.pass_mint_reservations WHERE verified_at IS NOT NULL ON CONFLICT DO NOTHING`);
	assert.equal((await connection.query("SELECT count(*)::int AS n FROM quest.devnet_pass_minters")).rows[0].n, before);
	check("re-running the backfill adds nothing");
	for (const [statement, label] of [
		["UPDATE quest.devnet_pass_minters SET wallet = wallet", "update"],
		["DELETE FROM quest.devnet_pass_minters", "delete"],
		["TRUNCATE quest.devnet_pass_minters", "truncate"],
	])
		await refused(connection.query(statement), /permanent and append-only/, `the record refuses ${label}`);

	// Nothing outside the owner can read it.
	await admin.query(`CREATE ROLE "${outsider}" NOLOGIN`);
	await connection.query(`GRANT USAGE ON SCHEMA quest TO "${outsider}"`);
	await connection.query(`SET ROLE "${outsider}"`);
	await refused(connection.query("SELECT * FROM quest.devnet_pass_minters"), /permission denied/, "an ordinary role cannot read the record");
	await connection.query("RESET ROLE");

	// The export: who minted, nothing else, with a hash a later copy can be compared against.
	const exportSql = await readFile(fileURLToPath(new URL("./export-devnet-pass-minters.sql", import.meta.url)), "utf8");
	const exported = (await connection.query(exportSql)).rows[0];
	const document = JSON.parse(Object.values(exported)[0]);
	assert.equal(document.record, "devnet-pass-minters");
	assert.equal(document.network, "DEVNET");
	assert.equal(document.count, 3);
	assert.deepEqual(document.minters.map((m) => m.wallet), [...document.minters.map((m) => m.wallet)].sort());
	for (const minter of document.minters) {
		assert.deepEqual(Object.keys(minter).sort(), ["evidenceSha256", "mintedAt", "passMint", "wallet"]);
		assert.match(minter.mintedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
	}
	const text = JSON.stringify(document);
	assert.ok(!/passport|xp|level/i.test(text.replace(/"purpose":"[^"]*"/, "")), "no Passport id or XP in the export");
	const recomputed = (await connection.query(
		"SELECT encode(sha256(convert_to(($1::jsonb->'minters')::text, 'UTF8')), 'hex') AS h",
		[JSON.stringify(document)],
	)).rows[0].h;
	assert.equal(document.documentSha256, recomputed);
	assert.equal(createHash("sha256").update(document.documentSha256).digest("hex").length, 64);
	check("the export lists only wallet, Pass mint, mint time and evidence hash, sorted, with a verifiable hash");

	console.log(`\nPass minter record rehearsal passed (${passed} checks); dropping the temporary database.`);
} finally {
	await connection?.end().catch(() => {});
	if (created) {
		await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
		await admin.query(`DROP ROLE IF EXISTS "${outsider}"`).catch(() => {});
	}
	await admin.end().catch(() => {});
}
