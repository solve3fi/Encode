import test from "node:test";
import assert from "node:assert/strict";
import {liquidityRangeFixture} from "../../tests/fixtures/quest-position-timeline.mjs";
import {runPositionTimelineFeedRound} from "./position-timeline-feed.mjs";
function fixture(slot=1100) {
 const anchor=liquidityRangeFixture().anchor,calls=[];
 return {anchor,calls,connection:{getGenesisHash:async()=>"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",getSlot:async commitment=>{assert.equal(commitment,"finalized");return slot;}},publisher:{publish:async range=>{calls.push(range);return {watermarkPublished:true,awardEligible:false,coveredThroughSlot:range.endSlot,coverageRevision:String(calls.length)};}}};
}
test("feed pins one finalized end and publishes a bounded contiguous round",async()=>{
 const f=fixture(),out=await runPositionTimelineFeedRound({...f,maxRanges:2});
 assert.deepEqual(f.calls,[{startSlot:f.anchor.firstReplaySlot,endSlot:f.anchor.firstReplaySlot+255},{startSlot:f.anchor.firstReplaySlot+256,endSlot:f.anchor.firstReplaySlot+511}]);
 assert.equal(out.caughtUp,false);assert.equal(out.awardEligible,false);
});
test("feed resumes coverage and truncates at the finalized end",async()=>{
 const f=fixture(550),out=await runPositionTimelineFeedRound({...f,coveredThroughSlot:530});
 assert.deepEqual(f.calls,[{startSlot:531,endSlot:550}]);assert.equal(out.caughtUp,true);
});
test("caught-up feed performs no publication",async()=>{
 const f=fixture(550);assert.equal((await runPositionTimelineFeedRound({...f,coveredThroughSlot:550})).publications.length,0);assert.equal(f.calls.length,0);
});
test("wrong RPC, invalid bounds and future coverage refuse before writing",async()=>{
 for(const config of [{maxRanges:17},{slotsPerRange:257},{coveredThroughSlot:1101}]) {
  const f=fixture();await assert.rejects(runPositionTimelineFeedRound({...f,...config}));assert.equal(f.calls.length,0);
 }
 const f=fixture();f.connection.getGenesisHash=async()=>"wrong";await assert.rejects(runPositionTimelineFeedRound(f),/RPC network/);assert.equal(f.calls.length,0);
});
test("quarantine, incomplete publication and publisher errors stop the round",async()=>{
 for(const response of [{quarantined:true},{watermarkPublished:false}]) {
  const f=fixture();f.publisher.publish=async range=>{f.calls.push(range);return response;};await assert.rejects(runPositionTimelineFeedRound(f));assert.equal(f.calls.length,1);
 }
 const f=fixture();f.publisher.publish=async()=>{throw new Error("stale coverage");};await assert.rejects(runPositionTimelineFeedRound(f),/stale coverage/);
});
test("a future anchor cannot be reported as caught up",async()=>{
 const f=fixture(0);await assert.rejects(runPositionTimelineFeedRound(f),/anchor is not finalized/);assert.equal(f.calls.length,0);
});
test("a later failure stops after the already committed range",async()=>{
 const f=fixture();const publish=f.publisher.publish;
 f.publisher.publish=async range=>{if(f.calls.length) throw new Error("RPC unavailable");return publish(range);};
 await assert.rejects(runPositionTimelineFeedRound(f),/RPC unavailable/);
 assert.equal(f.calls.length,1);
 const resumed=fixture(1100);await runPositionTimelineFeedRound({...resumed,coveredThroughSlot:f.calls[0].endSlot,maxRanges:1});
 assert.equal(resumed.calls[0].startSlot,f.calls[0].endSlot+1);
});
test("busy transaction bound narrows complete ranges and preserves contiguous publication",async()=>{
 const f=fixture(1100),attempts=[],publish=f.publisher.publish;
 f.publisher.publish=async range=>{attempts.push(range);if(range.endSlot-range.startSlot+1>64)throw new Error("Liquidity replay: bounded full blocks required");return publish(range);};
 const result=await runPositionTimelineFeedRound({...f,maxRanges:2});
 assert.deepEqual(attempts.map(r=>r.endSlot-r.startSlot+1),[256,128,64,64]);
 assert.equal(result.effectiveSlotsPerRange,64);assert.equal(f.calls[1].startSlot,f.calls[0].endSlot+1);
});
test("a single oversized block refuses rather than skipping it",async()=>{
 const f=fixture(),attempts=[];f.publisher.publish=async range=>{attempts.push(range);throw new Error("Ownership range: transaction bound exceeded");};
 await assert.rejects(runPositionTimelineFeedRound(f),/transaction bound/);assert.equal(attempts.length,9);assert.equal(attempts.at(-1).startSlot,attempts.at(-1).endSlot);assert.equal(f.calls.length,0);
});
