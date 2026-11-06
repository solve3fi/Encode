// Public, read-only account audit. No signer secrets or transaction submission.
import anchor from '@coral-xyz/anchor';
import {Connection,PublicKey} from '@solana/web3.js';
import {SolveContext} from '@solve3fi/sdk';
import idl from '../src/configs/vesolve.json' with {type:'json'};
import {readGaugeFeePolicySnapshot} from './lib/gauge-fee-policy.mjs';
const connection=new Connection(process.env.SOLVE3_RPC_URL ?? 'https://api.devnet.solana.com','confirmed');
const wallet={publicKey:PublicKey.default,signTransaction:async()=>{throw new Error('Read only');},signAllTransactions:async()=>{throw new Error('Read only');}};
const program=new anchor.Program(idl,new anchor.AnchorProvider(connection,wallet,{commitment:'confirmed'}));
const dexContext=SolveContext.from(connection,wallet,new PublicKey('Bwkxu4ZnWgPAwCCfBmT3D95EmdiMVuY88Rs7mTBaKysb'));
const dexConfig=new PublicKey('Fnc66UJ8MMJ6t2zFM8TEx5wzcQpcXo8pAQEpTBjwnEBG');
const [protocol]=PublicKey.findProgramAddressSync([Buffer.from('protocol')],program.programId);
const snapshot=await readGaugeFeePolicySnapshot({program,dexContext,dexConfig,protocol});
console.log(JSON.stringify({timestamp:new Date().toISOString(),genesisHash:await connection.getGenesisHash(),feeAuthority:snapshot.config.feeAuthority.toString(),default:snapshot.config.defaultProtocolFeeRate,poolCount:snapshot.plan.poolPolicies.length,gaugeCount:snapshot.plan.gauges.length,changes:snapshot.plan.changes.length}));
for(const policy of snapshot.plan.poolPolicies){
 const pool=snapshot.pools.find(p=>p.publicKey.toString()===policy.pool).account;
 console.log(JSON.stringify({...policy,feeRate:pool.feeRate,tokenA:pool.tokenMintA.toString(),tokenB:pool.tokenMintB.toString(),protocolFeeOwedA:pool.protocolFeeOwedA.toString(),protocolFeeOwedB:pool.protocolFeeOwedB.toString()}));
}
if(process.argv.includes('--expect-configured') && (snapshot.plan.defaultPolicy.from!==snapshot.plan.defaultPolicy.to || snapshot.plan.changes.length)) {
 throw new Error('Pool fee policy is not fully configured');
}
