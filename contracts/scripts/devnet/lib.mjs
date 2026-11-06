// Shared helpers for the Devnet rehearsal scripts. Devnet only; secret keys are
// read from files outside the repo and never printed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const IDS_FILE = new URL("../../deploy-out/ids.json", import.meta.url);
const ids = existsSync(IDS_FILE) ? JSON.parse(readFileSync(IDS_FILE, "utf8")) : {};
const need = (v, k) => { if (!v) throw new Error(`missing ${k} in deploy-out/ids.json`); return new PublicKey(v); };
export const IDS = {
	vesolve: need(ids.vesolve, "vesolve"),
	solve: need(ids.solve, "solve"),
	token: need(ids.token, "token"),
};
// Mints are optional until created (solv3 appears after genesis-token.mjs).
const opt = (v) => (v ? new PublicKey(v) : undefined);
export const MINTS = { solv3: opt(ids.solv3), tusdc: opt(ids.tusdc), bribe: opt(ids.bribe), tsol: opt(ids.tsol) };
export const REHEARSAL_DIR = process.env.REHEARSAL_DIR ?? ids.keysDir ?? "rehearsal2";
const rpcFile = `${process.env.HOME}/.solve3-devnet-keys/rpc.txt`;
export const RPC = process.env.RPC ?? (existsSync(rpcFile) ? readFileSync(rpcFile, "utf8").trim() : "https://api.devnet.solana.com");
if (!RPC.includes("devnet")) throw new Error("refusing to run against a non-devnet RPC");
export const conn = new Connection(RPC, {
	commitment: "confirmed",
	fetch: async (url, options) => {
		let res;
		for (let attempt = 0; attempt < 8; attempt++) {
			await new Promise((r) => setTimeout(r, 300 + attempt * 1500));
			res = await fetch(url, options);
			if (res.status !== 429) return res;
		}
		return res;
	},
});
const KEYS = `${process.env.HOME}/.solve3-devnet-keys`;
export const loadKeypair = (path) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
export const admin = loadKeypair(`${KEYS}/id.json`);
export const wallet = (name) => loadKeypair(`${KEYS}/${REHEARSAL_DIR}/wallets/${name}.json`);
export const mintKeypair = (name) => loadKeypair(`${KEYS}/${REHEARSAL_DIR}/${name}.json`);

const IDL_DIR = new URL("../../tests/svm/idl/", import.meta.url);
export const programFor = (name, signer = admin) => {
	const idl = JSON.parse(readFileSync(new URL(`${name}.json`, IDL_DIR), "utf8"));
	idl.address = IDS[name].toBase58();
	const provider = new AnchorProvider(conn, new Wallet(signer), { commitment: "confirmed" });
	return new Program(idl, provider);
};

const STATE = new URL("../../deploy-out/state.json", import.meta.url);
export const loadState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {});
export const saveState = (patch) => writeFileSync(STATE, JSON.stringify({ ...loadState(), ...patch }, null, 2));

export const pda = (program, seeds) => PublicKey.findProgramAddressSync(seeds, IDS[program])[0];
export const sortMints = (a, b) => (Buffer.compare(a.toBuffer(), b.toBuffer()) <= 0 ? [a, b] : [b, a]);
export const sqrtPriceX64 = (price) => BigInt(Math.floor(Math.sqrt(price) * 2 ** 32)) * 2n ** 32n;
export const tickForPrice = (price) => Math.floor(Math.log(price) / Math.log(1.0001));
export { SystemProgram, PublicKey, Keypair };
