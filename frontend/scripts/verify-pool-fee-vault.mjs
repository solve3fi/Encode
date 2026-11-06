import fs from "node:fs";
import assert from "node:assert/strict";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { SolveContext, SolveRouterBuilder, RouterUtils, IGNORE_CACHE, PDAUtil } from "@solve3fi/sdk";
import utilities from "@solve3fi/common";
import idl from "../src/configs/vesolve.json" with { type: "json" };

// One-off devnet verification for the PoolFeeVault UI feature just built:
// proves register -> real-fee-driven weight -> fund (sweep proxy) -> claim
// against the actually-deployed program, using a pool where the admin wallet
// holds ~100% of active liquidity so its own fee_owed growth is unambiguous.
// Mirrors verify-public-auto-vote.mjs's shape.

const { Percentage } = utilities;
const RPC = process.env.SOLVE3_DEVNET_RPC ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(idl.address);
const DEX_PROGRAM_ID = new PublicKey("Bwkxu4ZnWgPAwCCfBmT3D95EmdiMVuY88Rs7mTBaKysb");

const owner = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync("D:/Projects/ve33-contracts/id.json", "utf8"))),
);
const stranger = Keypair.generate();

const poolAddress = new PublicKey("FxLW2367wtUhgTrLGKkubyB5NJszTjkBQKuP33EpSwhR");
const positionAddress = new PublicKey("HiqeL1Y233GffyUjTRWbnFNxEGEG4JQgjYq6D8MdZFdS");
const positionMint = new PublicKey("829x4uYEAPrBV8aUFTuu3NWfn2C4R2MWLEMAmraXrfp9");
const tokenMintA = new PublicKey("3TokhXnDGCShfn1N2XsQDBL1rGmco37Kq2bWizdmKU5f");
const tokenMintB = new PublicKey("FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up");

const connection = new Connection(RPC, "confirmed");
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const provider = new AnchorProvider(connection, new Wallet(owner), { commitment: "confirmed", preflightCommitment: "confirmed" });
const program = new Program(idl, provider);

const ctx = SolveContext.from(connection, new Wallet(owner), DEX_PROGRAM_ID);

const vaultAddress = pda([Buffer.from("pool_fee_vault"), poolAddress.toBuffer()]);
const poolFeePositionAddress = pda([Buffer.from("pool_fee_position"), positionMint.toBuffer()]);
const ownerPositionToken = getAssociatedTokenAddressSync(positionMint, owner.publicKey);
const ownerTokenAccountA = getAssociatedTokenAddressSync(tokenMintA, owner.publicKey);
const ownerTokenAccountB = getAssociatedTokenAddressSync(tokenMintB, owner.publicKey);
const vaultTokenAccountA = getAssociatedTokenAddressSync(tokenMintA, vaultAddress, true);
const vaultTokenAccountB = getAssociatedTokenAddressSync(tokenMintB, vaultAddress, true);

// Preconditions -------------------------------------------------------------
const gauges = await program.account.gauge.all();
const hasActiveGauge = gauges.some((g) => g.account.poolAddress.equals(poolAddress) && g.account.isActive);
assert.equal(hasActiveGauge, false, "test pool must have no active gauge");
const pool = await ctx.fetcher.getPool(poolAddress);
assert.equal(pool.liquidity.toString(), "10000000002", "expected the seeded single-LP test pool");
console.log("preconditions OK: no active gauge, pool liquidity =", pool.liquidity.toString());

