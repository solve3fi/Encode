// Prints which local keypair file (if any) matches a public key. Prints no secrets.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
const target = process.argv[2];
const walk = (d) => readdirSync(d).flatMap((f) => { const p = `${d}/${f}`; return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const p of walk(`${process.env.HOME}/.solve3-devnet-keys`).filter((x) => x.endsWith(".json"))) {
	try { if (Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8")))).publicKey.toBase58() === target) console.log("match:", p.replace(process.env.HOME, "~")); } catch {}
}
console.log("done");
