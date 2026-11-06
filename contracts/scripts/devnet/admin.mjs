#!/usr/bin/env node
// Admin command checks. Usage: node admin.mjs <exitfee-set|exitcheck|exitprice|gate|treasury|bribetoken|adminxfer> [args]
// Every step that changes a setting restores it in a finally block.
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { MINTS, admin, conn, loadState, pda, programFor, wallet } from "./lib.mjs";

const step = process.argv[2];
const st = loadState();
const bob = wallet("bob"), carol = wallet("carol"), alice = wallet("alice");
const protocol = pda("vesolve", [Buffer.from("protocol")]);
const TREASURY = new PublicKey("HRmz8NhLJDXYiSyR6STzBkofJZGb9ZMbbEh3rMHRVXNV");
const u64 = (n) => new BN(n).toArrayLike(Buffer, "le", 8);
const as = (w) => programFor("vesolve", w);
const flaky = (e) => /Blockhash not found|429|not confirmed|expired/i.test(String(e.message ?? e));
const retry = async (fn) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 4 || !flaky(e)) throw e; } } };
const code = (e) => { const t = JSON.stringify(e.logs ?? []) + String(e.message ?? e); return (t.match(/Error Code: (\w+)/) ?? [null, "NO ANCHOR CODE " + t.slice(-100)])[1]; };
const ok = (m) => console.log("PASS ", m), bad = (m) => console.log("FAIL ", m);
const refused = async (label, fn, want) => {
	try { await retry(fn); bad(`${label}: succeeded but should be refused`); }
	catch (e) { const c = code(e); (!want || c === want ? ok : bad)(`${label}: refused with ${c}${want && c !== want ? ` (expected ${want})` : ""}`); }
};
const epochNo = async () => (await as(admin).account.protocol.fetch(protocol)).currentEpoch.toNumber();
const feeCfg = () => as(admin).account.exitFeeConfig.fetch(pda("vesolve", [Buffer.from("exit_fee_config")]));
const priceCfg = () => as(admin).account.exitConfig.fetch(pda("vesolve", [Buffer.from("exit_config")]));
const setFee = (w, bps) => retry(() => as(w).methods.setExitFeeBps(new BN(bps)).accounts({ admin: w.publicKey }).rpc());
const effectiveBps = async () => { const [c, e] = [await feeCfg(), await epochNo()]; return c.pendingEpoch.toNumber() !== 0 && e >= c.pendingEpoch.toNumber() ? c.pendingBps.toNumber() : c.feeBps.toNumber(); };
const exitAccts = (w) => ({ user: w.publicKey, userTokenAccount: getAssociatedTokenAddressSync(MINTS.solv3, w.publicKey), tokenMint: MINTS.solv3, protocolTokenAccount: getAssociatedTokenAddressSync(MINTS.solv3, protocol, true), tokenProgram: TOKEN_PROGRAM_ID });
const exitFee = async (amountSolv3) => {
	const raw = BigInt(Math.round(amountSolv3 * 1e9));
	const p0 = await conn.getBalance(protocol, "confirmed");
	await retry(() => as(bob).methods.partialExitLock(new BN(st.controlLock), new BN(raw.toString())).accounts(exitAccts(bob)).rpc());
	return BigInt((await conn.getBalance(protocol, "confirmed")) - p0);
};
const expectedFee = async (amountSolv3) => {
	const raw = BigInt(Math.round(amountSolv3 * 1e9));
	const price = BigInt((await priceCfg()).lamportsPerSolv3.toString());
	const bps = BigInt(await effectiveBps());
	const value = (raw * price) / 10n ** 9n;
	const fee = (value * bps + 9_999n) / 10_000n;
	return { fee: fee === 0n ? 1n : fee, bps, price };
};