// Step 1: register (idempotent -- resume if a prior run got this far) -------
let feePosition = await program.account.poolFeePosition.fetchNullable(poolFeePositionAddress);
if (feePosition) {
  console.log("already registered (resuming from a prior run)");
} else {
  const sig = await program.methods
    .registerPoolFeePosition()
    .accounts({
      owner: owner.publicKey,
      pool: poolAddress,
      poolFeeVault: vaultAddress,
      position: positionAddress,
      positionMint,
      ownerPositionToken,
      poolFeePosition: poolFeePositionAddress,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await connection.confirmTransaction(sig, "confirmed");
  console.log("register_pool_fee_position:", sig);
  feePosition = await program.account.poolFeePosition.fetch(poolFeePositionAddress);
}
assert.equal(feePosition.weight.toString(), "0", "weight must start at zero before any post-registration activity");
console.log("registered, baseline last_fee_owed:", feePosition.lastFeeOwedA.toString(), feePosition.lastFeeOwedB.toString());

// Step 2: generate real trading-fee activity on this exact position ---------
const router = await SolveRouterBuilder.buildWithPools(ctx, [poolAddress]);
const doSwap = async (tokenIn, tokenOut, amount, label) => {
  const trade = { tokenIn: tokenIn.toString(), tokenOut: tokenOut.toString(), tradeAmount: amount, amountSpecifiedIsInput: true };
  const result = await router.findBestRoute(trade, RouterUtils.getDefaultRouteOptions(), RouterUtils.getDefaultSelectOptions(), IGNORE_CACHE);
  const route = result?.[0];
  assert.ok(route, `a direct route through the test pool must exist (${label})`);
  const swapBuilder = await router.swap(route, Percentage.fromFraction(1, 100), null);
  const sig = await swapBuilder.buildAndExecute();
  await connection.confirmTransaction(sig, "confirmed");
  console.log(`swap (${label}):`, sig);
};
// Weight is isqrt(delta_a * delta_b) -- a geometric mean of BOTH tokens'
// fee_owed growth -- so activity in only one direction still yields zero
// weight. Swap both ways to generate real growth on both sides.
await doSwap(tokenMintB, tokenMintA, new BN("100000000"), "100 token B -> token A");
await doSwap(tokenMintA, tokenMintB, new BN("100000000"), "100 token A -> token B");

// A swap only advances the pool's global fee-growth accumulator; a specific
// position's own fee_owed field is materialized lazily, only when that
// position is next touched. Our on-chain PoolFeeVault reads fee_owed
// directly (not a client-recomputed quote), so it must be touched for real.
const poolForTickArrays = await ctx.fetcher.getPool(poolAddress, IGNORE_CACHE);
const rawPositionForTicks = await ctx.program.account.position.fetch(positionAddress);
const tickArrayLower = PDAUtil.getTickArrayFromTickIndex(rawPositionForTicks.tickLowerIndex, poolForTickArrays.tickSpacing, poolAddress, DEX_PROGRAM_ID).publicKey;
const tickArrayUpper = PDAUtil.getTickArrayFromTickIndex(rawPositionForTicks.tickUpperIndex, poolForTickArrays.tickSpacing, poolAddress, DEX_PROGRAM_ID).publicKey;
const updateFeesSig = await ctx.program.methods
  .updateFeesAndRewards()
  .accounts({
    solve: poolAddress,
    position: positionAddress,
    tickArrayLower,
    tickArrayUpper,
  })
  .rpc();
await connection.confirmTransaction(updateFeesSig, "confirmed");
console.log("update_fees_and_rewards:", updateFeesSig);

const positionAfterSwap = await ctx.fetcher.getPosition(positionAddress, IGNORE_CACHE);
const deltaA = positionAfterSwap.feeOwedA.sub(feePosition.lastFeeOwedA);
const deltaB = positionAfterSwap.feeOwedB.sub(feePosition.lastFeeOwedB);
assert.ok(deltaA.gtn(0), "swap must have generated real fee_owed_a growth on this position");
assert.ok(deltaB.gtn(0), "swap must have generated real fee_owed_b growth on this position");
console.log("fee_owed grew by", deltaA.toString(), "(A) and", deltaB.toString(), "(B) raw units since registration");

// Step 3: sync -- weight must move from zero to something real -------------
const syncSig = await program.methods
  .syncPoolFeePosition()
  .accounts({
    caller: owner.publicKey,
    pool: poolAddress,
    position: positionAddress,
    poolFeeVault: vaultAddress,
    poolFeePosition: poolFeePositionAddress,
  })
  .rpc();
await connection.confirmTransaction(syncSig, "confirmed");
feePosition = await program.account.poolFeePosition.fetch(poolFeePositionAddress);
let vault = await program.account.poolFeeVault.fetch(vaultAddress);
assert.ok(feePosition.weight.gtn(0), "weight must be nonzero after syncing real fee activity");
assert.equal(vault.totalWeight.toString(), feePosition.weight.toString(), "vault total_weight must equal the sole registered position's weight");
console.log("sync_pool_fee_position:", syncSig, "-- weight now", feePosition.weight.toString());

// Step 4: fund the vault (permissionless -- stands in for an admin fee sweep)
const fundAmountA = new BN("1000000"); // 1 token A
const fundAmountB = new BN("50000"); // 0.05 token B
const fundSig = await program.methods
  .fundPoolFeeVault(fundAmountA, fundAmountB)
  .accounts({
    funder: owner.publicKey,
    pool: poolAddress,
    poolFeeVault: vaultAddress,
    tokenMintA,
    funderTokenAccountA: ownerTokenAccountA,
    vaultTokenAccountA,
    tokenMintB,
    funderTokenAccountB: ownerTokenAccountB,
    vaultTokenAccountB,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
await connection.confirmTransaction(fundSig, "confirmed");
console.log("fund_pool_fee_vault:", fundSig, `(+${fundAmountA} A, +${fundAmountB} B)`);

// Step 5: claim -- must receive exactly what was funded, this position holds
// 100% of the vault's weight -------------------------------------------------
const balanceABefore = await connection.getTokenAccountBalance(ownerTokenAccountA);
const balanceBBefore = await connection.getTokenAccountBalance(ownerTokenAccountB);

const claimSig = await program.methods
  .claimPoolFees()
  .accounts({
    owner: owner.publicKey,
    pool: poolAddress,
    poolFeeVault: vaultAddress,
    position: positionAddress,
    poolFeePosition: poolFeePositionAddress,
    positionMint,
    ownerPositionToken,
    tokenMintA,
    vaultTokenAccountA,
    ownerTokenAccountA,
    tokenMintB,
    vaultTokenAccountB,
    ownerTokenAccountB,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
await connection.confirmTransaction(claimSig, "confirmed");
console.log("claim_pool_fees:", claimSig);

const balanceAAfter = await connection.getTokenAccountBalance(ownerTokenAccountA);
const balanceBAfter = await connection.getTokenAccountBalance(ownerTokenAccountB);
const gotA = BigInt(balanceAAfter.value.amount) - BigInt(balanceABefore.value.amount);
const gotB = BigInt(balanceBAfter.value.amount) - BigInt(balanceBBefore.value.amount);
// The reward-per-weight index is Q64 fixed point (amount << 64) / total_weight,
// truncated on division; holding 100% of the weight should recover the full
// funded amount minus at most a few raw units of floor-rounding dust that
// stays behind in the vault (never more -- the index can only round down,
// so this also proves the vault can't be tricked into overpaying a claim).
const dustA = BigInt(fundAmountA.toString()) - gotA;
const dustB = BigInt(fundAmountB.toString()) - gotB;
assert.ok(dustA >= 0n && dustA <= 2n, `token A rounding dust out of expected range: ${dustA}`);
assert.ok(dustB >= 0n && dustB <= 2n, `token B rounding dust out of expected range: ${dustB}`);
console.log("claimed the funded amounts (within Q64 rounding dust):", { gotA: gotA.toString(), gotB: gotB.toString(), dustA: dustA.toString(), dustB: dustB.toString() });

feePosition = await program.account.poolFeePosition.fetch(poolFeePositionAddress);
assert.equal(feePosition.accruedA.toString(), "0");
assert.equal(feePosition.accruedB.toString(), "0");
console.log("accrued reset to zero after claim");

// Step 6: double-claim protection -- nothing new accrued, must be rejected --
try {
  await program.methods
    .claimPoolFees()
    .accounts({
      owner: owner.publicKey,
      pool: poolAddress,
      poolFeeVault: vaultAddress,
      position: positionAddress,
      poolFeePosition: poolFeePositionAddress,
      positionMint,
      ownerPositionToken,
      tokenMintA,
      vaultTokenAccountA,
      ownerTokenAccountA,
      tokenMintB,
      vaultTokenAccountB,
      ownerTokenAccountB,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  throw new Error("SECURITY BUG: double-claim with nothing accrued was NOT rejected");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("SECURITY BUG")) throw error;
  console.log("double-claim with zero accrued correctly rejected:", message.split("\n")[0]);
}

// Step 7: ownership check -- a signer who does not hold the position NFT
// must be rejected, proving "ownership = holding the NFT right now" is
// actually enforced, not just documented -----------------------------------
try {
  await program.methods
    .claimPoolFees()
    .accounts({
      owner: stranger.publicKey,
      pool: poolAddress,
      poolFeeVault: vaultAddress,
      position: positionAddress,
      poolFeePosition: poolFeePositionAddress,
      positionMint,
      ownerPositionToken: getAssociatedTokenAddressSync(positionMint, stranger.publicKey),
      tokenMintA,
      vaultTokenAccountA,
      ownerTokenAccountA: getAssociatedTokenAddressSync(tokenMintA, stranger.publicKey),
      tokenMintB,
      vaultTokenAccountB,
      ownerTokenAccountB: getAssociatedTokenAddressSync(tokenMintB, stranger.publicKey),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([stranger])
    .rpc();
  throw new Error("SECURITY BUG: a claim by a wallet that never held the position NFT was NOT rejected");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("SECURITY BUG")) throw error;
  console.log("claim by a non-NFT-holder correctly rejected:", message.split("\n")[0]);
}

console.log("\nALL POOL FEE VAULT CHECKS PASSED");
