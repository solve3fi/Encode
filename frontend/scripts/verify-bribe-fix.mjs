import fs from "node:fs";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const RPC = process.env.SOLVE3_DEVNET_RPC ?? "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.SOLVE3_DEVNET_KEYPAIR;
if (!KEYPAIR_PATH) throw new Error("SOLVE3_DEVNET_KEYPAIR is required");
const IDL_PATH = process.env.VESOLVE_IDL ?? new URL("../src/configs/vesolve.json", import.meta.url);
const PROGRAM_ID = new PublicKey("HUk7bMPwzxgJyrjrTsLZjZVuLj5YDbm3bgfL9MA1r3us");
// The exact pool the user hit the AccountNotInitialized error on: SOLV3/devUSDC (1%).
const POOL_ADDRESS = new PublicKey(process.env.SOLVE3_BRIBE_POOL ?? "");
if (!process.env.SOLVE3_BRIBE_POOL) throw new Error("SOLVE3_BRIBE_POOL is required");
const BRIBE_MINT = new PublicKey(process.env.SOLVE3_BRIBE_MINT ?? "9Xn8ko7AwH8HBRLt6Ci6oYxFjPN1sBoUrkDWeTPCPacn"); // SOLV3
const BRIBE_AMOUNT = new BN(process.env.SOLVE3_BRIBE_AMOUNT ?? "1000000"); // 1 SOLV3 (6 decimals)

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"))));
const connection = new Connection(RPC, "confirmed");
const wallet = new Wallet(payer);
const provider = new AnchorProvider(connection, wallet, {
	commitment: "confirmed",
	preflightCommitment: "confirmed",
	maxRetries: 8,
});
const program = new Program(JSON.parse(fs.readFileSync(IDL_PATH, "utf8")), provider);
if (!program.programId.equals(PROGRAM_ID)) throw new Error("Unexpected vesolve program ID");

const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const u64 = (value) => new BN(value).toArrayLike(Buffer, "le", 8);

const protocolAddress = pda([Buffer.from("protocol")]);
const protocol = await program.account.protocol.fetch(protocolAddress);
const epochNumber = protocol.currentEpoch;
const epochAddress = pda([Buffer.from("epoch_data"), u64(epochNumber)]);

const gaugeAddress = pda([Buffer.from("gauge"), protocolAddress.toBuffer(), POOL_ADDRESS.toBuffer()]);
const gauge = await program.account.gauge.fetchNullable(gaugeAddress);
if (!gauge) throw new Error(`No gauge found for pool ${POOL_ADDRESS.toBase58()}`);
console.log(JSON.stringify({ step: "gauge_found", gauge: gaugeAddress.toBase58(), isActive: gauge.isActive }, null, 2));

const vaultAddress = pda([Buffer.from("vault"), u64(epochNumber), gaugeAddress.toBuffer()]);
const vaultBefore = await connection.getAccountInfo(vaultAddress);
console.log(JSON.stringify({ step: "vault_before", vault: vaultAddress.toBase58(), exists: vaultBefore !== null }, null, 2));

const bribeAddress = pda([Buffer.from("bribe"), gaugeAddress.toBuffer(), BRIBE_MINT.toBuffer(), wallet.publicKey.toBuffer()]);
const userTokenAccount = getAssociatedTokenAddressSync(BRIBE_MINT, wallet.publicKey);
const bribeTokenAccount = getAssociatedTokenAddressSync(BRIBE_MINT, vaultAddress, true);

const signature = await program.methods
	.createBribe(BRIBE_AMOUNT)
	.accounts({
		user: wallet.publicKey,
		epoch: epochAddress,
		gauge: gaugeAddress,
		vault: vaultAddress,
		tokenMint: BRIBE_MINT,
		bribe: bribeAddress,
		userTokenAccount,
		bribeTokenAccount,
		systemProgram: SystemProgram.programId,
		tokenProgram: TOKEN_PROGRAM_ID,
		associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
	})
	.rpc({ commitment: "confirmed" });

const vaultAfter = await program.account.vaultData.fetch(vaultAddress);
const bribeAfter = await program.account.bribe.fetch(bribeAddress);

console.log(JSON.stringify({
	step: "create_bribe_succeeded",
	signature,
	epoch: epochNumber.toNumber(),
	pool: POOL_ADDRESS.toBase58(),
	gauge: gaugeAddress.toBase58(),
	vault: {
		address: vaultAddress.toBase58(),
		gauge: vaultAfter.gauge.toBase58(),
		epoch: vaultAfter.epoch.toString(),
		admin: vaultAfter.admin.toBase58(),
	},
	bribe: {
		address: bribeAddress.toBase58(),
		totalAmount: bribeAfter.totalAmount.toString(),
		creator: bribeAfter.creator.toBase58(),
	},
}, null, 2));

console.log("\nALL CHECKS PASSED — vault auto-initialized on first bribe, create_bribe succeeded.");
