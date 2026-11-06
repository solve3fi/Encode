import { validateLeaderboard } from './quest-leaderboard.mjs';
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{
 'Content-Type':'application/json','X-Content-Type-Options':'nosniff',
 'Cache-Control':status===200?'public, max-age=15':'no-store'}});
export function createLeaderboardProxy({enabled=false,backendOrigin,fetchImpl=fetch}) {
 let origin=null;
 try {const u=new URL(backendOrigin);
  if(!u.username&&!u.password&&!u.search&&!u.hash&&u.origin===backendOrigin&&
   (u.protocol==='https:'||(u.protocol==='http:'&&u.hostname==='quest-backend'&&u.port==='8080')))origin=u.origin;
 }catch{}
 return async request=>{
  if(request.method!=='GET')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  if(new URL(request.url).search)return reply(400,{error:'INVALID_REQUEST'});
  if(!enabled||!origin)return reply(503,{error:'UNAVAILABLE'});
  try {
   const r=await fetchImpl(`${origin}/public/leaderboard`,{method:'GET',redirect:'error',
    signal:AbortSignal.timeout(5000),headers:{Accept:'application/json'}});
   if(r.status!==200||!r.body)throw Error('Unavailable');
   const reader=r.body.getReader();let size=0,chunks=[];
   try {for(;;){const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;if(size>65536)throw Error('Oversized leaderboard');chunks.push(value);
   }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   return reply(200,validateLeaderboard(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
  }catch{return reply(503,{error:'UNAVAILABLE'});}
 };
}
