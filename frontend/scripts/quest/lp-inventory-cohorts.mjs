import {isDeepStrictEqual} from "node:util";
import {PublicKey} from "@solana/web3.js";
import {preparePositionBaselineAnchor} from "./position-baseline-anchor.mjs";
import {verifyOwnershipRangeAnchor} from "./position-ownership-block-range.mjs";
import {createPositionTimelineReader} from "./position-timeline-service.mjs";
import {timelineInteger} from "./position-timeline-integrity.mjs";
const GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const fail=message=>{throw new Error(`LP inventory: ${message}`);};

// One response context for every position/mint/NFT account in this admission.
// minContextSlot is a lower bound; credit starts at the returned finalized slot.
export async function captureLpInventoryCohort({connection,parentAnchor,campaignId,inventory,minContextSlot}) {
 const parent=verifyOwnershipRangeAnchor(parentAnchor).bundle;
 if(await connection.getGenesisHash()!==GENESIS) fail("RPC network differs");
 timelineInteger(minContextSlot);
 if(minContextSlot<parent.anchorSlot||campaignId===parent.campaignId||!Array.isArray(inventory)||inventory.length<1||inventory.length>32) fail("bounded new inventory and cohort identity required");
 const addresses=inventory.flatMap(row=>[row.positionAddress,row.positionMint,row.tokenAccountAddress]);
 if(new Set(addresses).size!==addresses.length) fail("duplicate admission accounts");
 const response=await connection.getMultipleAccountsInfoAndContext(addresses.map(a=>new PublicKey(a)),{commitment:"finalized",minContextSlot});
 timelineInteger(response?.context?.slot);
 if(response.context.slot<minContextSlot||!Array.isArray(response.value)||response.value.length!==addresses.length) fail("incomplete or stale snapshot");
 if(response.context.slot>timelineInteger(await connection.getSlot("finalized"))) fail("unfinalized snapshot");
 const snapshots=inventory.map((row,i)=>{
  const raw=offset=>{const account=response.value[i*3+offset];if(!account||!Buffer.isBuffer(account.data)||account.data.length>216) fail("unsupported admission account");return {address:addresses[i*3+offset],owner:account.owner.toBase58(),executable:account.executable,dataBase64:account.data.toString("base64")};};
  return {network:"DEVNET",finality:"finalized",slot:response.context.slot,programId:parent.programId,layoutVersion:parent.layoutVersion,positionAccount:raw(0),mintAccount:raw(1),tokenAccount:raw(2)};
 });
 return preparePositionBaselineAnchor({network:"DEVNET",campaignId,programId:parent.programId,layoutVersion:parent.layoutVersion,manifestSha256:parent.manifestSha256,anchorSlot:response.context.slot,inventory,snapshots});
}

// Trusted operator admission only; the serving/feed roles cannot insert anchors.
export async function admitLpInventoryCohort({pool,parentCampaignId,prepared,environment}) {
 const p=verifyOwnershipRangeAnchor(prepared?.bundle),anchor=p.bundle;
 const db=await pool.connect();let begun=false;
 try {
  await db.query("BEGIN ISOLATION LEVEL READ COMMITTED");begun=true;
  await db.query("SET LOCAL statement_timeout='5000ms'");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('lp-inventory-admission',61747))");
  const identity=await db.query("SELECT network,genesis_hash,environment_id::text,manifest_sha256,namespace FROM quest.environment_identity WHERE singleton=true");
  if(identity.rows.length!==1||!isDeepStrictEqual(identity.rows[0],{network:"DEVNET",genesis_hash:GENESIS,environment_id:environment.environmentId,manifest_sha256:environment.manifestSha256,namespace:"quest"})||anchor.manifestSha256!==environment.manifestSha256) fail("database identity differs");
  const existing=await db.query("SELECT evidence_bundle FROM quest.position_baseline_anchors WHERE campaign_id=$1",[anchor.campaignId]);
  if(existing.rows.length) {if(existing.rows.length!==1||!isDeepStrictEqual(existing.rows[0].evidence_bundle,anchor)) fail("cohort anchor conflict");}
  else await db.query("INSERT INTO quest.position_baseline_anchors(campaign_id,network,program_id,layout_version,anchor_slot,manifest_sha256,inventory_sha256,evidence_set_sha256,position_count,evidence_bundle) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[anchor.campaignId,anchor.network,anchor.programId,anchor.layoutVersion,anchor.anchorSlot,anchor.manifestSha256,p.inventorySha256,p.evidenceSetSha256,anchor.inventory.length,anchor]);
  const registered=await db.query("SELECT parent_campaign_id FROM quest.lp_inventory_cohorts WHERE cohort_campaign_id=$1",[anchor.campaignId]);
  if(registered.rows.length) {if(registered.rows[0].parent_campaign_id!==parentCampaignId) fail("cohort belongs to another parent");}
  else await db.query("INSERT INTO quest.lp_inventory_cohorts(parent_campaign_id,cohort_campaign_id) VALUES($1,$2)",[parentCampaignId,anchor.campaignId]);
  await db.query("COMMIT");begun=false;
  return {state:"TEST_ONLY_LP_INVENTORY_ADMISSION",awardEligible:false,parentCampaignId,campaignId:anchor.campaignId,anchorSlot:anchor.anchorSlot,anchorSha256:p.evidenceSetSha256,created:registered.rows.length===0};
 } catch(error){if(begun)await db.query("ROLLBACK").catch(()=>{});throw error;}finally{db.release();}
}

