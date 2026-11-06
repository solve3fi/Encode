#!/usr/bin/env node
// Remaining checks. Usage: node more.mjs <split|fullexit|feechange1|feechange2|alloc|dexpause>
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { MINTS, admin, conn, loadState, pda, programFor, wallet } from "./lib.mjs";

const step = process.argv[2];
const st = loadState();
const bob = wallet("bob"), carol = wallet("carol");
const protocol = pda("vesolve", [Buffer.from("protocol")]);
const METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const u64 = (n) => new BN(n).toArrayLike(Buffer, "le", 8);
const ata = (m, o, off = false) => getAssociatedTokenAddressSync(m, o, off);
const veMint = (id) => pda("vesolve", [Buffer.from("ve_token"), u64(id)]);
const lockPda = (id) => pda("vesolve", [Buffer.from("ve_lock"), u64(id)]);
const metaOf = (mint) => PublicKey.findProgramAddressSync([Buffer.from("metadata"), METADATA.toBuffer(), mint.toBuffer()], METADATA)[0];
const flaky = (e) => /Blockhash not found|429|not confirmed|expired/i.test(String(e.message ?? e));
const retry = async (fn) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 4 || !flaky(e)) throw e; } } };
const code = (e) => { const t = JSON.stringify(e.logs ?? []) + String(e.message ?? e); return (t.match(/Error Code: (\w+)/) ?? [null, "NO ANCHOR CODE " + t.slice(-100)])[1]; };
const as = (w) => programFor("vesolve", w);
const nextId = async () => (await as(bob).account.protocol.fetch(protocol)).nextNftTokenId.toNumber();
const lockAmount = async (id) => { try { return Number((await as(bob).account.lock.fetch(lockPda(id))).amount) / 1e9; } catch { return null; } };
const ok = (m) => console.log("PASS ", m), bad = (m) => console.log("FAIL ", m);
const exitAccts = (w) => ({ user: w.publicKey, userTokenAccount: ata(MINTS.solv3, w.publicKey), tokenMint: MINTS.solv3, protocolTokenAccount: ata(MINTS.solv3, protocol, true), tokenProgram: TOKEN_PROGRAM_ID });
const feeOf = async (fn) => { const p0 = await conn.getBalance(protocol, "confirmed"); await retry(fn); return (await conn.getBalance(protocol, "confirmed")) - p0; };
const price = 1_333_333n;
const create = async (w, amount) => {
	const id = await nextId();
	await retry(() => as(w).methods.createLock(new BN((BigInt(amount) * 10n ** 9n).toString()), new BN(0)).accounts({
		user: w.publicKey, userTokenAccount: ata(MINTS.solv3, w.publicKey), tokenMint: MINTS.solv3, protocolTokenAccount: ata(MINTS.solv3, protocol, true), metadata: metaOf(veMint(id)), tokenProgram: TOKEN_PROGRAM_ID,
	}).rpc());
	return id;
};

