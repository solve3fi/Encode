#!/usr/bin/env node
// Remaining independent pauses: claims, exit, emissions, gauge activation. Always unpauses at the end.
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { MINTS, admin, loadState, pda, programFor, sortMints, wallet } from "./lib.mjs";

const st = loadState();
const v = programFor("vesolve");
const protocol = pda("vesolve", [Buffer.from("protocol")]);
const u64 = (n) => new BN(n).toArrayLike(Buffer, "le", 8);
const epochNo = (await v.account.protocol.fetch(protocol)).currentEpoch;
const bob = wallet("bob");
const none = { global: false, voting: false, bribes: false, claims: false, exit: false, gaugeActivation: false, emissions: false };
const flaky = (e) => /Blockhash not found|429|not confirmed|expired/i.test(String(e.message ?? e));
const retry = async (fn) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 4 || !flaky(e)) throw e; } } };
const setPauses = (over) => retry(() => v.methods.setPauses({ ...none, ...over }).accounts({ admin: admin.publicKey }).rpc());
const code = (e) => { const t = JSON.stringify(e.logs ?? []) + String(e.message ?? e); return (t.match(/Error Code: (\w+)/) ?? [null, "NO ANCHOR CODE " + t.slice(-120)])[1]; };
const check = async (label, fn, shouldFail) => {
	try { await retry(fn); console.log(`${shouldFail ? "FAIL" : "PASS"}  ${label}: ${shouldFail ? "succeeded but should be refused" : "works"}`); }
	catch (e) { const c = code(e); console.log(`${shouldFail && c === "SystemPaused" ? "PASS" : "FAIL"}  ${label}: ${shouldFail ? "refused with " + c : "unexpectedly refused " + c}`); }
};
const poolA = new PublicKey(st.solv3_tusdc.pool);
const gaugeA = pda("vesolve", [Buffer.from("gauge"), protocol.toBuffer(), poolA.toBuffer()]);
const poolB = new PublicKey(st.tsol_tusdc.pool);
const gaugeB = pda("vesolve", [Buffer.from("gauge"), protocol.toBuffer(), poolB.toBuffer()]);
const EP = 4; // epoch whose bribes (gauge A) are now claimable
const claim = () => programFor("vesolve", bob).methods.claimBribeReward(new BN(2)).accounts({
	user: bob.publicKey, gauge: gaugeA, epoch: pda("vesolve", [Buffer.from("epoch_data"), u64(EP)]), vault: pda("vesolve", [Buffer.from("vault"), u64(EP), gaugeA.toBuffer()]),
	tokenMint: MINTS.bribe, bribeToken: pda("vesolve", [Buffer.from("bribe_token"), MINTS.bribe.toBuffer()]), tokenProgram: TOKEN_PROGRAM_ID,
}).rpc();
const exit = () => programFor("vesolve", bob).methods.partialExitLock(new BN(5), new BN(10n ** 9n)).accounts({
	user: bob.publicKey, userTokenAccount: getAssociatedTokenAddressSync(MINTS.solv3, bob.publicKey), tokenMint: MINTS.solv3, protocolTokenAccount: getAssociatedTokenAddressSync(MINTS.solv3, protocol, true), tokenProgram: TOKEN_PROGRAM_ID,
}).rpc();
const emission = () => {
	const votingEpoch = pda("vesolve", [Buffer.from("epoch_data"), u64(epochNo.subn(1))]);
	return v.methods.initializeEpochEmission(epochNo).accounts({
		caller: admin.publicKey, votingEpoch, epochEmission: pda("vesolve", [Buffer.from("epoch_emission"), u64(epochNo)]), developerWallet: admin.publicKey, tokenMint: MINTS.solv3,
		developerTokenAccount: getAssociatedTokenAddressSync(MINTS.solv3, admin.publicKey), tokenProgram: TOKEN_PROGRAM_ID,
	}).rpc();
};
const [lo, hi] = sortMints(new PublicKey(st.tsol_tusdc.mintA), new PublicKey(st.tsol_tusdc.mintB));
const activation = () => v.methods.scheduleGaugeActivation(lo, hi).accounts({ admin: admin.publicKey, gauge: gaugeB, pool: poolB, occupant: null }).rpc();

try {
	await setPauses({ claims: true });
	await check("claims paused: bribe claim refused", claim, true);
	await check("claims paused: exit still works (independent)", exit, false);
	await setPauses({ exit: true });
	await check("exit paused: partial exit refused", exit, true);
	await check("exit paused: claims work again (independent)", claim, false);
	await setPauses({ emissions: true });
	await check("emissions paused: initialize_epoch_emission refused", emission, true);
	await setPauses({ gaugeActivation: true });
	await check("gauge-activation paused: schedule_gauge_activation refused", activation, true);
	await setPauses({});
	await check("all unpaused: initialize_epoch_emission works (or already initialised)", async () => { try { await emission(); } catch (e) { if (code(e) !== "NO ANCHOR CODE" && !/already in use|0x0/.test(String(e.message ?? e) + JSON.stringify(e.logs ?? []))) throw e; } }, false);
} finally {
	await setPauses({});
	console.log("all pauses cleared");
}
