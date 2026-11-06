#!/usr/bin/env node
// Is enroll_auto_vote gated? An ordinary lock owner (carol, lock 4) enrolls, then revokes.
import { BN } from "@coral-xyz/anchor";
import { conn, pda, programFor, wallet } from "./lib.mjs";
const carol = wallet("carol");
const v = programFor("vesolve", carol);
const retry = async (fn) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 4 || !/Blockhash|429|not confirmed/.test(String(e.message ?? e))) throw e; } } };
const enrollment = pda("vesolve", [Buffer.from("auto_vote"), pda("vesolve", [Buffer.from("ve_lock"), new BN(4).toArrayLike(Buffer, "le", 8)]).toBuffer()]);
try {
	console.log("enroll_auto_vote by an ordinary lock owner:", (await retry(() => v.methods.enrollAutoVote(new BN(4)).accounts({ owner: carol.publicKey }).rpc())).slice(0, 12), "-> SUCCEEDED (not admin-gated)");
	console.log("enrollment account exists:", !!(await conn.getAccountInfo(enrollment)));
} catch (e) { console.log("enroll refused:", String(e.message ?? e).slice(0, 160)); }
try { console.log("revoke_auto_vote:", (await retry(() => v.methods.revokeAutoVote(new BN(4)).accounts({ owner: carol.publicKey }).rpc())).slice(0, 12)); } catch (e) { console.log("revoke:", String(e.message ?? e).slice(0, 120)); }
console.log("enrollment account after revoke:", !!(await conn.getAccountInfo(enrollment)) ? "still exists" : "closed");
