import { admin, pda, programFor, conn } from "./lib.mjs";
const v = programFor("vesolve");
const none = { global: false, voting: false, bribes: false, claims: false, exit: false, gaugeActivation: false, emissions: false };
for (let i = 0; i < 4; i++) {
	try { console.log("set_pauses all false", await v.methods.setPauses(none).accounts({ admin: admin.publicKey }).rpc()); break; } catch (e) { console.log("retry", String(e.message ?? e).slice(0, 80)); }
}
const d = (await conn.getAccountInfo(pda("vesolve", [Buffer.from("admin_config")]))).data;
console.log("pause bytes global,voting,bribes,claims,exit,gauge_act,emissions =", [...d.subarray(40, 47)].join(","));
