// Explicit operator command only. Never run automatically on server startup.
import { writeFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";

const path = process.env.QUEST_PASS_AUTHORITY_FILE;
if (!path?.startsWith("/etc/solve3/quest/") || path.includes(".."))
	throw new Error("Choose a key file inside /etc/solve3/quest");
const key = Keypair.generate();
writeFileSync(path, JSON.stringify(Array.from(key.secretKey)), {
	mode: 0o600,
	flag: "wx",
});
console.log(
	`Pass derivation authority public address: ${key.publicKey.toBase58()}`,
);
console.log(
	"No SOL funding required. Preserve this file; do not regenerate it for retries.",
);
