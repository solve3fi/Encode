import {isDeepStrictEqual} from "node:util";
import {pathToFileURL} from "node:url";
import {verifyOwnershipRangeAnchor} from "./position-ownership-block-range.mjs";
import {timelineInteger} from "./position-timeline-integrity.mjs";
import {createPositionTimelinePublisher} from "./position-timeline-service.mjs";

const GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const fail=message=>{throw new Error(`LP timeline feed: ${message}`);};
function bounded(value,max) {timelineInteger(value);if(value<1||value>max) fail("invalid round bound");return value;}

// SQL state only proposes the next range. The publisher independently verifies
// pins, complete evidence, continuity, quarantine and current coverage atomically.
export async function runPositionTimelineFeedRound({anchor,connection,publisher,coveredThroughSlot=null,maxRanges=4,slotsPerRange=256}) {
 const p=verifyOwnershipRangeAnchor(anchor);anchor=p.bundle;
 bounded(maxRanges,16);bounded(slotsPerRange,256);
 if(typeof publisher?.publish!=="function") fail("verified publisher required");
 if(await connection.getGenesisHash()!==GENESIS) fail("RPC network differs");
 const finalized=timelineInteger(await connection.getSlot("finalized"));
 if(finalized<anchor.anchorSlot) fail("anchor is not finalized");
 let next=anchor.firstReplaySlot;
 if(coveredThroughSlot!==null) {
  timelineInteger(coveredThroughSlot);
  if(coveredThroughSlot<anchor.firstReplaySlot||coveredThroughSlot>finalized) fail("coverage outside finalized prefix");
  next=coveredThroughSlot+1;
 }
 const publications=[];
 let rangeWidth=slotsPerRange;
 for(let i=0;i<maxRanges&&next<=finalized;i++) {
  let endSlot=Math.min(finalized,next+rangeWidth-1),result;
  for(;;){
   try{result=await publisher.publish({startSlot:next,endSlot});break;}
   catch(error){
    // These exact decoder bounds refuse before SQL publication. Busy blocks
    // require smaller complete ranges, never filtered or skipped transactions.
    if(!["Liquidity replay: bounded full blocks required","Ownership range: transaction bound exceeded"].includes(error?.message)||endSlot===next)throw error;
    rangeWidth=Math.max(1,Math.floor((endSlot-next+1)/2));endSlot=Math.min(finalized,next+rangeWidth-1);
   }
  }
  if(result?.quarantined===true) fail("campaign quarantined during publication");
  if(result?.watermarkPublished!==true||result.coveredThroughSlot!==endSlot||result.awardEligible!==false) fail("publication did not verify requested coverage");
  publications.push({startSlot:next,endSlot,coverageRevision:result.coverageRevision});
  next=endSlot+1;
 }
 return {state:"TEST_ONLY_LP_FEED_ROUND",awardEligible:false,campaignId:anchor.campaignId,finalizedThroughSlot:finalized,publications,nextSlot:next,caughtUp:next>finalized,effectiveSlotsPerRange:rangeWidth};
}

export async function loadPositionTimelineFeedState(pool,{campaignId,environmentId,manifestSha256}) {
 if(typeof campaignId!=="string"||!campaignId||campaignId.length>200||typeof environmentId!=="string"||!environmentId||!/^[0-9a-f]{64}$/.test(manifestSha256)) fail("explicit identity pins required");
 const client=await pool.connect();let begun=false;
 try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");begun=true;
  await client.query("SET LOCAL statement_timeout='5000ms'");
  const env=await client.query("SELECT network,genesis_hash,environment_id::text,manifest_sha256,namespace FROM quest.environment_identity WHERE singleton=true");
  if(env.rows.length!==1||!isDeepStrictEqual(env.rows[0],{network:"DEVNET",genesis_hash:GENESIS,environment_id:environmentId,manifest_sha256:manifestSha256,namespace:"quest"})) fail("database identity differs");
  const selected=await client.query("SELECT evidence_bundle FROM quest.position_baseline_anchors WHERE campaign_id=$1",[campaignId]);
  if(selected.rows.length!==1) fail("selected-position anchor required");
  const p=verifyOwnershipRangeAnchor(selected.rows[0].evidence_bundle),anchor=p.bundle;
  if(anchor.campaignId!==campaignId||anchor.manifestSha256!==manifestSha256||anchor.network!=="DEVNET") fail("anchor pins differ");
  const quarantine=await client.query("SELECT EXISTS(SELECT 1 FROM quest.position_timeline_conflicts WHERE campaign_id=$1) OR EXISTS(SELECT 1 FROM quest.position_ownership_conflicts WHERE campaign_id=$1) AS quarantined",[campaignId]);
  if(quarantine.rows.length!==1||quarantine.rows[0].quarantined!==false) fail("campaign quarantined");
  const coverage=await client.query("SELECT anchor_sha256,decoder_version,start_slot::text,covered_through_slot::text,invalidation_reason FROM quest.position_timeline_coverage WHERE campaign_id=$1",[campaignId]);
  if(coverage.rows.length>1) fail("ambiguous coverage");
  let coveredThroughSlot=null;
  if(coverage.rows.length) {
   const c=coverage.rows[0];
   if(c.anchor_sha256!==p.evidenceSetSha256||c.decoder_version!=="position-timeline-v1"||c.start_slot!==String(anchor.firstReplaySlot)) fail("coverage pins differ");
   if(c.invalidation_reason!==null) fail("coverage invalidated; reviewed rebuild required");
   if(c.covered_through_slot!==null) coveredThroughSlot=timelineInteger(Number(c.covered_through_slot));
  }
  await client.query("COMMIT");begun=false;
  return {anchor,coveredThroughSlot};
 } catch(error) {if(begun) await client.query("ROLLBACK").catch(()=>{});throw error;}
 finally {client.release();}
}

async function main() {
 const {default:pg}=await import("pg"),{Connection}=await import("@solana/web3.js");
 const env=process.env;
 if(!env.QUEST_LP_TIMELINE_DB_URL||!env.QUEST_LP_RPC_URL) fail("dedicated database and RPC configuration required");
 const pool=new pg.Pool({connectionString:env.QUEST_LP_TIMELINE_DB_URL,max:2,statement_timeout:5000,connectionTimeoutMillis:5000});
 try {
  const state=await loadPositionTimelineFeedState(pool,{campaignId:env.QUEST_SWAP_CAMPAIGN_ID,environmentId:env.QUEST_ENVIRONMENT_ID,manifestSha256:env.QUEST_MANIFEST_SHA256});
  const connection=new Connection(env.QUEST_LP_RPC_URL,{commitment:"finalized",disableRetryOnRateLimit:true});
  const publisher=createPositionTimelinePublisher({pool,anchor:state.anchor,connection,pagedHistory:true});
  const result=await runPositionTimelineFeedRound({...state,connection,publisher,maxRanges:Number(env.QUEST_LP_MAX_RANGES??4),slotsPerRange:Number(env.QUEST_LP_SLOTS_PER_RANGE??256)});
  console.log(JSON.stringify(result));
 } finally {await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(()=>{console.error("LP timeline feed failed; no successful round reported. Check identity, coverage, RPC and role configuration.");process.exitCode=1;});
