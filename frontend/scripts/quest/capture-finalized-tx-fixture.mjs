// Saves public finalized-transaction RPC fields (message, meta, slot, block time) as a decoder test
// fixture. Public chain data only; no keys, no wallet files.
//   node scripts/quest/capture-finalized-tx-fixture.mjs <signature> <out.json> [rpc-url]
import { writeFileSync } from "node:fs";

const [signature, out, rpc = "https://api.devnet.solana.com"] = process.argv.slice(2);
if (!signature || !out) {
	console.error("usage: capture-finalized-tx-fixture.mjs <signature> <out.json> [rpc-url]");
	process.exit(2);
}
let body;
for (let attempt = 0; attempt < 6 && !body?.result; attempt++) {
	const res = await fetch(rpc, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "getTransaction",
			params: [signature, { encoding: "json", commitment: "finalized", maxSupportedTransactionVersion: 1 }],
		}),
	});
	body = res.ok ? await res.json() : null;
	if (!body?.result) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
}
const tx = body?.result;
if (!tx || tx.meta?.err !== null) throw new Error("finalized successful transaction not found");
writeFileSync(
	out,
	`${JSON.stringify(
		{
			slot: tx.slot,
			blockTime: tx.blockTime,
			version: tx.version ?? "legacy",
			transaction: tx.transaction,
			meta: tx.meta,
		},
		null,
		"\t",
	)}\n`,
);
console.log(`saved ${signature} (slot ${tx.slot}, version ${tx.version ?? "legacy"}) to ${out}`);
