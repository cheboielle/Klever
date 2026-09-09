import {describe,it,expect} from 'vitest';
import {OfflineQueue,offlineEntryAllowed,type OfflineState,type PendingCommand} from '../packages/domain/src/offline';
const access={allowed:true,user_id:'user-a',tenant_id:'business-a',role:'technician' as const,can_write:true,access_ends_at:'2030-01-01T00:00:00Z'};
const now=Date.parse('2026-09-09T00:00:00Z');
const command:PendingCommand={id:'submission-1',kind:'reading',label:'Machine: 42 hours',assetId:'asset-a',args:{p_value:42,p_expected_revision:0},state:'pending'};
function disk(){let saved:OfflineState|null=null;let fail=false;return {storage:{read:async()=>saved,write:async(s:OfflineState)=>{if(fail)throw Error('Disk full');saved=JSON.parse(JSON.stringify(s));},remove:async()=>{saved=null;}},fail:()=>{fail=true;},get:()=>saved};}
describe('persistent offline commands',()=>{
 it('acknowledges durable entries, recovers after restart, and deduplicates the same retry ID',async()=>{
  const d=disk();const queue=new OfflineQueue('user-a',d.storage,null);await queue.validated(access,now);await queue.enqueue(command,now);
  const restarted=new OfflineQueue('user-a',d.storage,await d.storage.read());expect(restarted.snapshot().commands).toEqual([command]);await restarted.enqueue(command,now);expect(restarted.snapshot().commands).toHaveLength(1);
  await expect(restarted.enqueue({...command,args:{p_value:99}},now)).rejects.toThrow(/different details/);
 });
 it('storage failure never reports a command as saved',async()=>{
  const d=disk();const queue=new OfflineQueue('user-a',d.storage,null);await queue.validated(access,now);d.fail();await expect(queue.enqueue(command,now)).rejects.toThrow('Disk full');expect(queue.snapshot().commands).toHaveLength(0);
 });
 it('serializes concurrent cache and command writes without losing either',async()=>{
  const d=disk();const queue=new OfflineQueue('user-a',d.storage,null);await queue.validated(access,now);
  await Promise.all([queue.enqueue(command,now),queue.change(s=>{s.cache.tasks=['daily'];}),queue.enqueue({...command,id:'submission-2'},now)]);
  expect(d.get()?.commands).toHaveLength(2);expect(d.get()?.cache.tasks).toEqual(['daily']);
 });
 it('24-hour limit and known access end stop new entries without deleting queued work',async()=>{
  const d=disk();const queue=new OfflineQueue('user-a',d.storage,null);await queue.validated({...access,access_ends_at:new Date(now+3600000).toISOString()},now);await queue.enqueue(command,now);
  expect(offlineEntryAllowed(queue.snapshot(),now+3600000)).toBe(false);await expect(queue.enqueue({...command,id:'later'},now+3600000)).rejects.toThrow(/Reconnect/);expect(queue.snapshot().commands).toHaveLength(1);
  await queue.validated(access,now);expect(offlineEntryAllowed(queue.snapshot(),now+24*3600000)).toBe(false);
 });
 it('read-only keeps queued entries and history; confirmed wipe removes both',async()=>{
  const d=disk();const queue=new OfflineQueue('user-a',d.storage,null);await queue.validated(access,now);await queue.enqueue(command,now);await queue.change(s=>{s.cache.history=['old'];});
  await queue.validated({...access,can_write:false},now);expect(queue.snapshot().commands).toHaveLength(1);expect(queue.snapshot().cache.history).toEqual(['old']);await queue.clear();expect(d.get()).toBe(null);expect(queue.snapshot().commands).toHaveLength(0);
 });
 it('blocked entries survive restart and role changes discard cached admin-only views',async()=>{
  const d=disk();const queue=new OfflineQueue('user-a',d.storage,null);await queue.validated({...access,role:'admin'},now);await queue.enqueue(command,now);await queue.block(command.id,'Needs review');await queue.change(s=>{s.cache.cost=123;});await queue.validated(access,now);
  const restarted=new OfflineQueue('user-a',d.storage,await d.storage.read());expect(restarted.snapshot().commands[0].reason).toBe('Needs review');expect(restarted.snapshot().cache).toEqual({});await restarted.retry(command.id);expect(restarted.snapshot().commands[0].state).toBe('pending');
 });
 it('rejects another account’s cached state and unverified user access',async()=>{
  const d=disk();const queue=new OfflineQueue('user-a',d.storage,null);await expect(queue.enqueue(command,now)).rejects.toThrow(/Reconnect/);await expect(queue.validated({...access,user_id:'user-b'},now)).rejects.toThrow(/Access denied/);await queue.validated(access,now);expect(()=>new OfflineQueue('user-b',d.storage,queue.snapshot())).toThrow(/could not be opened/);
 });
});
