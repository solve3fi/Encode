#!/usr/bin/env node
// Exit: partial exit of an unvoted lock charges 40% of value in SOL into the protocol PDA;
// fees can only be withdrawn to the Treasury.
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { MINTS, admin, conn, loadState, pda, programFor, wallet } from "./lib.mjs";

const st = loadState();
const LOCK = st.controlLock; // bob's unvoted control lock
const bob = wallet("bob");
const TREASURY = new PublicKey("HRmz8NhLJDXYiSyR6STzBkofJZGb9ZMbbEh3rMHRVXNV");
const protocol = pda("vesolve", [Buffer.from("protocol")]);
const v = programFor("vesolve", bob);
const code = (e) => { const t = JSON.stringify(e.logs ?? []) + String(e.message ?? e); return (t.match(/Error Code: (\w+)/) ?? [null, t.slice(0, 140)])[1]; };
const bal = (k) => conn.getBalance(k, "confirmed");
const solv3 = async (o) => BigInt((await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(MINTS.solv3, o))).value.amount);
const amount = 20n * 10n ** 9n;
const price = 1_333_333n; // lamports per SOLV3 (exit_config)
const feeCfg = await programFor("vesolve").account.exitFeeConfig.fetch(pda("vesolve", [Buffer.from("exit_fee_config")]));
const epochNow = (await programFor("vesolve").account.protocol.fetch(protocol)).currentEpoch.toNumber();
const bps = BigInt(feeCfg.pendingEpoch.toNumber() !== 0 && epochNow >= feeCfg.pendingEpoch.toNumber() ? feeCfg.pendingBps.toString() : feeCfg.feeBps.toString());
const expectedFee = ((((amount * price) / 10n ** 9n) * bps) + 9_999n) / 10_000n; // rounds up
console.log("effective exit fee:", bps.toString(), "bps");
const [p0, b0, s0] = [await bal(protocol), await bal(bob.publicKey), await solv3(bob.publicKey)];
const sig = await v.methods.partialExitLock(new BN(LOCK), new BN(amount.toString())).accounts({
	user: bob.publicKey, userTokenAccount: getAssociatedTokenAddressSync(MINTS.solv3, bob.publicKey), tokenMint: MINTS.solv3, protocolTokenAccount: getAssociatedTokenAddressSync(MINTS.solv3, protocol, true), tokenProgram: TOKEN_PROGRAM_ID,
}).rpc();
const [p1, b1, s1] = [await bal(protocol), await bal(bob.publicKey), await solv3(bob.publicKey)];
console.log("partial_exit_lock", LOCK, "20 SOLV3", sig.slice(0, 12));
console.log("liquid SOLV3 received:", (s1 - s0).toString(), amount === s1 - s0 ? "(exact)" : "MISMATCH");
console.log("fee paid into protocol PDA (lamports):", p1 - p0, "expected", expectedFee.toString(), BigInt(p1 - p0) === expectedFee ? "(exact)" : "MISMATCH");
console.log("bob SOL spent:", b0 - b1, "= fee + tx fee", b0 - b1 - Number(expectedFee));
// withdrawals
const t0 = await bal(TREASURY);
try {
	await programFor("vesolve", admin).methods.withdrawExitFees(new BN(expectedFee.toString())).accounts({ admin: admin.publicKey, destination: admin.publicKey }).rpc();
	console.log("FAIL  fees withdrawn to a non-Treasury destination");
} catch (e) { console.log("PASS  withdraw to a non-Treasury destination refused:", code(e)); }
await programFor("vesolve", admin).methods.withdrawExitFees(new BN(expectedFee.toString())).accounts({ admin: admin.publicKey, destination: TREASURY }).rpc();
const t1 = await bal(TREASURY);
console.log("Treasury received (lamports):", t1 - t0, BigInt(t1 - t0) === expectedFee ? "(exact)" : "MISMATCH");
