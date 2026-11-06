// Read-only diagnostics: no wallet secrets, signing, or transaction submission.
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import utilities from '@solve3fi/common';
import anchor from '@coral-xyz/anchor';
import veIdl from '../src/configs/vesolve.json' with { type:'json' };
const { Percentage }=utilities;
import { SolveContext, buildSolveClient, getAllSolveAccountsForConfig, getAllPositionAccountsByOwner, IGNORE_CACHE, collectFeesQuote, TokenExtensionUtil, SolveRouterBuilder, RouterUtils } from '@solve3fi/sdk';
import BN from 'bn.js';
import {swapQuoteMetrics} from '../src/lib/swapQuoteMetrics.ts';
const connection=new Connection('https://api.devnet.solana.com','confirmed');
const owner=new PublicKey('HGUPXpPUhD6PiTSWexebRSsgCT1uDAgiKk2DvdRHsq6o');
const programId=new PublicKey('Bwkxu4ZnWgPAwCCfBmT3D95EmdiMVuY88Rs7mTBaKysb');
const wallet={publicKey:owner,signTransaction:()=>{throw Error('Read only');},signAllTransactions:()=>{throw Error('Read only');}};
const ctx=SolveContext.from(connection,wallet,programId), client=buildSolveClient(ctx);
const accounts=await getAllSolveAccountsForConfig({connection,programId,configId:new PublicKey('Fnc66UJ8MMJ6t2zFM8TEx5wzcQpcXo8pAQEpTBjwnEBG')});
for(const [address,data] of accounts) {
 if(data && [data.tokenMintA.toString(),data.tokenMintB.toString()].some(mint=>['9ueYeFVEbPpet57eJjMt9QuwtjEbYykpUZMw4zFY1SJq','DzkTGZGQsh8zsYo275JSQgwqRmREKb3D617EMCg2njao'].includes(mint))) {
  console.log('POOL',JSON.stringify({address,tokenA:data.tokenMintA.toString(),tokenB:data.tokenMintB.toString(),feeRate:data.feeRate,protocolFeeRate:data.protocolFeeRate,protocolFeeOwedA:data.protocolFeeOwedA.toString(),protocolFeeOwedB:data.protocolFeeOwedB.toString(),feeGrowthGlobalA:data.feeGrowthGlobalA.toString(),feeGrowthGlobalB:data.feeGrowthGlobalB.toString(),liquidity:data.liquidity.toString(),tickCurrentIndex:data.tickCurrentIndex}));
 }
}
const positions=await getAllPositionAccountsByOwner({ctx,owner,includesPositions:true,includesPositionsWithTokenExtensions:true,includesBundledPositions:false});
for(const [address,position] of positions.positions) console.log('POSITION',JSON.stringify({address,pool:position.solve.toString(),mint:position.positionMint.toString(),liquidity:position.liquidity.toString(),tickLower:position.tickLowerIndex,tickUpper:position.tickUpperIndex,feeOwedA:position.feeOwedA.toString(),feeOwedB:position.feeOwedB.toString()}));
const testPool=await client.getPool('DiCvABbjrTtcXWaaKjWCoBCJu3NNvrT6RnuXorj6jJzZ',IGNORE_CACHE);
try {
 const builders=await testPool.closePosition('CCRxtcjBxJCaxQMV3MNdEei8fZSZihfKxrMknAmztvgX',Percentage.fromFraction(50,10000));
 console.log('CLOSE_BUILDERS',builders.length);
 const block=await connection.getLatestBlockhash('confirmed');
 for(const builder of builders) {
  const compressed=builder.compressIx(true);
  const message=new TransactionMessage({payerKey:owner,recentBlockhash:block.blockhash,instructions:compressed.instructions}).compileToV0Message();
  const simulation=await connection.simulateTransaction(new VersionedTransaction(message),{sigVerify:false,replaceRecentBlockhash:true});
  console.log('CLOSE_SIMULATION',JSON.stringify({err:simulation.value.err,logs:simulation.value.logs,unitsConsumed:simulation.value.unitsConsumed}));
 }
} catch(error) {console.log('CLOSE_BUILD_ERROR',error.message,error.stack);}
const cbtPool=new PublicKey('DaLDjZTEQpsSeAnrQsTCARHuRKgSeiixGAA2Fv35R24X');
const cbtPositions=await ctx.program.account.position.all([{memcmp:{offset:8,bytes:cbtPool.toString()}}]);
for(const position of cbtPositions) console.log('CBT_POSITION',JSON.stringify({address:position.publicKey.toString(),mint:position.account.positionMint.toString(),liquidity:position.account.liquidity.toString(),tickLower:position.account.tickLowerIndex,tickUpper:position.account.tickUpperIndex,feeOwedA:position.account.feeOwedA.toString(),feeOwedB:position.account.feeOwedB.toString()}));
const ve=new anchor.Program(veIdl,new anchor.AnchorProvider(connection,wallet,{commitment:'confirmed'}));
for(const item of cbtPositions) {
 const position=await client.getPosition(item.publicKey,IGNORE_CACHE);
 const solve=position.getSolveData();
 console.log('CBT_FEE_CHECKPOINTS',JSON.stringify({checkpointA:position.getData().feeGrowthCheckpointA.toString(),checkpointB:position.getData().feeGrowthCheckpointB.toString(),lowerA:position.getLowerTickData().feeGrowthOutsideA.toString(),lowerB:position.getLowerTickData().feeGrowthOutsideB.toString(),upperA:position.getUpperTickData().feeGrowthOutsideA.toString(),upperB:position.getUpperTickData().feeGrowthOutsideB.toString()}));
 const tokenExtensionCtx=await TokenExtensionUtil.buildTokenExtensionContextForPool(ctx.fetcher,solve.tokenMintA,solve.tokenMintB);
 const quote=collectFeesQuote({position:position.getData(),tickLower:position.getLowerTickData(),tickUpper:position.getUpperTickData(),solve,tokenExtensionCtx});
 console.log('CBT_LP_CLAIMABLE',JSON.stringify({position:item.publicKey.toString(),rawCbt:quote.feeOwedA.toString(),rawDevUSDC:quote.feeOwedB.toString()}));
}
const gauges=await ve.account.gauge.all();
console.log('CBT_GAUGES',JSON.stringify(gauges.filter(g=>g.account.poolAddress.equals(cbtPool)).map(g=>({address:g.publicKey.toString(),active:g.account.isActive}))));
const history=await connection.getSignaturesForAddress(cbtPool,{limit:15});
for(const entry of history){
 const transaction=await connection.getParsedTransaction(entry.signature,{maxSupportedTransactionVersion:0});
 console.log('CBT_HISTORY',JSON.stringify({signature:entry.signature,time:entry.blockTime,err:entry.err,log:transaction?.meta?.logMessages?.filter(line=>line.includes('Instruction:')),vaults:transaction?.meta?.postTokenBalances?.filter(x=>x.owner===cbtPool.toString()).map(x=>({mint:x.mint,after:x.uiTokenAmount.uiAmountString,before:transaction.meta.preTokenBalances?.find(y=>y.accountIndex===x.accountIndex)?.uiTokenAmount.uiAmountString}))}));
}
const router=await SolveRouterBuilder.buildWithPools(ctx,[cbtPool]);
for(const exactIn of [true,false]){
 const trade={tokenIn:'FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up',tokenOut:'9ueYeFVEbPpet57eJjMt9QuwtjEbYykpUZMw4zFY1SJq',tradeAmount:new BN(exactIn?'200000000':'1000000000'),amountSpecifiedIsInput:exactIn};
 const result=await router.findBestRoute(trade,RouterUtils.getDefaultRouteOptions(),RouterUtils.getDefaultSelectOptions(),IGNORE_CACHE);
 const route=result?.[0];
 if(route){const metrics=swapQuoteMetrics(trade,route,Percentage.fromFraction(5,1000));console.log('LIVE_QUOTE',JSON.stringify({exactIn,amountIn:route.totalAmountIn.toString(),amountOut:route.totalAmountOut.toString(),impact:metrics.priceImpact?.toString(),threshold:metrics.threshold.toString()}));}
 else console.log('LIVE_QUOTE','No route');
}
