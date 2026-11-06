#!/usr/bin/env node
// Voters claim the trading fees routed into a finished epoch's vault (default 7).
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { conn, loadState, pda, programFor, wallet } from "./lib.mjs";

const EP = Number(process.argv[2] ?? 7);
const st = loadState();
const protocol = pda("vesolve", [Buffer.from("protocol")]);
const u64 = (n) => new BN(n).toArrayLike(Buffer, "le", 8);
const epoch = pda("vesolve", [Buffer.from("epoch_data"), u64(EP)]);
const ata = (m, o, off = false) => getAssociatedTokenAddressSync(m, o, off);
const tokenBal = async (a) => { try { return BigInt((await conn.getTokenAccountBalance(a)).value.amount); } catch { return 0n; } };
// weights of the epoch's votes: gauge A total 2,280,000, gauge B total 1,320,000 (SOLV3 units)
const W = { solv3_tusdc: 2_680_000n, tsol_tusdc: 920_000n };
const plan = [
	["alice", 1, "solv3_tusdc", 2_000_000n], ["bob", 2, "solv3_tusdc", 280_000n], ["bob", 3, "solv3_tusdc", 400_000n],
	["bob", 2, "tsol_tusdc", 120_000n], ["carol", 4, "tsol_tusdc", 800_000n],
];
const initial = {};
for (const [who, id, key, weight] of plan) {
	const w = wallet(who);
	const s = st[key];
	const pool = new PublicKey(s.pool);
	const gauge = pda("vesolve", [Buffer.from("gauge"), protocol.toBuffer(), pool.toBuffer()]);
	const vault = pda("vesolve", [Buffer.from("vault"), u64(EP), gauge.toBuffer()]);
	const mintA = new PublicKey(s.mintA), mintB = new PublicKey(s.mintB);
	const [ua, ub] = [ata(mintA, w.publicKey), ata(mintB, w.publicKey)];
	await sendAndConfirmTransaction(conn, new Transaction().add(
		createAssociatedTokenAccountIdempotentInstruction(w.publicKey, ua, w.publicKey, mintA),
		createAssociatedTokenAccountIdempotentInstruction(w.publicKey, ub, w.publicKey, mintB)), [w]);
	initial[key] ??= [await tokenBal(ata(mintA, vault, true)), await tokenBal(ata(mintB, vault, true))];
	const [vA, vB] = initial[key];
	const [bA, bB] = [await tokenBal(ua), await tokenBal(ub)];
	try {
		const sig = await programFor("vesolve", w).methods.claimPoolReward(new BN(id), 3).accounts({
			user: w.publicKey, gauge, epoch, vault, tokenMintA: mintA, userTokenAccountA: ua, tokenMintB: mintB, userTokenAccountB: ub, tokenProgram: TOKEN_PROGRAM_ID,
		}).rpc();
		const [gA, gB] = [(await tokenBal(ua)) - bA, (await tokenBal(ub)) - bB];
		const [eA, eB] = [(vA * weight) / W[key], (vB * weight) / W[key]];
		console.log(`${who} lock ${id} ${key}: A +${gA} (exp ${eA}${gA === eA ? " exact" : " MISMATCH"}) B +${gB} (exp ${eB}${gB === eB ? " exact" : " MISMATCH"}) ${sig.slice(0, 10)}`);
	} catch (e) {
		const t = JSON.stringify(e.logs ?? []) + String(e.message ?? e);
		console.log(`${who} lock ${id} ${key}: REFUSED ${(t.match(/Error Code: (\w+)/) ?? [null, t.slice(0, 120)])[1]}`);
	}
}
