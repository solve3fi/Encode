import test from "node:test";
import assert from "node:assert/strict";
import {createLpRpcFetch,createLpRoundConnection} from "./lp-rpc-fetch.mjs";
test("throttling retries preserve request, cancel body and use bounded Retry-After",async()=>{
 let calls=0,cancelled=0;const waits=[],options={body:"private request"};
 const fetcher=async(url,opts)=>{assert.equal(url,"private endpoint");assert.equal(opts.body,options.body);assert.ok(opts.signal);calls++;return calls===1?{status:429,headers:new Headers({"retry-after":"99"}),body:{cancel:async()=>{cancelled++;}}}:{status:200};};
 const out=await createLpRpcFetch({fetcher,minimumDelayMs:0,sleep:async ms=>waits.push(ms)})("private endpoint",options);
 assert.equal(out.status,200);assert.equal(calls,2);assert.equal(cancelled,1);assert.deepEqual(waits,[30000]);
});
test("persistent 429 refuses after three attempts with sanitized error",async()=>{
 let calls=0;const waits=[];const transport=createLpRpcFetch({fetcher:async()=>{calls++;return {status:429,headers:new Headers(),body:null};},minimumDelayMs:0,sleep:async ms=>waits.push(ms)});
 await assert.rejects(transport("secret endpoint"),/^Error: LP RPC throttled after bounded retries$/);assert.equal(calls,3);assert.deepEqual(waits,[2000,4000]);
});
test("concurrent requests are serialized and paced; failed fetch does not poison queue",async()=>{
 let time=0,active=0,calls=0;const waits=[];
 const transport=createLpRpcFetch({minimumDelayMs:150,now:()=>time,sleep:async ms=>{waits.push(ms);time+=ms;},fetcher:async()=>{assert.equal(active++,0);await Promise.resolve();active--;if(++calls===1)throw Error("failure");return {status:200};}});
 const out=await Promise.allSettled([transport("a"),transport("b"),transport("c")]);assert.deepEqual(out.map(r=>r.status),["rejected","fulfilled","fulfilled"]);assert.deepEqual(waits,[150]);
});
test("shutdown aborts queued work without additional fetch",async()=>{
 const controller=new AbortController();let calls=0;
 const transport=createLpRpcFetch({signal:controller.signal,minimumDelayMs:0,fetcher:async()=>{calls++;controller.abort();return {status:200};}});
 const out=await Promise.allSettled([transport("a"),transport("b")]);assert.equal(out[0].status,"fulfilled");assert.equal(out[1].status,"rejected");assert.equal(calls,1);
});
test("HTTP failures other than 429 do not retry; invalid configuration refuses",async()=>{
 let calls=0;assert.equal((await createLpRpcFetch({fetcher:async()=>{calls++;return {status:503};}})("a")).status,503);assert.equal(calls,1);
 for(const value of [-1,10001,NaN])assert.throws(()=>createLpRpcFetch({minimumDelayMs:value}));
});
test("round caches only anchor header while refreshing all mutable metadata and every full block",async()=>{
 const calls=[];const connection={getGenesisHash:async()=>{calls.push("genesis");return "g";},getSlot:async()=>{calls.push("head");return 100;},getFirstAvailableBlock:async()=>{calls.push("first");return 1;},getBlocks:async()=>{calls.push("slots");return [91];},getBlock:async(slot,opts)=>{calls.push(opts.transactionDetails);return {slot};}};
 const round=createLpRoundConnection(connection,90),none={transactionDetails:"none",commitment:"finalized"};
 for(let i=0;i<2;i++){await round.getGenesisHash();await round.getSlot("finalized");await round.getFirstAvailableBlock();await round.getBlock(90,none);await round.getBlock(91,{transactionDetails:"full"});await round.getBlocks(91,91,"finalized");}
 assert.deepEqual(calls,["genesis","head","first","none","full","slots","genesis","head","first","full","slots"]);
 await createLpRoundConnection(connection,90).getSlot("finalized");assert.equal(calls.at(-1),"head");assert.throws(()=>round.getSlot("confirmed"));
});
test("a missing full block remains missing and is never inferred from cached metadata",async()=>{
 const round=createLpRoundConnection({getBlock:async()=>null},90);assert.equal(await round.getBlock(91,{transactionDetails:"full"}),null);
});
