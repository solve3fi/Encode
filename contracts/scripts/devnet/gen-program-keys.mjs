// Generates the three program keypairs for a fresh deployment under ~/.solve3-devnet-keys/<REHEARSAL_DIR>.
// Prints public keys only. Never overwrites.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
const dir = `${process.env.HOME}/.solve3-devnet-keys/${process.env.REHEARSAL_DIR ?? "live"}`;
mkdirSync(`${dir}/wallets`, { recursive: true, mode: 0o700 });
for (const n of ["vesolve", "solve", "token"]) {
	const p = `${dir}/${n}-keypair.json`;
	if (!existsSync(p)) { writeFileSync(p, JSON.stringify([...Keypair.generate().secretKey])); chmodSync(p, 0o600); }
	const { Keypair: K } = await import("@solana/web3.js");
	const { readFileSync } = await import("node:fs");
	console.log(n, K.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8")))).publicKey.toBase58());
}
