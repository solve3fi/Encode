#!/usr/bin/env node
// Devnet rehearsal genesis, token program part: initialize_mint, create the
// Treasury's SOLV3 account, mint exactly 100,000,000 SOLV3 to it.
// Signs with the Admin key (must also be the token program's upgrade authority).
//
//   ADMIN_KEYPAIR=/path/id.json TOKEN=<token program> TREASURY=<wallet> \
//   RPC=https://api.devnet.solana.com node scripts/devnet/genesis-token.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	Connection,
	Keypair,
	PublicKey,
	SystemProgram,
	SYSVAR_INSTRUCTIONS_PUBKEY,
	SYSVAR_RENT_PUBKEY,
	Transaction,
	TransactionInstruction,
	sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	createAssociatedTokenAccountIdempotentInstruction,
	getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const env = (k) => {
	const v = process.env[k];
	if (!v) {
		console.error(`missing ${k}`);
		process.exit(2);
	}
	return v;
};
const rpc = process.env.RPC ?? "https://api.devnet.solana.com";
if (!rpc.includes("devnet")) {
	console.error("refusing to run against a non-devnet RPC");
	process.exit(2);
}
const conn = new Connection(rpc, "confirmed");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(env("ADMIN_KEYPAIR"), "utf8"))));
const token = new PublicKey(env("TOKEN"));
const treasury = new PublicKey(env("TREASURY"));
const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const str = (s) => {
	const b = Buffer.from(s, "utf8");
	const len = Buffer.alloc(4);
	len.writeUInt32LE(b.length);
	return Buffer.concat([len, b]);
};
const u64 = (n) => {
	const b = Buffer.alloc(8);
	b.writeBigUInt64LE(BigInt(n));
	return b;
};
const [mint] = PublicKey.findProgramAddressSync([Buffer.from("mint")], token);
const [mintConfig] = PublicKey.findProgramAddressSync([Buffer.from("mint_config"), mint.toBuffer()], token);
const [programData] = PublicKey.findProgramAddressSync([token.toBuffer()], new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"));
const [metadata] = PublicKey.findProgramAddressSync(
	[Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), mint.toBuffer()],
	METADATA_PROGRAM,
);
const treasuryAta = getAssociatedTokenAddressSync(mint, treasury, true);

const send = async (label, ...ixs) => {
	const sig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [admin]);
	console.log(`${label}: ${sig}`);
	return sig;
};

console.log("admin   ", admin.publicKey.toBase58());
console.log("mint    ", mint.toBase58());
console.log("treasury", treasury.toBase58(), "ATA", treasuryAta.toBase58());

if (await conn.getAccountInfo(mintConfig)) {
	console.log("initialize_mint: already done, skipping");
} else {
	const data = Buffer.concat([
		disc("initialize_mint"),
		Buffer.from([9]),
		str("Solve3"),
		str("SOLV3"),
		str("https://solve3.fi/solv3.json"),
	]);
	await send(
		"initialize_mint",
		new TransactionInstruction({
			programId: token,
			data,
			keys: [
				{ pubkey: admin.publicKey, isSigner: true, isWritable: true },
				{ pubkey: token, isSigner: false, isWritable: false },
				{ pubkey: programData, isSigner: false, isWritable: false },
				{ pubkey: mint, isSigner: false, isWritable: true },
				{ pubkey: mintConfig, isSigner: false, isWritable: true },
				{ pubkey: metadata, isSigner: false, isWritable: true },
				{ pubkey: METADATA_PROGRAM, isSigner: false, isWritable: false },
				{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
				{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
				{ pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
			],
		}),
	);
}

const minted = await conn.getTokenSupply(mint);
console.log("supply before mint:", minted.value.amount);
if (BigInt(minted.value.amount) === 0n) {
	const amount = 100_000_000n * 10n ** 9n;
	await send(
		"mint_tokens (100,000,000 SOLV3)",
		createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, treasuryAta, treasury, mint),
		new TransactionInstruction({
			programId: token,
			data: Buffer.concat([disc("mint_tokens"), u64(amount)]),
			keys: [
				{ pubkey: admin.publicKey, isSigner: true, isWritable: true },
				{ pubkey: mint, isSigner: false, isWritable: true },
				{ pubkey: mintConfig, isSigner: false, isWritable: true },
				{ pubkey: treasuryAta, isSigner: false, isWritable: true },
				{ pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
				{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
				{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
				{ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
			],
		}),
	);
} else {
	console.log("mint_tokens: supply already non-zero, skipping");
}
const after = await conn.getTokenSupply(mint);
console.log("supply after:", after.value.uiAmountString, "SOLV3");
