#!/usr/bin/env node
// Derives every address the Devnet scripts need and writes deploy-out/ids.json:
// program IDs from the program keypairs, test mints from mint keypairs (created if
// missing, mode 0600, outside the repo), and the SOLV3 mint (PDA [b"mint"] of the token program).
// Imports nothing from lib.mjs because lib.mjs needs this file to exist.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";

const keysDir = process.env.REHEARSAL_DIR ?? "rehearsal2";
const dir = `${process.env.HOME}/.solve3-devnet-keys/${keysDir}`;
const load = (name) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"))));
const ensure = (name) => {
	const path = `${dir}/${name}.json`;
	if (!existsSync(path)) {
		writeFileSync(path, JSON.stringify([...Keypair.generate().secretKey]));
		chmodSync(path, 0o600);
	}
	return load(name).publicKey;
};
const vesolve = load("vesolve-keypair").publicKey;
const solve = load("solve-keypair").publicKey;
const token = load("token-keypair").publicKey;
const ids = {
	vesolve: vesolve.toBase58(),
	solve: solve.toBase58(),
	token: token.toBase58(),
	solv3: PublicKey.findProgramAddressSync([Buffer.from("mint")], token)[0].toBase58(),
	tusdc: ensure("tusdc-mint").toBase58(),
	bribe: ensure("bribe-mint").toBase58(),
	tsol: ensure("tsol-mint").toBase58(),
	keysDir,
};
mkdirSync(new URL("../../deploy-out/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../deploy-out/ids.json", import.meta.url), JSON.stringify(ids, null, 2));
console.log(JSON.stringify(ids, null, 2));
