type Context={id:string;email:string;name:string;business_name:string;existing_auth:boolean};
type Config={url:string;anonKey:string;serviceKey:string;enabled:boolean;resendKey?:string;from?:string};
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const response=(status:string,http=200)=>new Response(JSON.stringify({status}),{status:http,headers});

export async function handleInvitation(request:Request,config:Config,send:typeof fetch=fetch):Promise<Response>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return response('method_not_allowed',405);
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return response('sign_in_required',401);
 let id:string,action:string;
 try{
  const text=await request.text();if(text.length>1024)return response('invalid_request',400);
  const body=JSON.parse(text);id=body.invitationId;action=body.action;
  if(typeof id!=='string'||!uuid.test(id)||!['status','send'].includes(action)||Object.keys(body).some(k=>!['invitationId','action'].includes(k)))return response('invalid_request',400);
 }catch{return response('invalid_request',400);}
 async function rpc(name:string,args:Record<string,unknown>,privileged=false){
  const key=privileged?config.serviceKey:config.anonKey;
  const result=await send(config.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:privileged?'Bearer '+key:authorization!,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
  if(!result.ok)throw new Error('Database request failed');return result.json();
 }
 // Even the disabled/status path requires current tenant/admin authorization.
 try{await rpc('staff_invitation_delivery_context',{p_id:id});}catch{return response('invitation_unavailable',403);}
 if(!config.enabled||!config.resendKey||!config.from)return response('not_configured');
 if(action==='status')return response('ready');
 let attempt:string;
 try{const claim=await rpc('claim_staff_invitation_delivery',{p_id:id});if(claim.status==='wait')return response('wait');if(claim.status!=='claimed'||!uuid.test(claim.attempt))throw new Error('Invalid claim');attempt=claim.attempt;}catch{return response('invitation_unavailable',403);}
 async function finish(status:'sent'|'failed'|'unknown'){
  try{const saved=await rpc('finish_staff_invitation_delivery',{p_id:id,p_attempt:attempt,p_status:status},true);return response(saved?status:'unknown');}
  catch{return response('unknown');}
 }
 let context:Context,code:string;
 try{
  context=await rpc('staff_invitation_delivery_context',{p_id:id,p_attempt:attempt});
  const auth=await send(config.url+'/auth/v1/admin/generate_link',{method:'POST',headers:{apikey:config.serviceKey,Authorization:'Bearer '+config.serviceKey,'Content-Type':'application/json'},body:JSON.stringify({type:context.existing_auth?'magiclink':'invite',email:context.email}),signal:AbortSignal.timeout(15000)});
  if(!auth.ok)return finish('failed');
  const generated=await auth.json();code=generated.email_otp;
  if(typeof code!=='string'||!/^\d{6,10}$/.test(code)||generated.email?.toLowerCase()!==context.email.toLowerCase())return finish('failed');
  // Generation can take time: recheck cancellation, actor access and the attempt.
  await rpc('staff_invitation_delivery_context',{p_id:id,p_attempt:attempt});
 }catch{return finish('failed');}
 try{
  const result=await send('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+config.resendKey,'Content-Type':'application/json','Idempotency-Key':'staff-invite/'+attempt},body:JSON.stringify({from:config.from,to:[context.email],subject:'Your Klever Assets team invitation',text:`${context.business_name} has invited you to join Klever Assets.\n\nOpen the Klever Assets app, choose “I have an invitation”, and enter this email address and code:\n\n${code}\n\nThen confirm your details and choose your password. Use the most recent code; it can only be used once and expires. If it expires, ask your administrator to resend the invitation.\n\nIf you were not expecting this invitation, you can ignore this email.`}),signal:AbortSignal.timeout(15000)});
  // "sent" means accepted by Resend, never proof of inbox delivery.
  if(!result.ok)return finish(result.status>=500?'unknown':'failed');
  const receipt=await result.json();return finish(typeof receipt.id==='string'&&receipt.id?'sent':'unknown');
 }catch{return finish('unknown');}
}
