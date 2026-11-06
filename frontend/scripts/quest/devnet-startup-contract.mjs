import { createHash } from "node:crypto";
import { DEVNET_GENESIS_HASH } from "./devnet-inventory.mjs";

const HEX_256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_OBSERVATION_AGE_MS = 5 * 60 * 1000;

function requireMatch(label, actual, expected) {
	if (expected === undefined || actual === undefined || actual !== expected) {
		throw new Error(`Quest startup refused ${label} mismatch`);
	}
}

function requireText(label, value) {
	if (
		typeof value !== "string" ||
		value.trim() !== value ||
		value.length === 0
	) {
		throw new Error(`Quest startup requires ${label}`);
	}
}

function checkProgram(label, expected, observed) {
	if (!expected || !observed?.exists || observed.executable !== true) {
		throw new Error(`Quest startup requires ${label} program evidence`);
	}
	for (const field of ["address", "owner", "programDataAddress"]) {
		requireText(`${label}.${field}`, expected[field]);
		requireMatch(`${label}.${field}`, observed[field], expected[field]);
	}
	if (!expected.programData || !observed.programData) {
		throw new Error(`Quest startup requires ${label} ProgramData evidence`);
	}
	for (const field of [
		"address",
		"lastDeployedSlot",
		"allocatedExecutableBytes",
		"allocatedExecutableDataSha256",
		"upgradeAuthority",
	]) {
		if (field === "upgradeAuthority") {
			if (expected.programData[field] !== null)
				requireText(`${label}.${field}`, expected.programData[field]);
		} else if (field === "allocatedExecutableBytes") {
			if (
				!Number.isSafeInteger(expected.programData[field]) ||
				expected.programData[field] <= 0
			) {
				throw new Error(
					`Quest startup requires ${label} allocated executable size`,
				);
			}
		} else {
			requireText(`${label}.${field}`, expected.programData[field]);
			if (
				field === "lastDeployedSlot" &&
				!/^[0-9]+$/.test(expected.programData[field])
			) {
				throw new Error(`Quest startup requires ${label} deployment slot`);
			}
		}
		requireMatch(
			`${label}.${field}`,
			observed.programData[field],
			expected.programData[field],
		);
	}
	if (!HEX_256.test(expected.programData.allocatedExecutableDataSha256)) {
		throw new Error(`Quest startup requires ${label} ProgramData SHA-256`);
	}
	requireMatch(
		`${label}.ProgramData pointer`,
		observed.programData.address,
		observed.programDataAddress,
	);
}

/**
 * Pure startup assertion. The caller must obtain the manifest bytes and digest
 * from separate trusted deployment inputs, make a fresh finalized RPC read,
 * and query database identity using the same connection the worker will use.
 * This function does not create a database, approve a manifest, or start work.
 */
