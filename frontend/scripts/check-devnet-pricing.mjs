// Read-only pool and pricing diagnostics. No signing or transactions.
import { Connection, PublicKey } from '@solana/web3.js';
import { SolveContext, buildSolveClient, getAllSolveAccountsForConfig, PriceMath, IGNORE_CACHE, SolveRouterBuilder, RouterUtils } from '@solve3fi/sdk';
import BN from 'bn.js';
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const programId = new PublicKey('Bwkxu4ZnWgPAwCCfBmT3D95EmdiMVuY88Rs7mTBaKysb');
const wallet = {publicKey: PublicKey.default, signTransaction: () => {throw Error('Read only');}, signAllTransactions: () => {throw Error('Read only');}};
const ctx = SolveContext.from(connection, wallet, programId);
const accounts = await getAllSolveAccountsForConfig({connection,programId,configId:new PublicKey('Fnc66UJ8MMJ6t2zFM8TEx5wzcQpcXo8pAQEpTBjwnEBG')});
const pools = await buildSolveClient(ctx).getPools([...accounts.keys()], IGNORE_CACHE);
for (const pool of pools) {
 const data=pool.getData(), a=pool.getTokenAInfo(), b=pool.getTokenBInfo();
 console.log(JSON.stringify({pool:pool.getAddress().toString(),a:a.mint.toString(),b:b.mint.toString(),decimalsA:a.decimals,decimalsB:b.decimals,sqrtPrice:data.sqrtPrice.toString(),liquidity:data.liquidity.toString(),amountA:pool.getTokenVaultAInfo().amount.toString(),amountB:pool.getTokenVaultBInfo().amount.toString(),bPerA:PriceMath.sqrtPriceX64ToPrice(data.sqrtPrice,a.decimals,b.decimals).toString()}));
}
const router=await SolveRouterBuilder.buildWithPools(ctx,[...accounts.keys()]);
for(const mint of ['9Xn8ko7AwH8HBRLt6Ci6oYxFjPN1sBoUrkDWeTPCPacn','294YpSBwicjzKggcn9aZozVDfxHbM3EcBStQXiWcG8sk']) {
 try {
  const route=await router.findBestRoute({tokenIn:mint,tokenOut:'FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up',amountSpecifiedIsInput:true,tradeAmount:new BN(mint.startsWith('BCS')?1000000:1000)},RouterUtils.getDefaultRouteOptions(),{...RouterUtils.getDefaultRouteOptions(),maxSupportedTransactionVersion:'legacy',maxTransactionSize:1232},IGNORE_CACHE);
  console.log('EXECUTABLE_QUOTE',mint,route?.[0]?.totalAmountOut.toString()??'unavailable');
 } catch(error) {console.log('EXECUTABLE_QUOTE_ERROR',mint,error.message);}
}
