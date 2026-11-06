// Prints the two mints of Solve pool accounts (read-only RPC): node scripts/quest/inspect-pool-mints.mjs <pool...>
import { PublicKey } from "@solana/web3.js";
import { createResilientConnection } from "../lib/resilient-rpc.mjs";
import { parsePoolMints } from "./devnet-swap-valuation.mjs";

const connection = createResilientConnection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "finalized", { attempts: 10, maxDelayMs: 15000 });
for (const address of process.argv.slice(2)) {
	const info = await connection.getAccountInfo(new PublicKey(address));
	if (!info) {
		console.log(address, "missing");
		continue;
	}
	const { mintA, mintB } = parsePoolMints(info.data, PublicKey);
	console.log(address, mintA, mintB);
}
