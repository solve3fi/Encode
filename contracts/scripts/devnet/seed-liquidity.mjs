#!/usr/bin/env node
// Devnet: mints test tokens to the admin wallet and opens one LP position per pool from it.
//   node seed-liquidity.mjs tsol_tusdc | solv3_tusdc
// The SOLV3 pool needs SOLV3 in the admin wallet (the Treasury sends it); tSOL and tUSDC are minted here.
import { BN } from "@coral-xyz/anchor";
import { NATIVE_MINT, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { MINTS, admin, conn, loadState, pda, programFor, saveState } from "./lib.mjs";

const key = process.argv[2];
const label = process.argv[3] ?? "admin"; // a second run with another label opens another position
const state = loadState();
const s = state[key];
if (!s) throw new Error("usage: seed-liquidity.mjs tsol_tusdc|solv3_tusdc");
const RANGES = { tsol_tusdc: [-19456, -18496, "5000000000000"], solv3_tusdc: [-85696, -84672, "100000000000000"] };
// SOL pool: +-480 ticks (about 5%) around the pool tick; liquidity sized for roughly 2 SOL.
if (key === "sol_tusdc") RANGES.sol_tusdc = [Math.floor((s.tick - 480) / 64) * 64, Math.ceil((s.tick + 480) / 64) * 64, process.env.SOL_LIQ ?? "30000000000"];
const [lower, upper, liq] = RANGES[key];
const SPAN = 88 * 64;
const ata = (m, o) => getAssociatedTokenAddressSync(m, o);
const send = (...ixs) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [admin]);
const mint = async (m, amount) => console.log("mint", m.toBase58().slice(0, 6), await send(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata(m, admin.publicKey), admin.publicKey, m), createMintToInstruction(m, ata(m, admin.publicKey), admin.publicKey, amount)));
await mint(MINTS.tusdc, 1_000_000n * 10n ** 6n);
if (key === "tsol_tusdc") await mint(MINTS.tsol, 1_000n * 10n ** 9n);
else if (key === "sol_tusdc") {
	const wsol = ata(NATIVE_MINT, admin.publicKey);
	console.log("wrap 3 SOL", await send(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, wsol, admin.publicKey, NATIVE_MINT), SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: wsol, lamports: 3_000_000_000 }), createSyncNativeInstruction(wsol)));
}
else await send(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata(MINTS.solv3, admin.publicKey), admin.publicKey, MINTS.solv3));

if ((state.positions ?? {})[`${key}:${label}`]) { console.log("position already exists"); process.exit(0); }
const solve = programFor("solve", admin);
const pool = new PublicKey(s.pool);
const tickArray = (start) => pda("solve", [Buffer.from("tick_array"), pool.toBuffer(), Buffer.from(String(start))]);
const positionMint = Keypair.generate();
const position = pda("solve", [Buffer.from("position"), positionMint.publicKey.toBuffer()]);
const positionToken = ata(positionMint.publicKey, admin.publicKey);
await solve.methods.openPosition({ positionBump: 255 }, lower, upper).accounts({
	funder: admin.publicKey, owner: admin.publicKey, position, positionMint: positionMint.publicKey, positionTokenAccount: positionToken, solve: pool,
}).signers([positionMint]).rpc();
const sig = await solve.methods.increaseLiquidity(new BN(liq), new BN("18446744073709551615"), new BN("18446744073709551615")).accounts({
	solve: pool, positionAuthority: admin.publicKey, position, positionTokenAccount: positionToken,
	tokenOwnerAccountA: ata(new PublicKey(s.mintA), admin.publicKey), tokenOwnerAccountB: ata(new PublicKey(s.mintB), admin.publicKey),
	tokenVaultA: new PublicKey(s.vaultA), tokenVaultB: new PublicKey(s.vaultB),
	tickArrayLower: tickArray(Math.floor(lower / SPAN) * SPAN), tickArrayUpper: tickArray(Math.floor(upper / SPAN) * SPAN), solvesConfig: new PublicKey(state.config),
}).rpc();
console.log(key, "liquidity", liq, sig);
saveState({ positions: { ...(state.positions ?? {}), [`${key}:${label}`]: { position: position.toBase58(), mint: positionMint.publicKey.toBase58(), lower, upper } } });
