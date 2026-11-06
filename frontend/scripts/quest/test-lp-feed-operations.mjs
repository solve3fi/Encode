import test from "node:test";
import assert from "node:assert/strict";
import {loadLpFeedSources,runLpFeedOperationsRound} from "./lp-feed-operations.mjs";

const identity={campaignId:"parent",environmentId:"environment",manifestSha256:"a".repeat(64)};
const receipt=campaignId=>({state:"TEST_ONLY_LP_FEED_ROUND",awardEligible:false,campaignId,caughtUp:true,publications:[],nextSlot:101,finalizedThroughSlot:100});
function fixture(cohorts=[{cohort_campaign_id:"new"}]){
 const calls=[];
 const db={release(){calls.push("RELEASE");},async query(sql,args){calls.push(sql);
  if(sql.includes("environment_identity"))return {rows:[{network:"DEVNET",genesis_hash:"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",environment_id:identity.environmentId,manifest_sha256:identity.manifestSha256,namespace:"quest"}]};
  if(sql.includes("position_baseline_anchors")){assert.deepEqual(args,["parent"]);return {rows:[{campaign_id:"parent"}]};}
  if(sql.includes("lp_inventory_cohorts")){assert.deepEqual(args,["parent"]);return {rows:cohorts};}
  return {rows:[]};
 }};
 return {pool:{connect:async()=>db},db,calls};
}
test("source discovery reads pinned parent and bounded registry in one read-only snapshot",async()=>{
 const f=fixture();assert.deepEqual(await loadLpFeedSources(f.pool,identity),["parent","new"]);
 assert.equal(f.calls[0],"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");assert.equal(f.calls.at(-2),"COMMIT");assert.equal(f.calls.at(-1),"RELEASE");
 assert.ok(f.calls.find(sql=>sql.includes('LIMIT 17')));
});
test("registry refuses missing parent, wrong identity, duplicate or oversized cohorts and releases SQL",async()=>{
 for(const mode of ["parent","identity","duplicate","size"]){
  const f=fixture(mode==="duplicate"?[{cohort_campaign_id:"parent"}]:mode==="size"?Array.from({length:17},(_,i)=>({cohort_campaign_id:`c${i}`})):[]);
  const query=f.db.query;f.db.query=async(sql,args)=>{if(mode==="parent"&&sql.includes("position_baseline_anchors"))return {rows:[]};if(mode==="identity"&&sql.includes("environment_identity"))return {rows:[]};return query(sql,args);};
  await assert.rejects(loadLpFeedSources(f.pool,identity));assert.equal(f.calls.at(-2),"ROLLBACK");assert.equal(f.calls.at(-1),"RELEASE");
 }
});
test("every cohort is serviced sequentially and one failure cannot starve later sources",async()=>{
 const calls=[];let active=0;
 const out=await runLpFeedOperationsRound({identity,loadSources:async()=>["parent","bad","new"],runSource:async id=>{assert.equal(active++,0);calls.push(id);await Promise.resolve();active--;if(id==="bad")throw Error("private RPC URL and password");return {...receipt(id),caughtUp:id!=="parent",publications:id==="parent"?[{}]:[]};}});
 assert.deepEqual(calls,["parent","bad","new"]);assert.deepEqual(out.sources.map(s=>s.state),["CATCHING_UP","REFUSED","CAUGHT_UP"]);assert.equal(out.awardEligible,false);assert.ok(!JSON.stringify(out).includes("password"));
});
test("a new registry is loaded each round",async()=>{
 let round=0;const calls=[];const config={loadSources:async()=>++round===1?["parent"]:["parent","new"],runSource:async id=>{calls.push(id);return receipt(id);}};
 await runLpFeedOperationsRound(config);await runLpFeedOperationsRound(config);assert.deepEqual(calls,["parent","parent","new"]);
});
test("abort finishes current bounded publication then skips remaining sources",async()=>{
 const controller=new AbortController(),calls=[];
 const out=await runLpFeedOperationsRound({signal:controller.signal,loadSources:async()=>["parent","new"],runSource:async id=>{calls.push(id);controller.abort();return receipt(id);}});
 assert.deepEqual(calls,["parent"]);assert.equal(out.state,"TEST_ONLY_LP_FEED_STOPPED");assert.equal(out.registeredSources,2);
});
test("already aborted worker neither reads SQL nor publishes",async()=>{
 const controller=new AbortController();controller.abort();const out=await runLpFeedOperationsRound({signal:controller.signal,loadSources:async()=>assert.fail("SQL read")});assert.equal(out.state,"TEST_ONLY_LP_FEED_STOPPED");
});
test("invalid receipt and accidental eligible result are sanitized failures",async()=>{
 for(const patch of [{awardEligible:true},{campaignId:"other"},{nextSlot:NaN},{publications:Array(5).fill({})},{caughtUp:undefined}]){
  const out=await runLpFeedOperationsRound({loadSources:async()=>["parent"],runSource:async()=>({...receipt("parent"),...patch})});assert.equal(out.sources[0].state,"REFUSED");
 }
});
test("invalid global bounds refuse before discovery",async()=>{
 for(const patch of [{maxRanges:0},{maxRanges:17},{slotsPerRange:257},{maxRanges:1.5}])await assert.rejects(runLpFeedOperationsRound({...patch,loadSources:async()=>assert.fail("discovered")}));
});
