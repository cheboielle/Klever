export type DeliveryJob={id:string;lease_id:string;channel:'push'|'email';event_type:string;payload:Record<string,unknown>;email:string|null;devices:{installation_id:string;token:string}[];delivery_state:Record<string,any>;created_at:string;attempts:number};
export type Outcome={status:'pending'|'awaiting_receipt'|'sent'|'failed';state:Record<string,any>;error?:string;invalidTokens?:string[]};
type Config={resendKey:string;from:string;expoAccessToken?:string};
export async function deliver(job:DeliveryJob,config:Config,send:typeof fetch=fetch):Promise<Outcome>{
 const deadline=Date.now()+80000;const state={...job.delivery_state};const subject=job.event_type==='urgent_issue'?`Urgent issue: ${job.payload.asset_name??'asset'}`:'Klever Assets reminder';const body=String(job.payload.description??job.payload.message??'Open Klever Assets to see the latest maintenance information.');
 try{
  if(job.channel==='email'){
   if(!job.email)return {status:'failed',state,error:'Recipient has no email address'};
   if(state.emailId)return {status:'sent',state};
   // Anchor the retry window to durable job creation, including worker crashes before acknowledgement.
   state.firstAttempt??=Date.parse(job.created_at);
   if(!Number.isFinite(state.firstAttempt)||Date.now()-state.firstAttempt>23*3600000)return {status:'failed',state,error:'Email outcome needs review; provider retry window expired'};
   const response=await send('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${config.resendKey}`,'Content-Type':'application/json','Idempotency-Key':job.id},body:JSON.stringify({from:config.from,to:[job.email],subject,text:body}),signal:AbortSignal.timeout(20000)});
   const data=await response.json();if(!response.ok)return {status:response.status===429||response.status>=500?'pending':'failed',state,error:`Email provider rejected request (${response.status})`};
   if(typeof data.id!=='string')return {status:'pending',state,error:'Email provider response incomplete'};
   state.emailId=data.id;return {status:'sent',state};
  }
  if(!job.devices.length)return {status:'pending',state,error:'No signed-in phone has enabled notifications'};
  const invalidTokens:string[]=[];let retry=false,awaiting=false;
  const headers:Record<string,string>={'Content-Type':'application/json',Accept:'application/json'};if(config.expoAccessToken)headers.Authorization='Bearer '+config.expoAccessToken;
  for(const device of job.devices){
   if(Date.now()>deadline)return {status:'pending',state,invalidTokens,error:'Continuing remaining phones on the next attempt'};
   let prior=state[device.installation_id];if(prior?.status==='sent'||prior?.status==='invalid'||prior?.status==='failed')continue;
   if(prior?.ticket){
    const response=await send('https://exp.host/--/api/v2/push/getReceipts',{method:'POST',headers,body:JSON.stringify({ids:[prior.ticket]}),signal:AbortSignal.timeout(20000)});const data=await response.json();
    if(!response.ok){awaiting=true;continue;}
    const receipt=data.data?.[prior.ticket];
    if(!receipt){if(Date.now()-prior.acceptedAt>23*3600000){state[device.installation_id]={...prior,status:'failed'};}else awaiting=true;continue;}
    if(receipt.status==='ok'){state[device.installation_id]={...prior,status:'sent'};continue;}
    if(receipt.details?.error==='DeviceNotRegistered'){invalidTokens.push(device.token);state[device.installation_id]={...prior,status:'invalid'};continue;}
    state[device.installation_id]={...prior,status:'failed',error:receipt.details?.error??'Provider rejected push'};continue;
   }
   if(prior?.status==='failed')continue;
   const response=await send('https://exp.host/--/api/v2/push/send',{method:'POST',headers,body:JSON.stringify({to:device.token,title:subject.slice(0,180),body:body.slice(0,240),sound:'default',data:{assetId:job.payload.asset_id??null}}),signal:AbortSignal.timeout(20000)});const data=await response.json();
   if(!response.ok){if(response.status===429||response.status>=500)retry=true;else state[device.installation_id]={status:'failed',error:`Push request rejected (${response.status})`};continue;}
   const ticket=Array.isArray(data.data)?data.data[0]:data.data;
   if(ticket?.status==='ok'&&typeof ticket.id==='string'){state[device.installation_id]={ticket:ticket.id,status:'awaiting_receipt',acceptedAt:Date.now()};awaiting=true;}
   else if(ticket?.details?.error==='DeviceNotRegistered'){invalidTokens.push(device.token);state[device.installation_id]={status:'invalid'};}
   else if(ticket?.details?.error==='MessageRateExceeded')retry=true;
   else state[device.installation_id]={status:'failed',error:ticket?.details?.error??'Push response incomplete'};
  }
  const failed=job.devices.some(d=>state[d.installation_id]?.status==='failed'||state[d.installation_id]?.status==='invalid');
  return {status:retry?'pending':awaiting?'awaiting_receipt':failed?'failed':'sent',state,invalidTokens,error:failed?'One or more phones could not receive the notification':undefined};
 }catch{return {status:'pending',state,error:'Notification provider connection failed; retry pending'};}
}
