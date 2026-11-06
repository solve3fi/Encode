// Signed transactions are allowed ONLY on the disposable loopback validator.
// --print-clones performs public devnet reads and prints its fixture addresses.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair, ComputeBudgetProgram, SystemProgram, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAccount } from '@solana/spl-token';
import { SolveContext, buildSolveClient, PDAUtil, TickUtil, IGNORE_CACHE } from '@solve3fi/sdk';
import idl from '../src/configs/vesolve.json' with {type:'json'};
import { configureNativeGaugeAccounts } from '../src/lib/nativeGaugeAccounts.ts';
import { buildNativePoolFeeRoutingTransaction } from './finalize-devnet-epoch.mjs';

const DEX = new PublicKey('Bwkxu4ZnWgPAwCCfBmT3D95EmdiMVuY88Rs7mTBaKysb');
const CONFIG = new PublicKey('Fnc66UJ8MMJ6t2zFM8TEx5wzcQpcXo8pAQEpTBjwnEBG');
const GAUGE = new PublicKey('6Hqa6TYH4U12MAbktXDMbwAxcjpm7AQQsFrrkviGsSvB');
const printClones = process.argv.includes('--print-clones');
const connection = new Connection(printClones ? 'https://api.devnet.solana.com' : 'http://127.0.0.1:18999', 'confirmed');
const readOnly = { publicKey: PublicKey.default, signTransaction: async () => { throw Error('Read only'); }, signAllTransactions: async () => { throw Error('Read only'); } };
let wallet = readOnly;
if (!printClones) {
  assert.equal(new URL(connection.rpcEndpoint).hostname, '127.0.0.1');
  assert.notEqual(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
  wallet = new anchor.Wallet(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('D:/Projects/ve33-contracts/id.json','utf8')))));
}
const provider = new anchor.AnchorProvider(connection, wallet, {commitment:'confirmed'});
const program = new anchor.Program(idl, provider);
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const protocolAddress = pda(Buffer.from('protocol'));
const protocol = await program.account.protocol.fetch(protocolAddress);
const gauge = await program.account.gauge.fetch(GAUGE);
const dex = SolveContext.from(connection, wallet, DEX);
const client = buildSolveClient(dex);
const pool = await client.getPool(gauge.poolAddress, IGNORE_CACHE);
const poolData = pool.getData();
const legacyRewardAddress = pda(Buffer.from('gauge_reward'), GAUGE.toBuffer());
const legacy = await program.account.gaugeReward.fetch(legacyRewardAddress);
const allAccounts = await connection.getProgramAccounts(program.programId);
const stakeDiscriminator = Buffer.from(idl.accounts.find(account => account.name === 'GaugeStake').discriminator);
const stakes = allAccounts.filter(item => item.account.data.length === 185 && item.account.data.subarray(0,8).equals(stakeDiscriminator)
  && new PublicKey(item.account.data.subarray(40,72)).equals(GAUGE));
assert.equal(stakes.length, 1, 'Expected one legacy WIF3 stake fixture');
const stakeAddress = stakes[0].pubkey;
const positionAddress = new PublicKey(stakes[0].account.data.subarray(72,104));
const positionMint = new PublicKey(stakes[0].account.data.subarray(104,136));
const owner = new PublicKey(stakes[0].account.data.subarray(8,40));
const positionData = await dex.fetcher.getPosition(positionAddress, IGNORE_CACHE);
const lower = PDAUtil.getTickArray(DEX, gauge.poolAddress, TickUtil.getStartTickIndex(positionData.tickLowerIndex,poolData.tickSpacing)).publicKey;
const upper = PDAUtil.getTickArray(DEX, gauge.poolAddress, TickUtil.getStartTickIndex(positionData.tickUpperIndex,poolData.tickSpacing)).publicKey;
const legacyVault = getAssociatedTokenAddressSync(protocol.tokenMint, legacyRewardAddress, true);
const custody = getAssociatedTokenAddressSync(positionMint, stakeAddress, true);
const ownerPosition = getAssociatedTokenAddressSync(positionMint, owner);
const ownerReward = getAssociatedTokenAddressSync(protocol.tokenMint, owner);
const epochBytes = protocol.currentEpoch.toArrayLike(Buffer,'le',8);
const epochVault = pda(Buffer.from('vault'),epochBytes,GAUGE.toBuffer());
if (printClones) {
  const candidates = [protocolAddress,CONFIG,GAUGE,gauge.poolAddress,legacyRewardAddress,legacyVault,stakeAddress,positionAddress,positionMint,
    ownerPosition,ownerReward,custody,lower,upper,poolData.tokenMintA,poolData.tokenMintB,poolData.tokenVaultA,poolData.tokenVaultB,
    protocol.tokenMint, epochVault, getAssociatedTokenAddressSync(poolData.tokenMintA,epochVault,true),getAssociatedTokenAddressSync(poolData.tokenMintB,epochVault,true),
    pda(Buffer.from('epoch_data'),protocol.currentEpoch.subn(1).toArrayLike(Buffer,'le',8)),pda(Buffer.from('epoch_emission'),epochBytes)];
  const unique = [...new Set(candidates.map(key=>key.toString()))];
  const accounts = await connection.getMultipleAccountsInfo(unique.map(key=>new PublicKey(key)));
  console.log(JSON.stringify({ clones: unique.filter((_,index)=>accounts[index]), owner: owner.toString() }));
  process.exit(0);
}
assert.ok(owner.equals(wallet.publicKey), 'Test wallet must own the cloned legacy position');
// Agave's local feature/rent settings may differ from the source cluster.
// Normalize fixture rent in this disposable ledger, never on devnet.
for (const entry of [...allAccounts, ...await connection.getProgramAccounts(DEX), ...await connection.getProgramAccounts(TOKEN_PROGRAM_ID)]) {
  if (entry.account.executable) continue;
  const minimum = await connection.getMinimumBalanceForRentExemption(entry.account.data.length);
  if (entry.account.lamports < minimum) await provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey, toPubkey: entry.pubkey, lamports: minimum-entry.account.lamports,
  })));
}
const configAccounts = configureNativeGaugeAccounts({admin:wallet.publicKey,protocol:protocolAddress,gauge:GAUGE,pool:gauge.poolAddress,
  tokenMintA: gauge.tokenMintA, tokenMintB: gauge.tokenMintB,
  solvesConfig:CONFIG,rewardMint:protocol.tokenMint,programId:program.programId,dexProgramId:DEX});
