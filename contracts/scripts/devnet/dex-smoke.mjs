#!/usr/bin/env node
// Devnet smoke test of the Apache solve program: swaps both ways on a seeded pool as the admin
// wallet and prints balances and the pool's fee accounting before and after. Read the output.
//   node dex-smoke.mjs tsol_tusdc
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { admin, conn, loadState, pda, programFor } from "./lib.mjs";

const key = process.argv[2] ?? "tsol_tusdc";
const state = loadState();
const s = state[key];
if (!s) throw new Error(`pool ${key} not in deploy-out/state.json`);
const solve = programFor("solve", admin);
const pool = new PublicKey(s.pool);
const SPAN = 88 * 64;
const ata = (m) => getAssociatedTokenAddressSync(new PublicKey(m), admin.publicKey);
const tickArrayKey = (start) => pda("solve", [Buffer.from("tick_array"), pool.toBuffer(), Buffer.from(String(start))]);
const bal = async (m) => BigInt((await conn.getTokenAccountBalance(ata(m))).value.amount);
const show = async (label) => {
	const p = await solve.account.solve.fetch(pool);
	const [a, b] = [await bal(s.mintA), await bal(s.mintB)];
	console.log(label, JSON.stringify({
		tick: p.tickCurrentIndex, liquidity: p.liquidity.toString(), feeRate: p.feeRate, protocolFeeRate: p.protocolFeeRate,
		feeGrowthA: p.feeGrowthGlobalA.toString(), feeGrowthB: p.feeGrowthGlobalB.toString(),
		protocolOwedA: p.protocolFeeOwedA.toString(), protocolOwedB: p.protocolFeeOwedB.toString(), userA: a.toString(), userB: b.toString(),
	}));
	return { p, a, b };
};
const swap = async (amount, aToB) => {
	const p = await solve.account.solve.fetch(pool);
	const held = Math.floor(p.tickCurrentIndex / SPAN) * SPAN;
	const dir = aToB ? -1 : 1;
	const arrays = [held, held + dir * SPAN, held + 2 * dir * SPAN].map(tickArrayKey);
	return solve.methods
		.swap(new BN(amount.toString()), new BN(0), new BN(aToB ? "4295048016" : "79226673515401279992447579055"), true, aToB)
		.accounts({
			tokenAuthority: admin.publicKey, solve: pool,
			tokenOwnerAccountA: ata(s.mintA), tokenVaultA: new PublicKey(s.vaultA),
			tokenOwnerAccountB: ata(s.mintB), tokenVaultB: new PublicKey(s.vaultB),
			tickArray0: arrays[0], tickArray1: arrays[1], tickArray2: arrays[2], solvesConfig: new PublicKey(state.config),
			oracle: pda("solve", [Buffer.from("oracle"), pool.toBuffer()]),
		})
		.rpc();
};
const before = await show("before");
console.log("swap A->B", await swap(1_000_000_000n, true));
const mid = await show("after A->B");
console.log("swap B->A", await swap(100_000_000n, false));
const after = await show("after B->A");
const ok = mid.a < before.a && mid.b > before.b && after.a > mid.a && after.b < mid.b && after.p.protocolFeeOwedA.gt(before.p.protocolFeeOwedA);
console.log(ok ? "PASS swaps move balances both ways and protocol fees accrue" : "FAIL unexpected balances/fees");
process.exit(ok ? 0 : 1);
