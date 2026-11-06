#!/usr/bin/env node
// Independent pause switches (spec F2): each switch must stop only its own system and be reversible.
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { MINTS, admin, loadState, pda, programFor, wallet } from "./lib.mjs";

const st = loadState();
const v = programFor("vesolve");
const protocol = pda("vesolve", [Buffer.from("protocol")]);
const u64 = (n) => new BN(n).toArrayLike(Buffer, "le", 8);
const epochNo = (await v.account.protocol.fetch(protocol)).currentEpoch;
const epoch = pda("vesolve", [Buffer.from("epoch_data"), u64(epochNo)]);
const gaugeA = pda("vesolve", [Buffer.from("gauge"), protocol.toBuffer(), new PublicKey(st.solv3_tusdc.pool).toBuffer()]);
const bob = wallet("bob"), alice = wallet("alice");
const none = { global: false, voting: false, bribes: false, claims: false, exit: false, gaugeActivation: false, emissions: false };
const flaky = (e) => /Blockhash not found|429|not confirmed|expired/i.test(String(e.message ?? e));
const retry = async (fn) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 4 || !flaky(e)) throw e; } } };
const setPauses = (over) => retry(() => v.methods.setPauses({ ...none, ...over }).accounts({ admin: admin.publicKey }).rpc());
const code = (e) => { const t = JSON.stringify(e.logs ?? []) + String(e.message ?? e); return (t.match(/Error Code: (\w+)/) ?? [null, t.slice(0, 120)])[1]; };
const tryVote = () => programFor("vesolve", bob).methods.vote(new BN(3), [{ gauge: gaugeA, weight: new BN(100) }]).accounts({ user: bob.publicKey, epoch, autoVoteEnrollment: null, allocationVoter: null }).remainingAccounts([{ pubkey: gaugeA, isSigner: false, isWritable: true }]).rpc();
const tryBribe = () => programFor("vesolve", alice).methods.createBribe(new BN(10_000_000)).accounts({ user: alice.publicKey, gauge: gaugeA, tokenMint: MINTS.bribe, userTokenAccount: getAssociatedTokenAddressSync(MINTS.bribe, alice.publicKey), tokenProgram: TOKEN_PROGRAM_ID }).rpc();
const expect = async (label, fn, shouldFail) => {
	try { await retry(fn); console.log(`${shouldFail ? "FAIL" : "PASS"}  ${label}: ${shouldFail ? "succeeded but should be refused" : "works"}`); }
	catch (e) { console.log(`${shouldFail ? "PASS" : "FAIL"}  ${label}: ${shouldFail ? "refused with " + code(e) : "unexpectedly refused " + code(e)}`); }
};
await expect("baseline: vote works with nothing paused", tryVote, false);
await setPauses({ voting: true });
await expect("voting paused: vote refused", tryVote, true);
await expect("voting paused: bribe still works (independent)", tryBribe, false);
await setPauses({ bribes: true });
await expect("bribes paused: bribe refused", tryBribe, true);
await expect("bribes paused: vote works again (independent)", tryVote, false);
await setPauses({ global: true });
await expect("global pause: vote refused", tryVote, true);
await expect("global pause: bribe refused", tryBribe, true);
await setPauses({});
await expect("all unpaused: vote works", tryVote, false);
await expect("all unpaused: bribe works", tryBribe, false);
