import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet as EthWallet } from "ethers";
import { AnchorProvider, BN, Program, Wallet as AnchorWallet } from "@coral-xyz/anchor";
import {
	Connection,
	Keypair,
	PublicKey,
	SystemProgram,
	Transaction,
} from "@solana/web3.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.SOLVE3_BASE_URL ?? "http://localhost:3000";
const RPC = process.env.SOLVE3_DEVNET_RPC ?? "https://api.devnet.solana.com";
const FUNDER_KEYPAIR_PATH = process.env.SOLVE3_ADMIN_KEYPAIR;
if (!FUNDER_KEYPAIR_PATH) throw new Error("SOLVE3_ADMIN_KEYPAIR is required (to fund the throwaway claimant)");
const DATA_PATH = path.join(__dirname, "..", "data", "airdrop-allocations.json");
const PROGRAM_ID = new PublicKey("HUk7bMPwzxgJyrjrTsLZjZVuLj5YDbm3bgfL9MA1r3us");

const step = (label) => console.log(`\n=== ${label} ===`);

step("0. Setting up throwaway identities");
const ethWallet = EthWallet.createRandom();
const ethAddress = ethWallet.address.toLowerCase();
const solanaKeypair = Keypair.generate();
console.log(JSON.stringify({ ethAddress, solanaAddress: solanaKeypair.publicKey.toBase58() }));

step("1. Funding the throwaway Solana wallet");
const funder = Keypair.fromSecretKey(
	Uint8Array.from(JSON.parse(fs.readFileSync(FUNDER_KEYPAIR_PATH, "utf8"))),
);
const connection = new Connection(RPC, "confirmed");
const fundTx = new Transaction().add(
	SystemProgram.transfer({
		fromPubkey: funder.publicKey,
		toPubkey: solanaKeypair.publicKey,
		lamports: 0.05 * 1e9,
	}),
);
const fundSig = await connection.sendTransaction(fundTx, [funder]);
await connection.confirmTransaction(fundSig, "confirmed");
console.log("funded:", fundSig);

step("2. Seeding a test allocation directly into the live store (verification-only)");
const allocations = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const TEST_AMOUNT = 1;
allocations[ethAddress] = {
	ethAddress,
	amount: TEST_AMOUNT,
	amountRaw: String(TEST_AMOUNT * 10 ** 9),
	minted: false,
	locked: false,
};
fs.writeFileSync(DATA_PATH, JSON.stringify(allocations, null, "\t"));
console.log("seeded test allocation:", ethAddress, TEST_AMOUNT, "SOLV3");

step("3. Signing the claim message with the EVM wallet");
const claimMessage = `Claim ${TEST_AMOUNT} SOLV3 airdrop to Solana address ${solanaKeypair.publicKey.toString()}`;
const ethSignature = await ethWallet.signMessage(claimMessage);

step("4. POST /api/airdrop/claim (build)");
const buildRes = await fetch(`${BASE_URL}/api/airdrop/claim`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({
		ethAddress,
		solanaAddress: solanaKeypair.publicKey.toString(),
		signature: ethSignature,
	}),
});
const buildData = await buildRes.json();
console.log(buildRes.status, buildData);
if (!buildRes.ok) throw new Error("Build failed");

step("5. Signing and submitting the combined transfer+lock transaction");
const transaction = Transaction.from(Buffer.from(buildData.transaction, "base64"));
transaction.partialSign(solanaKeypair);
const solanaSignature = await connection.sendRawTransaction(transaction.serialize());
await connection.confirmTransaction(solanaSignature, "confirmed");
console.log("claim tx confirmed:", solanaSignature);

step("6. POST /api/airdrop/finalize");
const finalizeRes = await fetch(`${BASE_URL}/api/airdrop/finalize`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({
		ethAddress,
		solanaAddress: solanaKeypair.publicKey.toString(),
		signature: solanaSignature,
	}),
});
const finalizeData = await finalizeRes.json();
console.log(finalizeRes.status, finalizeData);
if (!finalizeRes.ok) throw new Error("Finalize failed");

step("7. Confirming via GET /api/airdrop/status");
const statusRes = await fetch(`${BASE_URL}/api/airdrop/status?ethAddress=${ethAddress}`);
const statusData = await statusRes.json();
console.log(statusData);
if (!statusData.minted || !statusData.locked) throw new Error("Status doesn't show minted+locked");

step("8. Confirming the on-chain Lock account is permanent");
const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "configs", "vesolve.json"), "utf8"));
const provider = new AnchorProvider(connection, new AnchorWallet(funder), { commitment: "confirmed" });
const program = new Program(idl, provider);
const lockAddress = new PublicKey(buildData.lockAddress);
const lock = await program.account.lock.fetch(lockAddress);
console.log(JSON.stringify({
	owner: lock.owner.toString(),
	amount: lock.amount.toString(),
	unlockTime: lock.unlockTime.toString(),
	isMaxI64: lock.unlockTime.eq(new BN("9223372036854775807")),
}));
if (!lock.unlockTime.eq(new BN("9223372036854775807"))) throw new Error("Lock is not permanent!");
if (lock.amount.toString() !== String(TEST_AMOUNT * 10 ** 9)) throw new Error("Locked amount mismatch!");
if (!lock.owner.equals(solanaKeypair.publicKey)) throw new Error("Lock owner mismatch!");

step("9. Cleaning up the test allocation");
const cleanup = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
delete cleanup[ethAddress];
fs.writeFileSync(DATA_PATH, JSON.stringify(cleanup, null, "\t"));
console.log("removed test allocation:", ethAddress);

console.log("\nALL CHECKS PASSED — claim built, signed, submitted, finalized; resulting lock is permanent and correct.");
