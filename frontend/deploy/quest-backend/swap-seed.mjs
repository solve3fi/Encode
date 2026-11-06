// One-time, idempotent seed for the Devnet swap source, run as the schema OWNER role (never over
// HTTP). Creates the Genesis campaign and the indexer cursor pinned to the DEX program's first
// finalized transaction, so every swap since the deployment is indexed. Prints only public values.
//
//   QUEST_OWNER_DB_URL, QUEST_DEVNET_RPC_URL, QUEST_SWAP_PROGRAM_ID, QUEST_SWAP_CAMPAIGN_ID
import { Connection, PublicKey } from "@solana/web3.js";
import pg from "pg";
import { SOLVE_DIRECT_DECODER_VERSION } from "../src/lib/genesis/solveDecoder.ts";

const need = (name) => {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required setting ${name}`);
	return value;
};
const programId = need("QUEST_SWAP_PROGRAM_ID");
const campaignId = need("QUEST_SWAP_CAMPAIGN_ID");
const connection = new Connection(need("QUEST_DEVNET_RPC_URL"), {
	commitment: "finalized",
});
if (
	(await connection.getGenesisHash()) !==
	"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
)
	throw new Error("RPC is not Devnet");

let oldest = null;
let before;
for (;;) {
	const page = await connection.getSignaturesForAddress(
		new PublicKey(programId),
		{ limit: 1000, ...(before ? { before } : {}) },
		"finalized",
	);
	for (const entry of page)
		if (oldest === null || entry.slot < oldest) oldest = entry.slot;
	if (page.length < 1000) break;
	before = page[page.length - 1].signature;
	await new Promise((resolve) => setTimeout(resolve, 200));
}
if (oldest === null) throw new Error("The program has no finalized transactions.");

const client = new pg.Client({ connectionString: need("QUEST_OWNER_DB_URL") });
await client.connect();
try {
	await client.query("BEGIN");
	await client.query(
		`INSERT INTO genesis.campaigns(id,cluster,status,starts_at,ends_at)
		 VALUES($1,'devnet','active','2026-09-01T00:00:00Z','2027-12-31T00:00:00Z') ON CONFLICT (id) DO NOTHING`,
		[campaignId],
	);
	await client.query(
		`INSERT INTO genesis.indexer_cursors(campaign_id,program_id,decoder_version,next_slot,reconciliation_start_slot)
		 VALUES($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING`,
		[campaignId, programId, SOLVE_DIRECT_DECODER_VERSION, oldest],
	);
	await client.query("COMMIT");
} catch (error) {
	await client.query("ROLLBACK").catch(() => {});
	throw error;
} finally {
	await client.end();
}
console.log(
	JSON.stringify({
		campaignId,
		programId,
		decoderVersion: SOLVE_DIRECT_DECODER_VERSION,
		startSlot: oldest,
	}),
);
