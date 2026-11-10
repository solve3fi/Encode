import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {DEV_SITE_URL} from '@/configs/site';
import manifest from './almBetaManifest.json';
export type AlmBetaOptions={enabled?:string;root?:string};
const files:Record<string,{sha256:string;bytes:number}>=manifest.files;
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.ttf':'font/ttf'};
/** Public, unlisted dev-only lab. No server sessions, keys or transaction submission. */
export async function almBeta(request:Request,path:string[],options:AlmBetaOptions):Promise<Response>{
 const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',Vary:'Host'};
 const response=(message:string,status:number)=>new Response(request.method==='HEAD'?null:message,{status,headers});
 const url=new URL(request.url),host=request.headers.get('host')??url.host;
 if(options.enabled==='0'||host!==new URL(DEV_SITE_URL).host)return response('Not found',404);
 if(!['GET','HEAD'].includes(request.method))return response('Method not allowed',405);
 if(path.some(p=>!p||p==='.'||p==='..'||/[\\/\u0000]/.test(p)))return response('Not found',404);
 const name=path.join('/')||'index.html',expected=files[name];
 if(!expected||!Object.hasOwn(files,name))return response('Not found',404);
 try{
  const root=await realpath(options.root??resolve(process.cwd(),'alm-beta'));
  const file=await realpath(resolve(root,name));if(!file.startsWith(root+sep))return response('Not found',404);
  const bytes=await readFile(file);if(bytes.length!==expected.bytes||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)return response('ALM bundle requires a matching release',503);
  // Next already strips a trailing slash (/beta/alm/ -> /beta/alm), so a redirect back to the slash loops. Serve the page at
 // /beta/alm and point its relative links at the prefix instead (a <base> tag would be blocked by base-uri 'none').
 const body=name==='index.html'?new TextEncoder().encode(new TextDecoder().decode(bytes).replace(/(href|src)="\.\//g,'$1="/beta/alm/')):new Uint8Array(bytes);
 return new Response(request.method==='HEAD'?null:body,{headers:{...headers,'Content-Type':types[extname(name)]??'application/octet-stream','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self' https://solana-rpc.publicnode.com; base-uri 'none'; frame-ancestors 'self'; form-action 'self'"}});
 }catch{return response('ALM beta unavailable',503);}
}