const beforeLegacyBalance = (await getAccount(connection,legacyVault)).amount;
await program.methods.configureNativeGauge(true).accounts(configAccounts)
  .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({units:700_000})]).rpc();
const configuredPool = await dex.fetcher.getPool(gauge.poolAddress, IGNORE_CACHE);
assert.equal(configuredPool.protocolFeeRate, 10_000);
const frozen = await program.account.gaugeReward.fetch(legacyRewardAddress);
assert.ok(frozen.rewardRateX64.isZero());
const native = await program.account.nativeGauge.fetch(configAccounts.nativeGauge);
const nativeBalance = (await getAccount(connection,configAccounts.rewardVault)).amount;
const afterLegacyBalance = (await getAccount(connection,legacyVault)).amount;
assert.equal(beforeLegacyBalance, nativeBalance+afterLegacyBalance, 'Migration transfers only; no new minting');
assert.equal(native.lastFundedEpoch.toString(), legacy.lastFundedEpoch.toString());

await program.methods.migrateLegacyStake().accounts({payer:wallet.publicKey,positionMint,stake:stakeAddress,
  nativeGauge:configAccounts.nativeGauge,legacyReward:legacyRewardAddress,systemProgram:SystemProgram.programId}).rpc();
const migrated = await program.account.gaugeStake.fetch(stakeAddress);
assert.ok(migrated.weight.isZero()); assert.ok(migrated.owner.equals(owner));
const ownerBefore = (await getAccount(connection,ownerReward)).amount;
await program.methods.unstakePosition().accounts({owner,protocol:protocolAddress,gauge:GAUGE,pool:gauge.poolAddress,
  position:positionAddress,gaugeReward:legacyRewardAddress,stake:stakeAddress,positionMint,custodyPositionToken:custody,
  ownerPositionToken:ownerPosition,rewardMint:protocol.tokenMint,rewardVault:legacyVault,ownerRewardToken:ownerReward,
  tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId}).rpc();
assert.equal((await getAccount(connection,ownerReward)).amount-ownerBefore,BigInt(migrated.accruedRewards.toString()));
assert.equal((await getAccount(connection,ownerPosition)).amount,1n);
assert.equal(await connection.getAccountInfo(stakeAddress),null);

const nativePosition = await client.getPosition(positionAddress,IGNORE_CACHE);
const beforeClaim = (await getAccount(connection,ownerReward)).amount;
for (const builder of await nativePosition.collectRewards()) await builder.buildAndExecute();
const nativeClaim = (await getAccount(connection,ownerReward)).amount-beforeClaim;
assert.ok(nativeClaim>0n,'In-range liquidity must earn native SOLV even when LP trading fees are zero');

const routing = await buildNativePoolFeeRoutingTransaction({program,dexProgramId:DEX,dexConfig:CONFIG,protocol:protocolAddress,wallet,
  gaugeAddress:GAUGE,poolAddress:gauge.poolAddress,poolData:await dex.fetcher.getPool(gauge.poolAddress,IGNORE_CACHE),epoch:protocol.currentEpoch.toNumber()});
await program.methods.configureNativeGauge(false).accounts(configAccounts).preInstructions(routing.instructions).rpc();
const inactive = await program.account.gauge.fetch(GAUGE);
const pausedPool = await dex.fetcher.getPool(gauge.poolAddress,IGNORE_CACHE);
assert.equal(inactive.isActive,false); assert.equal(pausedPool.protocolFeeRate,0);
assert.ok(pausedPool.rewardInfos[0].emissionsPerSecondX64.isZero());
assert.ok(pausedPool.protocolFeeOwedA.isZero() && pausedPool.protocolFeeOwedB.isZero());
console.log(JSON.stringify({passed:true,cluster:'local-only',nativeClaim:nativeClaim.toString(),legacyClaim:migrated.accruedRewards.toString(),
  checks:['100% gauge fees','migration conservation','legacy claim and NFT recovery','native in-range LP reward claim','atomic fee sweep + deactivation']},null,2));
