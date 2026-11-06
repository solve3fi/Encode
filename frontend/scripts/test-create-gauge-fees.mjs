import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {PublicKey} from '@solana/web3.js';
import {GAUGED_PROTOCOL_FEE_RATE,UNGAUGED_PROTOCOL_FEE_RATE} from '../src/configs/feePolicy.ts';
import {configureNativeGaugeAccounts} from '../src/lib/nativeGaugeAccounts.ts';
const require=createRequire(import.meta.url);
const address=n=>new PublicKey(Uint8Array.from({length:32},()=>n));
const authority=address(1),configAddress=address(2),poolAddress=address(3),tokenMintA=address(4),tokenMintB=address(5);
let signer=authority, poolConfig=configAddress, rejectRpc=false, calls=[], invalidated=[];
const pool={get solvesConfig(){return poolConfig;},tokenMintA,tokenMintB,tickSpacing:64};
const ctx={program:{account:{solvesConfig:{fetch:async()=>({feeAuthority:authority})},solve:{fetch:async()=>pool}},methods:{setProtocolFeeRate:rate=>({accounts:accounts=>({instruction:async()=>{calls.push(['feeInstruction',rate,accounts]);return {kind:'fee',rate};}})})}}};
ctx.fetcher={getConfig:async()=>({feeAuthority:authority}),getPool:async()=>pool};
const program={programId:address(20),methods:{configureNativeGauge:active=>({accounts:accounts=>({instruction:async()=>{calls.push(['nativeInstruction',active,accounts]);return {kind:'native',active};}})}),createGauge:(...args)=>({accounts:accounts=>({postInstructions:instructions=>({preInstructions:before=>({rpc:async opts=>{calls.push(['atomicGauge',args,accounts,instructions,opts,before]);if(rejectRpc)throw new Error('Simulation rejected');return 'signature';}})})})})}};
const mocks={
 '@lingui/react':{useLingui:()=>({i18n:{_:(str,params)=>params?str.replace('{address}',params.address):str}})},
 '@solana/wallet-adapter-react':{useWallet:()=>({publicKey:signer})},
 '@tanstack/react-query':{useMutation:options=>options,useQueryClient:()=>({invalidateQueries:async key=>invalidated.push(key.queryKey[0])})},
 '@/components/Notifications':{notification:{success:()=>{},error:()=>{}}},
 '@/configs/addresses':{DEX_PROGRAM_ID:{devnet:address(6)},PROGRAM_CONFIG:{devnet:configAddress}},
 '@/configs/feePolicy':{GAUGED_PROTOCOL_FEE_RATE},
 '@/lib/nativeGaugeAccounts':{configureNativeGaugeAccounts},
 '@/providers/ClusterProvider':{useCluster:()=>({network:'devnet'})},
 '@/providers/DappProvider':{useClient:()=>({ctx})},
 '@/hooks/useVesolveProgram':{useVesolveProgram:()=>program,getProtocolPDA:()=>[address(7)],getGaugePDA:()=>[address(8)],vesolveAccount:{protocol:()=>({fetch:async()=>({tokenMint:address(21)})})}},
};
const source=fs.readFileSync(new URL('../src/stores/admin/hooks/useCreateGauge.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const module={exports:{}};
new Function('require','module','exports',js)(id=>id in mocks?mocks[id]:require(id),module,module.exports);
const input={poolAddress,tokenMintA,tokenMintB,tickSpacing:64};
assert.equal(UNGAUGED_PROTOCOL_FEE_RATE,0);assert.equal(GAUGED_PROTOCOL_FEE_RATE,10000);
let mutation=module.exports.useCreateGauge();
assert.equal(await mutation.mutationFn(input),'signature');
assert.equal(calls.length,2);assert.equal(calls[0][1],true);
assert.deepEqual(calls[1][3],[{kind:'native',active:true}]);
assert.ok(calls[0][2].rewardMint.equals(address(21)));
assert.ok(calls[0][2].pool.equals(poolAddress));
assert.deepEqual(calls[1][4],{commitment:'confirmed'});
await mutation.onSuccess();assert.ok(invalidated.includes('vesolve-all-gauges'));assert.ok(invalidated.includes('poolInfo'));
calls=[];signer=address(9);mutation=module.exports.useCreateGauge();
await assert.rejects(mutation.mutationFn(input),/fee-authority/);assert.equal(calls.length,0);
signer=authority;poolConfig=address(10);mutation=module.exports.useCreateGauge();
await assert.rejects(mutation.mutationFn(input),/do not match/);assert.equal(calls.length,0);
poolConfig=configAddress;
await assert.rejects(mutation.mutationFn({...input,tickSpacing:128}),/do not match/);assert.equal(calls.length,0);
rejectRpc=true;
await assert.rejects(mutation.mutationFn(input),/Simulation rejected/);
assert.equal(calls.filter(x=>x[0]==='atomicGauge').length,1,'Exactly one atomic RPC, no create-only fallback');
console.log('PASS: atomic gauge+fee transition, exact authority, live pool validation, cache refresh and failure handling');
