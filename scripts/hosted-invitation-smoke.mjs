// Actual development Auth/database; Resend is intercepted and cannot send mail.
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {handleInvitation} from '../supabase/functions/staff-invitation/handler.ts';
const url=process.env.EXPO_PUBLIC_SUPABASE_URL,serviceKey=process.env.KLEVER_ADMIN_KEY,anonKey=process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if(url!=='https://blzubtujrxpcnfphcrny.supabase.co'||!serviceKey||!anonKey)throw new Error('Explicit development connection required');
const users=new Set(),tenants=[],stamp=randomUUID();let passed=0;
const pass=label=>{passed++;console.log('PASS '+label);};
async function request(path,{token=serviceKey,method='POST',body}={}){
 const result=await fetch(url+path,{method,headers:{apikey:anonKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 return {ok:result.ok,data:await result.json().catch(()=>null)};
}
async function requireRequest(path,options){const result=await request(path,options);if(!result.ok)throw new Error('Hosted invitation request failed: '+path.split('?')[0]);return result.data;}
const rpc=(name,body,token)=>requireRequest('/rest/v1/rpc/'+name,{body,token});
const password=()=>randomBytes(24).toString('base64url');
try{
 const ownerEmail=`klever-invite-${stamp}-owner@example.invalid`,ownerPassword=password();
 const owner=await requireRequest('/auth/v1/admin/users',{body:{email:ownerEmail,password:ownerPassword,email_confirm:true}});users.add(owner.id);
 const signed=await requireRequest('/auth/v1/token?grant_type=password',{token:anonKey,body:{email:ownerEmail,password:ownerPassword}});
 const tenant=await rpc('provision_business',{p_owner:owner.id,p_name:'TEST ONLY invitation '+stamp,p_owner_name:'Test owner',p_write_until:new Date(Date.now()+3600000).toISOString()});tenants.push(tenant);
 for(const existing of [false,true]){
  const email=`klever-invite-${stamp}-${existing?'existing':'new'}@example.invalid`,id=randomUUID();
  if(existing){const account=await requireRequest('/auth/v1/admin/users',{body:{email,email_confirm:false}});users.add(account.id);}
  await rpc('create_staff_invitation',{p_id:id,p_email:email,p_name:'Synthetic recipient'},signed.access_token);
  const disabled=await requireRequest('/functions/v1/staff-invitation',{token:signed.access_token,body:{invitationId:id,action:'send'}});
  assert.equal(disabled.status,'not_configured');pass('Deployed invitation endpoint is explicitly disabled');
  let code='',generated=0,emailCalls=0;
  const send=async(target,init)=>{
   if(String(target)==='https://api.resend.com/emails'){
    emailCalls++;const payload=JSON.parse(init.body);assert.deepEqual(payload.to,[email]);code=/\n\n(\d{6,10})\n\n/.exec(payload.text)?.[1]??'';assert.ok(Boolean(code));
    return new Response(JSON.stringify({id:'synthetic-provider-receipt'}),{headers:{'Content-Type':'application/json'}});
   }
   if(!String(target).startsWith(url+'/'))throw new Error('Unexpected external request blocked');
   const result=await fetch(target,init);
   if(String(target).endsWith('/auth/v1/admin/generate_link')&&result.ok){generated++;const account=await result.clone().json();if(account.id)users.add(account.id);}
   return result;
  };
  const config={url,anonKey,serviceKey,enabled:true,resendKey:'synthetic-no-network',from:'test@example.invalid'};
  const makeRequest=()=>new Request('https://local-test.invalid',{method:'POST',headers:{Authorization:'Bearer '+signed.access_token},body:JSON.stringify({invitationId:id,action:'send'})});
  assert.equal((await (await handleInvitation(makeRequest(),config,send)).json()).status,'sent');
  assert.equal(emailCalls,1);assert.equal(generated,1);pass((existing?'Existing unconfirmed':'New')+' Auth account uses actual generated email code with intercepted provider');
  assert.equal((await (await handleInvitation(makeRequest(),config,send)).json()).status,'wait');assert.equal(emailCalls,1);assert.equal(generated,1);pass('Immediate retry generates no second code or email');
  const confirmed=await requireRequest('/auth/v1/verify',{token:anonKey,body:{email,token:code,type:'email'}});assert.ok(confirmed.access_token&&confirmed.user.email_confirmed_at);users.add(confirmed.user.id);
  assert.equal((await rpc('access_status',{},confirmed.access_token)).reason,'not_provisioned');
  assert.equal((await request('/auth/v1/verify',{token:anonKey,body:{email,token:code,type:'email'}})).ok,false);pass('Email code creates confirmed session once without pre-granting membership');
  const chosen=password();await requireRequest('/auth/v1/user',{method:'PUT',token:confirmed.access_token,body:{password:chosen}});
  const invitations=await rpc('my_staff_invitations',{},confirmed.access_token);assert.equal(invitations[0]?.id,id);
  await rpc('accept_staff_invitation',{p_id:id,p_name:'Accepted tester',p_phone:'000-test',p_job_title:'QA'},confirmed.access_token);
  const login=await requireRequest('/auth/v1/token?grant_type=password',{token:anonKey,body:{email,password:chosen}});
  assert.equal((await rpc('access_status',{},login.access_token)).role,'technician');
  assert.equal((await request('/functions/v1/staff-invitation',{token:login.access_token,body:{invitationId:id,action:'send'}})).ok,false);
  pass('Recipient sets password, accepts as technician and cannot send invitations');
 }
 console.log(`${passed} hosted invitation checks passed. No email sent.`);
}finally{
 mkdirSync('tmp',{recursive:true});
 const ids=tenants.map(id=>{assert.ok(/^[a-f0-9-]{36}$/.test(id));return `'${id}'`;}).join(',');
 writeFileSync('tmp/invitation-smoke-users.json',JSON.stringify([...users]));
 if(ids)writeFileSync('tmp/invitation-smoke-cleanup.sql',`begin;\nupdate public.tenants set write_until=now()-interval '1 day' where id in (${ids});\ndelete from public.staff_invitations where tenant_id in (${ids});\ndelete from public.notification_rules where tenant_id in (${ids});\ndelete from public.memberships where tenant_id in (${ids});\ndelete from public.tenants where id in (${ids});\ncommit;`);
 console.log('Non-secret exact-ID cleanup manifests written.');
}
