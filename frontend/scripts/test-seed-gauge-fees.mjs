import assert from "node:assert/strict";
import fs from "node:fs";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import { configureNativeGaugeAccounts } from "../src/lib/nativeGaugeAccounts.ts";
const source = fs.readFileSync(new URL("./seed-devnet-governance.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function createSeedGaugeWithFeePolicy(");
const end = source.indexOf("\nconst RPC =", start);
assert.ok(start >= 0 && end > start);
const createGauge = new Function("PublicKey", "SystemProgram", "ComputeBudgetProgram", "configureNativeGaugeAccounts",
  `${source.slice(start,end)}\nreturn createSeedGaugeWithFeePolicy;`
)(PublicKey,SystemProgram,ComputeBudgetProgram,configureNativeGaugeAccounts);
const key = n => new PublicKey(new Uint8Array(32).fill(n));
function fixture(badAuthority=false, badPool=false, reject=false) {
  const calls=[];
  const args={wallet:{publicKey:key(1)},protocol:key(2),gauge:key(3),dexConfig:key(4),pool:key(5),mintA:key(6),mintB:key(7),tickSpacing:64};
  args.dexContext={program:{programId:key(8),account:{
    solvesConfig:{fetch:async()=>({feeAuthority:badAuthority?key(20):args.wallet.publicKey})},
    solve:{fetch:async()=>({solvesConfig:badPool?key(21):args.dexConfig,tokenMintA:args.mintA,tokenMintB:args.mintB,tickSpacing:64})}
  }}};
  args.program={programId:key(9),account:{protocol:{fetch:async()=>({tokenMint:key(10)})}},methods:{
    configureNativeGauge:active=>({accounts:accounts=>({instruction:async()=>{calls.push(["native",active,accounts]);return {kind:"native"};}})}),
    createGauge:(...values)=>({accounts:accounts=>({postInstructions:instructions=>({preInstructions:before=>({rpc:async()=>{
      calls.push(["atomic",values,accounts,instructions,before]);if(reject)throw Error("rejected");return "signature";
    }})})})})
  }};
  return {args,calls};
}
const ok=fixture();
assert.equal(await createGauge(ok.args),"signature");
assert.deepEqual(ok.calls.map(call=>call[0]),["native","atomic"]);
assert.equal(ok.calls[0][1],true);
assert.ok(ok.calls[0][2].pool.equals(ok.args.pool));
assert.deepEqual(ok.calls[1][3],[{kind:"native"}]);
for(const flags of [[true,false],[false,true]]) {
  const item=fixture(...flags);
  await assert.rejects(createGauge(item.args),/fee authority|do not match/);
  assert.equal(item.calls.length,0);
}
const rejected=fixture(false,false,true);
await assert.rejects(createGauge(rejected.args),/rejected/);
assert.equal(rejected.calls.filter(call=>call[0]==="atomic").length,1);
assert.doesNotMatch(source.slice(end),/\.createGauge\(/);
console.log("PASS: seed creates gauge and native 100% fee/liquidity-emission policy atomically; invalid inputs fail closed (offline).");
