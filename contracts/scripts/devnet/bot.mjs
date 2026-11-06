#!/usr/bin/env node
// Keeps both pools trading (tiny alternating swaps by bob) until the epoch
// ends, so every fast-epoch gate bucket is productive.
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { MINTS, loadState, pda, programFor, wallet } from "./lib.mjs";

const state = loadState();
const bob = wallet("bob");
const solve = programFor("solve", bob);
const vesolve = programFor("vesolve");
const SPAN = 88 * 64;
const protocolKey = pda("vesolve", [Buffer.from("protocol")]);
const untilArg = Number(process.argv[2] ?? 0);
const keys = ["solv3_tusdc", "tsol_tusdc"];
let n = 0, ok = 0, fail = 0;
const tickArrayKey = (pool, start) => pda("solve", [Buffer.from("tick_array"), pool.toBuffer(), Buffer.from(String(start))]);
const end = async () => {
	if (untilArg) return untilArg;
	const p = await vesolve.account.protocol.fetch(protocolKey);
	return p.epochStartTime.toNumber() + p.epochResetTime.toNumber();
};
const stopAt = (await end()) - 6;
console.log("bot until", stopAt, "now", Math.floor(Date.now() / 1000));
while (Math.floor(Date.now() / 1000) < stopAt) {
	for (const key of keys) {
		const s = state[key];
		const pool = new PublicKey(s.pool);
		const usdcIsB = s.mintB === MINTS.tusdc.toBase58();
		const aToB = n % 2 === 0;
		try {
			const acct = await solve.account.solve.fetch(pool);
			const held = Math.floor(acct.tickCurrentIndex / SPAN) * SPAN;
			const dir = aToB ? -1 : 1;
			const arrays = [held, held + dir * SPAN, held + 2 * dir * SPAN].map((st) => tickArrayKey(pool, st));
			const amount = aToB ? (key === "solv3_tusdc" ? 2_500_000_000_000n : 3_000_000_000n) : 500_000_000n; // ~$500 each way
			await solve.methods.swap(new BN(amount.toString()), new BN(0), new BN(aToB ? "4295048016" : "79226673515401279992447579055"), true, aToB).accounts({
				tokenAuthority: bob.publicKey, solve: pool,
				tokenOwnerAccountA: getAssociatedTokenAddressSync(new PublicKey(s.mintA), bob.publicKey), tokenVaultA: new PublicKey(s.vaultA),
				tokenOwnerAccountB: getAssociatedTokenAddressSync(new PublicKey(s.mintB), bob.publicKey), tokenVaultB: new PublicKey(s.vaultB),
				tickArray0: arrays[0], tickArray1: arrays[1], tickArray2: arrays[2], solvesConfig: new PublicKey(state.config),
			}).rpc();
			ok++;
		} catch (e) {
			fail++;
			if (fail < 4) console.log(key, "swap failed:", String(e.message ?? e).split("\n").slice(0, 3).join(" | "));
		}
	}
	n++;
}
console.log(`bot done: ${ok} swaps ok, ${fail} failed`);
