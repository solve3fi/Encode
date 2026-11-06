// Default is public read-only planning. --apply never mints, votes, claims or
// unstake-transfers an owner's position. Upgrade both programs BEFORE applying.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair, ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAccount } from '@solana/spl-token';
import { SolveContext, IGNORE_CACHE } from '@solve3fi/sdk';
import idl from '../src/configs/vesolve.json' with { type: 'json' };
import { configureNativeGaugeAccounts, nativeGaugeAddresses } from '../src/lib/nativeGaugeAccounts.ts';
import { hasNativeGaugeReward } from './lib/gauge-fee-policy.mjs';
import { buildNativePoolFeeRoutingTransaction } from './finalize-devnet-epoch.mjs';

const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some(arg => !['--apply', '--dry-run'].includes(arg))) throw Error('Use --dry-run (default) or --apply');
if (apply && process.argv.includes('--dry-run')) throw Error('Choose --dry-run OR --apply');
const connection = new Connection(process.env.SOLVE3_RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', 'This migration is DEVNET ONLY');
let wallet = { publicKey: PublicKey.default, signTransaction: async () => { throw Error('Read only'); }, signAllTransactions: async () => { throw Error('Read only'); } };
if (apply) {
  const keyPath = process.env.SOLVE3_KEEPER_KEYPAIR ?? process.env.SOLVE3_DEVNET_KEYPAIR;
  if (!keyPath) throw Error('An explicit SOLVE3_KEEPER_KEYPAIR path is required for --apply');
  wallet = new anchor.Wallet(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, 'utf8')))));
}
const program = new anchor.Program(idl, new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' }));
const DEX = new PublicKey('Bwkxu4ZnWgPAwCCfBmT3D95EmdiMVuY88Rs7mTBaKysb');
const CONFIG = new PublicKey('Fnc66UJ8MMJ6t2zFM8TEx5wzcQpcXo8pAQEpTBjwnEBG');
const dex = SolveContext.from(connection, wallet, DEX);
const [protocol] = PublicKey.findProgramAddressSync([Buffer.from('protocol')], program.programId);
const protocolState = await program.account.protocol.fetch(protocol);
const config = await dex.fetcher.getConfig(CONFIG, IGNORE_CACHE);
assert.ok(config, 'DEX config missing');
if (apply) {
  assert.ok(config.feeAuthority.equals(wallet.publicKey), 'Signer must be DEX fee authority');
  assert.ok(config.collectProtocolFeesAuthority.equals(wallet.publicKey), 'Signer must also be fee collection authority');
}
const gauges = await program.account.gauge.all();
const plan = [];
const blockers = [];
const slot = await connection.getSlot('confirmed');
const chainTime = await connection.getBlockTime(slot);
assert.notEqual(chainTime, null, 'Chain time unavailable');
for (const { publicKey: gauge, account: state } of gauges) {
  const pool = await dex.fetcher.getPool(state.poolAddress, IGNORE_CACHE);
  assert.ok(pool?.solvesConfig.equals(CONFIG), `Unrecognized gauge pool ${gauge}`);
  const [canonical] = PublicKey.findProgramAddressSync([Buffer.from('gauge'), protocol.toBuffer(), state.poolAddress.toBuffer()], program.programId);
  assert.ok(canonical.equals(gauge) && pool.tokenMintA.equals(state.tokenMintA) && pool.tokenMintB.equals(state.tokenMintB), 'Gauge identity mismatch');
  const mints = await connection.getMultipleAccountsInfo([pool.tokenMintA, pool.tokenMintB]);
  const native = await program.account.nativeGauge.fetchNullable(nativeGaugeAddresses(program.programId, DEX, gauge, state.poolAddress).nativeGauge);
  const ready = hasNativeGaugeReward(pool);
  if (Boolean(native) !== ready) blockers.push(`Inconsistent native state ${gauge}`);
  if (native) {
    const expected = nativeGaugeAddresses(program.programId, DEX, gauge, state.poolAddress);
    if (!native.gauge.equals(gauge) || !native.pool.equals(state.poolAddress) || !native.rewardVault.equals(expected.rewardVault)
        || !pool.rewardInfos[0].mint.equals(protocolState.tokenMint) || !pool.rewardInfos[0].vault.equals(expected.rewardVault)) {
      blockers.push(`Native gauge/vault identity mismatch ${gauge}`);
    }
    const legacy = await program.account.gaugeReward.fetch(expected.legacyReward);
    if (!legacy.gauge.equals(gauge) || !legacy.rewardMint.equals(protocolState.tokenMint) || !legacy.rewardRateX64.isZero()
        || legacy.periodFinish.gtn(chainTime)) blockers.push(`Legacy stream not safely frozen ${gauge}`);
    const vault = await getAccount(connection, expected.rewardVault);
    if (!vault.owner.equals(state.poolAddress) || !vault.mint.equals(protocolState.tokenMint)) blockers.push(`Invalid native token vault ${gauge}`);
  }
  if (state.isActive && mints.some(mint => !mint?.owner.equals(TOKEN_PROGRAM_ID))) blockers.push(`Unsupported active pool token program ${gauge}`);
  if (state.isActive && protocolState.epochStartTime.add(protocolState.epochResetTime).lten(chainTime)) blockers.push('Epoch has ended: reconcile/finalize it before activating streams');
  if (!ready && (!pool.rewardInfos[0].mint.equals(PublicKey.default) || !pool.rewardInfos[0].vault.equals(PublicKey.default)
      || !pool.rewardInfos[0].growthGlobalX64.isZero() || !pool.rewardInfos[0].emissionsPerSecondX64.isZero())) blockers.push(`Occupied native reward slot ${gauge}`);
  const primary = pool.rewardInfos[1].authority.toBytes(), secondary = pool.rewardInfos[2].authority.toBytes();
  if (!ready && (secondary.some(x => x !== 0) || primary.slice(2).some(x => x !== 0))) blockers.push(`Pool extension requires separate review/migration ${gauge}`);
  plan.push({ gauge, state, pool, native, action: native ? 'already_migrated' : 'configure_native', targetFeeRate: state.isActive ? 10000 : 0 });
}
const raw = await connection.getProgramAccounts(program.programId);
const discriminator = Buffer.from(idl.accounts.find(account => account.name === 'GaugeStake').discriminator);
const stakes = raw.filter(item => item.account.data.subarray(0, 8).equals(discriminator));
for (const item of stakes) {
  if (![185, 218].includes(item.account.data.length)) blockers.push(`Unsupported stake layout ${item.pubkey}: ${item.account.data.length}`);
  if (!plan.some(row => row.gauge.equals(new PublicKey(item.account.data.subarray(40, 72))))) blockers.push(`Unknown stake gauge ${item.pubkey}`);
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'read-only', epoch: protocolState.currentEpoch.toString(), blockers,
  gauges: plan.map(row => ({ gauge: row.gauge.toString(), pool: row.state.poolAddress.toString(), active: row.state.isActive, action: row.action, targetFeeRate: row.targetFeeRate })),
  legacyStakes: stakes.map(item => ({ address: item.pubkey.toString(), bytes: item.account.data.length })),
  note: 'Applying requires upgraded DEX and governance programs. Migration transfers unvested rewards only; no token minting.' }, null, 2));
