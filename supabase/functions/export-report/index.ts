import {renderCsv,renderPdf,type ExportData} from './render.ts';
import {fontBase64} from './font.ts';
const font=Uint8Array.from(atob(fontBase64),c=>c.charCodeAt(0));
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Expose-Headers':'Content-Disposition'};
const headers={...cors,'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'};
Deno.serve(async(request:Request)=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers});
 try{
  const authorization=request.headers.get('authorization');if(!authorization?.startsWith('Bearer '))return new Response('Sign in required',{status:401,headers});
  const {kind,assetId=null,format}=await request.json();if(!['assets','logs','services','tasks'].includes(kind)||!['csv','pdf'].includes(format)||(assetId!==null&&!/^[0-9a-f-]{36}$/i.test(assetId)))return new Response('Invalid export request',{status:400,headers});
  const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!;
  async function rpc(name:string,args:Record<string,unknown>={}){const response=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:authorization!,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(30000),cache:'no-store'});if(!response.ok)throw Error('Access denied or data unavailable');return response.json();}
  const access=await rpc('access_status');if(!access.allowed||!['owner','admin'].includes(access.role))return new Response('Admin access required',{status:403,headers});
  const data:ExportData=await rpc('export_data',{p_kind:kind,p_asset:assetId});let bytes=0;
  const body=format==='csv'?renderCsv(data):await renderPdf(data,font,async(row)=>{
   if(!row.photo_path)return null;
   const response=await fetch(base+'/functions/v1/service-photo',{method:'POST',headers:{apikey:key,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({submissionId:row.id,kind:kind==='services'?'service':'task'}),signal:AbortSignal.timeout(20000),cache:'no-store'});
   if(!response.ok)throw Error('A recorded evidence photo could not be loaded. Please retry.');const result=new Uint8Array(await response.arrayBuffer());bytes+=result.length;if(bytes>64*1024*1024)throw Error('This report needs background processing. Please contact your admin.');return result;
  });
  const current=await rpc('access_status');if(!current.allowed||!['owner','admin'].includes(current.role)||current.tenant_id!==access.tenant_id)return new Response('Access changed. Sign in again.',{status:403,headers});
  return new Response(body,{headers:{...headers,'Content-Type':format==='csv'?'text/csv; charset=utf-8':'application/pdf','Content-Disposition':`attachment; filename="klever-${kind}.${format}"`}});
 }catch{return new Response('Export could not be completed. Check your connection and access, then retry. No incomplete report was saved.',{status:503,headers});}
});
