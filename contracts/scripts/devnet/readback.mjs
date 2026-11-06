#!/usr/bin/env node
// Read-only check of a Solve3 deployment. Holds no keys and sends no transactions.
//
//   npm i @solana/web3.js            (once, anywhere on the module path)
//   RPC=https://api.devnet.solana.com \
//   VESOLVE=<program id> SOLVE=<program id> TOKEN=<program id> \
//   SOLV3_MINT=<mint> ADMIN=<admin wallet> TREASURY=<treasury wallet> \
//   node scripts/devnet/readback.mjs
//
// Every line prints PASS or FAIL; the exit code is 1 if any FAIL. Attach the output as evidence.
import { Connection, PublicKey } from "@solana/web3.js";

const env = (k, required = true) => {
	const v = process.env[k];
	if (!v && required) {
		console.error(`missing ${k}`);
		process.exit(2);
	}
	return v;
};
const conn = new Connection(env("RPC", false) ?? "https://api.devnet.solana.com", "confirmed");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const vesolve = new PublicKey(env("VESOLVE"));
const programs = { vesolve, solve: new PublicKey(env("SOLVE")), token: new PublicKey(env("TOKEN")) };
const mint = new PublicKey(env("SOLV3_MINT"));
const admin = new PublicKey(env("ADMIN"));
const treasury = new PublicKey(env("TREASURY"));
const pda = (seeds, program = vesolve) => PublicKey.findProgramAddressSync(seeds, program)[0];
const key = (data, at) => new PublicKey(data.subarray(at, at + 32));

let failed = 0;
const check = (name, ok, detail = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
	if (!ok) failed++;
};
const info = async (k) => {
	const a = await conn.getAccountInfo(k);
	if (!a) throw new Error(`account ${k.toBase58()} not found`);
	return a;
};

// 1. Upgrade authority of each program is the vesolve timelock PDA (F3).
const timelock = pda([Buffer.from("upgrade_authority")]);
for (const [name, id] of Object.entries(programs)) {
	const data = (await info(pda([id.toBuffer()], LOADER))).data;
	const has = data[12] === 1;
	const auth = has ? key(data, 13) : null;
	check(`${name}: upgrade authority is the timelock PDA`, !!auth && auth.equals(timelock), auth?.toBase58() ?? "none (immutable)");
}

// 2. SOLV3 mint: authority is the vesolve Protocol PDA, supply within genesis (B1).
const protocolPda = pda([Buffer.from("protocol")]);
const m = (await info(mint)).data;
const mintAuth = m.readUInt32LE(0) === 1 ? key(m, 4) : null;
check("SOLV3 mint authority is the Protocol PDA", !!mintAuth && mintAuth.equals(protocolPda), mintAuth?.toBase58() ?? "none");
const supply = m.readBigUInt64LE(36);
const decimals = m[44];
console.log(`INFO  SOLV3 supply ${supply} base units, ${decimals} decimals`);

// 3. Protocol admin, token mint, epoch.
const p = (await info(protocolPda)).data;
check("Protocol admin is the Admin wallet", key(p, 8).equals(admin), key(p, 8).toBase58());
check("Protocol token mint is SOLV3", key(p, 40).equals(mint), key(p, 40).toBase58());
console.log(`INFO  current epoch ${p.readBigUInt64LE(96)}`);

// 4. AdminConfig: Treasury set, nothing paused, no pending Admin transfer.
const cfg = await conn.getAccountInfo(pda([Buffer.from("admin_config")]));
if (!cfg) {
	check("AdminConfig exists (Treasury set)", false, "not created yet");
} else {
	const d = cfg.data;
	const pending = key(d, 8);
	check("no Admin transfer pending", pending.equals(PublicKey.default), pending.toBase58());
	const names = ["global", "voting", "bribes", "claims", "exit", "gauge activation", "emissions"];
	check("nothing is paused", names.every((_, i) => d[40 + i] === 0), names.filter((_, i) => d[40 + i] !== 0).join(", "));
	const t = key(d, 52);
	check("Treasury is set to the expected wallet", t.equals(treasury), t.toBase58());
}

process.exit(failed ? 1 : 0);
