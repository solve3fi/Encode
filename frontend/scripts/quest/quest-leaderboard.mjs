// Public output boundary: no raw Passport IDs, wallet/link/session data or writes.
const keys = (value, expected) => value && Object.getPrototypeOf(value) === Object.prototype &&
 Object.keys(value).sort().join('|') === expected.split(' ').sort().join('|');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const xp = /^(0|[1-9][0-9]{0,39})$/;
export function validateLeaderboard(value) {
 if (!keys(value,'network testOnly scope asOf entries') || value.network !== 'DEVNET' ||
  value.testOnly !== true || value.scope !== 'devnet-preseason' ||
  typeof value.asOf !== 'string' || !Number.isFinite(Date.parse(value.asOf)) ||
  new Date(value.asOf).toISOString() !== value.asOf || !Array.isArray(value.entries) || value.entries.length>50)
  throw new Error('Invalid leaderboard');
 const seen=new Set(); let previous=null;
 for (const [index,row] of value.entries.entries()) {
  if (!keys(row,'publicId label rank totalXp questXp votingXp') || !uuid.test(row.publicId) ||
   row.label !== `Explorer ${row.publicId.replaceAll('-','').slice(0,8).toUpperCase()}` ||
   row.rank !== index+1 || seen.has(row.publicId) ||
   ![row.totalXp,row.questXp,row.votingXp].every(v=>typeof v==='string'&&xp.test(v)) ||
   BigInt(row.totalXp)<=0n || BigInt(row.totalXp)!==BigInt(row.questXp)+BigInt(row.votingXp) ||
   (previous && (BigInt(row.totalXp)>BigInt(previous.totalXp) ||
    (row.totalXp===previous.totalXp&&row.publicId<=previous.publicId)))) throw new Error('Invalid leaderboard entry');
  seen.add(row.publicId);previous=row;
 }
 return structuredClone(value);
}
const response=(status,body)=>new Response(JSON.stringify(body),{status,headers:{
 'Content-Type':'application/json','X-Content-Type-Options':'nosniff',
 'Cache-Control':status===200?'public, max-age=15':'no-store'}});
export function createLeaderboardHandler({pool,now=Date.now,cacheMs=15000}) {
 if(typeof pool?.query!=='function'||typeof now!=='function'||!Number.isSafeInteger(cacheMs)||cacheMs<0||cacheMs>30000)
  throw new Error('Invalid leaderboard configuration');
 let cached=null,expires=0,pending=null;
 async function read() {
  if(cached&&now()<expires)return cached;
  if(!pending) pending=Promise.resolve().then(async()=>{
    const {rows}=await pool.query('SELECT quest.public_leaderboard() AS leaderboard');
    if(rows.length!==1)throw new Error('Missing leaderboard');
    const value=validateLeaderboard(rows[0].leaderboard);cached=value;expires=now()+cacheMs;return value;
  }).finally(()=>{pending=null;});
  return pending;
 }
 return async request=>{
  if(request.method!=='GET')return response(405,{error:'METHOD_NOT_ALLOWED'});
  if(new URL(request.url).search)return response(400,{error:'INVALID_REQUEST'});
  try{return response(200,await read());}catch{return response(503,{error:'UNAVAILABLE'});}
 };
}
