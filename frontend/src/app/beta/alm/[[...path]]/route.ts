import {almBeta} from '../../../../server/almBeta';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handler(request:Request,context:{params:Promise<{path?:string[]}>}){
 return almBeta(request,(await context.params).path??[],{
  enabled:process.env.ALM_BETA_ENABLED,
 });
}
export {handler as GET,handler as HEAD,handler as POST};
