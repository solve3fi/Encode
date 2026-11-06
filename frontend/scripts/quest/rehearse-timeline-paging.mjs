// Disposable PostgreSQL test of the real publisher/reader across 65 ranges.
import assert from "node:assert/strict";
import {readdir,readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import pg from "pg";
import {liquidityRangeFixture,timelineExtension,timelineConnection} from "../../tests/fixtures/quest-position-timeline.mjs";
import {verifyOwnershipRangeAnchor} from "./position-ownership-block-range.mjs";
import {createPositionTimelinePublisher,createPositionTimelineReader} from "./position-timeline-service.mjs";
import {readerGrants,timelinePublisherGrants} from "../../deploy/quest-backend/swap-grants.mjs";

import {loadPositionTimelineFeedState,runPositionTimelineFeedRound} from "./position-timeline-feed.mjs";
import {loadLpFeedSources,runLpFeedOperationsRound} from "./lp-feed-operations.mjs";

const conn={host:process.env.QUEST_TEST_PG_HOST??'127.0.0.1',port:Number(process.env.QUEST_TEST_PG_PORT??5432),user:process.env.QUEST_TEST_PG_USER??'postgres',password:process.env.QUEST_TEST_PG_PASSWORD};
const stamp=`${Date.now()}_${process.pid}`, database=`quest_paging_${stamp}`, role=`quest_paging_reader_${stamp}`;
const admin=new pg.Client({...conn,database:'postgres'});
let pool,created=false,roleCreated=false;
await admin.connect();
try {
	await admin.query(`CREATE DATABASE "${database}"`);created=true;
	pool=new pg.Pool({...conn,database,max:3});
	for(const folder of ['db/migrations','db/quest/migrations']) {
		const base=fileURLToPath(new URL(`../../${folder}/`,import.meta.url));
		for(const file of (await readdir(base)).filter(name=>name.endsWith('.sql')).sort()) await pool.query(await readFile(base+file,'utf8'));
	}
	let fixture=liquidityRangeFixture({campaignId:'paging-rehearsal'});
	const anchor=fixture.anchor,p=verifyOwnershipRangeAnchor(anchor), environment={network:'DEVNET',environmentId:'11111111-1111-4111-8111-111111111111',manifestSha256:anchor.manifestSha256};
	await pool.query("INSERT INTO quest.environment_identity(network,genesis_hash,environment_id,manifest_sha256,namespace) VALUES('DEVNET','EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',$1,$2,'quest')",[environment.environmentId,environment.manifestSha256]);
	await pool.query("INSERT INTO quest.position_baseline_anchors(campaign_id,network,program_id,layout_version,anchor_slot,manifest_sha256,inventory_sha256,evidence_set_sha256,position_count,evidence_bundle) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
		[anchor.campaignId,anchor.network,anchor.programId,anchor.layoutVersion,anchor.anchorSlot,anchor.manifestSha256,p.inventorySha256,p.evidenceSetSha256,anchor.inventory.length,anchor]);
	for(let i=0;i<65;i++) {
		if(i) {fixture=timelineExtension(fixture,{slot:fixture.endSlot+1,time:1000+i,signature:`paging-rehearsal-${i}`});fixture.endSlot+=255;}
		const result=await createPositionTimelinePublisher({pool,anchor,connection:timelineConnection(fixture),pagedHistory:true}).publish(fixture);
		assert.equal(result.watermarkPublished,true);assert.equal(result.coverageRevision,String(i+1));
	}
	console.log('ok - real publisher commits 65 contiguous ranges');
	const out=await createPositionTimelineReader({pool,anchor,environment,pagedHistory:true}).read({endSlot:fixture.endSlot});
	assert.equal(out.positions[0].endSlotLiquidityRaw,String(107+64*7));
	assert.equal(out.intervalPositions[0].intervals[0].startsAtSeconds,900);
	assert.equal(out.intervalPositions[0].intervals.at(-1).endsAtSeconds,1064);
	assert.equal(out.historySemantics,'VERIFIED_PAGED_PREFIX');
	console.log('ok - real paged reader preserves liquidity and complete elapsed history beyond 64 ranges');
	await assert.rejects(createPositionTimelineReader({pool,anchor}).read({endSlot:fixture.endSlot}),/oversized/);
	console.log('ok - original bounded reader retains its limit');
	const historical=await createPositionTimelineReader({pool,anchor,pagedHistory:true}).read({endSlot:20+5*256});
	assert.equal(historical.positions[0].endSlotLiquidityRaw,String(107+5*7));
	assert.equal(historical.intervalPositions[0].intervals.at(-1).endsAtSeconds,1005);
	console.log('ok - historical cutoff checks full coverage without attributing future state');
	await admin.query(`CREATE ROLE "${role}" NOLOGIN`);roleCreated=true;
	for(const grant of readerGrants(`"${role}"`)) await pool.query(grant);
	const readPool={async connect(){const client=await pool.connect();await client.query(`SET ROLE "${role}"`);return {
		query:(...args)=>client.query(...args),async release(error){await client.query('RESET ROLE');client.release(error);}};}};
	assert.equal((await createPositionTimelineReader({pool:readPool,anchor,pagedHistory:true}).read({endSlot:fixture.endSlot})).trust,'HISTORICAL_REPEATABLE_READ_SNAPSHOT');
	console.log('ok - shared production reader grants support paged history');
	for(const grant of timelinePublisherGrants(`"${role}"`)) await pool.query(grant);
 const expected={campaignId:anchor.campaignId,environmentId:environment.environmentId,manifestSha256:environment.manifestSha256};
 const state=await loadPositionTimelineFeedState(readPool,expected);
 assert.deepEqual(await loadLpFeedSources(readPool,expected),[anchor.campaignId]);
 const operations=await runLpFeedOperationsRound({pool:readPool,identity:expected,runSource:async campaignId=>({state:'TEST_ONLY_LP_FEED_ROUND',awardEligible:false,campaignId,caughtUp:true,publications:[],nextSlot:fixture.endSlot+1,finalizedThroughSlot:fixture.endSlot})});
 assert.equal(operations.sources[0].state,'CAUGHT_UP');
 assert.equal(state.coveredThroughSlot,fixture.endSlot);
 await assert.rejects(loadPositionTimelineFeedState(readPool,{...expected,environmentId:'22222222-2222-4222-8222-222222222222'}),/identity differs/);
 fixture=timelineExtension(fixture,{slot:fixture.endSlot+1,time:1070,signature:'feed-runner-next'});
 const connection=timelineConnection(fixture);
 const round=await runPositionTimelineFeedRound({...state,connection,publisher:createPositionTimelinePublisher({pool:readPool,anchor,connection,pagedHistory:true}),maxRanges:1});
 assert.equal(round.caughtUp,true);assert.equal(round.publications.length,1);
 const probe=await readPool.connect();try {await assert.rejects(probe.query('SELECT * FROM quest.xp_events'),/permission denied/);}finally{await probe.release();}
 console.log('ok - pinned feed state and dedicated publisher role advance coverage without XP access');
 const duplicate=timelineExtension(fixture,{slot:fixture.endSlot+1,time:1100,signature:'synthetic-liquidity'});
	await assert.rejects(createPositionTimelinePublisher({pool,anchor,connection:timelineConnection(duplicate),pagedHistory:true}).publish(duplicate),/duplicate full-prefix/);
	assert.equal((await pool.query("SELECT count(*)::int AS n FROM quest.position_timeline_ranges WHERE campaign_id=$1",[anchor.campaignId])).rows[0].n,66);
	console.log('ok - cross-page duplicate signature rejects publication and rolls back the new range');
	await pool.query("UPDATE quest.position_timeline_coverage SET covered_through_slot=NULL,last_range_start=NULL,last_range_sha256=NULL,revision=revision+1,invalidation_reason='LATE_EVIDENCE' WHERE campaign_id=$1",[anchor.campaignId]);
	await assert.rejects(createPositionTimelineReader({pool,anchor,pagedHistory:true}).read({endSlot:fixture.endSlot}),/coverage required/);
	await assert.rejects(loadPositionTimelineFeedState(readPool,expected),/invalidated/);
	console.log('ok - invalidation refuses the entire paged projection and feed resume');
	console.log('timeline paging rehearsal passed: 8 checks');
} finally {
	await pool?.end();
	if(created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
	if(roleCreated) await admin.query(`DROP ROLE "${role}"`);
	await admin.end();
}
