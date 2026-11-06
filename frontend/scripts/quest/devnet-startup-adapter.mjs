import { createHash } from "node:crypto";
import { readQuestDatabaseIdentity } from "./database-identity.mjs";
import { collectDevnetInventory } from "./devnet-inventory.mjs";
import { assertQuestDevnetStartup } from "./devnet-startup-contract.mjs";

const HEX_256 = /^[0-9a-f]{64}$/;

/**
 * Dormant orchestration boundary for a future Devnet worker. The caller must
 * supply manifest bytes and their independently approved digest, an explicit
 * RPC URL, and a factory for a dedicated, restricted database connection (not
 * a pool's query facade). Nothing runs on import. The adapter owns and closes
 * the connection used for identity verification and passed to awaited `work`.
 */
export async function withQuestDevnetStartup({
	manifestJson,
	approvedManifestSha256,
	rpcUrl,
	openDatabase,
	work,
	collectInventory = collectDevnetInventory,
	clock = Date.now,
}) {
	if (
		typeof manifestJson !== "string" ||
		Buffer.byteLength(manifestJson) === 0 ||
		Buffer.byteLength(manifestJson) > 64 * 1024 ||
		!HEX_256.test(approvedManifestSha256 ?? "") ||
		createHash("sha256").update(manifestJson).digest("hex") !==
			approvedManifestSha256
	) {
		throw new Error(
			"Quest adapter requires independently pinned manifest bytes",
		);
	}
	let endpoint;
	try {
		endpoint = new URL(rpcUrl);
	} catch {
		throw new Error("Quest adapter requires explicit HTTPS Devnet RPC URL");
	}
	if (endpoint.protocol !== "https:") {
		throw new Error("Quest adapter requires explicit HTTPS Devnet RPC URL");
	}
	if (
		typeof openDatabase !== "function" ||
		typeof work !== "function" ||
		typeof collectInventory !== "function" ||
		typeof clock !== "function"
	) {
		throw new Error("Quest adapter requires connection and work callbacks");
	}

	const chain = await collectInventory(endpoint.toString());
	const connection = await openDatabase();
	try {
		if (
			typeof connection?.query !== "function" ||
			typeof connection?.end !== "function"
		) {
			throw new Error("Quest adapter requires a closable database connection");
		}
		const database = await readQuestDatabaseIdentity(connection);
		const receipt = assertQuestDevnetStartup({
			manifestJson,
			approvedManifestSha256,
			chain,
			database,
			now: clock(),
		});
		const value = await work({ connection, receipt });
		return { receipt, value };
	} finally {
		if (typeof connection?.end === "function") {
			await connection.end();
		}
	}
}
