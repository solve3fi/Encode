import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { DEVNET_GENESIS_HASH } from "./devnet-inventory.mjs";
import { withQuestDevnetStartup } from "./devnet-startup-adapter.mjs";

// All addresses and manifest bytes here are test-only, never deployment input.
const NOW = Date.parse("2026-09-28T12:00:00Z");
const SHA = "a".repeat(64);

function fixture() {
	const program = (name) => ({
		address: `TEST_${name}_PROGRAM`,
		owner: "TEST_UPGRADEABLE_LOADER",
		programDataAddress: `TEST_${name}_PROGRAMDATA`,
		programData: {
			address: `TEST_${name}_PROGRAMDATA`,
			lastDeployedSlot: "99",
			allocatedExecutableBytes: 3,
			allocatedExecutableDataSha256: SHA,
			upgradeAuthority: `TEST_${name}_AUTHORITY`,
		},
	});
	const manifest = {
		version: 1,
		network: "DEVNET",
		genesisHash: DEVNET_GENESIS_HASH,
		namespace: "quest",
		environmentId: "11111111-1111-4111-8111-111111111111",
		database: { name: "quest_devnet_test", runtimeRole: "quest_runtime_test" },
		programs: { dexProgram: program("DEX"), veProgram: program("VE") },
		solv3Mint: {
			address: "TEST_SOLV3_MINT",
			owner: "TEST_TOKEN_PROGRAM",
			decimals: 9,
			mintAuthority: "TEST_MINT_AUTHORITY",
			freezeAuthority: null,
		},
	};
	const manifestJson = JSON.stringify(manifest);
	const approvedManifestSha256 = createHash("sha256")
		.update(manifestJson)
		.digest("hex");
	const chainProgram = (expected) => ({
		...expected,
		exists: true,
		executable: true,
		programData: { ...expected.programData },
	});
	const chain = {
		status: "UNREVIEWED_CANDIDATE_INVENTORY",
		network: "DEVNET",
		genesisHash: DEVNET_GENESIS_HASH,
		observedAt: new Date(NOW - 1000).toISOString(),
		finalizedSlot: 123,
		accounts: {
			dexProgram: chainProgram(manifest.programs.dexProgram),
			veProgram: chainProgram(manifest.programs.veProgram),
			solv3Mint: {
				address: manifest.solv3Mint.address,
				owner: manifest.solv3Mint.owner,
				exists: true,
				mint: {
					decimals: manifest.solv3Mint.decimals,
					mintAuthority: manifest.solv3Mint.mintAuthority,
					freezeAuthority: manifest.solv3Mint.freezeAuthority,
				},
			},
		},
	};
	const database = {
		databaseName: manifest.database.name,
		sessionUser: manifest.database.runtimeRole,
		currentUser: manifest.database.runtimeRole,
		superuser: false,
		canCreateQuestObjects: false,
		canCreatePublicObjects: false,
		canCreateDatabaseObjects: false,
		canMutateIdentity: false,
		identity: {
			network: manifest.network,
			genesisHash: manifest.genesisHash,
			namespace: manifest.namespace,
			environmentId: manifest.environmentId,
			manifestSha256: approvedManifestSha256,
		},
	};
	const calls = [];
	const connection = {
		async query(sql) {
			calls.push("query");
			assert.match(sql, /session_user::text/);
			return { rows: [database] };
		},
		async end() {
			calls.push("end");
		},
	};
	const options = {
		manifestJson,
		approvedManifestSha256,
		rpcUrl: "https://devnet.example.test/rpc",
		async collectInventory(url) {
			calls.push("inventory");
			assert.equal(url, options.rpcUrl);
			return chain;
		},
		async openDatabase() {
			calls.push("open");
			return connection;
		},
		clock: () => NOW,
		async work({ connection: workConnection, receipt }) {
			calls.push("work");
			assert.equal(workConnection, connection);
			assert.equal(receipt.network, "DEVNET");
			return "done";
		},
	};
	return { options, chain, database, calls, connection };
}

test("uses the verified worker connection and closes it after work", async () => {
	const { options, calls } = fixture();
	const result = await withQuestDevnetStartup(options);
	assert.equal(result.value, "done");
	assert.equal(result.receipt.finalizedSlot, 123);
	assert.deepEqual(calls, ["inventory", "open", "query", "work", "end"]);
});

test("rejects an unpinned manifest or non-HTTPS endpoint before I/O", async () => {
	const badPin = fixture();
	badPin.options.approvedManifestSha256 = "b".repeat(64);
	await assert.rejects(
		withQuestDevnetStartup(badPin.options),
		/pinned manifest/,
	);
	assert.deepEqual(badPin.calls, []);
	const badEndpoint = fixture();
	badEndpoint.options.rpcUrl = "http://devnet.example.test/rpc";
	await assert.rejects(
		withQuestDevnetStartup(badEndpoint.options),
		/HTTPS Devnet RPC/,
	);
	assert.deepEqual(badEndpoint.calls, []);
});

test("does not open a database or run work when inventory fails", async () => {
	const { options, calls } = fixture();
	options.collectInventory = async () => {
		calls.push("inventory");
		throw new Error("RPC unavailable");
	};
	await assert.rejects(withQuestDevnetStartup(options), /RPC unavailable/);
	assert.deepEqual(calls, ["inventory"]);
});

test("does not run work when opening the database fails", async () => {
	const { options, calls } = fixture();
	options.openDatabase = async () => {
		calls.push("open");
		throw new Error("connection refused");
	};
	await assert.rejects(withQuestDevnetStartup(options), /connection refused/);
	assert.deepEqual(calls, ["inventory", "open"]);
});

test("closes the connection and skips work on identity query failure", async () => {
	const { options, calls, connection } = fixture();
	connection.query = async () => {
		calls.push("query");
		throw new Error("database unavailable");
	};
	await assert.rejects(withQuestDevnetStartup(options), /database unavailable/);
	assert.deepEqual(calls, ["inventory", "open", "query", "end"]);
});

test("requires exactly one identity query result", async () => {
	for (const rows of [[], [{}, {}]]) {
		const { options, calls, connection } = fixture();
		connection.query = async () => {
			calls.push("query");
			return { rows };
		};
		await assert.rejects(withQuestDevnetStartup(options), /exactly one row/);
		assert.deepEqual(calls, ["inventory", "open", "query", "end"]);
	}
});

test("closes and refuses an untrusted identity row or elevated role", async () => {
	for (const mutate of [
		(database) => {
			database.identity.manifestSha256 = "b".repeat(64);
		},
		(database) => {
			database.canCreateQuestObjects = true;
		},
	]) {
		const { options, database, calls } = fixture();
		mutate(database);
		await assert.rejects(withQuestDevnetStartup(options), /Quest startup/);
		assert.deepEqual(calls, ["inventory", "open", "query", "end"]);
	}
});

test("closes the connection when work fails", async () => {
	const { options, calls } = fixture();
	options.work = async () => {
		calls.push("work");
		throw new Error("worker failed");
	};
	await assert.rejects(withQuestDevnetStartup(options), /worker failed/);
	assert.deepEqual(calls, ["inventory", "open", "query", "work", "end"]);
});
