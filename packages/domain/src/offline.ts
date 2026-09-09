import type {Access} from './index';
export type PendingCommand={id:string;kind:'reading'|'issue'|'service'|'task';label:string;assetId?:string;meterUnit?:'hours'|'km';args:Record<string,unknown>;finalArgs?:Record<string,unknown>;photo?:string;state:'pending'|'blocked';reason?:string};
export type OfflineState={version:1;userId:string;access:Access|null;validatedAt:number;cache:Record<string,unknown>;commands:PendingCommand[]};
export interface QueueStorage{read():Promise<OfflineState|null>;write(value:OfflineState):Promise<void>;remove():Promise<void>}
export function offlineEntryAllowed(state:OfflineState,now=Date.now()):boolean{
 const end=state.access?.access_ends_at?Date.parse(state.access.access_ends_at):Infinity;
 return !!state.access?.allowed&&!!state.access?.can_write&&state.access.user_id===state.userId&&now>=state.validatedAt&&now-state.validatedAt<24*3600000&&now<end;
}
/** Persist before acknowledging changes; serialize cache writes and queued submissions. */
export class OfflineQueue{
 private state:OfflineState;private chain:Promise<unknown>=Promise.resolve();
 constructor(readonly userId:string,private storage:QueueStorage,loaded:OfflineState|null){
  if(loaded&&(loaded.version!==1||loaded.userId!==userId||!Array.isArray(loaded.commands)))throw Error('Saved offline data could not be opened. Reconnect before continuing.');
  this.state=loaded??{version:1,userId,access:null,validatedAt:0,cache:{},commands:[]};
 }
 snapshot(){return JSON.parse(JSON.stringify(this.state)) as OfflineState;}
 async change(work:(draft:OfflineState)=>void){
  const run=this.chain.then(async()=>{const next=this.snapshot();work(next);await this.storage.write(next);this.state=next;});this.chain=run.catch(()=>{});return run;
 }
 async validated(access:Access,now=Date.now()){
  if(!access.allowed||access.user_id!==this.userId)throw Error('Access denied');
  await this.change(s=>{if(s.access?.tenant_id&&s.access.tenant_id!==access.tenant_id){s.cache={};s.commands=[];}if(s.access?.role!==access.role)s.cache={};s.access=access;s.validatedAt=now;});
 }
 async enqueue(command:PendingCommand,now=Date.now()){
  await this.change(s=>{if(!offlineEntryAllowed(s,now))throw Error('Reconnect to confirm access before saving a new entry.');const old=s.commands.find(c=>c.id===command.id);if(old){if(JSON.stringify({...old,state:'pending',reason:undefined})!==JSON.stringify({...command,state:'pending',reason:undefined}))throw Error('This saved entry already has different details.');return;}s.commands.push(command);});
 }
 async replaceBlocked(id:string,replacement:PendingCommand,now=Date.now()){
  await this.change(s=>{if(!offlineEntryAllowed(s,now))throw Error('Reconnect to confirm access before resubmitting.');const index=s.commands.findIndex(c=>c.id===id&&c.state==='blocked');if(index<0)throw Error('This entry changed. Reopen the review.');s.commands[index]=replacement;});
 }
 async remove(id:string){await this.change(s=>{s.commands=s.commands.filter(c=>c.id!==id);});}
 async block(id:string,reason:string){await this.change(s=>{const c=s.commands.find(c=>c.id===id);if(c){c.state='blocked';c.reason=reason;}});}
 async retry(id:string){await this.change(s=>{const c=s.commands.find(c=>c.id===id);if(c){c.state='pending';delete c.reason;}});}
 async clear(){const run=this.chain.then(async()=>{await this.storage.remove();this.state={version:1,userId:this.userId,access:null,validatedAt:0,cache:{},commands:[]};});this.chain=run.catch(()=>{});return run;}
}