export function createLpInventoryTimelineReader({pool,campaignId,environment}) {
 return {async read({endSlot}) {
  timelineInteger(endSlot);
  const db=await pool.connect();let begun=false;
  try {
   await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");begun=true;
   await db.query("SET LOCAL statement_timeout='2500ms'");
   const registered=await db.query("SELECT cohort_campaign_id FROM quest.lp_inventory_cohorts WHERE parent_campaign_id=$1 ORDER BY cohort_campaign_id COLLATE \"C\" LIMIT 17",[campaignId]);
   if(registered.rows.length>16) fail("cohort bound exceeded");
   const ids=[campaignId,...registered.rows.map(r=>r.cohort_campaign_id)];
   const selected=await db.query("SELECT campaign_id,evidence_bundle FROM quest.position_baseline_anchors WHERE campaign_id=ANY($1::text[]) ORDER BY campaign_id COLLATE \"C\"",[ids]);
   if(selected.rows.length!==ids.length) fail("complete admitted anchors required");
   // Existing readers retain all validation while sharing this outer snapshot.
   const shared={async connect(){return {query:async(sql,args)=> /^(BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|COMMIT|ROLLBACK)$/.test(sql)?{rows:[]}:db.query(sql,args),release(){}};}};
   const parentRow=selected.rows.find(r=>r.campaign_id===campaignId);
   if(!parentRow)fail("parent anchor required");
   const parent=verifyOwnershipRangeAnchor(parentRow.evidence_bundle).bundle;
   const packets=[],seenPositions=new Set(),seenMints=new Set();let packetBytes=0,intervalCount=0;
   for(const row of selected.rows) {
    const anchor=verifyOwnershipRangeAnchor(row.evidence_bundle).bundle;
    if(anchor.campaignId!==row.campaign_id||anchor.manifestSha256!==environment.manifestSha256||anchor.programId!==parent.programId||anchor.layoutVersion!==parent.layoutVersion||anchor.anchorSlot<parent.anchorSlot) fail("admitted anchor pins differ");
    for(const position of anchor.inventory) {if(seenPositions.has(position.positionAddress)||seenMints.has(position.positionMint)) fail("duplicate admitted position or mint");seenPositions.add(position.positionAddress);seenMints.add(position.positionMint);}
    if(anchor.anchorSlot>=endSlot) continue; // No history or credit before admission.
    const packet=await createPositionTimelineReader({pool:shared,anchor,environment,pagedHistory:true,conservativeLinkTimes:true}).read({endSlot});
    packetBytes+=Buffer.byteLength(JSON.stringify(packet));intervalCount+=packet.intervalPositions.reduce((n,p)=>n+p.intervals.length,0);
    if(packetBytes>16_777_216||intervalCount>20000)fail("combined inventory projection bound exceeded");
    packets.push(packet);
   }
   const root=packets.find(p=>p.campaignId===campaignId);if(!root)fail("parent coverage required");
   const histories=new Map();
   for(const packet of packets) for(const history of packet.histories) {const old=histories.get(history.wallet);if(old&&!isDeepStrictEqual(old,history))fail("wallet histories differ within snapshot");histories.set(history.wallet,history);}
   const sources=packets.map(p=>({campaignId:p.campaignId,anchorSha256:p.anchorSha256,coverageRevision:String(p.coverageRevision)}));
   const output={...root,campaignId,endSlot,positions:packets.flatMap(p=>p.positions),intervalPositions:packets.flatMap(p=>p.intervalPositions),histories:[...histories.values()],coveredThroughSlot:Math.min(...packets.map(p=>p.coveredThroughSlot)),measuredThroughSeconds:Math.min(...packets.map(p=>p.measuredThroughSeconds)),inventoryProof:{campaignId,inventoryRevision:String(registered.rows.length),sources}};
   if(Buffer.byteLength(JSON.stringify(output))>16_777_216||output.intervalPositions.reduce((n,p)=>n+p.intervals.length,0)>20000)fail("combined inventory projection bound exceeded");
   await db.query("COMMIT");begun=false;return output;
  }catch(error){if(begun)await db.query("ROLLBACK").catch(()=>{});throw error;}finally{db.release();}
 }};
}