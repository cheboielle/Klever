import {expect,it,vi} from 'vitest';
import {processNotifications} from '../supabase/functions/notification-worker/process';
const outcome={status:'sent' as const,state:{}};
it('drains a small team batch while claiming and acknowledging one job at a time',async()=>{
 let index=0;const events:string[]=[];
 const rpc=vi.fn(async(name:string,args:any)=>{if(name==='claim_notifications'){events.push('claim');return index<15?[{id:String(index++),lease_id:'lease'}]:[];}events.push('finish:'+args.p_id);return true;});
 const deliver=vi.fn(async(job:any)=>{events.push('deliver:'+job.id);return outcome;});
 expect(await processNotifications(rpc,deliver,()=>0)).toEqual({processed:15});
 expect(events.slice(0,6)).toEqual(['claim','deliver:0','finish:0','claim','deliver:1','finish:1']);
 expect(deliver).toHaveBeenCalledTimes(15);
});
it('stops claiming new jobs when the run time is used up',async()=>{
 let time=0;const rpc=vi.fn(async(name:string)=>name==='claim_notifications'?[{id:'1',lease_id:'lease'}]:true);
 const deliver=vi.fn(async()=>{time=44000;return outcome;});
 expect(await processNotifications(rpc,deliver,()=>time)).toEqual({processed:1});expect(rpc).toHaveBeenCalledTimes(2);
});
it('does not claim an unlimited backlog and leaves unclaimed work available',async()=>{
 const rpc=vi.fn(async(name:string)=>name==='claim_notifications'?[{id:'1',lease_id:'lease'}]:true);
 expect(await processNotifications(rpc,async()=>outcome,()=>0)).toEqual({processed:20});
});
it('stops on a lost acknowledgement so the existing lease/retry mechanism can recover',async()=>{
 const rpc=vi.fn(async(name:string)=>{if(name==='claim_notifications')return [{id:'1',lease_id:'lease'}];throw Error('Network failure');});
 await expect(processNotifications(rpc,async()=>outcome,()=>0)).rejects.toThrow(/Network/);expect(rpc).toHaveBeenCalledTimes(2);
});
it('does not report completion after a stale lease acknowledgement',async()=>{
 const rpc=vi.fn(async(name:string)=>name==='claim_notifications'?[{id:'1',lease_id:'old'}]:false);
 await expect(processNotifications(rpc,async()=>outcome,()=>0)).rejects.toThrow(/lease/);
});
