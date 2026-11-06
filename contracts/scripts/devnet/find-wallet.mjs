// Read-only: finds the owner of a holder of a mint whose address starts/ends with the given fragments, then prints its latest transactions.
import { Connection, PublicKey } from "@solana/web3.js";
const [mint, start, end] = process.argv.slice(2);
const c = new Connection(process.env.RPC ?? "https://api.devnet.solana.com", "confirmed");
const retry = async (f) => { for (let i = 0; i < 10; i++) { try { return await f(); } catch { await new Promise((r) => setTimeout(r, 2000)); } } throw new Error("rpc"); };
const largest = await retry(() => c.getTokenLargestAccounts(new PublicKey(mint)));
for (const a of largest.value) {
	const info = await retry(() => c.getParsedAccountInfo(a.address));
	const owner = info.value?.data?.parsed?.info?.owner;
	if (owner?.startsWith(start) && owner.endsWith(end)) {
		console.log("owner", owner, "devUSDC", a.uiAmountString);
		const sigs = await retry(() => c.getSignaturesForAddress(new PublicKey(owner), { limit: 12 }));
		for (const s of sigs) console.log(new Date(s.blockTime * 1000).toISOString(), s.err ? "FAILED " + JSON.stringify(s.err) : "ok     ", s.signature.slice(0, 20));
		process.exit(0);
	}
}
console.log("no match among top holders (", largest.value.length, ")");
