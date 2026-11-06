import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import ts from 'typescript';
import BN from 'bn.js';
import utilities from '@solve3fi/common';
import {swapQuoteMetrics} from '../src/lib/swapQuoteMetrics.ts';
const {Percentage}=utilities;
const require=createRequire(import.meta.url);
function load(path,mocks) {
 const js=ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',js)(id=>id in mocks?mocks[id]:require(id),module,module.exports);
 return module.exports;
}
const bn=n=>new BN(n);
const request={tokenIn:'A',tokenOut:'B',tradeAmount:bn(1000000),amountSpecifiedIsInput:true};
const hop={amountIn:bn(1000000),amountOut:bn(900000),snapshot:{aToB:true,sqrtPrice:bn(1).shln(64),feeRate:Percentage.fromFraction(1,100)}};
const route={totalAmountIn:hop.amountIn,totalAmountOut:hop.amountOut,subRoutes:[{hopQuotes:[hop]}]};
const a=swapQuoteMetrics(request,route,Percentage.fromFraction(1,1000));
const b=swapQuoteMetrics(request,route,Percentage.fromFraction(1,100));
assert.ok(a.priceImpact.gt(9));
assert.ok(a.priceImpact.eq(b.priceImpact),'Impact must not change with slippage');
assert.ok(a.threshold.lt(hop.amountOut));
assert.ok(b.threshold.lt(a.threshold));
const exactOut=swapQuoteMetrics({...request,tradeAmount:hop.amountOut,amountSpecifiedIsInput:false},route,Percentage.fromFraction(1,100));
assert.equal(exactOut.threshold.toString(),'1010000');
assert.ok(exactOut.priceImpact.gt(9));
let query;
const {useBestTrade}=load('../src/hooks/useBestTrade.ts',{
 '@solana/wallet-adapter-react':{useWallet:()=>({publicKey:null})},
 '@/providers/ClusterProvider':{useCluster:()=>({network:'devnet'})},
 '@/stores/swap':{TradeState:{LOADING:0,INVALID:1,NO_ROUTE_FOUND:2,VALID:3}},
 './usePoolRouters':{usePoolRouters:()=>({router:{},isLoading:false})},
 '@tanstack/react-query':{useQuery:opts=>{query=opts;return {data:[route,[]],isLoading:false};}},
});
const exact=useBestTrade({address:'A',decimals:6},{address:'B',decimals:9},2,false);
assert.equal(exact.request.tokenIn,'A');assert.equal(exact.request.tokenOut,'B');
assert.equal(exact.request.tradeAmount.toString(),'2000000000');
assert.equal(exact.request.amountSpecifiedIsInput,false);assert.equal(query.queryKey.at(-1),false);
let invalidated=0;
const mocks={
 '@lingui/react':{useLingui:()=>({i18n:{_:x=>x}})},
 '@tanstack/react-query':{useMutation:x=>x,useQueryClient:()=>({invalidateQueries:()=>{invalidated++;}})},
 '@/components/Notifications':{notification:{error:()=>{},success:()=>{}}},
};
const close=load('../src/hooks/useClosePosition.ts',mocks).useClosePosition();
const sequence=[];
const builders=[0,1,2].map(n=>({buildAndExecute:async()=>{sequence.push(n);return 'signature';}}));
await close.mutationFn({pool:{closePosition:async()=>builders},positionAddress:'position',slippage:Percentage.fromFraction(1,100)});
assert.deepEqual(sequence,[0,1,2]);assert.equal(invalidated,1);
sequence.length=0;
builders[1].buildAndExecute=async()=>{throw new Error('Wallet rejected');};
await assert.rejects(close.mutationFn({pool:{closePosition:async()=>builders},positionAddress:'position'}),/Wallet rejected/);
assert.deepEqual(sequence,[0],'Stop after a failed close transaction');
assert.equal(invalidated,1);
console.log('PASS: real route impact, slippage bounds, exact-output direction, sequential close and failure handling');
