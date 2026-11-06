import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";

const BASE_URL = process.env.SOLVE3_BASE_URL ?? "http://localhost:3000";
const ADMIN_KEYPAIR_PATH = process.env.SOLVE3_ADMIN_KEYPAIR;
if (!ADMIN_KEYPAIR_PATH) throw new Error("SOLVE3_ADMIN_KEYPAIR is required");
const MINT = process.env.SOLVE3_TEST_MINT;
if (!MINT) throw new Error("SOLVE3_TEST_MINT is required");

const adminKeypair = Keypair.fromSecretKey(
	Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEYPAIR_PATH, "utf8"))),
);

const sign = (keypair, message) =>
	Buffer.from(
		nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey),
	).toString("base64");

const step = (label) => console.log(`\n=== ${label} ===`);

step("1. Setting website/X for mint");
const message = "solve3 admin action: update token links";
const signature = sign(adminKeypair, message);
const saveRes = await fetch(`${BASE_URL}/api/admin/token-links`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({
		wallet: adminKeypair.publicKey.toBase58(),
		message,
		signature,
		mint: MINT,
		website: "https://dogwifhat3.example",
		twitter: "https://x.com/wif3_example",
	}),
});
const saveData = await saveRes.json();
console.log(saveRes.status, saveData);
if (!saveRes.ok) throw new Error("Save failed");

step("2. Confirming via GET /api/admin/token-links");
const listRes = await fetch(`${BASE_URL}/api/admin/token-links`);
const listData = await listRes.json();
console.log(listData);
if (listData[MINT]?.website !== "https://dogwifhat3.example") {
	throw new Error("Website override not found in store");
}
if (listData[MINT]?.twitter !== "https://x.com/wif3_example") {
	throw new Error("Twitter override not found in store");
}

step("3. Clearing the override");
const clearRes = await fetch(`${BASE_URL}/api/admin/token-links`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({
		wallet: adminKeypair.publicKey.toBase58(),
		message,
		signature,
		mint: MINT,
		website: "",
		twitter: "",
	}),
});
const clearData = await clearRes.json();
console.log(clearRes.status, clearData);
if (!clearRes.ok || clearData.link !== null) throw new Error("Clear failed");

const listRes2 = await fetch(`${BASE_URL}/api/admin/token-links`);
const listData2 = await listRes2.json();
if (listData2[MINT]) throw new Error("Override still present after clear");

console.log("\nALL CHECKS PASSED — set, read, and clear all worked.");
