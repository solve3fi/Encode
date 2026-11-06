import {PublicKey} from "@solana/web3.js";
import {isDeepStrictEqual} from "node:util";
import {readFile,writeFile,stat} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {preparePositionBaselineAnchor,createPositionBaselineAnchorStore} from "./position-baseline-anchor.mjs";
const GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

// Establish only selected positions at one actual finalized response slot.
// The RPC lower bound is never treated as a historical snapshot timestamp.
export async function captureLpBaseline({connection,pins,inventory,minContextSlot}) {
 if(pins?.network!=="DEVNET"||pins.layoutVersion!=="solve-position-v1"||!Number.isSafeInteger(minContextSlot)||minContextSlot<0||!Array.isArray(inventory)||inventory.length<1||inventory.length>32)throw new Error("LP baseline inputs refused");
 if(await connection.getGenesisHash()!==GENESIS)throw new Error("LP baseline RPC network differs");
 const addresses=inventory.flatMap(row=>[row.positionAddress,row.positionMint,row.tokenAccountAddress]);
 if(new Set(addresses).size!==addresses.length)throw new Error("LP baseline duplicate accounts");
 const response=await connection.getMultipleAccountsInfoAndContext(addresses.map(a=>new PublicKey(a)),{commitment:"finalized",minContextSlot});
 const slot=response?.context?.slot;
 const finalized=await connection.getSlot("finalized");
 if(!Number.isSafeInteger(finalized)||finalized<0||!Number.isSafeInteger(slot)||slot<minContextSlot||!Array.isArray(response.value)||response.value.length!==addresses.length||slot>finalized)throw new Error("LP baseline snapshot refused");
 const snapshots=inventory.map((row,i)=>{
  const raw=offset=>{const account=response.value[i*3+offset];if(!account||!Buffer.isBuffer(account.data)||account.data.length>216)throw new Error("LP baseline account refused");return {address:addresses[i*3+offset],owner:account.owner.toBase58(),executable:account.executable,dataBase64:account.data.toString("base64")};};
  return {...pins,finality:"finalized",slot,positionAccount:raw(0),mintAccount:raw(1),tokenAccount:raw(2)};
 });
 return preparePositionBaselineAnchor({...pins,anchorSlot:slot,inventory,snapshots});
}

async function main(){
 const env=process.env,need=name=>{if(!env[name])throw new Error("Missing LP baseline setting");return env[name];};
 const {default:pg}=await import("pg"),{Connection}=await import("@solana/web3.js");
 const pool=new pg.Pool({connectionString:need("QUEST_LP_ADMISSION_DB_URL"),max:1,statement_timeout:5000,connectionTimeoutMillis:5000});
 try{
  const campaignId=need("QUEST_SWAP_CAMPAIGN_ID"),environmentId=need("QUEST_ENVIRONMENT_ID"),manifestSha256=need("QUEST_MANIFEST_SHA256"),programId=need("QUEST_SWAP_PROGRAM_ID");
  const identity=await pool.query("SELECT network,genesis_hash,environment_id::text,manifest_sha256,namespace FROM quest.environment_identity WHERE singleton=true");
  if(identity.rows.length!==1||!isDeepStrictEqual(identity.rows[0],{network:"DEVNET",genesis_hash:GENESIS,environment_id:environmentId,manifest_sha256:manifestSha256,namespace:"quest"}))throw new Error("LP baseline database differs");
  const path=need("QUEST_LP_NEW_INVENTORY_PATH");if((await stat(path)).size>65536)throw new Error("LP inventory too large");
  const input=await readFile(path,"utf8");if(Buffer.byteLength(input)>65536)throw new Error("LP inventory too large");
  const inventory=JSON.parse(input),pins={network:"DEVNET",campaignId,programId,layoutVersion:"solve-position-v1",manifestSha256};
  const connection=new Connection(need("QUEST_LP_RPC_URL"),{commitment:"finalized",disableRetryOnRateLimit:true});
  const prepared=await captureLpBaseline({connection,pins,inventory,minContextSlot:await connection.getSlot("finalized")});
  await writeFile(need("QUEST_LP_ADMISSION_OUTPUT"),JSON.stringify({schemaVersion:1,state:"TEST_ONLY_LP_BASELINE_REVIEW",awardEligible:false,environmentId,prepared},null,2)+"\n",{flag:"wx"});
  if(env.QUEST_LP_ADMISSION_APPLY==="1"){
   const result=await createPositionBaselineAnchorStore({...pins,pool}).record({anchorSlot:prepared.bundle.anchorSlot,inventory:prepared.bundle.inventory,snapshots:prepared.bundle.evidence.map(e=>e.raw)});
   console.log(JSON.stringify({state:result.state,awardEligible:false,campaignId,inserted:result.inserted,anchorSlot:prepared.bundle.anchorSlot,positionCount:inventory.length}));
  }else console.log(JSON.stringify({state:"TEST_ONLY_LP_BASELINE_REVIEW",awardEligible:false,campaignId,anchorSlot:prepared.bundle.anchorSlot,positionCount:inventory.length}));
 }finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error("LP baseline refused. Check selected inventory, immutable identity, RPC and admission role.");process.exitCode=1;});
