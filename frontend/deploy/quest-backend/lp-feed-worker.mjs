import pg from "pg";
import {Connection} from "@solana/web3.js";
import {setTimeout as delay} from "node:timers/promises";
import {runLpFeedOperationsRound} from "../scripts/quest/lp-feed-operations.mjs";
import {createLpRpcFetch} from "../scripts/quest/lp-rpc-fetch.mjs";

const env=process.env,required=name=>{if(!env[name])throw new Error("LP feed configuration missing");return env[name];};
const controller=new AbortController();
for(const event of ["SIGINT","SIGTERM"])process.once(event,()=>controller.abort());
let pool;
try {
 const identity={campaignId:required("QUEST_SWAP_CAMPAIGN_ID"),environmentId:required("QUEST_ENVIRONMENT_ID"),manifestSha256:required("QUEST_MANIFEST_SHA256")};
 const interval=Number(env.QUEST_LP_FEED_INTERVAL_SECONDS??30);
 if(!Number.isSafeInteger(interval)||interval<10||interval>3600)throw new Error("LP feed interval refused");
 const maxRanges=Number(env.QUEST_LP_MAX_RANGES??4),slotsPerRange=Number(env.QUEST_LP_SLOTS_PER_RANGE??256);
 if(!Number.isSafeInteger(maxRanges)||maxRanges<1||maxRanges>16||!Number.isSafeInteger(slotsPerRange)||slotsPerRange<1||slotsPerRange>256)throw new Error("LP feed bounds refused");
 pool=new pg.Pool({connectionString:required("QUEST_LP_TIMELINE_DB_URL"),max:2,connectionTimeoutMillis:5000,statement_timeout:5000});
 const connection=new Connection(required("QUEST_LP_RPC_URL"),{commitment:"finalized",disableRetryOnRateLimit:true,fetch:createLpRpcFetch({signal:controller.signal,minimumDelayMs:Number(env.QUEST_LP_RPC_MIN_DELAY_MS??150)})});
 while(!controller.signal.aborted){
  try{console.log(JSON.stringify(await runLpFeedOperationsRound({pool,connection,identity,maxRanges,slotsPerRange,signal:controller.signal})));}
  catch{if(!controller.signal.aborted)console.error(JSON.stringify({state:"LP_FEED_ROUND_REFUSED",code:"REGISTRY_OR_CONFIGURATION_FAILED"}));}
  try{await delay(interval*1000,undefined,{signal:controller.signal});}catch{break;}
 }
}catch{console.error(JSON.stringify({state:"LP_FEED_STARTUP_REFUSED"}));process.exitCode=1;}
finally{if(pool)await pool.end();}
