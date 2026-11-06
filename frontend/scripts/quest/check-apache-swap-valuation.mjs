// Devnet check: values a real swap of the clean Apache deployment with the same code the swap worker uses
// (pool mints read from the live pool account, payload from the strict decoder). Read-only.
//   node scripts/quest/check-apache-swap-valuation.mjs
import { readFileSync } from "node:fs";
import { Connection, Message, PublicKey } from "@solana/web3.js";
import { decodeVerifiedSwapTransactions } from "../../src/lib/genesis/swapDecoder.ts";
import { parsePoolMints, valueSwapEvent } from "./devnet-swap-valuation.mjs";

const PROGRAM = "HnosXNWPvKSFkY6xjUpCJ9nhbvTRhdfNTfWpgp3m4GK";
const USDC = "FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up";
const fixture = JSON.parse(
	readFileSync(new URL("../../tests/fixtures/genesis-apache-swap-a-to-b.json", import.meta.url)),
);
const [record] = decodeVerifiedSwapTransactions({
	campaignId: "check",
	cluster: "devnet",
	programId: PROGRAM,
	slot: fixture.slot,
	blockTimeSeconds: fixture.blockTime,
	transactions: [
		{ transaction: { signatures: fixture.transaction.signatures, message: new Message(fixture.transaction.message) }, meta: fixture.meta },
	],
});
const connection = new Connection(process.env.RPC ?? "https://api.devnet.solana.com", "finalized");
const info = await connection.getAccountInfo(new PublicKey(record.poolAddress));
if (!info || info.owner.toBase58() !== PROGRAM) throw new Error("pool account not owned by the clean program");
const { mintA, mintB } = parsePoolMints(info.data, PublicKey);
console.log("pool", record.poolAddress, "mints", String(mintA), String(mintB));
console.log("payload", JSON.stringify({ aToB: record.payload.aToB, in: record.payload.inputAmountRaw, out: record.payload.outputAmountRaw }));
console.log("valuation", JSON.stringify(valueSwapEvent({ payload: record.payload, mintA, mintB, usdcMint: USDC, usdcDecimals: 6 }), (_, v) => (typeof v === "bigint" ? v.toString() : v)));
