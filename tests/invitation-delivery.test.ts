import {expect,it,vi} from 'vitest';
import {handleInvitation} from '../supabase/functions/staff-invitation/handler';
const id='00000000-0000-4000-8000-000000000001',attempt='00000000-0000-4000-8000-000000000002';
const config={url:'https://supabase.invalid',anonKey:'public-test',serviceKey:'private-test',enabled:true,resendKey:'provider-test',from:'Klever <invite@example.invalid>'};
const request=(body:object={invitationId:id,action:'send'})=>new Request('https://edge.invalid',{method:'POST',headers:{Authorization:'Bearer actor-test'},body:JSON.stringify(body)});
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function transport(options:{denied?:boolean;existing?:boolean;cancelled?:boolean;wait?:boolean;provider?:'reject'|'timeout'|'incomplete';finishFails?:boolean}={}){
 let contexts=0;
 return vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(url);
  if(path.endsWith('staff_invitation_delivery_context')){
   contexts++;expect((init!.headers as any).Authorization).toBe('Bearer actor-test');
   if(options.denied||(options.cancelled&&contexts===3))return json({error:'denied'},403);
   return json({id,email:'recipient@example.invalid',name:'Recipient',business_name:'Test business',existing_auth:Boolean(options.existing)});
  }
  if(path.endsWith('claim_staff_invitation_delivery'))return json(options.wait?{status:'wait'}:{status:'claimed',attempt});
  if(path.endsWith('generate_link'))return json({email:'recipient@example.invalid',email_otp:'12345678',hashed_token:'synthetic-proof-never-returned'});
  if(path==='https://api.resend.com/emails'){
   if(options.provider==='timeout')throw new Error('Synthetic network loss containing provider-test');
   if(options.provider==='reject')return json({error:'private provider diagnostics'},422);
   return json(options.provider==='incomplete'?{}:{id:'synthetic-email'});
  }
  if(path.endsWith('finish_staff_invitation_delivery')){expect((init!.headers as any).Authorization).toBe('Bearer private-test');return json(!options.finishFails);}
  throw new Error('Unexpected request');
 });
}
it('authorizes even a disabled endpoint and never generates codes or emails without configuration',async()=>{
 const send=transport();expect(await (await handleInvitation(request(),{...config,enabled:false},send)).json()).toEqual({status:'not_configured'});expect(send).toHaveBeenCalledTimes(1);
 const denied=transport({denied:true});expect((await handleInvitation(request(),config,denied)).status).toBe(403);expect(denied).toHaveBeenCalledTimes(1);
 const injected=transport();expect((await handleInvitation(request({invitationId:id,action:'send',email:'another@example.invalid'}),config,injected)).status).toBe(400);expect(injected).not.toHaveBeenCalled();
});
it('uses the authorized recipient, private Auth generation, a stable attempt key and a redacted receipt',async()=>{
 for(const existing of [false,true]){
  const send=transport({existing});const result=await handleInvitation(request(),config,send);
  expect(await result.json()).toEqual({status:'sent'});
  const auth=send.mock.calls.find(([url])=>String(url).endsWith('generate_link'))![1]!;
  expect(JSON.parse(auth.body as string)).toEqual({email:'recipient@example.invalid',type:existing?'magiclink':'invite'});
  const email=send.mock.calls.find(([url])=>String(url)==='https://api.resend.com/emails')![1]!;
  expect((email.headers as any)['Idempotency-Key']).toBe('staff-invite/'+attempt);
  expect(JSON.parse(email.body as string)).toMatchObject({to:['recipient@example.invalid'],text:expect.stringContaining('12345678')});
  expect(JSON.parse(email.body as string).text).not.toContain('hashed_token');
 }
});
it('does not send during cooldown or after access/cancellation changes during generation',async()=>{
 const wait=transport({wait:true});expect(await (await handleInvitation(request(),config,wait)).json()).toEqual({status:'wait'});expect(wait.mock.calls.some(([u])=>String(u).endsWith('generate_link'))).toBe(false);
 const cancelled=transport({cancelled:true});expect(await (await handleInvitation(request(),config,cancelled)).json()).toEqual({status:'failed'});expect(cancelled.mock.calls.some(([u])=>String(u)==='https://api.resend.com/emails')).toBe(false);
});
it('separates rejection from uncertain delivery and never fabricates a durable send receipt',async()=>{
 for(const [options,status] of [[{provider:'reject'},'failed'],[{provider:'timeout'},'unknown'],[{provider:'incomplete'},'unknown'],[{finishFails:true},'unknown']] as const){
  const send=transport(options);const result=await handleInvitation(request(),config,send);expect(await result.json()).toEqual({status});
  expect(send.mock.calls.filter(([url])=>String(url)==='https://api.resend.com/emails')).toHaveLength(1);
 }
});
