import type {Access} from '@klever/domain';
import type {PendingCommand} from '../../../packages/domain/src/offline';
import {rpc,supabase} from './client';
import {currentOffline,clearOffline,networkFailure,notifyOffline} from './offlineStore';
import {persistMedia,mediaBytes,removeMedia} from './offlineMedia';
const syncedListeners=new Set<()=>void>();
export const subscribeSynced=(fn:()=>void)=>{syncedListeners.add(fn);return()=>{syncedListeners.delete(fn);};};
let syncing:Promise<{online:boolean;synced:number}>|null=null;
export async function queueEntry(command:Omit<PendingCommand,'state'>,photoUri?:string){
 const q=currentOffline();if(!q)throw Error('Sign in and connect before saving an entry.');
 const old=q.snapshot().commands.find(c=>c.id===command.id);let photo=old?.photo;
 if(photoUri&&!photo)photo=await persistMedia(q.userId,command.id,photoUri);
 try{
  if(q!==currentOffline())throw Error('Your account changed. Sign in again.');
  const args={...command.args};
  // A sequence from this phone depends on its earlier queued readings, not on stale cache updates.
  if(command.kind==='reading'&&!old){const preceding=q.snapshot().commands.filter(c=>c.kind==='reading'&&c.assetId===command.assetId);for(const c of preceding)args.p_expected_revision=Math.max(Number(args.p_expected_revision),Number(c.args.p_expected_revision)+1);}
  await q.enqueue({...command,args,photo,state:'pending'});notifyOffline();
 }catch(e){if(photo&&!old?.photo)await removeMedia(photo);throw e;}
}
export async function flushQueue(options:{maxCommands?:number}={}){if(syncing)return syncing;syncing=flush(options.maxCommands??Infinity);try{const result=await syncing;if(result.synced)for(const fn of syncedListeners)fn();return result;}finally{syncing=null;}}
async function flush(maxCommands:number):Promise<{online:boolean;synced:number}>{
 const q=currentOffline();if(!q||!supabase)return {online:false,synced:0};let synced=0;
 async function validate(){const access=await rpc<Access>('access_status');if(q!==currentOffline())throw Error('Account changed');if(!access.allowed){await clearOffline();await supabase!.auth.signOut({scope:'local'});throw Error('Access revoked');}await q!.validated(access);notifyOffline();return access;}
 try{const access=await validate();if(!access.can_write)return {online:true,synced:0};}
 catch{return {online:false,synced:0};}
 const blockedAssets=new Set<string>();let attempted=0;
 for(const command of q.snapshot().commands){
  if(q!==currentOffline())break;
  if(command.state==='blocked'){if(command.assetId&&command.kind==='reading')blockedAssets.add(command.assetId);continue;}
  if(command.assetId&&blockedAssets.has(command.assetId)&&(command.kind==='reading'||command.kind==='service'))continue;
  if(attempted>=maxCommands)break;attempted++;
  try{
   let result:{status?:string;path?:string;already_completed?:boolean};
   if(command.kind==='reading')result=await rpc('log_hours',command.args);
   else if(command.kind==='issue')result=await rpc('report_issue',command.args);
   else {
    const prepared=await rpc<{status?:string;path?:string;already_completed?:boolean}>(command.kind==='service'?'prepare_service_photo':'prepare_task',command.args);
    if(prepared.status==='already_completed')result=prepared;
    else{
     if(command.photo&&prepared.path&&!prepared.already_completed&&prepared.status!=='completed'){
      const bytes=await mediaBytes(command.photo);if(bytes.byteLength>10485760)throw Error('Photo is too large. Reopen the entry with a smaller photo.');
      const {error}=await supabase.storage.from('evidence').upload(prepared.path,bytes,{contentType:'image/jpeg',upsert:false,cacheControl:'0'});
      if(error&&!/already exists|duplicate/i.test(error.message)&&String((error as {statusCode?:string}).statusCode)!=='409')throw error;
     }
     result=await rpc(command.kind==='service'?'complete_service':'complete_task',{p_id:command.id,...command.finalArgs});
    }
   }
   if(q!==currentOffline())break;
   if(result.status==='conflict'||result.status==='confirmation_required'){
    await q.block(command.id,result.status==='confirmation_required'?'Check this unusually large reading before syncing.':'The asset reading changed. An administrator needs to review this entry.');if(command.assetId&&command.kind==='reading')blockedAssets.add(command.assetId);
   }else{
    if(!result.status||!['accepted','reported','applied','pending_correction','completed','already_completed'].includes(result.status))throw Error('The server response was incomplete. Retry this entry.');
    await q.remove(command.id);synced++;if(command.photo)await removeMedia(command.photo);
   }
  }catch(e){
   if(q!==currentOffline())break;
   if(networkFailure(e))return {online:false,synced};
   try{const access=await validate();if(!access.can_write)return {online:true,synced};}catch{return {online:false,synced};}
   await q.block(command.id,e instanceof Error?e.message:'This entry needs review before syncing.');if(command.assetId&&command.kind==='reading')blockedAssets.add(command.assetId);
  }
  notifyOffline();
 }
 return {online:true,synced};
}

export async function discardBlockedEntry(id:string){
 if(syncing)await syncing;const q=currentOffline();const command=q?.snapshot().commands.find(c=>c.id===id&&c.state==='blocked');if(!q||!command)throw Error('This entry changed. Refresh the pending list.');await q.remove(id);if(command.photo)await removeMedia(command.photo);notifyOffline();
}
