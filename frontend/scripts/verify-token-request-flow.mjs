import fs from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

const BASE_URL = process.env.SOLVE3_BASE_URL ?? "https://solve3.fi";
const ADMIN_KEYPAIR_PATH = process.env.SOLVE3_ADMIN_KEYPAIR;
if (!ADMIN_KEYPAIR_PATH) throw new Error("SOLVE3_ADMIN_KEYPAIR is required");
const MINT = process.env.SOLVE3_TEST_MINT;
if (!MINT) throw new Error("SOLVE3_TEST_MINT is required");

const adminKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEYPAIR_PATH, "utf8"))),
);
new PublicKey(adminKeypair.publicKey.toBase58()); // sanity check

const submitter = Keypair.generate();

const sign = (keypair, message) =>
  Buffer.from(
    nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey),
  ).toString("base64");

// 1x1 transparent PNG
const LOGO_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const step = (label) => console.log(`\n=== ${label} ===`);

step("1. Submitting token listing request");
const submitMessage = `solve3 token request: ${MINT}`;
const submitSignature = sign(submitter, submitMessage);

const form = new FormData();
form.set("mint", MINT);
form.set("symbol", "TEST3");
form.set("name", "E2E Verification Token");
form.set("website", "https://example.com");
form.set("twitter", "https://x.com/example");
form.set("wallet", submitter.publicKey.toBase58());
form.set("message", submitMessage);
form.set("signature", submitSignature);
form.set("logo", new Blob([LOGO_BYTES], { type: "image/png" }), "logo.png");

const submitRes = await fetch(`${BASE_URL}/api/token-requests`, {
  method: "POST",
  body: form,
});
const submitData = await submitRes.json();
console.log(submitRes.status, submitData);
if (!submitRes.ok) throw new Error("Submission failed");

step("2. Confirming pending request via admin GET");
const listRes1 = await fetch(`${BASE_URL}/api/admin/token-requests`);
const listData1 = await listRes1.json();
const pendingRecord = listData1[MINT];
console.log("pending record:", pendingRecord);
if (!pendingRecord || pendingRecord.status !== "pending") {
  throw new Error("Expected a pending record after submission");
}

step("3. Approving as admin");
const adminMessage = "solve3 admin action: review token request";
const adminSignature = sign(adminKeypair, adminMessage);
const approveRes = await fetch(`${BASE_URL}/api/admin/token-requests`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    wallet: adminKeypair.publicKey.toBase58(),
    message: adminMessage,
    signature: adminSignature,
    mint: MINT,
    decision: "approved",
  }),
});
const approveData = await approveRes.json();
console.log(approveRes.status, approveData);
if (!approveRes.ok || approveData.status !== "approved") {
  throw new Error("Approval failed");
}

step("4. Confirming published in /api/token-list-extra");
const publishedRes = await fetch(`${BASE_URL}/api/token-list-extra`);
const publishedData = await publishedRes.json();
const publishedEntry = publishedData.tokens?.find((t) => t.address === MINT);
console.log("published entry:", publishedEntry);
if (!publishedEntry) throw new Error("Approved token not found in token-list-extra");
if (publishedEntry.logoURI !== `/api/token-logos/${pendingRecord ? approveData.logoFile : ""}` &&
    !publishedEntry.logoURI?.startsWith("/api/token-logos/")) {
  throw new Error("logoURI not in expected shape");
}
if (publishedEntry.extensions?.website !== "https://example.com") {
  throw new Error("website extension missing/mismatched");
}
if (publishedEntry.extensions?.twitter !== "https://x.com/example") {
  throw new Error("twitter extension missing/mismatched");
}

step("5. Confirming logo is servable");
const logoRes = await fetch(`${BASE_URL}${publishedEntry.logoURI}`);
console.log("logo fetch status:", logoRes.status, logoRes.headers.get("content-type"));
if (!logoRes.ok) throw new Error("Logo not servable");

console.log("\nALL CHECKS PASSED");
