import {deliver,type DeliveryJob} from './delivery.ts';
// Deliberately disabled until provider credentials, sender verification and live delivery are authorized.
Deno.serve(async(request:Request)=>{
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 if(request.method!=='POST')return new Response('{}',{status:405,headers});
 const secret=Deno.env.get('NOTIFICATION_WORKER_SECRET');
 if(!secret||request.headers.get('x-worker-secret')!==secret)return new Response('{"error":"Unauthorized"}',{status:401,headers});
 const resendKey=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('NOTIFICATION_FROM');
 if(Deno.env.get('NOTIFICATIONS_ENABLED')!=='true'||!resendKey||!from)return new Response('{"status":"disabled"}',{status:503,headers});
 const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 async function rpc(name:string,args:Record<string,unknown>){const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Notification database request failed');return response.json();}
 try{
  const jobs:DeliveryJob[]=await rpc('claim_notifications',{p_limit:1});let processed=0;
  for(const job of jobs){const outcome=await deliver(job,{resendKey,from,expoAccessToken:Deno.env.get('EXPO_ACCESS_TOKEN')});await rpc('finish_notification',{p_id:job.id,p_lease:job.lease_id,p_status:outcome.status,p_delivery_state:outcome.state,p_error:outcome.error??null,p_invalid_tokens:outcome.invalidTokens??[]});processed++;}
  return new Response(JSON.stringify({processed}),{headers});
 }catch{return new Response('{"error":"Notification processing failed"}',{status:500,headers});}
});
