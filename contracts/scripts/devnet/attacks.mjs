#!/usr/bin/env node
// Vote-transfer attacks (spec A8/A9, invariants I-7/I-10): alice votes lock 1,
// transfers it to bob in the same epoch; bob must not be able to re-vote,
// exit, split or merge it. Controls use an unvoted lock to prove the accounts are right.
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { MINTS, conn, loadState, pda, programFor, saveState, wallet } from "./lib.mjs";

const voterName = process.env.VOTER ?? "alice", toName = process.env.TO ?? "bob";
const alice = wallet(voterName), bob = wallet(toName); // alice = original voter, bob = recipient/attacker
const CONTROL_ID = process.env.CONTROL ? Number(process.env.CONTROL) : null;
const st = loadState();
const protocolKey = pda("vesolve", [Buffer.from("protocol")]);
const METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const u64 = (n) => new BN(n).toArrayLike(Buffer, "le", 8);
const ata = (m, o, off = false) => getAssociatedTokenAddressSync(m, o, off);
const veMint = (id) => pda("vesolve", [Buffer.from("ve_token"), u64(id)]);
const lockPda = (id) => pda("vesolve", [Buffer.from("ve_lock"), u64(id)]);
const gaugeA = pda("vesolve", [Buffer.from("gauge"), protocolKey.toBuffer(), new PublicKey(st.solv3_tusdc.pool).toBuffer()]);
const as = (w) => programFor("vesolve", w);
const send = (signer, ...ixs) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [signer]);
const code = (e) => {
	const text = JSON.stringify(e.logs ?? []) + String(e.message ?? e);
	return (text.match(/Error Code: (\w+)/) ?? text.match(/custom program error: (0x[0-9a-f]+)/) ?? [null, String(e.message ?? e).slice(0, 120)])[1];
};
const expectFail = async (label, fn) => {
	try { const sig = await fn(); console.log(`FAIL  ${label}: UNEXPECTED SUCCESS ${sig}`); }
	catch (e) { console.log(`PASS  ${label}: refused with ${code(e)}`); }
};
const expectOk = async (label, fn) => {
	try { console.log(`PASS  ${label}: ${await fn()}`); }
	catch (e) { console.log(`FAIL  ${label}: unexpectedly refused ${code(e)}`); }
};

const protocol = await as(alice).account.protocol.fetch(protocolKey);
const epochNo = protocol.currentEpoch;
const epoch = pda("vesolve", [Buffer.from("epoch_data"), u64(epochNo)]);
console.log("epoch", epochNo.toString());
const ID = Number(process.env.LOCK ?? 1);
const vote1 = (w, id, votes) => as(w).methods.vote(new BN(id), votes.map(([gauge, weight]) => ({ gauge, weight: new BN(weight) })))
	.accounts({ user: w.publicKey, epoch, autoVoteEnrollment: null, allocationVoter: null }).remainingAccounts(votes.map(([g]) => ({ pubkey: g, isSigner: false, isWritable: true }))).rpc();

const vote = async (w, id, votes) => { for (let i = 0; ; i++) { try { return await vote1(w, id, votes); } catch (e) { if (i >= 3 || !/Blockhash|429|confirmed/.test(String(e.message ?? e))) throw e; } } };
// recipient gets an unvoted control lock (id = next)
const nextId = CONTROL_ID ?? (await as(bob).account.protocol.fetch(protocolKey)).nextNftTokenId.toNumber();
if (CONTROL_ID === null) {
	const id = nextId;
	const mint = veMint(id);
	const metadata = PublicKey.findProgramAddressSync([Buffer.from("metadata"), METADATA.toBuffer(), mint.toBuffer()], METADATA)[0];
	await as(bob).methods.createLock(new BN(2000n * 10n ** 9n), new BN(0)).accounts({
		user: bob.publicKey, userTokenAccount: ata(MINTS.solv3, bob.publicKey), tokenMint: MINTS.solv3, protocolTokenAccount: ata(MINTS.solv3, protocolKey, true), metadata, tokenProgram: TOKEN_PROGRAM_ID,
	}).rpc();
	console.log("control lock created for bob, id", id);
	saveState({ controlLock: id });
}
const CONTROL = nextId;

await vote(alice, ID, [[gaugeA, 100]]); console.log("PASS  original voter voted lock", ID);
await send(bob, createAssociatedTokenAccountIdempotentInstruction(bob.publicKey, ata(veMint(ID), bob.publicKey), bob.publicKey, veMint(ID)));
await expectOk("alice transfers voted lock 1 to bob (allowed per A8)", () => as(alice).methods.transferLock(new BN(ID)).accounts({
	user: alice.publicKey, veTokenAccount: ata(veMint(ID), alice.publicKey), destinationTokenAccount: ata(veMint(ID), bob.publicKey), destination: bob.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
}).rpc());

const exitAccounts = (id, w) => ({ user: w.publicKey, userTokenAccount: ata(MINTS.solv3, w.publicKey), tokenMint: MINTS.solv3, protocolTokenAccount: ata(MINTS.solv3, protocolKey, true), tokenProgram: TOKEN_PROGRAM_ID });
await expectFail("bob (new owner) re-votes transferred lock 1", () => vote(bob, ID, [[gaugeA, 100]]));
await expectFail("alice (original voter, no longer owner) changes the vote", () => vote(alice, ID, [[gaugeA, 50]]));
await expectFail("bob partially exits voted lock 1", () => as(bob).methods.partialExitLock(new BN(ID), new BN(10n * 10n ** 9n)).accounts(exitAccounts(ID, bob)).rpc());
{
	const newId = (await as(bob).account.protocol.fetch(protocolKey)).nextNftTokenId.toNumber();
	const mint = veMint(newId);
	const metadata = PublicKey.findProgramAddressSync([Buffer.from("metadata"), METADATA.toBuffer(), mint.toBuffer()], METADATA)[0];
	await expectFail("bob splits voted lock 1 into an exit-eligible child", () => as(bob).methods.splitLock(new BN(ID), new BN(100n * 10n ** 9n)).accounts({
		user: bob.publicKey, veLockTokenAccount: ata(veMint(ID), bob.publicKey), metadata, tokenProgram: TOKEN_PROGRAM_ID,
	}).rpc());
}
await expectFail("bob merges voted lock 1 into his unvoted lock", () => as(bob).methods.mergeLock(new BN(CONTROL), new BN(ID)).accounts({
	user: bob.publicKey, secondaryVeTokenAccount: ata(veMint(ID), bob.publicKey), tokenProgram: TOKEN_PROGRAM_ID,
}).rpc());
await expectOk("CONTROL: bob partially exits his unvoted lock (accounts are right)", () => as(bob).methods.partialExitLock(new BN(CONTROL), new BN(10n * 10n ** 9n)).accounts(exitAccounts(CONTROL, bob)).rpc());
