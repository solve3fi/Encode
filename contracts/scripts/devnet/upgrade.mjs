#!/usr/bin/env node
// Upgrade timelock on the token program: schedule | nonadmin | early | cancel | execute | status
import { PublicKey, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { IDS, admin, conn, pda, programFor, wallet } from "./lib.mjs";

const BUFFER = new PublicKey(process.env.BUFFER ?? "F35KA9CcH3axBGADQpD7TszwngzKMX9jbjNfAbHvZXD2");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const target = IDS.token;
const programData = PublicKey.findProgramAddressSync([target.toBuffer()], LOADER)[0];
const retry = async (fn) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 4 || !/Blockhash|429|not confirmed/.test(String(e.message ?? e))) throw e; } } };
const code = (e) => { const t = JSON.stringify(e.logs ?? []) + String(e.message ?? e); return (t.match(/Error Code: (\w+)/) ?? [null, "NO ANCHOR CODE: " + t.slice(-200)])[1]; };
const base = { program: target, programData, buffer: BUFFER };
const cmd = process.argv[2];
const v = programFor("vesolve", admin);
const schedulePda = () => v.methods.scheduleUpgrade(target).accounts({ admin: admin.publicKey, ...base }).pubkeys().then((p) => p.schedule);
const SCHEDULE = await schedulePda();
if (cmd === "schedule") console.log("schedule_upgrade", (await retry(() => v.methods.scheduleUpgrade(target).accounts({ admin: admin.publicKey, ...base }).rpc())).slice(0, 12));
if (cmd === "nonadmin") {
	const bob = wallet("bob");
	try { await programFor("vesolve", bob).methods.scheduleUpgrade(target).accounts({ admin: bob.publicKey, ...base }).rpc(); console.log("FAIL  non-admin scheduled an upgrade"); }
	catch (e) { console.log("PASS  non-admin schedule refused:", code(e)); }
}
if (cmd === "nonadmincancel") {
	const bob = wallet("bob");
	try { await programFor("vesolve", bob).methods.cancelUpgrade().accounts({ admin: bob.publicKey, schedule: SCHEDULE }).rpc(); console.log("FAIL  non-admin cancelled the upgrade"); }
	catch (e) { console.log("PASS  non-admin cancel refused:", code(e)); }
}
if (cmd === "early") {
	try { await v.methods.executeUpgrade().accounts({ admin: admin.publicKey, schedule: SCHEDULE, ...base, rent: SYSVAR_RENT_PUBKEY, clock: SYSVAR_CLOCK_PUBKEY }).rpc(); console.log("FAIL  upgrade executed before the 24h delay"); }
	catch (e) { console.log("PASS  early execute refused:", code(e)); }
}
if (cmd === "cancel") console.log("cancel_upgrade", (await retry(() => v.methods.cancelUpgrade().accounts({ admin: admin.publicKey, schedule: SCHEDULE }).rpc())).slice(0, 12));
if (cmd === "execute") console.log("execute_upgrade", (await retry(() => v.methods.executeUpgrade().accounts({ admin: admin.publicKey, schedule: SCHEDULE, ...base, rent: SYSVAR_RENT_PUBKEY, clock: SYSVAR_CLOCK_PUBKEY }).rpc())).slice(0, 12));
if (cmd === "status") {
	const s = await schedulePda();
	const acc = await conn.getAccountInfo(s);
	console.log("schedule account", s.toBase58(), acc ? "exists" : "absent (none/cancelled/executed)");
	if (acc) { const d = await v.account.upgradeSchedule.fetch(s); console.log(" executableAt", d.executableAt.toString(), "now", Math.floor(Date.now() / 1000), "buffer", d.buffer.toBase58()); }
}