export function assertQuestDevnetStartup({
	manifestJson,
	approvedManifestSha256,
	chain,
	database,
	now = Date.now(),
}) {
	if (
		typeof manifestJson !== "string" ||
		Buffer.byteLength(manifestJson) === 0 ||
		Buffer.byteLength(manifestJson) > MAX_MANIFEST_BYTES ||
		!HEX_256.test(approvedManifestSha256 ?? "")
	) {
		throw new Error("Quest startup requires a pinned approved manifest");
	}
	const manifestSha256 = createHash("sha256")
		.update(manifestJson)
		.digest("hex");
	requireMatch(
		"approved manifest SHA-256",
		manifestSha256,
		approvedManifestSha256,
	);
	let manifest;
	try {
		manifest = JSON.parse(manifestJson);
	} catch {
		throw new Error("Quest startup requires valid manifest JSON");
	}
	if (!manifest || Array.isArray(manifest) || typeof manifest !== "object") {
		throw new Error("Quest startup requires a manifest object");
	}
	requireMatch("manifest version", manifest.version, 1);
	requireMatch("manifest network", manifest.network, "DEVNET");
	requireMatch(
		"manifest genesis hash",
		manifest.genesisHash,
		DEVNET_GENESIS_HASH,
	);
	requireMatch("manifest namespace", manifest.namespace, "quest");
	if (!manifest.programs || !manifest.solv3Mint || !manifest.database) {
		throw new Error("Quest startup requires complete manifest entries");
	}
	requireText("environment ID", manifest.environmentId);
	if (!UUID.test(manifest.environmentId)) {
		throw new Error("Quest startup requires canonical environment UUID");
	}
	requireText("database name", manifest.database.name);
	requireText("database runtime role", manifest.database.runtimeRole);

	if (chain?.status !== "UNREVIEWED_CANDIDATE_INVENTORY") {
		throw new Error("Quest startup requires fresh chain inventory evidence");
	}
	requireMatch("chain network", chain.network, manifest.network);
	requireMatch("chain genesis hash", chain.genesisHash, manifest.genesisHash);
	const observedAt = Date.parse(chain.observedAt);
	if (
		!Number.isFinite(now) ||
		!Number.isFinite(observedAt) ||
		observedAt > now ||
		now - observedAt > MAX_OBSERVATION_AGE_MS ||
		!Number.isSafeInteger(chain.finalizedSlot) ||
		chain.finalizedSlot < 0
	) {
		throw new Error("Quest startup requires recent finalized chain evidence");
	}
	checkProgram(
		"dexProgram",
		manifest.programs.dexProgram,
		chain.accounts?.dexProgram,
	);
	checkProgram(
		"veProgram",
		manifest.programs.veProgram,
		chain.accounts?.veProgram,
	);
	if (!chain.accounts?.solv3Mint?.exists || !chain.accounts.solv3Mint.mint) {
		throw new Error("Quest startup requires SOLV3 mint evidence");
	}
	for (const field of ["address", "owner"]) {
		requireText(`solv3Mint.${field}`, manifest.solv3Mint[field]);
		requireMatch(
			`solv3Mint.${field}`,
			chain.accounts.solv3Mint[field],
			manifest.solv3Mint[field],
		);
	}
	for (const field of ["decimals", "mintAuthority", "freezeAuthority"]) {
		if (field === "decimals") {
			if (
				!Number.isInteger(manifest.solv3Mint[field]) ||
				manifest.solv3Mint[field] < 0
			) {
				throw new Error("Quest startup requires SOLV3 mint decimals");
			}
		} else if (manifest.solv3Mint[field] !== null) {
			requireText(`solv3Mint.${field}`, manifest.solv3Mint[field]);
		}
		requireMatch(
			`solv3Mint.${field}`,
			chain.accounts.solv3Mint.mint[field],
			manifest.solv3Mint[field],
		);
	}

	if (
		database?.superuser !== false ||
		database.canCreateQuestObjects !== false ||
		database.canCreatePublicObjects !== false ||
		database.canCreateDatabaseObjects !== false ||
		database.canMutateIdentity !== false
	) {
		throw new Error(
			"Quest startup requires restricted runtime database privileges",
		);
	}
	requireMatch("database name", database.databaseName, manifest.database.name);
	requireMatch(
		"database login role",
		database.sessionUser,
		manifest.database.runtimeRole,
	);
	requireMatch(
		"database effective role",
		database.currentUser,
		manifest.database.runtimeRole,
	);
	if (!database.identity || typeof database.identity !== "object") {
		throw new Error("Quest startup requires database identity row");
	}
	for (const [field, expected] of [
		["network", manifest.network],
		["genesisHash", manifest.genesisHash],
		["namespace", manifest.namespace],
		["environmentId", manifest.environmentId],
		["manifestSha256", manifestSha256],
	]) {
		requireMatch(
			`database identity ${field}`,
			database.identity[field],
			expected,
		);
	}
	return Object.freeze({
		network: "DEVNET",
		manifestSha256,
		environmentId: manifest.environmentId,
		finalizedSlot: chain.finalizedSlot,
	});
}
