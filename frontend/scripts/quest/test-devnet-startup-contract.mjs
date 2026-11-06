import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { DEVNET_GENESIS_HASH } from "./devnet-inventory.mjs";
import { assertQuestDevnetStartup } from "./devnet-startup-contract.mjs";

// TEST-ONLY identifiers. A real worker must receive an independently reviewed
// and pinned manifest; this fixture grants no approval to any chain address.
const SHA = "a".repeat(64);
const NOW = Date.parse("2026-09-28T12:00:00Z");

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
	return {
		manifest,
		manifestJson,
		approvedManifestSha256,
		chain,
		database,
		now: NOW,
	};
}

test("returns a sealed Devnet startup receipt only for exact pinned evidence", () => {
	const input = fixture();
	const result = assertQuestDevnetStartup(input);
	assert.equal(result.network, "DEVNET");
	assert.equal(result.finalizedSlot, 123);
	assert.equal(result.manifestSha256, input.approvedManifestSha256);
	assert.equal(Object.isFrozen(result), true);
});

test("refuses missing, malformed, or mismatched approval pin", () => {
	const input = fixture();
	assert.throws(
		() =>
			assertQuestDevnetStartup({ ...input, approvedManifestSha256: undefined }),
		/pinned approved manifest/,
	);
	assert.throws(
		() =>
			assertQuestDevnetStartup({
				...input,
				approvedManifestSha256: "b".repeat(64),
			}),
		/approved manifest SHA-256/,
	);
	assert.throws(
		() => assertQuestDevnetStartup({ ...input, manifestJson: "{" }),
		/approved manifest SHA-256/,
	);
	const malformed = "{";
	assert.throws(
		() =>
			assertQuestDevnetStartup({
				...input,
				manifestJson: malformed,
				approvedManifestSha256: createHash("sha256")
					.update(malformed)
					.digest("hex"),
			}),
		/valid manifest JSON/,
	);
});

test("refuses a Mainnet manifest even when its digest is pinned", () => {
	const input = fixture();
	input.manifest.network = "MAINNET";
	input.manifestJson = JSON.stringify(input.manifest);
	input.approvedManifestSha256 = createHash("sha256")
		.update(input.manifestJson)
		.digest("hex");
	assert.throws(() => assertQuestDevnetStartup(input), /manifest network/);
});

test("refuses wrong chain genesis, program data hash, or SOLV3 mint", () => {
	const wrongNetwork = fixture();
	wrongNetwork.chain.genesisHash = "TEST_MAINNET_GENESIS";
	assert.throws(
		() => assertQuestDevnetStartup(wrongNetwork),
		/chain genesis hash/,
	);
	const wrongProgram = fixture();
	wrongProgram.chain.accounts.veProgram.programData.allocatedExecutableDataSha256 =
		"b".repeat(64);
	assert.throws(
		() => assertQuestDevnetStartup(wrongProgram),
		/veProgram.allocatedExecutableDataSha256/,
	);
	const upgradedProgram = fixture();
	upgradedProgram.chain.accounts.dexProgram.programData.lastDeployedSlot =
		"100";
	assert.throws(
		() => assertQuestDevnetStartup(upgradedProgram),
		/dexProgram.lastDeployedSlot/,
	);
	const wrongMint = fixture();
	wrongMint.chain.accounts.solv3Mint.address = "TEST_OTHER_MINT";
	assert.throws(() => assertQuestDevnetStartup(wrongMint), /solv3Mint.address/);
});

test("refuses stale or non-finalized chain evidence", () => {
	const stale = fixture();
	stale.chain.observedAt = new Date(NOW - 6 * 60 * 1000).toISOString();
	assert.throws(() => assertQuestDevnetStartup(stale), /recent finalized/);
	const missingSlot = fixture();
	missingSlot.chain.finalizedSlot = null;
	assert.throws(
		() => assertQuestDevnetStartup(missingSlot),
		/recent finalized/,
	);
});

test("refuses wrong database, identity row, role, or elevated runtime privileges", () => {
	const wrongDb = fixture();
	wrongDb.database.databaseName = "mainnet_database";
	assert.throws(() => assertQuestDevnetStartup(wrongDb), /database name/);
	const wrongIdentity = fixture();
	wrongIdentity.database.identity.environmentId =
		"22222222-2222-4222-8222-222222222222";
	assert.throws(
		() => assertQuestDevnetStartup(wrongIdentity),
		/database identity environmentId/,
	);
	const noIdentity = fixture();
	noIdentity.database.identity = null;
	assert.throws(
		() => assertQuestDevnetStartup(noIdentity),
		/database identity row/,
	);
	const wrongRole = fixture();
	wrongRole.database.sessionUser = "quest_migrator";
	assert.throws(
		() => assertQuestDevnetStartup(wrongRole),
		/database login role/,
	);
	for (const privilege of [
		"superuser",
		"canCreateQuestObjects",
		"canCreatePublicObjects",
		"canCreateDatabaseObjects",
		"canMutateIdentity",
	]) {
		const elevated = fixture();
		elevated.database[privilege] = true;
		assert.throws(
			() => assertQuestDevnetStartup(elevated),
			/restricted runtime database privileges/,
		);
	}
});
