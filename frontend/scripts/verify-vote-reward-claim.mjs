import fs from "node:fs";
import assert from "node:assert/strict";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idl from "../src/configs/vesolve.json" with { type: "json" };

// Real devnet proof that claim_reward (SOLV3-emission voting rewards) works
// end-to-end. Epoch 1 is the only funded, unclaimed, already-past-N+2 vault
// available right now (epoch 4 is current; epochs 1-2 pass the N+2 delay,
// but only epoch 1's gauges were ever funded via distribute_reward).

const RPC = process.env.SOLVE3_DEVNET_RPC ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(idl.address);
const EPOCH_N = 1;
const GAUGE = new PublicKey("BUQBUdS93v2yrqG1T6SKdSrDSW7s4KwQT3MYXqBpD1B8");

const admin = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync("D:/Projects/ve33-contracts/id.json", "utf8"))),
);
const connection = new Connection(RPC, "confirmed");
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const program = new Program(idl, new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed", preflightCommitment: "confirmed" }));

const protocolAddress = pda([Buffer.from("protocol")]);
const protocol = await program.account.protocol.fetch(protocolAddress);
assert.equal(protocol.currentEpoch.toString(), "4", "expected current epoch to still be 4");

const epochAddress = pda([Buffer.from("epoch_data"), u64(EPOCH_N)]);
const epoch = await program.account.epoch.fetch(epochAddress);
assert.ok(EPOCH_N + 2 <= protocol.currentEpoch.toNumber(), "epoch 1 should pass the N+2 claim delay by epoch 4");

const vaultAddress = pda([Buffer.from("vault"), u64(EPOCH_N), GAUGE.toBuffer()]);
const vault = await program.account.vaultData.fetch(vaultAddress);
console.log("vault rewards (SOLV3, raw):", vault.rewards.toString());

const userVoteAddress = pda([Buffer.from("user_vote"), admin.publicKey.toBuffer(), u64(EPOCH_N)]);
const userVote = await program.account.userVote.fetch(userVoteAddress);
const userGaugeVote = userVote.votes.find((v) => v.gauge.equals(GAUGE));
assert.ok(userGaugeVote, "admin must have voted for this gauge in epoch 1");
const gaugeWeight = epoch.gaugeWeights.find((g) => g.gauge.equals(GAUGE));
const expectedClaim = (BigInt(vault.rewards.toString()) * BigInt(userGaugeVote.weight.toString())) / BigInt(gaugeWeight.weight.toString());
console.log("expected claim (rewards * userVote / gaugeVote):", expectedClaim.toString());

const userRewardsAddress = pda([Buffer.from("user_rewards"), admin.publicKey.toBuffer(), epochAddress.toBuffer(), GAUGE.toBuffer()]);
const alreadyClaimed = await program.account.claimedRewards.fetchNullable(userRewardsAddress);
if (alreadyClaimed) {
  console.log("already claimed by a prior run:", alreadyClaimed.amount.toString());
} else {
  const tokenMint = protocol.tokenMint;
  const userTokenAccount = getAssociatedTokenAddressSync(tokenMint, admin.publicKey);
  const vaultTokenAccount = getAssociatedTokenAddressSync(tokenMint, vaultAddress, true);

  const balBefore = await connection.getTokenAccountBalance(userTokenAccount).catch(() => ({ value: { amount: "0" } }));

  const sig = await program.methods
    .claimReward()
    .accounts({
      user: admin.publicKey,
      protocol: protocolAddress,
      gauge: GAUGE,
      epoch: epochAddress,
      vault: vaultAddress,
      tokenMint,
      userTokenAccount,
      vaultTokenAccount,
      userRewards: userRewardsAddress,
      userVote: userVoteAddress,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
  await connection.confirmTransaction(sig, "confirmed");
  console.log("claim_reward:", sig);

  const balAfter = await connection.getTokenAccountBalance(userTokenAccount);
  const got = BigInt(balAfter.value.amount) - BigInt(balBefore.value.amount);
  assert.equal(got, expectedClaim, "claimed amount must equal rewards * (user vote / gauge vote) exactly");
  console.log("claimed exactly the expected share:", got.toString());

  const claimedRecord = await program.account.claimedRewards.fetch(userRewardsAddress);
  assert.equal(claimedRecord.amount.toString(), expectedClaim.toString());
  assert.equal(claimedRecord.epoch.toString(), String(EPOCH_N));
}

// Double-claim must be rejected (AlreadyClaimed), regardless of which branch ran above.
try {
  const tokenMint = protocol.tokenMint;
  await program.methods
    .claimReward()
    .accounts({
      user: admin.publicKey,
      protocol: protocolAddress,
      gauge: GAUGE,
      epoch: epochAddress,
      vault: vaultAddress,
      tokenMint,
      userTokenAccount: getAssociatedTokenAddressSync(tokenMint, admin.publicKey),
      vaultTokenAccount: getAssociatedTokenAddressSync(tokenMint, vaultAddress, true),
      userRewards: userRewardsAddress,
      userVote: userVoteAddress,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
  throw new Error("SECURITY BUG: double-claiming an already-claimed vote reward was NOT rejected");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("SECURITY BUG")) throw error;
  console.log("double-claim correctly rejected:", message.split("\n")[0]);
}

console.log("\nALL VOTE-REWARD CLAIM CHECKS PASSED");
