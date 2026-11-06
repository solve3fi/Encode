import fs from "node:fs";
import assert from "node:assert/strict";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idl from "../src/configs/vesolve.json" with { type: "json" };

// Real devnet proof that the auto-vote-fee-bypass fix works: a claim can no
// longer be filed under a different lock than the one that actually cast
// the vote it's paying out against.

const RPC = process.env.SOLVE3_DEVNET_RPC ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(idl.address);
const GAUGE = new PublicKey("BUQBUdS93v2yrqG1T6SKdSrDSW7s4KwQT3MYXqBpD1B8");
const BRIBE_MINT = new PublicKey("9Xn8ko7AwH8HBRLt6Ci6oYxFjPN1sBoUrkDWeTPCPacn"); // SOLV3
const LOCK_A_ID = 16; // will actually cast the vote
const LOCK_B_ID = 8; // a different lock the same wallet owns, never used to vote this epoch

const admin = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync("D:/Projects/ve33-contracts/id.json", "utf8"))),
);
const connection = new Connection(RPC, "confirmed");
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const program = new Program(idl, new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed", preflightCommitment: "confirmed" }));

const protocolAddress = pda([Buffer.from("protocol")]);
const protocol = await program.account.protocol.fetch(protocolAddress);
const currentEpoch = protocol.currentEpoch;
const epochAddress = pda([Buffer.from("epoch_data"), u64(currentEpoch.toString())]);
console.log("current epoch:", currentEpoch.toString());

const lockA = pda([Buffer.from("ve_lock"), u64(LOCK_A_ID)]);
const lockB = pda([Buffer.from("ve_lock"), u64(LOCK_B_ID)]);
const userVoteAddress = pda([Buffer.from("user_vote"), admin.publicKey.toBuffer(), u64(currentEpoch.toString())]);
const voteLockRecordAddress = pda([Buffer.from("vote_lock"), admin.publicKey.toBuffer(), u64(currentEpoch.toString())]);
const vaultAddress = pda([Buffer.from("vault"), u64(currentEpoch.toString()), GAUGE.toBuffer()]);

// Step 1: create_bribe (permissionless) auto-inits this epoch's vault for
// this gauge, so claim_bribe_reward's account-resolution can get far enough
// to reach the vote_lock_record check we're actually testing.
const bribeAddress = pda([Buffer.from("bribe"), GAUGE.toBuffer(), BRIBE_MINT.toBuffer(), admin.publicKey.toBuffer()]);
const userTokenAccount = getAssociatedTokenAddressSync(BRIBE_MINT, admin.publicKey);
const bribeTokenAccount = getAssociatedTokenAddressSync(BRIBE_MINT, vaultAddress, true);
const existingVault = await program.account.vaultData.fetchNullable(vaultAddress);
if (existingVault) {
  console.log("vault already exists for this epoch+gauge (resuming from a prior run)");
} else {
  const bribeSig = await program.methods
    .createBribe(new BN(1000))
    .accounts({
      user: admin.publicKey,
      epoch: epochAddress,
      gauge: GAUGE,
      vault: vaultAddress,
      tokenMint: BRIBE_MINT,
      bribe: bribeAddress,
      userTokenAccount,
      bribeTokenAccount,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
  await connection.confirmTransaction(bribeSig, "confirmed");
  console.log("create_bribe (vault init):", bribeSig);
}

// Step 2: cast a fresh vote this epoch using lock A.
const voteSig = await program.methods
  .vote(new BN(LOCK_A_ID), [{ gauge: GAUGE, weight: new BN(100) }])
  .accounts({
    user: admin.publicKey,
    protocol: protocolAddress,
    epoch: epochAddress,
    lock: lockA,
    autoVoteEnrollment: null,
    userVote: userVoteAddress,
    voteLockRecord: voteLockRecordAddress,
    systemProgram: SystemProgram.programId,
  })
  .remainingAccounts([{ pubkey: GAUGE, isWritable: false, isSigner: false }])
  .rpc();
await connection.confirmTransaction(voteSig, "confirmed");
console.log("vote (lock A):", voteSig);

const voteLockRecord = await program.account.voteLockRecord.fetch(voteLockRecordAddress);
assert.equal(voteLockRecord.veTokenId.toString(), String(LOCK_A_ID));
assert.ok(voteLockRecord.lock.equals(lockA));
console.log("vote_lock_record correctly recorded lock A:", voteLockRecord.veTokenId.toString());

const claimAccounts = (lockAddress, veTokenId) => ({
  user: admin.publicKey,
  protocol: protocolAddress,
  lock: lockAddress,
  autoVoteEnrollment: pda([Buffer.from("auto_vote"), lockAddress.toBuffer()]),
  gauge: GAUGE,
  epoch: epochAddress,
  vault: vaultAddress,
  tokenMint: BRIBE_MINT,
  userTokenAccount,
  bribeVaultTokenAccount: bribeTokenAccount,
  treasuryTokenAccount: getAssociatedTokenAddressSync(BRIBE_MINT, protocolAddress, true),
  userRewards: pda([Buffer.from("user_bribe_rewards"), admin.publicKey.toBuffer(), epochAddress.toBuffer(), GAUGE.toBuffer(), BRIBE_MINT.toBuffer()]),
  userVote: userVoteAddress,
  voteLockRecord: voteLockRecordAddress,
  systemProgram: SystemProgram.programId,
  tokenProgram: TOKEN_PROGRAM_ID,
  associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
});

// Step 3: THE BYPASS ATTEMPT -- claim by citing lock B, which never cast
// this epoch's vote. Before the fix, this would have sailed through with
// is_auto_voted computed from lock B's (unenrolled) status, dodging the fee
// entirely regardless of how the reward was actually earned. It must now be
// rejected before ever reaching that fee logic.
try {
  await program.methods
    .claimBribeReward(new BN(LOCK_B_ID))
    .accounts(claimAccounts(lockB, LOCK_B_ID))
    .rpc();
  throw new Error("SECURITY BUG: claiming under a lock that never cast this vote was NOT rejected");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("SECURITY BUG")) throw error;
  if (!message.includes("LockDidNotCastVote")) {
    throw new Error(`Expected LockDidNotCastVote, got: ${message.split("\n")[0]}`);
  }
  console.log("claim via the wrong (never-voted) lock correctly rejected: LockDidNotCastVote");
}

// Step 4: the LEGITIMATE case -- citing lock A (the one that actually
// voted) must clear our new check. It should still fail, since this epoch
// is current/still open (the N+2 claim delay and the end-time check both
// reject it) -- but on one of THOSE unrelated, expected business-logic
// errors, not on LockDidNotCastVote, proving the fix doesn't block the real
// voter, only the substitution attempt.
try {
  await program.methods
    .claimBribeReward(new BN(LOCK_A_ID))
    .accounts(claimAccounts(lockA, LOCK_A_ID))
    .rpc();
  throw new Error("SECURITY BUG: claim succeeded on a still-open, non-finalized epoch");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("SECURITY BUG")) throw error;
  if (message.includes("LockDidNotCastVote")) {
    throw new Error("The correct, voting lock was wrongly rejected by our new check");
  }
  if (!message.includes("VotingRewardsNotClaimableYet") && !message.includes("EpochNotFinalized")) {
    throw new Error(`Expected VotingRewardsNotClaimableYet or EpochNotFinalized, got: ${message.split("\n")[0]}`);
  }
  console.log("claim via the correct (voting) lock cleared our check, failed later on an unrelated epoch-timing check as expected:", message.split("\n")[0]);
}

console.log("\nALL VOTE-LOCK-FIX CHECKS PASSED");
