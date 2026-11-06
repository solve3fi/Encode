// Sends the SOL of the throwaway rehearsal wallets (wallets/*.json under rehearsal, rehearsal2) to the admin wallet. DEVNET ONLY.
import { readFileSync, readdirSync } from "node:fs";
import { Connection, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
const c = new Connection("https://api.devnet.solana.com", "confirmed");
const base = `${process.env.HOME}/.solve3-devnet-keys`;
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${base}/id.json`, "utf8"))));
const seen = new Set();
for (const d of ["rehearsal2", "rehearsal"]) {
	for (const f of readdirSync(`${base}/${d}/wallets`).filter((x) => x.endsWith(".json"))) {
		const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${base}/${d}/wallets/${f}`, "utf8"))));
		const k = kp.publicKey.toBase58();
		if (seen.has(k)) continue; seen.add(k);
		for (let i = 0; i < 8; i++) {
			try {
				const bal = await c.getBalance(kp.publicKey);
				const lamports = bal - 5000;
				if (lamports <= 0) break;
				const sig = await sendAndConfirmTransaction(c, new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: admin.publicKey, lamports })), [kp]);
				console.log(f.replace(".json", ""), (lamports / 1e9).toFixed(4), "SOL ->", sig.slice(0, 10));
				break;
			} catch (e) { await new Promise((r) => setTimeout(r, 2000)); }
		}
	}
}
console.log("admin now", (await c.getBalance(admin.publicKey)) / 1e9);
