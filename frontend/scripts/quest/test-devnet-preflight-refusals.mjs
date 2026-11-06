import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { DEVNET_GENESIS_HASH } from "./devnet-inventory.mjs";
import { runQuestDevnetPreflight } from "./devnet-preflight.mjs";

// Every path, address, digest, manifest byte and callback in this file is
// test-only. None of it is approved deployment input: a human still has to
// review and pin the real Devnet manifest. These tests drive the real
// `runQuestDevnetPreflight` -> `withQuestDevnetStartup` -> startup-contract path
// through injected seams and prove that each tampered input is refused, that no
// worker `work` callback ever runs on refusal, and that an opened connection is
// always closed with `end`.
const NOW = Date.parse("2026-09-28T12:00:00Z");
const PROGRAMDATA_SHA = "a".repeat(64);
const TAMPERED_SHA = "b".repeat(64);
const FIVE_MINUTES_MS = 5 * 60 * 1000;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function buildManifest() {
	const program = (name) => ({
		address: `TEST_ONLY_${name}_PROGRAM`,
		owner: "TEST_ONLY_UPGRADEABLE_LOADER",
		programDataAddress: `TEST_ONLY_${name}_PROGRAMDATA`,
		programData: {
			address: `TEST_ONLY_${name}_PROGRAMDATA`,
			lastDeployedSlot: "99",
			allocatedExecutableBytes: 3,
			allocatedExecutableDataSha256: PROGRAMDATA_SHA,
			upgradeAuthority: `TEST_ONLY_${name}_AUTHORITY`,
		},
	});
	return {
		version: 1,
		network: "DEVNET",
		genesisHash: DEVNET_GENESIS_HASH,
		namespace: "quest",
		environmentId: "11111111-1111-4111-8111-111111111111",
		database: {
			name: "quest_devnet_test_only",
			runtimeRole: "quest_runtime_test_only",
		},
		programs: {
			dexProgram: program("DEX"),
			veProgram: program("VE"),
		},
		solv3Mint: {
			address: "TEST_ONLY_SOLV3_MINT",
			owner: "TEST_ONLY_TOKEN_PROGRAM",
			decimals: 9,
			mintAuthority: "TEST_ONLY_MINT_AUTHORITY",
			freezeAuthority: null,
		},
	};
}

function buildChain(manifest) {
	const chainProgram = (expected) => ({
		address: expected.address,
		owner: expected.owner,
		programDataAddress: expected.programDataAddress,
		exists: true,
		executable: true,
		programData: { ...expected.programData },
	});
	return {
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
}

function buildDatabase(manifest, manifestSha256) {
	return {
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
			manifestSha256,
		},
	};
}

/**
 * Build a valid preflight fixture, apply per-case mutations, then recompute the
 * manifest SHA-256 over the mutated bytes so that only the intended check trips.
 * The injected `loadInputs` yields the (mutated) manifest bytes plus its pin;
 * the recording connection answers the identity query with the (mutated) row.
 */
function fixture({ pin, mutateManifest, mutateChain, mutateDatabase } = {}) {
	const manifest = buildManifest();
	mutateManifest?.(manifest);

	const manifestJson = JSON.stringify(manifest);
	const manifestSha256 = sha256(manifestJson);
	const approvedManifestSha256 = pin ?? manifestSha256;

	const chain = buildChain(manifest);
	mutateChain?.(chain);

	const database = buildDatabase(manifest, manifestSha256);
	mutateDatabase?.(database);

	let workCount = 0;
	let openCount = 0;
	let endCount = 0;
	const calls = [];

	const connection = {
		async query(sql) {
			calls.push("query");
			assert.match(sql, /session_user::text/);
			return { rows: [database] };
		},
		async end() {
			endCount += 1;
			calls.push("end");
		},
	};

	const options = {
		manifestPath: "/TEST_ONLY/quest-manifest.json",
		pinPath: "/TEST_ONLY/quest-manifest.sha256",
		maxManifestBytes: 65536,
		rpcUrl: "https://devnet.example.test/rpc",
		async loadInputs(args) {
			calls.push("load");
			assert.equal(args.manifestPath, options.manifestPath);
			assert.equal(args.pinPath, options.pinPath);
			return { manifestJson, approvedManifestSha256 };
		},
		async collectInventory(url) {
			calls.push("inventory");
			assert.equal(url, options.rpcUrl);
			return chain;
		},
		async openDatabase() {
			openCount += 1;
			calls.push("open");
			return connection;
		},
		clock: () => NOW,
		async work() {
			workCount += 1;
			calls.push("work");
			return "TEST_ONLY_WORK_RESULT";
		},
	};

	return {
		options,
		calls,
		chain,
		database,
		approvedManifestSha256,
		workCount: () => workCount,
		openCount: () => openCount,
		endCount: () => endCount,
	};
}

async function expectRefusal(name, build, pattern = /Quest startup/) {
	const f = build();
	await assert.rejects(runQuestDevnetPreflight(f.options), pattern, name);
	assert.equal(f.workCount(), 0, `${name}: work must never run on refusal`);
	if (f.openCount() > 0) {
		assert.equal(
			f.endCount(),
			1,
			`${name}: the opened connection must be closed with end`,
		);
	}
	return f;
}