if (apply) {
  assert.equal(blockers.length, 0, `Preflight blocked: ${blockers.join('; ')}`);
  const balance = async address => (await connection.getAccountInfo(address)) ? (await getAccount(connection, address)).amount : 0n;
  for (const row of plan) {
    const freshProtocol = await program.account.protocol.fetch(protocol);
    assert.ok(freshProtocol.currentEpoch.eq(protocolState.currentEpoch), 'Epoch changed: re-run preflight');
    const state = await program.account.gauge.fetch(row.gauge);
    assert.equal(state.isActive, row.state.isActive, 'Gauge status changed: re-run preflight');
    if (row.native) {
      assert.equal(row.pool.protocolFeeRate, row.targetFeeRate, 'Existing native gauge fee policy needs reconciliation');
      continue;
    }
    const accounts = configureNativeGaugeAccounts({ admin: wallet.publicKey, protocol, gauge: row.gauge,
      pool: state.poolAddress, solvesConfig: CONFIG, tokenMintA: state.tokenMintA, tokenMintB: state.tokenMintB,
      rewardMint: protocolState.tokenMint, programId: program.programId, dexProgramId: DEX });
    const before = [ComputeBudgetProgram.setComputeUnitLimit({ units: 700_000 })];
    if (!state.isActive) {
      const sweep = await buildNativePoolFeeRoutingTransaction({ program, dexProgramId: DEX, dexConfig: CONFIG, protocol,
        wallet, gaugeAddress: row.gauge, poolAddress: state.poolAddress, poolData: row.pool, epoch: protocolState.currentEpoch.toNumber() });
      before.push(...sweep.instructions.slice(1));
    }
    const priorBalance = await balance(accounts.legacyVault) + await balance(accounts.rewardVault);
    const signature = await program.methods.configureNativeGauge(state.isActive).accounts(accounts).preInstructions(before).rpc();
    const migratedPool = await dex.fetcher.getPool(state.poolAddress, IGNORE_CACHE);
    assert.equal(migratedPool.protocolFeeRate, row.targetFeeRate);
    assert.ok(hasNativeGaugeReward(migratedPool));
    // Claiming LPs can reduce the balance after confirmation. The on-chain
    // migration itself conserves both vaults; local-validator tests assert exact equality.
    const currentBalance = await balance(accounts.legacyVault) + await balance(accounts.rewardVault);
    console.log(JSON.stringify({ action: 'gauge_migrated', gauge: row.gauge.toString(), signature,
      combinedVaultBefore: priorBalance.toString(), combinedVaultAfter: currentBalance.toString() }));
  }
  for (const item of stakes) {
    const prior = await connection.getAccountInfo(item.pubkey);
    if (!prior) continue; // Owner may already have unstaked.
    const gauge = new PublicKey(prior.data.subarray(40, 72));
    const row = plan.find(row => row.gauge.equals(gauge));
    const addresses = nativeGaugeAddresses(program.programId, DEX, gauge, row.state.poolAddress);
    const signature = await program.methods.migrateLegacyStake().accounts({ payer: wallet.publicKey,
      positionMint: new PublicKey(prior.data.subarray(104, 136)), stake: item.pubkey, nativeGauge: addresses.nativeGauge,
      legacyReward: addresses.legacyReward, systemProgram: SystemProgram.programId }).rpc();
    const migrated = await connection.getAccountInfo(item.pubkey);
    if (migrated) {
      assert.equal(migrated.data.length, 218);
      assert.ok(migrated.data.subarray(8, 136).equals(prior.data.subarray(8, 136)), 'Owner and NFT identity must be preserved');
    }
    console.log(JSON.stringify({ action: 'stake_migrated', stake: item.pubkey.toString(), signature }));
  }
  console.log('Migration complete. Re-run read-only readiness/fee audits, then resume the upgraded keeper. Owners retain their existing claim/unstake permissions.');
}
