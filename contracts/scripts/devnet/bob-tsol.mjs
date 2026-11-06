// Gives bob a tSOL account and 1,000 tSOL so the bot can trade the tSOL/tUSDC pool both ways.
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { MINTS, admin, conn, wallet } from "./lib.mjs";

const bob = wallet("bob");
const ata = getAssociatedTokenAddressSync(MINTS.tsol, bob.publicKey);
const sig = await sendAndConfirmTransaction(conn, new Transaction().add(
	createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, bob.publicKey, MINTS.tsol),
	createMintToInstruction(MINTS.tsol, ata, admin.publicKey, 1000n * 10n ** 9n)), [admin]);
console.log("bob tSOL account ready, minted 1,000 tSOL:", sig.slice(0, 12));
