import test from "node:test";
import assert from "node:assert/strict";
import {MessageV1} from "@solana/web3.js";
import {copyRpcMessage} from "./rpc-message-copy.mjs";
import {liquidityRangeFixture} from "../../tests/fixtures/quest-position-timeline.mjs";
import {decodePositionLiquidityBlockRange} from "./position-liquidity-replay.mjs";
const config=()=>({computeUnitLimit:200000,heapSize:null,loadedAccountsDataSizeLimit:65536,priorityFee:1000});
function fixture(){const f=liquidityRangeFixture(),tx=f.blocks[0].block.transactions[0],m=tx.transaction.message;
 tx.version=1;tx.transaction.message=new MessageV1({header:{...m.header},staticAccountKeys:[...m.staticAccountKeys],recentBlockhash:m.recentBlockhash,compiledInstructions:m.compiledInstructions.map(ix=>({...ix,accountKeyIndexes:[...ix.accountKeyIndexes],data:Uint8Array.from(ix.data)})),transactionConfig:config()});return f;}
test("v1 evidence copy preserves config, signer/writable semantics and bytes without unsupported serialization",()=>{
 const f=fixture(),message=f.blocks[0].block.transactions[0].transaction.message;
 assert.throws(()=>message.serialize(),/not supported/);
 const copy=copyRpcMessage(message);assert.equal(copy.version,1);assert.deepEqual(copy.transactionConfig,message.transactionConfig);assert.notEqual(copy.transactionConfig,message.transactionConfig);
 for(let i=0;i<message.staticAccountKeys.length;i++){assert.equal(copy.isAccountSigner(i),message.isAccountSigner(i));assert.equal(copy.isAccountWritable(i),message.isAccountWritable(i));}
 const value=copy.compiledInstructions[0].data[0];message.compiledInstructions[0].data[0]^=255;message.transactionConfig.priorityFee=999;assert.equal(copy.compiledInstructions[0].data[0],value);assert.equal(copy.transactionConfig.priorityFee,1000);
});
test("version 1 LP replay produces the same verified economic observations as equivalent v0",async()=>{
 const expected=await decodePositionLiquidityBlockRange(liquidityRangeFixture());const result=await decodePositionLiquidityBlockRange(fixture());assert.deepEqual(result,expected);
});
test("version 1 async replay copies evidence before caller mutation",async()=>{
 const f=fixture(),message=f.blocks[0].block.transactions[0].transaction.message,result=decodePositionLiquidityBlockRange(f);message.compiledInstructions[0].data.fill(0);message.transactionConfig.computeUnitLimit=0;assert.deepEqual(await result,await decodePositionLiquidityBlockRange(liquidityRangeFixture()));
});
test("v1 copy refuses malformed header, unsafe config, unknown fields, account indices and oversized wire",()=>{
 for(const change of [m=>m.header.numRequiredSignatures=0,m=>m.header.numReadonlyUnsignedAccounts=99,m=>m.transactionConfig.priorityFee=Number.MAX_SAFE_INTEGER+1,m=>m.transactionConfig.computeUnitLimit=-1,m=>m.transactionConfig.extra=0,m=>delete m.transactionConfig.heapSize,m=>m.compiledInstructions[0].programIdIndex=99,m=>m.compiledInstructions[0].accountKeyIndexes.push(99),m=>m.compiledInstructions[0].data=Uint8Array.from({length:4096})]){
  const m=fixture().blocks[0].block.transactions[0].transaction.message;change(m);assert.throws(()=>copyRpcMessage(m));
 }
});
