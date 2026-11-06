import { pathToFileURL } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";
import pg from "pg";
import { fingerprintGenesisEvent } from "../src/lib/genesis/eventFingerprint.ts";
import { createFinalizedSolanaSource } from "../src/lib/genesis/finalizedSource.ts";
import { indexGenesisRange } from "../src/lib/genesis/indexer.ts";
import { createVerifiedSolveDecoder } from "../src/lib/genesis/solveDecoder.ts";
import { createGenesisSqlLedger } from "../src/lib/genesis/sqlLedger.ts";

const clusters = new Set(["localnet", "devnet", "testnet", "mainnet-beta"]);
const runnableCampaignStatuses = new Set(["active", "closed", "review"]);

/** Explicit operator configuration; no campaign, cluster, or RPC defaults. */
export function readGenesisIndexerConfig(env = process.env) {
	const databaseUrl = env.GENESIS_DATABASE_URL;
	const rpcUrl = env.GENESIS_RPC_URL;
	const campaignId = env.GENESIS_CAMPAIGN_ID;
	const cluster = env.GENESIS_CLUSTER;
	const programId = env.GENESIS_PROGRAM_ID;
	const maxSlots = Number(env.GENESIS_MAX_SLOTS ?? "32");
	if (!databaseUrl || !rpcUrl || !campaignId || !cluster || !programId)
		throw new Error(
			"Genesis indexer requires database, RPC, campaign, cluster, and program configuration.",
		);
	let database;
	let rpc;
	try {
		database = new URL(databaseUrl);
		rpc = new URL(rpcUrl);
	} catch {
		throw new Error("Genesis indexer connection URL is invalid.");
	}
	if (!["postgres:", "postgresql:"].includes(database.protocol))
		throw new Error("Genesis indexer requires a PostgreSQL connection URL.");
	if (!["http:", "https:"].includes(rpc.protocol))
		throw new Error("Genesis indexer requires an HTTP(S) RPC URL.");
	if (!clusters.has(cluster))
		throw new Error("Invalid Genesis Solana cluster.");
	try {
		new PublicKey(programId);
	} catch {
		throw new Error("Invalid Genesis Solve program ID.");
	}
	if (!Number.isSafeInteger(maxSlots) || maxSlots < 1 || maxSlots > 32)
		throw new Error("Genesis indexer batch must contain 1 to 32 slots.");
	return { databaseUrl, rpcUrl, campaignId, cluster, programId, maxSlots };
}

/** One bounded batch. A pre-existing campaign and cursor are required. */
export async function runGenesisIndexerOnce(config, { pool, source }) {
	const campaign = await pool.query(
		"SELECT cluster, status FROM genesis.campaigns WHERE id = $1",
		[config.campaignId],
	);
	if (campaign.rows.length !== 1)
		throw new Error("Genesis campaign is not initialized.");
	if (campaign.rows[0].cluster !== config.cluster)
		throw new Error(
			"Genesis campaign cluster differs from worker configuration.",
		);
	if (!runnableCampaignStatuses.has(campaign.rows[0].status))
		throw new Error("Genesis campaign is not in an indexable state.");
	const decoder = createVerifiedSolveDecoder({
		campaignId: config.campaignId,
		cluster: config.cluster,
		programId: config.programId,
	});
	const ledger = createGenesisSqlLedger(pool);
	// Check the exact cursor before making any RPC request. Neither record is created here.
	await ledger.readNextSlot(
		config.campaignId,
		config.programId,
		decoder.version,
	);
	return indexGenesisRange({
		campaignId: config.campaignId,
		cluster: config.cluster,
		source,
		decoder,
		ledger,
		fingerprint: fingerprintGenesisEvent,
		maxSlots: config.maxSlots,
	});
}

async function main() {
	const config = readGenesisIndexerConfig();
	const pool = new pg.Pool({
		connectionString: config.databaseUrl,
		max: 2,
		idleTimeoutMillis: 10_000,
	});
	try {
		const source = createFinalizedSolanaSource(
			new Connection(config.rpcUrl, "finalized"),
		);
		const result = await runGenesisIndexerOnce(config, { pool, source });
		process.stdout.write(
			`Genesis batch ${result.startSlot}..${result.nextSlot}: ${result.inserted} inserted, ${result.duplicates} duplicates.\n`,
		);
	} finally {
		await pool.end();
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch(() => {
		// Connection errors may include secrets in URL query strings; keep stdout safe.
		process.stderr.write(
			"Genesis indexer batch failed. Check worker configuration and secure logs.\n",
		);
		process.exitCode = 1;
	});
}