test("a valid test-only fixture succeeds and runs work exactly once", async () => {
	const f = fixture();
	const result = await runQuestDevnetPreflight(f.options);
	assert.equal(result.value, "TEST_ONLY_WORK_RESULT");
	assert.equal(result.receipt.network, "DEVNET");
	assert.equal(result.receipt.finalizedSlot, 123);
	assert.equal(result.receipt.manifestSha256, f.approvedManifestSha256);
	assert.equal(f.workCount(), 1);
	assert.equal(f.endCount(), 1);
	assert.deepEqual(f.calls, [
		"load",
		"inventory",
		"open",
		"query",
		"work",
		"end",
	]);
});

test("refuses a tampered pin before any I/O", async () => {
	const f = await expectRefusal(
		"tampered pin",
		() => fixture({ pin: TAMPERED_SHA }),
		/pinned manifest/,
	);
	// The digest check precedes the RPC read and the database open.
	assert.equal(f.openCount(), 0);
	assert.deepEqual(f.calls, ["load"]);
});

test("refuses a manifest that is not DEVNET", async () => {
	await expectRefusal("manifest network", () =>
		fixture({
			mutateManifest: (manifest) => {
				manifest.network = "TEST_ONLY_NOT_DEVNET";
			},
		}),
	);
});

test("refuses a genesis hash mismatch", async () => {
	await expectRefusal("genesis hash", () =>
		fixture({
			mutateManifest: (manifest) => {
				manifest.genesisHash = "TEST_ONLY_TAMPERED_GENESIS_HASH";
			},
		}),
	);
});

test("refuses dex and ve program address mismatches", async () => {
	await expectRefusal("dex program address", () =>
		fixture({
			mutateChain: (chain) => {
				chain.accounts.dexProgram.address = "TEST_ONLY_TAMPERED_DEX_PROGRAM";
			},
		}),
	);
	await expectRefusal("ve program address", () =>
		fixture({
			mutateChain: (chain) => {
				chain.accounts.veProgram.address = "TEST_ONLY_TAMPERED_VE_PROGRAM";
			},
		}),
	);
});

test("refuses a dex ProgramData hash mismatch", async () => {
	await expectRefusal("ProgramData hash", () =>
		fixture({
			mutateChain: (chain) => {
				chain.accounts.dexProgram.programData.allocatedExecutableDataSha256 =
					TAMPERED_SHA;
			},
		}),
	);
});

test("refuses a ProgramData upgrade authority mismatch", async () => {
	await expectRefusal("ProgramData upgrade authority", () =>
		fixture({
			mutateChain: (chain) => {
				chain.accounts.dexProgram.programData.upgradeAuthority =
					"TEST_ONLY_TAMPERED_AUTHORITY";
			},
		}),
	);
});

test("refuses a SOLV3 mint address mismatch", async () => {
	await expectRefusal("SOLV3 mint address", () =>
		fixture({
			mutateChain: (chain) => {
				chain.accounts.solv3Mint.address = "TEST_ONLY_TAMPERED_SOLV3_MINT";
			},
		}),
	);
});

test("refuses mint decimals and mint authority mismatches", async () => {
	await expectRefusal("mint decimals", () =>
		fixture({
			mutateChain: (chain) => {
				chain.accounts.solv3Mint.mint.decimals = 6;
			},
		}),
	);
	await expectRefusal("mint authority", () =>
		fixture({
			mutateChain: (chain) => {
				chain.accounts.solv3Mint.mint.mintAuthority =
					"TEST_ONLY_TAMPERED_MINT_AUTHORITY";
			},
		}),
	);
});

test("refuses a database name mismatch", async () => {
	await expectRefusal("database name", () =>
		fixture({
			mutateDatabase: (database) => {
				database.databaseName = "TEST_ONLY_OTHER_DATABASE";
			},
		}),
	);
});

test("refuses login role and effective role mismatches", async () => {
	await expectRefusal("database sessionUser", () =>
		fixture({
			mutateDatabase: (database) => {
				database.sessionUser = "TEST_ONLY_OTHER_ROLE";
			},
		}),
	);
	await expectRefusal("database currentUser", () =>
		fixture({
			mutateDatabase: (database) => {
				database.currentUser = "TEST_ONLY_OTHER_ROLE";
			},
		}),
	);
});

test("refuses every elevated runtime privilege flag", async () => {
	const flags = [
		"superuser",
		"canCreateQuestObjects",
		"canCreatePublicObjects",
		"canCreateDatabaseObjects",
		"canMutateIdentity",
	];
	for (const flag of flags) {
		await expectRefusal(`elevated privilege ${flag}`, () =>
			fixture({
				mutateDatabase: (database) => {
					database[flag] = true;
				},
			}),
		);
	}
});

test("refuses stale chain evidence older than five minutes", async () => {
	const f = await expectRefusal(
		"stale observedAt",
		() =>
			fixture({
				mutateChain: (chain) => {
					chain.observedAt = new Date(
						NOW - FIVE_MINUTES_MS - 1000,
					).toISOString();
				},
			}),
		/recent finalized chain evidence/,
	);
	// The evidence is read and the connection opened before the age check, so
	// the connection must still be closed.
	assert.deepEqual(f.calls, ["load", "inventory", "open", "query", "end"]);
});

test("refuses a database identity manifestSha256 mismatch", async () => {
	await expectRefusal(
		"identity manifestSha256",
		() =>
			fixture({
				mutateDatabase: (database) => {
					database.identity.manifestSha256 = TAMPERED_SHA;
				},
			}),
		/database identity manifestSha256/,
	);
});
