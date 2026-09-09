import type {DeliveryJob,Outcome} from './delivery.ts';
// Claim immediately before each delivery, preserving the live recipient/assignment check.
export async function processNotifications(rpc:(name:string,args:Record<string,unknown>)=>Promise<any>,deliver:(job:DeliveryJob,deadline:number)=>Promise<Outcome>,now:()=>number=Date.now){
 const deadline=now()+45000;let processed=0;
 while(processed<20&&now()<deadline-2000){
  const jobs:DeliveryJob[]=await rpc('claim_notifications',{p_limit:1});
  if(!jobs.length)break;
  const job=jobs[0],outcome=await deliver(job,deadline);
  const accepted=await rpc('finish_notification',{p_id:job.id,p_lease:job.lease_id,p_status:outcome.status,p_delivery_state:outcome.state,p_error:outcome.error??null,p_invalid_tokens:outcome.invalidTokens??[]});
  if(!accepted)throw Error('Notification lease changed before acknowledgement');
  processed++;
 }
 return {processed};
}
