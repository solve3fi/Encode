#!/usr/bin/env node
// Prints the protocol epoch clock; `roll` calls the permissionless update_epoch
// when the boundary has passed; `configure` runs configure_native_gauge(true)
// for every scheduled gauge whose epoch has arrived.
import { PublicKey } from "@solana/web3.js";
import { IDS, MINTS, admin, conn, loadState, pda, programFor } from "./lib.mjs";

const vesolve = programFor("vesolve");
const protocolKey = pda("vesolve", [Buffer.from("protocol")]);
const show = async () => {
	const p = await vesolve.account.protocol.fetch(protocolKey);
	const now = Math.floor(Date.now() / 1000);
	const start = p.epochStartTime.toNumber();
	const len = p.epochResetTime.toNumber();
	const dueIn = start + len - now;
	console.log(`epoch ${p.currentEpoch.toString()} started ${start} (${len}s long); next boundary in ${dueIn}s`);
	return { p, dueIn };
};
const cmd = process.argv[2];
let { p, dueIn } = await show();
if (cmd === "roll") {
	if (dueIn > 0) {
		console.log("boundary not reached yet");
	} else {
		const next = p.currentEpoch.addn(1);
		const epoch = pda("vesolve", [Buffer.from("epoch_data"), next.toArrayLike(Buffer, "le", 8)]);
		console.log("update_epoch", await vesolve.methods.updateEpoch().accounts({ caller: admin.publicKey, protocol: protocolKey, epoch }).rpc());
		await show();
	}
}
if (cmd === "configure") {
	const state = loadState();
	for (const key of ["solv3_tusdc", "tsol_tusdc"]) {
		const s = state[key];
		const pool = new PublicKey(s.pool);
		try {
			console.log(key, "configure_native_gauge(true)", await vesolve.methods.configureNativeGauge(true).accounts({
				admin: admin.publicKey, solvesConfig: new PublicKey(state.config), pool, tokenMintA: new PublicKey(s.mintA), tokenMintB: new PublicKey(s.mintB), rewardMint: MINTS.solv3, solveProgram: IDS.solve,
			}).rpc());
		} catch (e) {
			console.log(key, "configure failed:", String(e.message ?? e).split("\n").slice(0, 6).join(" | "));
		}
	}
}
