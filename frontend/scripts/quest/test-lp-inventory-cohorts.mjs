import test from "node:test";
import assert from "node:assert/strict";
import {PublicKey} from "@solana/web3.js";
import {liquidityRangeFixture} from "../../tests/fixtures/quest-position-timeline.mjs";
import {captureLpInventoryCohort} from "./lp-inventory-cohorts.mjs";
import {newInventoryFixture} from "../../tests/fixtures/quest-lp-inventory.mjs";
test("new inventory begins at the actual finalized response slot",async()=>{
 const f=newInventoryFixture(),p=await captureLpInventoryCohort(f);
 assert.equal(p.bundle.anchorSlot,20);assert.equal(p.bundle.firstReplaySlot,21);assert.equal(p.bundle.awardEligible,false);
 assert.equal(p.bundle.evidence[0].observation.positionAddress,f.inventory[0].positionAddress);
});
test("admission refuses wrong RPC, stale snapshots, duplicates and bad account bytes",async()=>{
 let f=newInventoryFixture();f.connection.getGenesisHash=async()=>"wrong";await assert.rejects(captureLpInventoryCohort(f),/RPC network/);
 f=newInventoryFixture();await assert.rejects(captureLpInventoryCohort({...f,minContextSlot:21}),/stale/);
 f=newInventoryFixture();await assert.rejects(captureLpInventoryCohort({...f,inventory:[...f.inventory,...f.inventory]}),/duplicate/);
 f=newInventoryFixture();f.connection.getSlot=async()=>19;await assert.rejects(captureLpInventoryCohort(f),/unfinalized/);
 f=newInventoryFixture();const read=f.connection.getMultipleAccountsInfoAndContext;f.connection.getMultipleAccountsInfoAndContext=async(...args)=>{const out=await read(...args);out.value[1].data=Buffer.alloc(82);return out;};await assert.rejects(captureLpInventoryCohort(f),/NFT mint/);
});