if (step === "exitfee-set") {
	const e = await epochNo();
	console.log("epoch", e, "effective exit fee now:", await effectiveBps(), "bps");
	await refused("non-admin set_exit_fee_bps", () => as(bob).methods.setExitFeeBps(new BN(2500)).accounts({ admin: bob.publicKey }).rpc(), "Unauthorized");
	await refused("fee above 100% (10001 bps)", () => as(admin).methods.setExitFeeBps(new BN(10_001)).accounts({ admin: admin.publicKey }).rpc(), "InvalidExitFee");
	const before = await effectiveBps();
	await setFee(admin, 3000);
	await setFee(admin, 2500); // second change replaces the pending one
	const c = await feeCfg();
	(c.pendingBps.toNumber() === 2500 && c.pendingEpoch.toNumber() === e + 1 && c.feeBps.toNumber() === before ? ok : bad)(
		`pending ${c.pendingBps} applies from epoch ${c.pendingEpoch} (now ${e}); a second change replaced 3000; current stays ${c.feeBps}`);
	const exp = await expectedFee(1);
	const fee = await exitFee(1);
	(fee === exp.fee ? ok : bad)(`exit in epoch ${e} still charges the current ${exp.bps} bps: ${fee} lamports (expected ${exp.fee})`);
}
if (step === "exitcheck") {
	const amount = Number(process.argv[3] ?? 1);
	const e = await epochNo();
	const exp = await expectedFee(amount);
	const fee = await exitFee(amount);
	(fee === exp.fee ? ok : bad)(`epoch ${e}: exit of ${amount} SOLV3 at ${exp.bps} bps and ${exp.price} lamports/SOLV3 charged ${fee} lamports (expected ${exp.fee})`);
}
if (step === "exitprice") {
	const orig = (await priceCfg()).lamportsPerSolv3.toString();
	const setP = (w, p) => retry(() => as(w).methods.setExitPrice(new BN(p)).accounts({ admin: w.publicKey }).rpc());
	await refused("non-admin set_exit_price", () => as(bob).methods.setExitPrice(new BN(5)).accounts({ admin: bob.publicKey }).rpc(), "Unauthorized");
	await refused("zero exit price", () => as(admin).methods.setExitPrice(new BN(0)).accounts({ admin: admin.publicKey }).rpc(), "InvalidAmount");
	try {
		await setP(admin, 2_666_666);
		const exp = await expectedFee(1);
		const fee = await exitFee(1);
		(fee === exp.fee ? ok : bad)(`price doubled to 2,666,666: exit of 1 SOLV3 charged ${fee} lamports (expected ${exp.fee} at ${exp.bps} bps)`);
	} finally { await setP(admin, orig); console.log("exit price restored to", orig); }
}
if (step === "gate") {
	const cfg = () => as(admin).account.adminConfig.fetch(pda("vesolve", [Buffer.from("admin_config")]));
	const setG = (w, v) => retry(() => as(w).methods.setGateThreshold(v).accounts({ admin: w.publicKey }).rpc());
	await refused("non-admin set_gate_threshold", () => as(bob).methods.setGateThreshold(5).accounts({ admin: bob.publicKey }).rpc(), "Unauthorized");
	await refused("gate threshold above the 10,000 ppm cap", () => as(admin).methods.setGateThreshold(10_001).accounts({ admin: admin.publicKey }).rpc(), "InvalidGateThreshold");
	try {
		await setG(admin, 10_000);
		const c = await cfg();
		(c.gatePhiSet && c.gatePhiPpm === 10_000 ? ok : bad)(`cap value accepted: gate_phi_ppm = ${c.gatePhiPpm}`);
	} finally { await setG(admin, 1); const c = await cfg(); console.log("gate threshold restored to", c.gatePhiPpm, "ppm"); }
}
if (step === "treasury") {
	const cfg = () => as(admin).account.adminConfig.fetch(pda("vesolve", [Buffer.from("admin_config")]));
	const setT = (w, t) => retry(() => as(w).methods.setTreasury(t).accounts({ admin: w.publicKey }).rpc());
	await refused("non-admin set_treasury", () => as(bob).methods.setTreasury(bob.publicKey).accounts({ admin: bob.publicKey }).rpc(), "Unauthorized");
	try {
		await setT(admin, alice.publicKey);
		(((await cfg()).treasury).equals(alice.publicKey) ? ok : bad)("Treasury changed to alice (test)");
		await refused("withdraw_exit_fees to the old Treasury now that it changed", () => as(admin).methods.withdrawExitFees(new BN(1)).accounts({ admin: admin.publicKey, destination: TREASURY }).rpc(), "InvalidTreasury");
	} finally { await setT(admin, TREASURY); console.log("Treasury restored to", ((await cfg()).treasury).toBase58().slice(0, 8)); }
}
if (step === "bribetoken") {
	const protocolAcct = protocol;
	const gaugeA = pda("vesolve", [Buffer.from("gauge"), protocolAcct.toBuffer(), new PublicKey(st.solv3_tusdc.pool).toBuffer()]);
	const EP = Number(process.argv[3] ?? 4);
	const setB = (w, allowed, paused) => retry(() => as(w).methods.setBribeToken(allowed, paused).accounts({ admin: w.publicKey, tokenMint: MINTS.bribe }).rpc());
	const claim = () => as(alice).methods.claimBribeReward(new BN(1)).accounts({
		user: alice.publicKey, gauge: gaugeA, epoch: pda("vesolve", [Buffer.from("epoch_data"), u64(EP)]), vault: pda("vesolve", [Buffer.from("vault"), u64(EP), gaugeA.toBuffer()]),
		tokenMint: MINTS.bribe, bribeToken: pda("vesolve", [Buffer.from("bribe_token"), MINTS.bribe.toBuffer()]), tokenProgram: TOKEN_PROGRAM_ID,
	}).rpc();
	const deposit = () => as(alice).methods.createBribe(new BN(1_000_000)).accounts({ user: alice.publicKey, gauge: gaugeA, tokenMint: MINTS.bribe, userTokenAccount: getAssociatedTokenAddressSync(MINTS.bribe, alice.publicKey), tokenProgram: TOKEN_PROGRAM_ID }).rpc();
	await refused("non-admin set_bribe_token", () => as(bob).methods.setBribeToken(false, true).accounts({ admin: bob.publicKey, tokenMint: MINTS.bribe }).rpc(), "Unauthorized");
	try {
		await setB(admin, true, true);
		await refused("token paused: claim of this token refused", claim, "SystemPaused");
		await setB(admin, false, false);
		await refused("token delisted: new deposit refused", deposit);
		try { await retry(claim); ok("token delisted: an already earned bribe can still be claimed (delisting never removes obligations)"); } catch (e) { bad(`claim after delisting: ${code(e)}`); }
	} finally { await setB(admin, true, false); console.log("bribe token restored: allowed, not paused"); }
}
if (step === "adminxfer") {
	const adminOf = async () => (await as(admin).account.protocol.fetch(protocol)).admin;
	const cfg = () => as(admin).account.adminConfig.fetch(pda("vesolve", [Buffer.from("admin_config")]));
	const propose = (w, who) => retry(() => as(w).methods.proposeAdmin(who).accounts({ admin: w.publicKey }).rpc());
	const accept = (w) => retry(() => as(w).methods.acceptAdmin().accounts({ newAdmin: w.publicKey }).rpc());
	const setT = (w) => as(w).methods.setTreasury(TREASURY).accounts({ admin: w.publicKey }).rpc();
	await refused("non-admin propose_admin", () => as(bob).methods.proposeAdmin(bob.publicKey).accounts({ admin: bob.publicKey }).rpc(), "Unauthorized");
	await propose(admin, carol.publicKey);
	await propose(admin, new PublicKey("11111111111111111111111111111111"));
	await refused("accept after the proposal was cancelled (proposed default key)", () => as(carol).methods.acceptAdmin().accounts({ newAdmin: carol.publicKey }).rpc(), "Unauthorized");
	await propose(admin, bob.publicKey);
	(((await cfg()).pendingAdmin).equals(bob.publicKey) ? ok : bad)("proposed bob as the new admin (nothing changed yet)");
	(((await adminOf()).equals(admin.publicKey)) ? ok : bad)("admin unchanged until the new wallet signs");
	await refused("carol (not the proposed wallet) accepts", () => as(carol).methods.acceptAdmin().accounts({ newAdmin: carol.publicKey }).rpc(), "Unauthorized");
	try {
		await accept(bob);
		(((await adminOf()).equals(bob.publicKey)) ? ok : bad)("bob accepted: protocol.admin = bob");
		await refused("old admin set_treasury after the transfer", () => setT(admin), "Unauthorized");
		try { await retry(() => setT(bob)); ok("new admin (bob) can run admin commands"); } catch (e) { bad(`new admin set_treasury: ${code(e)}`); }
	} finally {
		if ((await adminOf()).equals(bob.publicKey)) {
			await propose(bob, admin.publicKey);
			await accept(admin);
		}
		console.log("admin restored to", (await adminOf()).toBase58().slice(0, 8), "(expected 4j3VFftv)");
	}
}
if (step === "exitfee") {
	const bps = Number(process.argv[3]);
	const e = await epochNo();
	await setFee(admin, bps);
	const c = await feeCfg();
	console.log(`set exit fee to ${bps} bps in epoch ${e}: pending ${c.pendingBps} from epoch ${c.pendingEpoch}, current ${c.feeBps}; effective now ${await effectiveBps()}`);
}
