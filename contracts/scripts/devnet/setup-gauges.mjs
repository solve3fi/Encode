#!/usr/bin/env node
// Devnet rehearsal: whitelist the test bribe token, set a placeholder exit
// price, create a gauge for each pool and schedule its activation (takes
// effect next epoch; run configure-gauges.mjs once that epoch has started).
import { PublicKey } from "@solana/web3.js";
import { MINTS, admin, conn, loadState, programFor, sortMints, pda } from "./lib.mjs";

const vesolve = programFor("vesolve");
const state = loadState();
const exists = async (k) => !!(await conn.getAccountInfo(k));
const protocol = pda("vesolve", [Buffer.from("protocol")]);

const bribeToken = pda("vesolve", [Buffer.from("bribe_token"), MINTS.bribe.toBuffer()]);
if (!(await exists(bribeToken))) {
	console.log("set_bribe_token", await vesolve.methods.setBribeToken(true, false).accounts({ admin: admin.publicKey, tokenMint: MINTS.bribe }).rpc());
}
const exitConfig = pda("vesolve", [Buffer.from("exit_config")]);
if (!(await exists(exitConfig))) {
	// 1,333,333 lamports per SOLV3 = $0.20 at $150/SOL; Devnet placeholder.
	console.log("set_exit_price", await vesolve.methods.setExitPrice(new (await import("@coral-xyz/anchor")).BN(1_333_333)).accounts({ admin: admin.publicKey }).rpc());
}

for (const key of ["solv3_tusdc", "tsol_tusdc"]) {
	const p = state[key];
	if (!p) throw new Error(`run setup-dex.mjs first (${key})`);
	const pool = new PublicKey(p.pool);
	const gauge = pda("vesolve", [Buffer.from("gauge"), protocol.toBuffer(), pool.toBuffer()]);
	if (!(await exists(gauge))) {
		console.log(key, "create_gauge", await vesolve.methods.createGauge(pool, new PublicKey(p.mintA), new PublicKey(p.mintB), 3000).accounts({ admin: admin.publicKey }).rpc());
	}
	const [lo, hi] = sortMints(new PublicKey(p.mintA), new PublicKey(p.mintB));
	try {
		console.log(key, "schedule_gauge_activation", await vesolve.methods.scheduleGaugeActivation(lo, hi).accounts({ admin: admin.publicKey, gauge, pool, occupant: null }).rpc());
	} catch (e) {
		console.log(key, "schedule skipped:", String(e.message ?? e).split("\n")[0]);
	}
}
