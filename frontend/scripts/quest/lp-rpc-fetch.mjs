import {setTimeout as delay} from "node:timers/promises";

// A private worker transport, never a public proxy. Retry only HTTP throttling;
// preserve the exact RPC body and refuse all other transport errors upstream.
export function createLpRpcFetch({fetcher=fetch,signal,minimumDelayMs=150,retries=2,sleep=delay,now=Date.now}={}){
 if(!Number.isSafeInteger(minimumDelayMs)||minimumDelayMs<0||minimumDelayMs>10000||!Number.isSafeInteger(retries)||retries<0||retries>3)throw new Error("LP RPC transport bounds refused");
 let tail=Promise.resolve(),nextRequestAt=0;
 return (url,options)=>{
  const parents=[signal,options?.signal].filter(Boolean),parent=parents.length?AbortSignal.any(parents):undefined;
  const request=async()=>{
   for(let attempt=0;;attempt++){
    parent?.throwIfAborted();
    const wait=Math.max(0,nextRequestAt-now());
    if(wait)await sleep(wait,undefined,{signal:parent});
    const combined=parent?AbortSignal.any([parent,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);
    const response=await fetcher(url,{...options,signal:combined});nextRequestAt=now()+minimumDelayMs;
    if(response.status!==429)return response;
    await response.body?.cancel().catch(()=>{});
    if(attempt>=retries)throw new Error("LP RPC throttled after bounded retries");
    const header=response.headers.get("retry-after");
    const requested=header&&/^[0-9]{1,3}$/.test(header)?Math.min(30,Number(header))*1000:0;
    await sleep(Math.max(requested,2000*2**attempt),undefined,{signal:parent});
   }
  };
  const result=tail.then(request);tail=result.then(()=>{},()=>{});return result;
 };
}

// Reuse only the immutable finalized anchor header during one finite round.
// Head, genesis and pruning checks stay fresh for every publication; full blocks
// are never cached. The next cycle fetches the anchor header again.
export function createLpRoundConnection(connection,anchorSlot){
 if(!Number.isSafeInteger(anchorSlot)||anchorSlot<0)throw new Error("LP round anchor refused");
 let header;
 return {
  getGenesisHash:()=>connection.getGenesisHash(),
  getSlot:commitment=>{if(commitment!=="finalized")throw new Error("LP round requires finalized head");return connection.getSlot(commitment);},
  getFirstAvailableBlock:()=>connection.getFirstAvailableBlock(),
  getBlocks:(...args)=>connection.getBlocks(...args),
  getBlock:(slot,options)=>{
   if(slot===anchorSlot&&options?.transactionDetails==="none"&&options.commitment==="finalized")return header??=connection.getBlock(slot,options);
   return connection.getBlock(slot,options);
  },
 };
}
