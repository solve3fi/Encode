// Creates tester3: a fresh wallet with SOL and devUSDC (tUSDC) only, like a new user who claimed from the faucet.
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { MINTS, admin, conn, wallet } from "./lib.mjs";
const p = `${process.env.HOME}/.solve3-devnet-keys/live/wallets/tester3.json`;
if (!existsSync(p)) { writeFileSync(p, JSON.stringify([...Keypair.generate().secretKey])); chmodSync(p, 0o600); }
const w = wallet("tester3").publicKey;
const send = (...ixs) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [admin]);
console.log("tester3", w.toBase58());
console.log("SOL 0.3", (await send(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: w, lamports: 300_000_000 }))).slice(0, 10));
const ata = getAssociatedTokenAddressSync(MINTS.tusdc, w);
console.log("devUSDC 100", (await send(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, w, MINTS.tusdc), createMintToInstruction(MINTS.tusdc, ata, admin.publicKey, 100n * 10n ** 6n))).slice(0, 10));
