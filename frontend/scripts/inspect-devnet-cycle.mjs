import fs from "node:fs";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const RPC = process.env.SOLVE3_DEVNET_RPC ?? "https://api.devnet.solana.com";
const IDL_PATH = process.env.VESOLVE_IDL ?? new URL("../src/configs/vesolve.json", import.meta.url);
const PROGRAM_ID = new PublicKey("HUk7bMPwzxgJyrjrTsLZjZVuLj5YDbm3bgfL9MA1r3us");
const SOLV3 = new PublicKey("9Xn8ko7AwH8HBRLt6Ci6oYxFjPN1sBoUrkDWeTPCPacn");
const GAUGES = [
  ["BONK3", "BUQBUdS93v2yrqG1T6SKdSrDSW7s4KwQT3MYXqBpD1B8", "66TpRRMG7pugKLCndrLE3y3eNByYB4N4ph3bYmZx3XAE"],
  ["WIF3", "6Hqa6TYH4U12MAbktXDMbwAxcjpm7AQQsFrrkviGsSvB", "EMkdY1SnzmFgTSBebL6GuSPRgDBUegUtk6uTkDJFhtif"],
  ["PEPE3", "9LcB8K6rWizVSy68uuEYnTNCMR3p62NAkns4YwujmcLb", "5CUbwobWTKvjfxF6hMdVcQm2uyxLRqXhJtnahXdVYpHx"],
];

const connection = new Connection(RPC, "confirmed");
const wallet = new Wallet(Keypair.generate());
const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
const program = new Program(idl, provider);
if (!program.programId.equals(PROGRAM_ID)) throw new Error("Unexpected vesolve program ID");

const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const u64 = (value) => new BN(value).toArrayLike(Buffer, "le", 8);
const protocolAddress = pda([Buffer.from("protocol")]);
const protocol = await program.account.protocol.fetch(protocolAddress);
const currentEpoch = protocol.currentEpoch.toNumber();

async function epochSnapshot(epochNumber) {
  if (epochNumber < 0) return null;
  const address = pda([Buffer.from("epoch_data"), u64(epochNumber)]);
  const state = await program.account.epoch.fetchNullable(address);
  if (!state) return { epoch: epochNumber, address: address.toBase58(), exists: false };
  return {
    epoch: epochNumber,
    address: address.toBase58(),
    exists: true,
    startTime: state.startTime.toNumber(),
    endTime: state.endTime.toNumber(),
    totalVotingPower: state.totalVotingPower.toString(),
    totalVotes: state.totalVotes.toString(),
    gaugeWeights: state.gaugeWeights.map((item) => ({
      gauge: item.gauge.toBase58(),
      weight: item.weight.toString(),
      votes: item.votes.toString(),
    })),
  };
}

const gaugeSnapshots = [];
for (const [symbol, gaugeText, positionMintText] of GAUGES) {
  const gauge = new PublicKey(gaugeText);
  const positionMint = new PublicKey(positionMintText);
  const gaugeState = await program.account.gauge.fetchNullable(gauge);
  const gaugeRewardAddress = pda([Buffer.from("gauge_reward"), gauge.toBuffer()]);
  const gaugeReward = await program.account.gaugeReward.fetchNullable(gaugeRewardAddress);
  const rewardVault = getAssociatedTokenAddressSync(SOLV3, gaugeRewardAddress, true);
  const rewardVaultBalance = await connection.getTokenAccountBalance(rewardVault).catch(() => null);
  const stakeAddress = pda([Buffer.from("gauge_stake"), positionMint.toBuffer()]);
  const stake = await program.account.gaugeStake.fetchNullable(stakeAddress);
  gaugeSnapshots.push({
    symbol,
    gauge: gauge.toBase58(),
    active: gaugeState?.isActive ?? false,
    gaugeReward: gaugeReward
      ? {
          address: gaugeRewardAddress.toBase58(),
          lastFundedEpoch: gaugeReward.lastFundedEpoch.toString(),
          rewardRateX64: gaugeReward.rewardRateX64.toString(),
          periodFinish: gaugeReward.periodFinish.toString(),
          vault: rewardVault.toBase58(),
          vaultBalance: rewardVaultBalance?.value.amount ?? "0",
        }
      : null,
    stake: stake
      ? {
          address: stakeAddress.toBase58(),
          owner: stake.owner.toBase58(),
          positionMint: stake.positionMint.toBase58(),
          liquidity: stake.liquidity.toString(),
        }
      : null,
  });
}

const emissionAddress = pda([Buffer.from("epoch_emission"), u64(currentEpoch)]);
const emission = await program.account.epochEmission.fetchNullable(emissionAddress);
console.log(JSON.stringify({
  observedAt: new Date().toISOString(),
  protocol: {
    address: protocolAddress.toBase58(),
    admin: protocol.admin.toBase58(),
    tokenMint: protocol.tokenMint.toBase58(),
    currentEpoch,
    epochStartTime: protocol.epochStartTime.toNumber(),
    epochResetTime: protocol.epochResetTime.toNumber(),
    nextBoundary: protocol.epochStartTime.toNumber() + protocol.epochResetTime.toNumber(),
    totalLocked: protocol.totalLocked.toString(),
  },
  previousEpoch: await epochSnapshot(currentEpoch - 1),
  currentEpochState: await epochSnapshot(currentEpoch),
  currentEmission: emission
    ? {
        address: emissionAddress.toBase58(),
        totalEmission: emission.totalEmission.toString(),
        gaugeBudget: emission.gaugeBudget.toString(),
        developerAllocation: emission.developerAllocation.toString(),
        distributedToGauges: emission.distributedToGauges.toString(),
      }
    : null,
  gauges: gaugeSnapshots,
}, null, 2));
