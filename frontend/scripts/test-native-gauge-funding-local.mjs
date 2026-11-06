// Disposable localhost-only funding fixtures; never signs against devnet.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair, ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import { getAccount, getMint, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import idl from '../src/configs/vesolve.json' with {type:'json'};
import { configureNativeGaugeAccounts } from '../src/lib/nativeGaugeAccounts.ts';

const DEX=new PublicKey('Bwkxu4ZnWgPAwCCfBmT3D95EmdiMVuY88Rs7mTBaKysb');
const CONFIG=new PublicKey('Fnc66UJ8MMJ6t2zFM8TEx5wzcQpcXo8pAQEpTBjwnEBG');
const GAUGE=new PublicKey('6Hqa6TYH4U12MAbktXDMbwAxcjpm7AQQsFrrkviGsSvB');
const fixtures=process.argv.includes('--fixtures');
const connection=new Connection(fixtures?'http://127.0.0.1:18999':'http://127.0.0.1:19999','confirmed');
assert.equal(new URL(connection.rpcEndpoint).hostname,'127.0.0.1');
assert.notEqual(await connection.getGenesisHash(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const wallet=new anchor.Wallet(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('D:/Projects/ve33-contracts/id.json','utf8')))));
const provider=new anchor.AnchorProvider(connection,wallet,{commitment:'confirmed'});
const program=new anchor.Program(idl,provider);
const derive=(...seeds)=>PublicKey.findProgramAddressSync(seeds,program.programId);
const u64=value=>new anchor.BN(value).toArrayLike(Buffer,'le',8);
const [protocolAddress]=derive(Buffer.from('protocol'));
const protocol=await program.account.protocol.fetch(protocolAddress);
if(fixtures){
  const now=Math.floor(Date.now()/1000)-2;
  const [votingEpoch,bump]=derive(Buffer.from('epoch_data'),u64(3));
  const epoch=await program.account.epoch.fetch(derive(Buffer.from('epoch_data'),u64(2))[0]);
  const encode=async(pubkey,name,state)=>{
    const data=await program.coder.accounts.encode(name,state);
    return {pubkey:pubkey.toString(),account:{lamports:1_000_000_000,data:[data.toString('base64'),'base64'],owner:program.programId.toString(),executable:false,rentEpoch:0,space:data.length}};
  };
  const accounts=await Promise.all([
    encode(protocolAddress,'protocol',{...protocol,currentEpoch:new anchor.BN(4),epochStartTime:new anchor.BN(now)}),
    encode(votingEpoch,'epoch',{...epoch,epoch:new anchor.BN(3),startTime:new anchor.BN(now-604800),endTime:new anchor.BN(now),bump}),
  ]);
  const clones=(await Promise.all([program.programId,DEX,TOKEN_PROGRAM_ID].map(id=>connection.getProgramAccounts(id))))
    .flat().filter(item=>!item.account.executable && !item.pubkey.equals(protocolAddress) && !item.pubkey.equals(votingEpoch)).map(item=>item.pubkey.toString());
  console.log(JSON.stringify({accounts,clones,owner:wallet.publicKey.toString()}));
} else {
assert.equal(protocol.currentEpoch.toNumber(),4,'Requires synthetic week-4 local fixtures');
const gauge=await program.account.gauge.fetch(GAUGE);
const accounts=configureNativeGaugeAccounts({admin:wallet.publicKey,protocol:protocolAddress,gauge:GAUGE,pool:gauge.poolAddress,
  tokenMintA:gauge.tokenMintA,tokenMintB:gauge.tokenMintB,
  solvesConfig:CONFIG,rewardMint:protocol.tokenMint,programId:program.programId,dexProgramId:DEX});
await program.methods.configureNativeGauge(true).accounts(accounts).preInstructions([ComputeBudgetProgram.setComputeUnitLimit({units:700000})]).rpc();
const [votingEpoch]=derive(Buffer.from('epoch_data'),u64(3));
const [epochEmission]=derive(Buffer.from('epoch_emission'),u64(4));
const supplyBefore=(await getMint(connection,protocol.tokenMint)).supply;
await program.methods.initializeEpochEmission(new anchor.BN(4)).accounts({caller:wallet.publicKey,protocol:protocolAddress,votingEpoch,epochEmission,
  developerWallet:protocol.admin,tokenMint:protocol.tokenMint,developerTokenAccount:getAssociatedTokenAddressSync(protocol.tokenMint,protocol.admin),
  tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId}).rpc();
const emission=await program.account.epochEmission.fetch(epochEmission);
const votes=await program.account.epoch.fetch(votingEpoch);
const weight=votes.gaugeWeights.find(item=>item.gauge.equals(GAUGE)).weight;
const expected=BigInt(emission.gaugeBudget.toString())*BigInt(weight.toString())/BigInt(votes.totalVotingPower.toString());
const fundAccounts={caller:wallet.publicKey,protocol:protocolAddress,votingEpoch,epochEmission,gauge:GAUGE,nativeGauge:accounts.nativeGauge,
  pool:gauge.poolAddress,rewardMint:protocol.tokenMint,rewardVault:accounts.rewardVault,solveProgram:DEX,tokenProgram:TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId};
const before=(await getAccount(connection,accounts.rewardVault)).amount;
await program.methods.fundNativeGauge(new anchor.BN(4)).accounts(fundAccounts).rpc();
assert.equal((await getAccount(connection,accounts.rewardVault)).amount-before,expected);
assert.equal((await getMint(connection,protocol.tokenMint)).supply-supplyBefore,expected+BigInt(emission.developerAllocation.toString()));
assert.equal((await program.account.epochEmission.fetch(epochEmission)).distributedToGauges.toString(),expected.toString());
await assert.rejects(program.methods.fundNativeGauge(new anchor.BN(4)).accounts(fundAccounts).rpc(),/EmissionAlreadyFunded/);
const supplyAfter=(await getMint(connection,protocol.tokenMint)).supply;
await program.methods.configureNativeGauge(false).accounts(accounts).rpc();
await assert.rejects(program.methods.fundNativeGauge(new anchor.BN(4)).accounts(fundAccounts).rpc(),/GaugeInactive/);
const paused=await program.account.nativeGauge.fetch(accounts.nativeGauge);
assert.ok(paused.rateX64.isZero());assert.ok(paused.carryAmount.gten(0));
await program.methods.configureNativeGauge(true).accounts(accounts).rpc();
await program.methods.configureNativeGauge(true).accounts(accounts).rpc();
assert.equal((await getMint(connection,protocol.tokenMint)).supply,supplyAfter,'Reactivation must not mint another allocation');
assert.equal((await program.account.nativeGauge.fetch(accounts.nativeGauge)).lastFundedEpoch.toNumber(),4);
console.log(JSON.stringify({passed:true,cluster:'local-only',gaugeAllocation:expected.toString(),checks:['vote-weighted weekly gauge funding','100% gauge allocation into LP vault','no duplicate mint','inactive gauge cannot fund','repeated reactivation does not mint']},null,2));
}
