import {isDeepStrictEqual} from "node:util";
import {readFile,writeFile,stat} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {captureLpInventoryCohort,admitLpInventoryCohort} from "./lp-inventory-cohorts.mjs";

// Operator-only tool: capture selected new positions from one finalized RPC
// response. Default writes a review artifact; APPLY=1 atomically registers it.
async function main() {
 const env=process.env,need=name=>{if(!env[name])throw new Error(`Missing ${name}`);return env[name];};
 const {default:pg}=await import("pg"),{Connection}=await import("@solana/web3.js");
 const pool=new pg.Pool({connectionString:need("QUEST_LP_ADMISSION_DB_URL"),max:1,connectionTimeoutMillis:5000,statement_timeout:5000});
 try {
  const parentCampaignId=need("QUEST_SWAP_CAMPAIGN_ID"),campaignId=need("QUEST_LP_COHORT_ID"),environment={environmentId:need("QUEST_ENVIRONMENT_ID"),manifestSha256:need("QUEST_MANIFEST_SHA256")};
  const path=need("QUEST_LP_NEW_INVENTORY_PATH");if((await stat(path)).size>65536)throw new Error("Inventory file too large");
  const input=await readFile(path,"utf8");if(Buffer.byteLength(input)>65536)throw new Error("Inventory file too large");
  const inventory=JSON.parse(input);
  const parents=await pool.query("SELECT evidence_bundle FROM quest.position_baseline_anchors WHERE campaign_id=$1",[parentCampaignId]);if(parents.rows.length!==1)throw new Error("Parent anchor required");
  const identity=await pool.query("SELECT network,genesis_hash,environment_id::text,manifest_sha256,namespace FROM quest.environment_identity WHERE singleton=true");
  if(identity.rows.length!==1||!isDeepStrictEqual(identity.rows[0],{network:"DEVNET",genesis_hash:"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",environment_id:environment.environmentId,manifest_sha256:environment.manifestSha256,namespace:"quest"}))throw new Error("Database identity differs");
  const parentAnchor=parents.rows[0].evidence_bundle;
  if(parentAnchor.manifestSha256!==environment.manifestSha256)throw new Error("Parent manifest differs");
  const connection=new Connection(need("QUEST_LP_RPC_URL"),{commitment:"finalized",disableRetryOnRateLimit:true});
  const minContextSlot=await connection.getSlot("finalized");
  const prepared=await captureLpInventoryCohort({connection,parentAnchor,campaignId,inventory,minContextSlot});
  const artifact={schemaVersion:1,state:"TEST_ONLY_LP_ADMISSION_REVIEW",awardEligible:false,parentCampaignId,environment,prepared};
  await writeFile(need("QUEST_LP_ADMISSION_OUTPUT"),JSON.stringify(artifact,null,2)+"\n",{flag:"wx"});
  if(env.QUEST_LP_ADMISSION_APPLY==="1") console.log(JSON.stringify(await admitLpInventoryCohort({pool,parentCampaignId,environment,prepared})));
  else console.log(JSON.stringify({state:artifact.state,awardEligible:false,campaignId,anchorSlot:prepared.bundle.anchorSlot,positionCount:inventory.length}));
 }finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error("LP admission failed. Check reviewed inventory, identity, RPC, cohort uniqueness and operator role.");process.exitCode=1;});