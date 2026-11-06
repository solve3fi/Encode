#!/usr/bin/env node
// Devnet rehearsal: solve config, 0.30% fee tier (spacing 64), and two pools
// (SOLV3/tUSDC at $0.20 and tSOL/tUSDC at $150) with tick arrays around the
// initial price. Idempotent through deploy-out/state.json.
import { BN } from "@coral-xyz/anchor";
import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
	IDS, MINTS, admin, conn, loadState, pda, programFor, saveState, sortMints, sqrtPriceX64, tickForPrice,
} from "./lib.mjs";

const TSOL = MINTS.tsol;
const SPACING = 64;
const FEE_RATE = 3000;
const DEFAULT_PROTOCOL_FEE_RATE = 500; // 95/5 (spec A2) until a gauge activates
const solve = programFor("solve");
const exists = async (k) => !!(await conn.getAccountInfo(k));
let state = loadState();

if (!state.config) {
	const config = Keypair.generate();
	const sig = await solve.methods
		.initializeConfig(admin.publicKey, admin.publicKey, admin.publicKey, DEFAULT_PROTOCOL_FEE_RATE)
		.accounts({ config: config.publicKey, funder: admin.publicKey })
		.signers([config])
		.rpc();
	saveState({ config: config.publicKey.toBase58() });
	console.log("initialize_config", config.publicKey.toBase58(), sig);
	state = loadState();
}
const config = new PublicKey(state.config);
const feeTier = pda("solve", [Buffer.from("fee_tier"), config.toBuffer(), new BN(SPACING).toArrayLike(Buffer, "le", 2)]);
if (!(await exists(feeTier))) {
	const sig = await solve.methods
		.initializeFeeTier(SPACING, FEE_RATE)
		.accounts({ config, feeTier, funder: admin.publicKey, feeAuthority: admin.publicKey })
		.rpc();
	console.log("initialize_fee_tier", feeTier.toBase58(), sig);
}

const pools = [
	{ key: "solv3_tusdc", base: MINTS.solv3, baseDec: 9, quote: MINTS.tusdc, quoteDec: 6, price: 0.2 },
	{ key: "tsol_tusdc", base: TSOL, baseDec: 9, quote: MINTS.tusdc, quoteDec: 6, price: 150 },
	{ key: "sol_tusdc", base: NATIVE_MINT, baseDec: 9, quote: MINTS.tusdc, quoteDec: 6, price: 150 },
];
for (const p of pools) {
	if (loadState()[p.key]) {
		console.log(p.key, "exists", loadState()[p.key].pool);
		continue;
	}
	const [mintA, mintB] = sortMints(p.base, p.quote);
	const baseIsA = mintA.equals(p.base);
	// raw price = token B base units per token A base unit
	const rawPrice = baseIsA
		? (p.price * 10 ** p.quoteDec) / 10 ** p.baseDec
		: (1 / p.price) * 10 ** p.baseDec / 10 ** p.quoteDec;
	const pool = pda("solve", [Buffer.from("solve"), config.toBuffer(), mintA.toBuffer(), mintB.toBuffer(), new BN(SPACING).toArrayLike(Buffer, "le", 2)]);
	const vaultA = Keypair.generate();
	const vaultB = Keypair.generate();
	const sig = await solve.methods
		.initializePool({ solveBump: 255 }, SPACING, new BN(sqrtPriceX64(rawPrice).toString()))
		.accounts({ solvesConfig: config, tokenMintA: mintA, tokenMintB: mintB, funder: admin.publicKey, solve: pool, tokenVaultA: vaultA.publicKey, tokenVaultB: vaultB.publicKey, feeTier })
		.signers([vaultA, vaultB])
		.rpc();
	console.log("initialize_pool", p.key, pool.toBase58(), sig);
	const tick = tickForPrice(rawPrice);
	const span = 88 * SPACING;
	const start = Math.floor(tick / span) * span;
	const arrays = {};
	for (const s of [start - span, start, start + span]) {
		const tickArray = pda("solve", [Buffer.from("tick_array"), pool.toBuffer(), Buffer.from(String(s))]);
		await solve.methods.initializeTickArray(s).accounts({ solve: pool, funder: admin.publicKey, tickArray }).rpc();
		arrays[s] = tickArray.toBase58();
	}
	console.log(" tick", tick, "arrays", Object.keys(arrays).join(","));
	saveState({
		[p.key]: {
			pool: pool.toBase58(), mintA: mintA.toBase58(), mintB: mintB.toBase58(), vaultA: vaultA.publicKey.toBase58(),
			vaultB: vaultB.publicKey.toBase58(), baseIsA, rawPrice, tick, spacing: SPACING, feeTier: feeTier.toBase58(), arrays,
		},
	});
}
console.log(JSON.stringify(loadState(), null, 2));
