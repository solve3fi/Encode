import test from "node:test";
import assert from "node:assert/strict";
import {newInventoryFixture} from "../../tests/fixtures/quest-lp-inventory.mjs";
import {captureLpBaseline} from "./lp-baseline-bootstrap.mjs";
function fixture(){const f=newInventoryFixture();return {...f,pins:{network:"DEVNET",campaignId:"new-baseline",programId:f.parentAnchor.programId,layoutVersion:f.parentAnchor.layoutVersion,manifestSha256:f.parentAnchor.manifestSha256}};}
test("initial baseline starts at verified response slot and preserves selected-only evidence",async()=>{
 const f=fixture(),out=await captureLpBaseline(f);assert.equal(out.bundle.anchorSlot,20);assert.equal(out.bundle.firstReplaySlot,21);assert.equal(out.bundle.inventoryCoverage,"SELECTED_POSITIONS_ONLY");assert.equal(out.bundle.awardEligible,false);
});
test("initial baseline refuses wrong network, stale/future/missing snapshots and duplicate inventory",async()=>{
 for(const mode of ["network","stale","future","missing","duplicate"]){const f=fixture(),read=f.connection.getMultipleAccountsInfoAndContext;
  if(mode==="network")f.connection.getGenesisHash=async()=>"wrong";
  if(mode==="duplicate")f.inventory.push(f.inventory[0]);
  if(mode==="future")f.connection.getSlot=async()=>19;
  if(mode==="stale")f.minContextSlot=21;
  if(mode==="missing")f.connection.getMultipleAccountsInfoAndContext=async(...args)=>{const out=await read(...args);out.value[0]=null;return out;};
  await assert.rejects(captureLpBaseline(f));
 }
});
test("baseline bootstrap revalidates raw account layout and ownership",async()=>{
 const f=fixture(),read=f.connection.getMultipleAccountsInfoAndContext;f.connection.getMultipleAccountsInfoAndContext=async(...args)=>{const out=await read(...args);out.value[0].data=Buffer.alloc(216);return out;};await assert.rejects(captureLpBaseline(f));
});
