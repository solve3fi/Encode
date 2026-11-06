import {isDeepStrictEqual} from "node:util";
import {loadPositionTimelineFeedState,runPositionTimelineFeedRound} from "./position-timeline-feed.mjs";
import {createPositionTimelinePublisher} from "./position-timeline-service.mjs";
import {createLpRoundConnection} from "./lp-rpc-fetch.mjs";

const GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const fail=()=>{throw new Error("LP feed source registry refused");};

// Discovery proposes immutable sources only. Each feed independently rechecks
// its anchor, environment, conflicts and coverage before any publication.
export async function loadLpFeedSources(pool,{campaignId,environmentId,manifestSha256}) {
 if(typeof campaignId!=="string"||!campaignId||campaignId.length>200||typeof environmentId!=="string"||!environmentId||!/^[a-f0-9]{64}$/.test(manifestSha256))fail();
 const db=await pool.connect();let begun=false;
 try {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");begun=true;
  await db.query("SET LOCAL statement_timeout='5000ms'");
  const identity=await db.query("SELECT network,genesis_hash,environment_id::text,manifest_sha256,namespace FROM quest.environment_identity WHERE singleton=true");
  if(identity.rows.length!==1||!isDeepStrictEqual(identity.rows[0],{network:"DEVNET",genesis_hash:GENESIS,environment_id:environmentId,manifest_sha256:manifestSha256,namespace:"quest"}))fail();
  const parent=await db.query("SELECT campaign_id FROM quest.position_baseline_anchors WHERE campaign_id=$1",[campaignId]);
  if(parent.rows.length!==1||parent.rows[0].campaign_id!==campaignId)fail();
  const cohorts=await db.query('SELECT cohort_campaign_id FROM quest.lp_inventory_cohorts WHERE parent_campaign_id=$1 ORDER BY cohort_campaign_id COLLATE "C" LIMIT 17',[campaignId]);
  if(cohorts.rows.length>16)fail();
  const ids=[campaignId,...cohorts.rows.map(row=>row.cohort_campaign_id)];
  if(ids.some(id=>typeof id!=="string"||!id||id.length>200)||new Set(ids).size!==ids.length)fail();
  await db.query("COMMIT");begun=false;return ids;
 }catch(error){if(begun)await db.query("ROLLBACK").catch(()=>{});throw error;}finally{db.release();}
}

// Sequential rounds avoid multiplying RPC/SQL load. A quarantined cohort does
// not starve other sources. No raw exceptions, endpoints or credentials escape.
export async function runLpFeedOperationsRound({pool,connection,identity,maxRanges=4,slotsPerRange=256,signal,loadSources=loadLpFeedSources,runSource}) {
 if(!Number.isSafeInteger(maxRanges)||maxRanges<1||maxRanges>16||!Number.isSafeInteger(slotsPerRange)||slotsPerRange<1||slotsPerRange>256)throw new Error("LP feed bounds refused");
 if(signal?.aborted)return {state:"TEST_ONLY_LP_FEED_STOPPED",awardEligible:false,sources:[]};
 const ids=await loadSources(pool,identity);
 if(!Array.isArray(ids)||ids.length<1||ids.length>17||new Set(ids).size!==ids.length)fail();
 const execute=runSource??(async campaignId=>{
  const state=await loadPositionTimelineFeedState(pool,{...identity,campaignId});
  const roundConnection=createLpRoundConnection(connection,state.anchor.anchorSlot);
  return runPositionTimelineFeedRound({...state,connection:roundConnection,publisher:createPositionTimelinePublisher({pool,anchor:state.anchor,connection:roundConnection,pagedHistory:true}),maxRanges,slotsPerRange});
 });
 const sources=[];
 for(const campaignId of ids){
  if(signal?.aborted)break;
  try {
   const result=await execute(campaignId);
   if(result?.state!=="TEST_ONLY_LP_FEED_ROUND"||result.awardEligible!==false||result.campaignId!==campaignId||typeof result.caughtUp!=="boolean"||!Array.isArray(result.publications)||result.publications.length>maxRanges||!Number.isSafeInteger(result.nextSlot)||!Number.isSafeInteger(result.finalizedThroughSlot))throw new Error("Invalid feed receipt");
   sources.push({campaignId,state:result.caughtUp?"CAUGHT_UP":"CATCHING_UP",publishedRanges:result.publications.length,nextSlot:result.nextSlot,finalizedThroughSlot:result.finalizedThroughSlot,lagSlots:Math.max(0,result.finalizedThroughSlot-result.nextSlot+1)});
  }catch{sources.push({campaignId,state:"REFUSED",code:"SOURCE_VERIFICATION_OR_PUBLICATION_FAILED"});}
 }
 return {state:signal?.aborted?"TEST_ONLY_LP_FEED_STOPPED":"TEST_ONLY_LP_FEED_OPERATIONS",awardEligible:false,registeredSources:ids.length,sources};
}
