#!/usr/bin/env node
// Voter bribe claims for a finished epoch (default 1). Expected shares come from
// the epoch-1 vote weights recorded in the evidence file.
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { MINTS, conn, loadState, pda, programFor, wallet } from "./lib.mjs";

const EP = Number(process.argv[2] ?? 1);
const st = loadState();
const protocolKey = pda("vesolve", [Buffer.from("protocol")]);
const u64 = (n) => new BN(n).toArrayLike(Buffer, "le", 8);
const epoch = pda("vesolve", [Buffer.from("epoch_data"), u64(EP)]);
const gaugeOf = (key) => pda("vesolve", [Buffer.from("gauge"), protocolKey.toBuffer(), new PublicKey(st[key].pool).toBuffer()]);
const vaultOf = (gauge) => pda("vesolve", [Buffer.from("vault"), u64(EP), gauge.toBuffer()]);
const bal = async (owner) => {
	try { return BigInt((await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(MINTS.bribe, owner.publicKey))).value.amount); } catch { return 0n; }
};
// [claimer, lock id, gauge key, expected raw bribe amount]
const A = 1000_000_000n, B = 500_000_000n;
const plan = [
	["alice", 1, "solv3_tusdc", (A * 2_000_000n) / 2_280_000n],
	["bob", 2, "solv3_tusdc", (A * 280_000n) / 2_280_000n],
	["bob", 2, "tsol_tusdc", (B * 120_000n) / 1_320_000n],
	["bob", 3, "tsol_tusdc", (B * 400_000n) / 1_320_000n],
	["carol", 4, "tsol_tusdc", (B * 800_000n) / 1_320_000n],
];
const extra = process.argv[3] === "wrong-owner" ? [["carol", 1, "solv3_tusdc", 0n]] : [];
for (const [who, id, key, expected] of [...plan, ...extra]) {
	const w = wallet(who);
	const gauge = gaugeOf(key);
	const before = await bal(w);
	try {
		const sig = await programFor("vesolve", w).methods.claimBribeReward(new BN(id)).accounts({
			user: w.publicKey, gauge, epoch, vault: vaultOf(gauge), tokenMint: MINTS.bribe, bribeToken: pda("vesolve", [Buffer.from("bribe_token"), MINTS.bribe.toBuffer()]), tokenProgram: TOKEN_PROGRAM_ID,
		}).rpc();
		const got = (await bal(w)) - before;
		const note = got === expected ? "exact" : `expected ${expected}`;
		console.log(`${who} lock ${id} ${key}: +${got} (${note}) ${sig.slice(0, 12)}`);
	} catch (e) {
		const t = JSON.stringify(e.logs ?? []) + String(e.message ?? e);
		console.log(`${who} lock ${id} ${key}: REFUSED ${(t.match(/Error Code: (\w+)/) ?? [null, t.slice(0, 100)])[1]}`);
	}
}
