import { readFileSync, readdirSync } from "node:fs";
import { Connection, Keypair } from "@solana/web3.js";
const c = new Connection("https://api.devnet.solana.com", "confirmed");
const base = `${process.env.HOME}/.solve3-devnet-keys`;
let total = 0;
for (const d of ["rehearsal", "rehearsal2", "live"]) {
	const dir = `${base}/${d}/wallets`;
	let files = []; try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch {}
	for (const f of files) {
		const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${dir}/${f}`, "utf8"))));
		let b; for (let i = 0; i < 8; i++) { try { b = await c.getBalance(kp.publicKey); break; } catch { await new Promise((r) => setTimeout(r, 1500)); } }
		total += b ?? 0; console.log(d, f.replace(".json", ""), kp.publicKey.toBase58().slice(0, 6), (b / 1e9).toFixed(4));
	}
}
console.log("total", (total / 1e9).toFixed(4));
