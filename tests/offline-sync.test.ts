import {beforeEach,describe,it,expect,vi} from 'vitest';
import {OfflineQueue,type PendingCommand} from '../packages/domain/src/offline';
const env=vi.hoisted(()=>({q:null as any,rpc:vi.fn(),upload:vi.fn(),remove:vi.fn(),wipe:vi.fn(),signOut:vi.fn()}));
vi.mock('../apps/mobile/src/client',()=>({rpc:env.rpc,supabase:{storage:{from:()=>({upload:env.upload})},auth:{signOut:env.signOut}}}));
vi.mock('../apps/mobile/src/offlineStore',()=>({currentOffline:()=>env.q,notifyOffline:()=>{},networkFailure:(e:Error)=>/network/i.test(e.message),clearOffline:async()=>{await env.q?.clear();env.q=null;env.wipe();}}));
vi.mock('../apps/mobile/src/offlineMedia',()=>({persistMedia:async()=> 'offline-media:photo',mediaBytes:async()=>new ArrayBuffer(8),removeMedia:env.remove}));
import {flushQueue,queueEntry} from '../apps/mobile/src/offlineSync';
const access={allowed:true,user_id:'u',tenant_id:'t',role:'technician',can_write:true};
const reading:PendingCommand={id:'r',kind:'reading',assetId:'a',label:'Reading',args:{p_id:'r',p_value:42,p_expected_revision:0},state:'pending'};
beforeEach(async()=>{vi.clearAllMocks();env.q=new OfflineQueue('u',{read:async()=>null,write:async()=>{},remove:async()=>{}},null);await env.q.validated(access as any);env.upload.mockResolvedValue({error:null});env.rpc.mockImplementation(async(name:string)=>name==='access_status'?access:{status:'accepted'});});
describe('offline synchronization',()=>{
 it('keeps a lost-acknowledgement entry and retries the same submission ID',async()=>{
  await env.q.enqueue(reading);let calls=0;env.rpc.mockImplementation(async(name:string)=>{if(name==='access_status')return access;if(++calls===1)throw Error('Network interrupted after server accepted');return {status:'accepted',duplicate:true};});
  expect((await flushQueue()).online).toBe(false);expect(env.q.snapshot().commands).toHaveLength(1);await flushQueue();expect(env.q.snapshot().commands).toHaveLength(0);expect(env.rpc.mock.calls.filter(c=>c[0]==='log_hours').map(c=>c[1].p_id)).toEqual(['r','r']);
 });
 it('never finalizes evidence before upload; upload retry preserves capture snapshot and ID',async()=>{
  await queueEntry({id:'s',kind:'service',label:'Service',assetId:'a',args:{p_id:'s',p_snapshot:{instructions:'Original'},p_capture_time:'2026-09-09T00:00:00Z'}},'camera-photo');
  env.rpc.mockImplementation(async(name:string)=>name==='access_status'?access:name==='prepare_service_photo'?{path:'authorized.jpg'}:{status:'applied'});env.upload.mockResolvedValueOnce({error:Error('Network unavailable')});
  await flushQueue();expect(env.rpc.mock.calls.some(c=>c[0]==='complete_service')).toBe(false);expect(env.q.snapshot().commands).toHaveLength(1);expect(env.remove).not.toHaveBeenCalled();
  env.upload.mockResolvedValueOnce({error:{message:'Already exists',statusCode:'409'}});await flushQueue();expect(env.q.snapshot().commands).toHaveLength(0);expect(env.remove).toHaveBeenCalledWith('offline-media:photo');expect(env.rpc.mock.calls.filter(c=>c[0]==='prepare_service_photo')[1][1].p_snapshot.instructions).toBe('Original');
 });
 it('blocked readings stop dependent readings but unrelated issues continue',async()=>{
  await env.q.enqueue(reading);await env.q.enqueue({...reading,id:'next',args:{...reading.args,p_id:'next'}});await env.q.enqueue({id:'issue',kind:'issue',assetId:'a',label:'Issue',args:{p_id:'issue'},state:'pending'});
  env.rpc.mockImplementation(async(name:string)=>name==='access_status'?access:{status:name==='log_hours'?'conflict':'reported'});await flushQueue();expect(env.q.snapshot().commands.map((c:PendingCommand)=>[c.id,c.state])).toEqual([['r','blocked'],['next','pending']]);expect(env.rpc.mock.calls.filter(c=>c[0]==='log_hours')).toHaveLength(1);
 });
 it('read-only retains pending work, whereas revoked access wipes it and signs out',async()=>{
  await env.q.enqueue(reading);env.rpc.mockResolvedValue({...access,can_write:false});await flushQueue();expect(env.q.snapshot().commands).toHaveLength(1);expect(env.wipe).not.toHaveBeenCalled();env.rpc.mockResolvedValue({allowed:false,reason:'inactive'});await flushQueue();expect(env.q).toBe(null);expect(env.wipe).toHaveBeenCalledOnce();expect(env.signOut).toHaveBeenCalledOnce();
 });
 it('successive offline readings retain ordered expected revisions',async()=>{
  await queueEntry(reading);await queueEntry({...reading,id:'r2',args:{...reading.args,p_id:'r2',p_value:43}});expect(env.q.snapshot().commands.map((c:PendingCommand)=>c.args.p_expected_revision)).toEqual([0,1]);
 });
 it('unexpected responses cannot silently discard a pending entry',async()=>{
  await env.q.enqueue(reading);env.rpc.mockImplementation(async(name:string)=>name==='access_status'?access:{});await flushQueue();expect(env.q.snapshot().commands[0]).toMatchObject({state:'blocked',reason:'The server response was incomplete. Retry this entry.'});
 });
});
