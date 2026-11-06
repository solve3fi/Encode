import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import ts from 'typescript';
import Decimal from 'decimal.js';
import BN from 'bn.js';
import { valueTokenAmounts } from '../src/lib/devnetPricing.ts';
const require=createRequire(import.meta.url);
function hook(path,mocks) {
 const js=ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',js)((id)=>id in mocks?mocks[id]:require(id),module,module.exports);
 return module.exports;
}
let network='devnet';
const peg={address:'devUSDC',decimals:6};
const {useUSDCPrice}=hook('../src/hooks/useUSDCPrice.ts',{
 '@/configs/tokens':{DEVNET_USDC:peg,USDC:{address:'mainUSDC',decimals:6}},
 '@/lib/devnetPricing':{valueTokenAmounts},
 '@/providers/ClusterProvider':{ClusterNetwork:{Devnet:'devnet'},useCluster:()=>({network,cluster:{endpoint:'test'}})},
 './useToken':{useAllTokens:()=>({})},
 './useDevnetPrices':{useDevnetPrices:()=>({isLoading:true,data:undefined})},
 './usePoolRouters':{usePoolRouters:()=>({router:undefined,isLoading:true})},
 '@tanstack/react-query':{useQuery:()=>({isLoading:false})},
});
let value=useUSDCPrice({devUSDC:25});
assert.equal(value.totalUsdcValue.toNumber(),25);assert.equal(value.isComplete,true);assert.equal(value.isLoading,false);
value=useUSDCPrice({devUSDC:25,unknown:1});assert.equal(value.isComplete,false);
value=useUSDCPrice({unknown:0});assert.equal(value.isComplete,true);assert.equal(value.isLoading,false);
network='mainnet-beta';assert.equal(useUSDCPrice({devUSDC:25}).isComplete,false);
assert.equal(useUSDCPrice({mainUSDC:25}).totalUsdcValue.toNumber(),25);
let complete=true;
const {useEmissionApr}=hook('../src/hooks/useEmissionApr.ts',{
 '@/providers/ClusterProvider':{useCluster:()=>({network:'devnet'})},
 '@/providers/DappProvider':{useAnchor:()=>({connection:{}})},
 './useVesolveProgram':{EMISSION_WEEK_SECONDS:604800,useVesolveProgram:()=>({})},
 'react':{useMemo:fn=>fn()},
 '@tanstack/react-query':{useQuery:()=>({data:{rewardMint:'SOLV3',rewardAmount:new Decimal(10),epochsPerYear:new Decimal(52)},isLoading:false})},
 './useUSDCPrice':{useUSDCPrice:()=>({breakdown:[{address:'SOLV3',price:2,usdcValue:new Decimal(20)},{address:'devUSDC',price:1,usdcValue:new Decimal(50)}],isLoading:false,isComplete:complete})},
});
const pool={getAddress:()=>({toString:()=> 'pool'}),getTokenAInfo:()=>({mint:'SOLV3',decimals:9}),getTokenBInfo:()=>({mint:'devUSDC',decimals:6}),getTokenVaultAInfo:()=>({amount:new BN('100000000000')}),getTokenVaultBInfo:()=>({amount:new BN('50000000')})};
assert.equal(useEmissionApr(pool).apr.toNumber(),416);
complete=false;assert.equal(useEmissionApr(pool).pricingComplete,false);
pool.getAddress=()=>({toString:()=> 'pool',equals:()=>true});
pool.getData=()=>({tokenMintA:'SOLV3',tokenMintB:'devUSDC'});
// Vote display metadata can have address rather than the SDK's mint field.
pool.getTokenAInfo=()=>({address:'SOLV3',decimals:9});
pool.getTokenBInfo=()=>({address:'devUSDC',decimals:6});
const {useVoteEpochStats}=hook('../src/stores/vote/hooks/useVoteEpochStats.ts',{
 '@/configs/addresses':{DEX_PROGRAM_ID:{devnet:'program'}},
 '@/providers/DappProvider':{useClient:()=>({client:{},ctx:{}})},
 '@/hooks/useVesolveProgram':{useVesolveProgram:()=>({})},
 '@/hooks/usePools':{usePools:()=>({data:[pool]})},
 '@/hooks/useUSDCPrice':{useUSDCPrice:()=>({breakdown:[{address:'SOLV3',price:2},{address:'devUSDC',price:1}],isComplete:false,isLoading:false})},
 'react':{useMemo:fn=>fn()},
 '@tanstack/react-query':{useQuery:()=>({data:null,isLoading:false})},
});
const stats=useVoteEpochStats('devnet',3,[{pool:'pool',gauge:'gauge',bribesInfos:[],tradingFeesA:new BN('1000000000'),tradingFeesB:new BN('2000000')}]);
assert.equal(stats.totalTradingFeesUsd.toNumber(),4);
assert.equal(stats.rewardsPricingComplete,true);
assert.equal(stats.pricingComplete,false);
console.log('PASS: hook peg without RPC/router/metadata, network isolation, zero balances, incomplete values, and same-mint emission APR.');
console.log('PASS: funded gauge-fee totals remain available without protocol/emission data or unrelated TVL prices.');
