// Funds the throwaway UI-test wallet (wallets/tester.json) with SOL, SOLV3 and the test mints.
import {
	createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, createTransferInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { MINTS, admin, conn, wallet } from "./lib.mjs";

const tester = wallet("tester").publicKey;
const alice = wallet("alice");
const ata = (mint) => getAssociatedTokenAddressSync(mint, tester);
const send = (signer, ...ixs) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [signer]);

console.log("SOL 1:", (await send(admin, SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: tester, lamports: 1_000_000_000 }))).slice(0, 12));
console.log("SOLV3 50,000:", (await send(alice,
	createAssociatedTokenAccountIdempotentInstruction(alice.publicKey, ata(MINTS.solv3), tester, MINTS.solv3),
	createTransferInstruction(getAssociatedTokenAddressSync(MINTS.solv3, alice.publicKey), ata(MINTS.solv3), alice.publicKey, 50_000n * 10n ** 9n))).slice(0, 12));
for (const [label, mint, amount] of [["tUSDC 10,000", MINTS.tusdc, 10_000n * 10n ** 6n], ["tSOL 10", MINTS.tsol, 10n * 10n ** 9n], ["bribe token 1,000", MINTS.bribe, 1_000n * 10n ** 6n]]) {
	console.log(`${label}:`, (await send(admin,
		createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata(mint), tester, mint),
		createMintToInstruction(mint, ata(mint), admin.publicKey, amount))).slice(0, 12));
}
console.log("tester", tester.toBase58(), "funded");
