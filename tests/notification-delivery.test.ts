import {describe,it,expect,vi} from 'vitest';
import {deliver,type DeliveryJob} from '../supabase/functions/notification-worker/delivery';
const job:DeliveryJob={id:'event-1',lease_id:'lease',channel:'email',event_type:'urgent_issue',payload:{asset_name:'Test asset',description:'Synthetic report'},email:'fixture@example.invalid',devices:[],delivery_state:{},created_at:new Date().toISOString(),attempts:0};
const config={resendKey:'test-only',from:'fixture@example.invalid'};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
describe('notification delivery with simulated providers',()=>{
 it('preserves task identity for direct entry',async()=>{
  const send=vi.fn().mockResolvedValue(response({data:{status:'ok',id:'task-ticket'}}));
  await deliver({...job,channel:'push',event_type:'task_due',payload:{record_id:'task-1',asset_id:'asset-1',message:'Reminder'},devices:[{installation_id:'phone-1',token:'ExpoPushToken[test]'}]},config,send);
  expect(JSON.parse(send.mock.calls[0][1].body).data).toEqual({kind:'task_due',recordId:'task-1',assetId:'asset-1'});
 });
 it('starts no provider request after the worker deadline',async()=>{const send=vi.fn();expect((await deliver(job,config,send,Date.now()-1)).status).toBe('pending');expect(send).not.toHaveBeenCalled();});
 it('reuses the email key after a lost acknowledgement and stops after acceptance',async()=>{
  const send=vi.fn().mockRejectedValueOnce(Error('lost reply')).mockResolvedValueOnce(response({id:'email-1'}));
  const first=await deliver(job,config,send);expect(first.status).toBe('pending');
  const second=await deliver({...job,delivery_state:first.state},config,send);expect(second.status).toBe('sent');
  expect(send.mock.calls.map(c=>c[1].headers['Idempotency-Key'])).toEqual(['event-1','event-1']);
  await deliver({...job,delivery_state:second.state},config,send);expect(send).toHaveBeenCalledTimes(2);
 });
 it('stops uncertain email retries before the provider deduplication window ends',async()=>{
  const send=vi.fn();const result=await deliver({...job,delivery_state:{firstAttempt:Date.now()-24*3600000}},config,send);
  expect(result.status).toBe('failed');expect(send).not.toHaveBeenCalled();
 });
 it('polls a push receipt without sending the notification again',async()=>{
  const push={...job,channel:'push' as const,devices:[{installation_id:'phone-1',token:'ExpoPushToken[test]'}]};
  const send=vi.fn().mockResolvedValueOnce(response({data:{status:'ok',id:'ticket-1'}})).mockResolvedValueOnce(response({data:{'ticket-1':{status:'ok'}}}));
  const first=await deliver(push,config,send);expect(first.status).toBe('awaiting_receipt');
  expect(JSON.parse(send.mock.calls[0][1].body).data).toEqual({assetId:null,recordId:null,kind:'urgent_issue'});
  const second=await deliver({...push,delivery_state:first.state},config,send);expect(second.status).toBe('sent');
  expect(send.mock.calls[1][0]).toContain('getReceipts');expect(JSON.stringify(second.state)).not.toContain('ExpoPushToken');
 });
 it('reports invalid tokens for removal instead of retrying them',async()=>{
  const send=vi.fn().mockResolvedValue(response({data:{status:'error',details:{error:'DeviceNotRegistered'}}}));
  const result=await deliver({...job,channel:'push',devices:[{installation_id:'phone-1',token:'ExpoPushToken[test]'}]},config,send);
  expect(result).toMatchObject({status:'failed',invalidTokens:['ExpoPushToken[test]']});
 });
 it('retries provider throttling but records a permanent email rejection',async()=>{
  expect((await deliver(job,config,vi.fn().mockResolvedValue(response({},429)))).status).toBe('pending');
  expect((await deliver(job,config,vi.fn().mockResolvedValue(response({},422)))).status).toBe('failed');
 });
});
