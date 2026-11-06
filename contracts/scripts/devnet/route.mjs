#!/usr/bin/env node
// route_pool_fees for the current epoch on the given gauges (default both):
// moves the pool's protocol fees into that epoch's voter vault.
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { IDS, admin, conn, loadState, pda, programFor } from "./lib.mjs";

const st = loadState();
const v = programFor("vesolve");
const protocol = pda("vesolve", [Buffer.from("protocol")]);
const epochNo = (await v.account.protocol.fetch(protocol)).currentEpoch;
const keys = process.argv.slice(2).length ? process.argv.slice(2) : ["solv3_tusdc", "tsol_tusdc"];
for (const key of keys) {
	const s = st[key];
	const pool = new PublicKey(s.pool);
	const gauge = pda("vesolve", [Buffer.from("gauge"), protocol.toBuffer(), pool.toBuffer()]);
	const vault = pda("vesolve", [Buffer.from("vault"), new BN(epochNo).toArrayLike(Buffer, "le", 8), gauge.toBuffer()]);
	const mintA = new PublicKey(s.mintA), mintB = new PublicKey(s.mintB);
	const owedA = (await programFor("solve").account.solve.fetch(pool));
	try {
		const sig = await v.methods.routePoolFees(epochNo).accounts({
			admin: admin.publicKey, gauge, solvesConfig: new PublicKey(st.config), pool, tokenMintA: mintA, tokenMintB: mintB,
			tokenVaultA: new PublicKey(s.vaultA), tokenVaultB: new PublicKey(s.vaultB),
			vaultTokenAccountA: getAssociatedTokenAddressSync(mintA, vault, true), vaultTokenAccountB: getAssociatedTokenAddressSync(mintB, vault, true),
			solveProgram: IDS.solve, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
		}).rpc();
		const a = await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(mintA, vault, true));
		const b = await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(mintB, vault, true));
		console.log(key, "route_pool_fees epoch", epochNo.toString(), "vault A", a.value.uiAmountString, "B", b.value.uiAmountString, sig.slice(0, 12));
	} catch (e) {
		const t = JSON.stringify(e.logs ?? []) + String(e.message ?? e);
		console.log(key, "route FAILED", (t.match(/Error Code: (\w+)/) ?? [null, t.slice(0, 160)])[1]);
	}
}
