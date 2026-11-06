#!/usr/bin/env node
// Native emissions for the current epoch: initialize_epoch_emission then
// fund_native_gauge for both gauges. Votes of epoch N-1 fund epoch N.
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { IDS, MINTS, admin, conn, loadState, pda, programFor } from "./lib.mjs";

const v = programFor("vesolve");
const state = loadState();
const protocolKey = pda("vesolve", [Buffer.from("protocol")]);
const proto = await v.account.protocol.fetch(protocolKey);
const emissionEpoch = proto.currentEpoch;
const u64 = (n) => new BN(n).toArrayLike(Buffer, "le", 8);
const votingEpoch = pda("vesolve", [Buffer.from("epoch_data"), u64(emissionEpoch.subn(1))]);
const epochEmission = pda("vesolve", [Buffer.from("epoch_emission"), u64(emissionEpoch)]);
const devAta = getAssociatedTokenAddressSync(MINTS.solv3, admin.publicKey);
await sendAndConfirmTransaction(conn, new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, devAta, admin.publicKey, MINTS.solv3)), [admin]);

try {
	console.log("initialize_epoch_emission", emissionEpoch.toString(), await v.methods.initializeEpochEmission(emissionEpoch).accounts({
		caller: admin.publicKey, votingEpoch, epochEmission, developerWallet: admin.publicKey, tokenMint: MINTS.solv3, developerTokenAccount: devAta, tokenProgram: TOKEN_PROGRAM_ID,
	}).rpc());
} catch (e) {
	console.log("init emission:", String(e.message ?? e).split("\n").slice(0, 5).join(" | "));
}
for (const key of ["solv3_tusdc", "tsol_tusdc"]) {
	const s = state[key];
	const pool = new PublicKey(s.pool);
	const gauge = pda("vesolve", [Buffer.from("gauge"), protocolKey.toBuffer(), pool.toBuffer()]);
	const resolved = await v.methods.configureNativeGauge(true).accounts({
		admin: admin.publicKey, solvesConfig: new PublicKey(state.config), pool, tokenMintA: new PublicKey(s.mintA), tokenMintB: new PublicKey(s.mintB), rewardMint: MINTS.solv3, solveProgram: IDS.solve,
	}).pubkeys();
	try {
		console.log(key, "fund_native_gauge", await v.methods.fundNativeGauge(emissionEpoch).accounts({
			caller: admin.publicKey, votingEpoch, epochEmission, gauge, nativeGauge: resolved.nativeGauge, pool, rewardMint: MINTS.solv3, rewardVault: resolved.rewardVault, solveProgram: IDS.solve, tokenProgram: TOKEN_PROGRAM_ID,
		}).rpc());
		const bal = await conn.getTokenAccountBalance(resolved.rewardVault);
		console.log(key, "reward vault now", bal.value.uiAmountString, "SOLV3");
	} catch (e) {
		console.log(key, "fund FAILED", String(e.message ?? e).split("\n").slice(0, 8).join(" | "));
	}
}
const supply = await conn.getTokenSupply(MINTS.solv3);
console.log("SOLV3 supply", supply.value.uiAmountString);
