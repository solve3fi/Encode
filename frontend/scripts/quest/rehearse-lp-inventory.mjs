import assert from "node:assert/strict";
import {readdir,readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import pg from "pg";
import {liquidityRangeFixture,timelineConnection} from "../../tests/fixtures/quest-position-timeline.mjs";
import {preparePositionBaselineAnchor} from "./position-baseline-anchor.mjs";
import {verifyOwnershipRangeAnchor} from "./position-ownership-block-range.mjs";
import {admitLpInventoryCohort,createLpInventoryTimelineReader,captureLpInventoryCohort} from "./lp-inventory-cohorts.mjs";
import {createPositionTimelinePublisher} from "./position-timeline-service.mjs";
import {newInventoryFixture} from "../../tests/fixtures/quest-lp-inventory.mjs";
import {readerGrants,xpWriterGrants} from "../../deploy/quest-backend/swap-grants.mjs";
const conn={host:process.env.QUEST_TEST_PG_HOST??'127.0.0.1',port:Number(process.env.QUEST_TEST_PG_PORT??5432),user:process.env.QUEST_TEST_PG_USER??'postgres'};
const stamp=`${Date.now()}_${process.pid}`,database=`quest_inventory_${stamp}`,role=`quest_inventory_reader_${stamp}`;
const admin=new pg.Client({...conn,database:'postgres'});await admin.connect();let pool,created=false,roleCreated=false;
try {
 await admin.query(`CREATE DATABASE "${database}"`);created=true;pool=new pg.Pool({...conn,database,max:4});
 for(const folder of ['db/migrations','db/quest/migrations']) {const base=fileURLToPath(new URL(`../../${folder}/`,import.meta.url));for(const file of (await readdir(base)).filter(f=>f.endsWith('.sql')).sort())await pool.query(await readFile(base+file,'utf8'));}
 const root=liquidityRangeFixture(),p=verifyOwnershipRangeAnchor(root.anchor),environment={network:'DEVNET',environmentId:'11111111-1111-4111-8111-111111111111',manifestSha256:root.anchor.manifestSha256};
 await pool.query("INSERT INTO quest.environment_identity(network,genesis_hash,environment_id,manifest_sha256,namespace) VALUES('DEVNET','EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',$1,$2,'quest')",[environment.environmentId,environment.manifestSha256]);
 await pool.query("INSERT INTO quest.position_baseline_anchors(campaign_id,network,program_id,layout_version,anchor_slot,manifest_sha256,inventory_sha256,evidence_set_sha256,position_count,evidence_bundle) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[root.anchor.campaignId,root.anchor.network,root.anchor.programId,root.anchor.layoutVersion,root.anchor.anchorSlot,root.anchor.manifestSha256,p.inventorySha256,p.evidenceSetSha256,1,root.anchor]);
 const f=newInventoryFixture();f.parentAnchor=root.anchor;
 const prepared=await captureLpInventoryCohort(f);
 assert.equal((await admitLpInventoryCohort({pool,parentCampaignId:root.anchor.campaignId,prepared,environment})).created,true);
 assert.equal((await admitLpInventoryCohort({pool,parentCampaignId:root.anchor.campaignId,prepared,environment})).created,false);
 console.log('ok - verified admission is atomic and exactly replayable');
 const raw=structuredClone(prepared.bundle.evidence[0].raw),duplicate=preparePositionBaselineAnchor({...prepared.bundle,campaignId:'duplicate-cohort',snapshots:[raw]});
 await assert.rejects(admitLpInventoryCohort({pool,parentCampaignId:root.anchor.campaignId,prepared:duplicate,environment}),/already admitted/);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM quest.position_baseline_anchors WHERE campaign_id='duplicate-cohort'")).rows[0].n,0);
 console.log('ok - duplicate admission rolls back its new anchor');
 // Root and cohort share the same actual produced blocks; transactions can be
 // unrelated to the new position and are still checked by the full-block reader.
 root.endSlot=21;
 root.producedSlots.push(21);root.blocks.push({slot:21,block:{...root.blocks[0].block,blockTime:1100,parentSlot:20,previousBlockhash:root.blocks[0].block.blockhash,blockhash:'11111111111111111111111111111113',transactions:[]}});
 await createPositionTimelinePublisher({pool,anchor:root.anchor,connection:timelineConnection(root),pagedHistory:true}).publish(root);
 const cohort={anchor:prepared.bundle,startSlot:21,endSlot:21,producedSlots:[21],blocks:[root.blocks[1]]};
 const cohortConnection=timelineConnection(cohort,[],{anchorTime:1000,anchorHash:root.blocks[0].block.blockhash});
 await createPositionTimelinePublisher({pool,anchor:prepared.bundle,connection:cohortConnection,pagedHistory:true}).publish(cohort);
 const reader=createLpInventoryTimelineReader({pool,campaignId:root.anchor.campaignId,environment});
 const before=await reader.read({endSlot:20});assert.equal(before.intervalPositions.length,1);
 const after=await reader.read({endSlot:21});assert.equal(after.intervalPositions.length,2);assert.equal(after.inventoryProof.sources.length,2);
 assert.deepEqual(after.intervalPositions.find(x=>x.positionAddress===f.inventory[0].positionAddress).intervals.map(i=>[i.startsAtSeconds,i.endsAtSeconds]),[[1000,1100]]);
 console.log('ok - composite history adds no position or duration before admission');
 const valid=await pool.query("SELECT quest.lock_lp_inventory_source($1,$2,$3,$4) AS valid",[root.anchor.campaignId,after.inventoryProof.inventoryRevision,JSON.stringify(after.inventoryProof.sources),21]);assert.equal(valid.rows[0].valid,true);
 const missing=await pool.query("SELECT quest.lock_lp_inventory_source($1,$2,$3,$4) AS valid",[root.anchor.campaignId,1,JSON.stringify(after.inventoryProof.sources.slice(0,1)),21]);assert.equal(missing.rows[0].valid,false);
 const stale=await pool.query("SELECT quest.lock_lp_inventory_source($1,$2,$3,$4) AS valid",[root.anchor.campaignId,0,JSON.stringify(after.inventoryProof.sources),21]);assert.equal(stale.rows[0].valid,false);
 console.log('ok - receipt lock requires exact current inventory and every active coverage source');
 await admin.query(`CREATE ROLE "${role}" NOLOGIN`);roleCreated=true;for(const sql of xpWriterGrants(`"${role}"`))await pool.query(sql);
 const restricted={async connect(){const client=await pool.connect();await client.query(`SET ROLE "${role}"`);return {query:(...args)=>client.query(...args),async release(error){await client.query('RESET ROLE');client.release(error);}};}};
 assert.equal((await createLpInventoryTimelineReader({pool:restricted,campaignId:root.anchor.campaignId,environment}).read({endSlot:21})).intervalPositions.length,2);
 const probe=await restricted.connect();try{await assert.rejects(probe.query("INSERT INTO quest.lp_inventory_cohorts VALUES('x','y')"),/permission denied/);}finally{await probe.release();}
 console.log('ok - serving/receipt grants can read cohorts but cannot admit positions');
 await pool.query("UPDATE quest.position_timeline_coverage SET covered_through_slot=NULL,last_range_start=NULL,last_range_sha256=NULL,revision=revision+1,invalidation_reason='LATE_EVIDENCE' WHERE campaign_id=$1",[prepared.bundle.campaignId]);
 await assert.rejects(reader.read({endSlot:21}),/coverage required/);
 const invalid=await pool.query("SELECT quest.lock_lp_inventory_source($1,$2,$3,$4) AS valid",[root.anchor.campaignId,1,JSON.stringify(after.inventoryProof.sources),21]);assert.equal(invalid.rows[0].valid,false);
 console.log('ok - cohort invalidation rejects progress and stale receipt proofs');
 const second=newInventoryFixture({mintAddress:'11111111111111111111111111111116',tokenAddress:'11111111111111111111111111111117'});second.parentAnchor=root.anchor;second.campaignId='inventory-cohort-two';
 const secondPrepared=await captureLpInventoryCohort(second);
 const race=await Promise.allSettled([admitLpInventoryCohort({pool,parentCampaignId:root.anchor.campaignId,prepared:secondPrepared,environment}),admitLpInventoryCohort({pool,parentCampaignId:root.anchor.campaignId,prepared:secondPrepared,environment})]);
 assert.ok(race.every(r=>r.status==='fulfilled'));assert.deepEqual(race.map(r=>r.value.created).sort(),[false,true]);
 const changed=await pool.query("SELECT quest.lock_lp_inventory_source($1,$2,$3,$4) AS valid",[root.anchor.campaignId,1,JSON.stringify(after.inventoryProof.sources),21]);assert.equal(changed.rows[0].valid,false);
 console.log('ok - concurrent same admission initializes once; added inventory rejects old receipt revision');
 await assert.rejects(pool.query('DELETE FROM quest.lp_inventory_cohorts'),/immutable/);
 const transaction=await pool.connect();try{await transaction.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await assert.rejects(transaction.query("INSERT INTO quest.lp_inventory_cohorts(parent_campaign_id,cohort_campaign_id) VALUES($1,$2)",[root.anchor.campaignId,'not-existing']),/requires read committed/);await transaction.query('ROLLBACK');}finally{transaction.release();}
 console.log('ok - admitted registry is immutable and refuses stale write transactions');
 console.log('LP inventory rehearsal passed: 8 checks');
}finally{
 await pool?.end();
 if(created){
  // pg.Pool.end resolves after issuing socket close, before the server has
  // necessarily retired every backend. FORCE can race that close and emit an
  // unhandled client error after all assertions passed. Wait for actual exit.
  for(let attempt=0;attempt<100;attempt++){
   const active=await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1",[database]);
   if(active.rows[0].n===0)break;
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  await admin.query(`DROP DATABASE "${database}"`);
 }
 if(roleCreated)await admin.query(`DROP ROLE "${role}"`);await admin.end();
}
