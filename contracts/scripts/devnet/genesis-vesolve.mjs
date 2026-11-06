#!/usr/bin/env node
// Devnet rehearsal genesis, vesolve part: vesolve.initialize, hand the SOLV3
// mint authority to the Protocol PDA, set the Treasury. Idempotent.
//
//   ADMIN_KEYPAIR=/path/id.json VESOLVE=<id> TOKEN=<id> TREASURY=<wallet> \
//   EPOCH_SECONDS=1200 node scripts/devnet/genesis-vesolve.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	Connection,
	Keypair,
	PublicKey,
	SystemProgram,
	Transaction,
	TransactionInstruction,
	sendAndConfirmTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

const env = (k, d) => {
	const v = process.env[k] ?? d;
	if (!v) {
		console.error(`missing ${k}`);
		process.exit(2);
	}
	return v;
};
const rpc = env("RPC", "https://api.devnet.solana.com");
if (!rpc.includes("devnet")) {
	console.error("refusing to run against a non-devnet RPC");
	process.exit(2);
}
const conn = new Connection(rpc, "confirmed");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(env("ADMIN_KEYPAIR"), "utf8"))));
const vesolve = new PublicKey(env("VESOLVE"));
const token = new PublicKey(env("TOKEN"));
const treasury = new PublicKey(env("TREASURY"));
const epochSeconds = BigInt(env("EPOCH_SECONDS", "1200"));

const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const i64 = (n) => {
	const b = Buffer.alloc(8);
	b.writeBigInt64LE(BigInt(n));
	return b;
};
const send = async (label, ix) => {
	const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [admin]);
	console.log(`${label}: ${sig}`);
};
const [mint] = PublicKey.findProgramAddressSync([Buffer.from("mint")], token);
const [mintConfig] = PublicKey.findProgramAddressSync([Buffer.from("mint_config"), mint.toBuffer()], token);
const [protocol] = PublicKey.findProgramAddressSync([Buffer.from("protocol")], vesolve);
const epoch0Seed = Buffer.alloc(8);
const [epoch0] = PublicKey.findProgramAddressSync([Buffer.from("epoch_data"), epoch0Seed], vesolve);
const [adminConfig] = PublicKey.findProgramAddressSync([Buffer.from("admin_config")], vesolve);
const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });

if (await conn.getAccountInfo(protocol)) {
	console.log("initialize: protocol already exists, skipping");
} else {
	await send(
		"vesolve.initialize",
		new TransactionInstruction({
			programId: vesolve,
			data: Buffer.concat([disc("initialize"), mint.toBuffer(), i64(epochSeconds)]),
			keys: [
				meta(admin.publicKey, true, true),
				meta(protocol, false, true),
				meta(epoch0, false, true),
				meta(SystemProgram.programId, false, false),
			],
		}),
	);
}

const mintInfo = await conn.getAccountInfo(mint);
const authOption = mintInfo.data.readUInt32LE(0);
const currentAuth = authOption === 1 ? new PublicKey(mintInfo.data.subarray(4, 36)) : null;
if (currentAuth?.equals(protocol)) {
	console.log("transfer_mint_authority: already the Protocol PDA, skipping");
} else {
	await send(
		"token.transfer_mint_authority -> Protocol PDA",
		new TransactionInstruction({
			programId: token,
			data: Buffer.concat([disc("transfer_mint_authority"), protocol.toBuffer()]),
			keys: [
				meta(admin.publicKey, true, true),
				meta(mint, false, true),
				meta(mintConfig, false, false),
				meta(TOKEN_PROGRAM_ID, false, false),
			],
		}),
	);
}

await send(
	"vesolve.set_treasury",
	new TransactionInstruction({
		programId: vesolve,
		data: Buffer.concat([disc("set_treasury"), treasury.toBuffer()]),
		keys: [
			meta(admin.publicKey, true, true),
			meta(protocol, false, false),
			meta(adminConfig, false, true),
			meta(SystemProgram.programId, false, false),
		],
	}),
);
console.log("protocol PDA", protocol.toBase58());
console.log("timelock PDA", PublicKey.findProgramAddressSync([Buffer.from("upgrade_authority")], vesolve)[0].toBase58());
