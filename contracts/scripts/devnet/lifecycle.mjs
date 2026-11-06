#!/usr/bin/env node
// Gauge lifecycle on the tSOL/tUSDC gauge: request | bribe | deactivate | relist | reactivate | status
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { IDS, MINTS, admin, conn, loadState, pda, programFor, sortMints, wallet } from "./lib.mjs";

const cmd = process.argv[2];
const key = process.argv[3] ?? "tsol_tusdc";
const st = loadState();
const s = st[key];
const v = programFor("vesolve");
const protocol = pda("vesolve", [Buffer.from("protocol")]);
const pool = new PublicKey(s.pool);
const gauge = pda("vesolve", [Buffer.from("gauge"), protocol.toBuffer(), pool.toBuffer()]);
const mintA = new PublicKey(s.mintA), mintB = new PublicKey(s.mintB);
const code = (e) => { const t = JSON.stringify(e.logs ?? []) + String(e.message ?? e); return (t.match(/Error Code: (\w+)/) ?? [null, t.slice(0, 140)])[1]; };
const cfgAccounts = { admin: admin.publicKey, solvesConfig: new PublicKey(st.config), pool, tokenMintA: mintA, tokenMintB: mintB, rewardMint: MINTS.solv3, solveProgram: IDS.solve };
const poolState = async () => { const p = await programFor("solve").account.solve.fetch(pool); return `protocolFeeRate ${p.protocolFeeRate} owedA ${p.protocolFeeOwedA} owedB ${p.protocolFeeOwedB}`; };
const gaugeState = async () => { const g = await v.account.gauge.fetch(gauge); return `status ${g.status} generation ${g.generation} effectiveEpoch ${g.effectiveEpoch}`; };

if (cmd === "status") console.log(key, await gaugeState(), "|", await poolState());
if (cmd === "request") {
	console.log("before:", await gaugeState());
	console.log("request_gauge_removal", await v.methods.requestGaugeRemoval().accounts({ admin: admin.publicKey, gauge }).rpc());
	console.log("after:", await gaugeState());
}
if (cmd === "bribe") {
	const alice = wallet("alice");
	try {
		const sig = await programFor("vesolve", alice).methods.createBribe(new BN(100_000_000)).accounts({
			user: alice.publicKey, gauge, tokenMint: MINTS.bribe, userTokenAccount: getAssociatedTokenAddressSync(MINTS.bribe, alice.publicKey), tokenProgram: TOKEN_PROGRAM_ID,
		}).rpc();
		console.log("FAIL  bribe on a gauge pending removal was accepted", sig);
	} catch (e) { console.log("PASS  new bribe refused after removal request:", code(e)); }
}
if (cmd === "deactivate") {
	console.log("before:", await gaugeState(), "|", await poolState());
	try { console.log("configure_native_gauge(false)", await v.methods.configureNativeGauge(false).accounts(cfgAccounts).rpc()); } catch (e) { console.log("deactivate refused:", code(e)); }
	console.log("after:", await gaugeState(), "|", await poolState());
}
if (cmd === "relist") {
	const [lo, hi] = sortMints(mintA, mintB);
	console.log("schedule_gauge_activation", await v.methods.scheduleGaugeActivation(lo, hi).accounts({ admin: admin.publicKey, gauge, pool, occupant: null }).rpc());
	console.log("after:", await gaugeState());
}
if (cmd === "reactivate") {
	console.log("configure_native_gauge(true)", await v.methods.configureNativeGauge(true).accounts(cfgAccounts).rpc());
	console.log("after:", await gaugeState(), "|", await poolState());
}
if (cmd === "sweep") {
	const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID: TP, ASSOCIATED_TOKEN_PROGRAM_ID: ATP } = await import("@solana/spl-token");
	const { SystemProgram } = await import("@solana/web3.js");
	const treasury = new PublicKey("HRmz8NhLJDXYiSyR6STzBkofJZGb9ZMbbEh3rMHRVXNV");
	const bal = async (m) => { try { return BigInt((await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(m, treasury, true))).value.amount); } catch { return 0n; } };
	console.log("before:", await poolState());
	const [a0, b0] = [await bal(mintA), await bal(mintB)];
	console.log("sweep_ungauged_pool_fees", (await v.methods.sweepUngaugedPoolFees().accounts({
		admin: admin.publicKey, solvesConfig: new PublicKey(st.config), pool, tokenMintA: mintA, tokenMintB: mintB,
		tokenVaultA: new PublicKey(s.vaultA), tokenVaultB: new PublicKey(s.vaultB), treasury, solveProgram: IDS.solve,
		tokenProgram: TP, associatedTokenProgram: ATP, systemProgram: SystemProgram.programId,
	}).rpc()).slice(0, 12));
	console.log("after:", await poolState());
	console.log("Treasury received A", (await bal(mintA)) - a0, "B", (await bal(mintB)) - b0);
}
