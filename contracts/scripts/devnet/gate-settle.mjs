#!/usr/bin/env node
// set_gate_threshold(ppm) then settle_native_gauge_unearned for both gauges,
// printing SOLV3 supply and vault balances before/after.
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { IDS, MINTS, admin, conn, loadState, pda, programFor } from "./lib.mjs";

const ppm = Number(process.argv[2] ?? 2);
const v = programFor("vesolve");
const st = loadState();
const protocol = pda("vesolve", [Buffer.from("protocol")]);
const supply = async () => (await conn.getTokenSupply(MINTS.solv3)).value.uiAmountString;
console.log("supply before", await supply());
if (ppm >= 0) console.log("set_gate_threshold", ppm, await v.methods.setGateThreshold(ppm).accounts({ admin: admin.publicKey }).rpc());
for (const key of ["solv3_tusdc", "tsol_tusdc"]) {
	const s = st[key];
	const pool = new PublicKey(s.pool);
	const gauge = pda("vesolve", [Buffer.from("gauge"), protocol.toBuffer(), pool.toBuffer()]);
	const r = await v.methods.configureNativeGauge(true).accounts({
		admin: admin.publicKey, solvesConfig: new PublicKey(st.config), pool, tokenMintA: new PublicKey(s.mintA), tokenMintB: new PublicKey(s.mintB), rewardMint: MINTS.solv3, solveProgram: IDS.solve,
	}).pubkeys();
	const vb = async () => (await conn.getTokenAccountBalance(r.rewardVault)).value.uiAmountString;
	console.log(key, "vault before", await vb());
	try {
		console.log(key, "settle_native_gauge_unearned", await v.methods.settleNativeGaugeUnearned().accounts({
			caller: admin.publicKey, gauge, nativeGauge: r.nativeGauge, pool, rewardMint: MINTS.solv3, rewardVault: r.rewardVault, solveProgram: IDS.solve, tokenProgram: TOKEN_PROGRAM_ID,
		}).rpc());
	} catch (e) {
		console.log(key, "settle FAILED", String(e.message ?? e).split("\n").slice(0, 6).join(" | "));
	}
	console.log(key, "vault after", await vb());
}
console.log("supply after", await supply());