if (step === "split") {
	const id = 5, before = await lockAmount(id), newId = await nextId();
	await retry(() => as(bob).methods.splitLock(new BN(id), new BN(100n * 10n ** 9n)).accounts({ user: bob.publicKey, veLockTokenAccount: ata(veMint(id), bob.publicKey), metadata: metaOf(veMint(newId)), tokenProgram: TOKEN_PROGRAM_ID }).rpc());
	const [a, b] = [await lockAmount(id), await lockAmount(newId)];
	(a === before - 100 && b === 100 ? ok : bad)(`unvoted split: lock ${id} ${before} -> ${a}, new lock ${newId} = ${b} (total ${a + b} vs ${before})`);
	await retry(() => as(bob).methods.mergeLock(new BN(id), new BN(newId)).accounts({ user: bob.publicKey, secondaryVeTokenAccount: ata(veMint(newId), bob.publicKey), tokenProgram: TOKEN_PROGRAM_ID }).rpc());
	const [c, d] = [await lockAmount(id), await lockAmount(newId)];
	(c === before && d === null ? ok : bad)(`unvoted merge back: lock ${id} = ${c}, secondary ${d === null ? "closed" : d}`);
}
if (step === "fullexit") {
	const id = await create(bob, 10);
	const expected = (((10n * 10n ** 9n * price) / 10n ** 9n) * 4000n) / 10_000n;
	const s0 = BigInt((await conn.getTokenAccountBalance(ata(MINTS.solv3, bob.publicKey))).value.amount);
	const fee = await feeOf(() => as(bob).methods.exitLock(new BN(id)).accounts(exitAccts(bob)).rpc());
	const s1 = BigInt((await conn.getTokenAccountBalance(ata(MINTS.solv3, bob.publicKey))).value.amount);
	(BigInt(fee) === expected ? ok : bad)(`full exit of lock ${id}: fee ${fee} lamports (expected ${expected})`);
	(s1 - s0 === 10n * 10n ** 9n ? ok : bad)(`principal returned in full: +${(s1 - s0) / 10n ** 9n} SOLV3`);
	(await lockAmount(id)) === null ? ok(`lock ${id} account closed`) : bad(`lock ${id} still exists`);
}
const exitFee1 = () => feeOf(() => as(bob).methods.partialExitLock(new BN(5), new BN(10n ** 9n)).accounts(exitAccts(bob)).rpc());
if (step === "feechange1") {
	await retry(() => as(admin).methods.setExitFeeBps(new BN(2000)).accounts({ admin: admin.publicKey }).rpc());
	const fee = await exitFee1();
	(fee === 533_334 ? ok : bad)(`fee set to 20% in this epoch; an exit now still charges ${fee} lamports (ceil of 40% = 533334)`);
}
if (step === "feechange2") {
	const fee = await exitFee1();
	(fee === 266_667 ? ok : bad)(`next epoch: exit charges ${fee} lamports (ceil of 20% = 266667)`);
	await retry(() => as(admin).methods.setExitFeeBps(new BN(4000)).accounts({ admin: admin.publicKey }).rpc());
	console.log("exit fee restored to 40% (applies from the next epoch)");
}
if (step === "alloc") {
	const gaugeA = pda("vesolve", [Buffer.from("gauge"), protocol.toBuffer(), new PublicKey(st.solv3_tusdc.pool).toBuffer()]);
	const epochNo = (await as(admin).account.protocol.fetch(protocol)).currentEpoch;
	const epoch = pda("vesolve", [Buffer.from("epoch_data"), u64(epochNo)]);
	const av = pda("vesolve", [Buffer.from("allocation"), lockPda(4).toBuffer()]);
	if (!(await conn.getAccountInfo(av))) {
		try { await as(carol).methods.registerAllocationVoter(new BN(4)).accounts({ admin: carol.publicKey }).rpc(); bad("non-admin registered an allocation voter"); } catch (e) { ok(`non-admin register refused: ${code(e)}`); }
		await retry(() => as(admin).methods.registerAllocationVoter(new BN(4)).accounts({ admin: admin.publicKey }).rpc());
		ok("admin registered lock 4 (carol's) as an allocation voter");
	} else console.log("lock 4 already registered, continuing");
	await retry(() => as(admin).methods.vote(new BN(4), [{ gauge: gaugeA, weight: new BN(40) }]).accounts({ user: admin.publicKey, epoch, allocationVoter: av, autoVoteEnrollment: null }).remainingAccounts([{ pubkey: gaugeA, isSigner: false, isWritable: true }]).rpc());
	const e = await as(admin).account.epoch.fetch(epoch);
	const gw = e.gaugeWeights.find((g) => g.gauge.equals(gaugeA));
	ok(`admin voted lock 4 with 40% (rest abstains): gauge A weight in epoch ${epochNo} = ${gw ? gw.weight.toString() : "none"}`);
	await retry(() => as(admin).methods.unregisterAllocationVoter().accounts({ admin: admin.publicKey, allocationVoter: pda("vesolve", [Buffer.from("allocation"), lockPda(4).toBuffer()]) }).rpc());
	ok("allocation voter unregistered");
}
if (step === "dexpause") {
	const solve = programFor("solve", admin);
	const pause = (s, l) => retry(() => solve.methods.setTradingPauses(s, l).accounts({ solvesConfig: new PublicKey(st.config), feeAuthority: admin.publicKey }).rpc());
	const s = st.tsol_tusdc, pool = new PublicKey(s.pool);
	const SPAN = 88 * 64;
	const swap = async () => {
		const acct = await programFor("solve").account.solve.fetch(pool);
		const held = Math.floor(acct.tickCurrentIndex / SPAN) * SPAN;
		const arrays = [held, held + SPAN, held + 2 * SPAN].map((x) => pda("solve", [Buffer.from("tick_array"), pool.toBuffer(), Buffer.from(String(x))]));
		return programFor("solve", bob).methods.swap(new BN(100_000_000), new BN(0), new BN("79226673515401279992447579055"), true, false).accounts({
			tokenAuthority: bob.publicKey, solve: pool, tokenOwnerAccountA: ata(new PublicKey(s.mintA), bob.publicKey), tokenVaultA: new PublicKey(s.vaultA), tokenOwnerAccountB: ata(new PublicKey(s.mintB), bob.publicKey), tokenVaultB: new PublicKey(s.vaultB),
			tickArray0: arrays[0], tickArray1: arrays[1], tickArray2: arrays[2], solvesConfig: new PublicKey(st.config),
		}).rpc();
	};
	try {
		await pause(true, false);
		try { await swap(); bad("swap succeeded while swaps are paused"); } catch (e) { ok(`swaps paused: swap refused ${code(e)}`); }
		await pause(false, false);
		try { await retry(swap); ok("swaps unpaused: swap works"); } catch (e) { bad(`swap after unpause: ${code(e)}`); }
	} finally { await pause(false, false); console.log("DEX pauses cleared"); }
}
