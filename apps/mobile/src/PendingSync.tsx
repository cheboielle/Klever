import {SaveFeedback} from './SaveFeedback';
import React,{useEffect,useState} from 'react';
import {Pressable,Text,TextInput,View} from './brandUI';
import * as Crypto from 'expo-crypto';
import type {Asset} from '@klever/domain';
import type {PendingCommand} from '../../../packages/domain/src/offline';
import {currentOffline,notifyOffline,subscribeOffline} from './offlineStore';
import {discardBlockedEntry,flushQueue} from './offlineSync';
import {supabase} from './client';
export function PendingSync(){
 const [,render]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[remove,setRemove]=useState<string|null>(null),[review,setReview]=useState<{command:PendingCommand;asset:Asset;correctionTarget:string|null}|null>(null),[value,setValue]=useState(''),[reason,setReason]=useState('');useEffect(()=>subscribeOffline(()=>render(v=>v+1)),[]);
 const commands=currentOffline()?.snapshot().commands??[],admin=currentOffline()?.snapshot().access?.role!=='technician';
 async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await fn();notifyOffline();}catch(e){setError(e instanceof Error?e.message:'Unable to continue.');}finally{setBusy(false);}}
 async function sync(id?:string,confirm=false){await run(async()=>{const q=currentOffline();if(id&&q){if(confirm)await q.change(s=>{const c=s.commands.find(x=>x.id===id);if(c)c.args.p_confirmed=true;});await q.retry(id);}await flushQueue();});}
 async function openReview(command:PendingCommand){await run(async()=>{
  const access=await flushQueue();if(!access.online)throw Error('Reconnect to review the current asset reading.');
  const {data,error}=await supabase!.from('assets').select('id,name,meter_unit,current_hours,meter_revision').eq('id',command.assetId!).single();if(error)throw Error('This asset is no longer available to you. Contact your administrator.');
  const history=await supabase!.from('hour_logs').select('id').eq('asset_id',command.assetId!).eq('meter_unit',data.meter_unit).order('revision',{ascending:false}).limit(1);if(history.error)throw history.error;
  setReview({command,asset:data as Asset,correctionTarget:history.data[0]?.id??null});setValue(command.meterUnit===data.meter_unit?String(command.args.p_value):'');setReason('');
 });}
 async function resubmit(){if(!review)return;await run(async()=>{
  if(!value.trim()||!Number.isFinite(Number(value))||Number(value)<0)throw Error('Enter the correct reading.');
  const lower=Number(value)<Number(review.asset.current_hours);if(lower&&(!admin||!review.correctionTarget))throw Error('An administrator must correct an accepted reading before a lower value can be saved.');
  if(!reason.trim())throw Error('Explain why this queued reading is being corrected.');
  const q=currentOffline();if(!q)throw Error('Sign in again.');const id=Crypto.randomUUID();
  await q.replaceBlocked(review.command.id,{...review.command,id,meterUnit:review.asset.meter_unit,label:`${review.asset.name}: ${value} ${review.asset.meter_unit}`,state:'pending',reason:undefined,args:{p_id:id,p_asset:review.asset.id,p_value:Number(value),p_expected_revision:review.asset.meter_revision,p_capture_time:review.command.args.p_capture_time,p_confirmed:true,p_correction_of:lower?review.correctionTarget:null,p_reason:reason.trim()}});setReview(null);await flushQueue();
 });}
 const button=(label:string,press:()=>void)=><Pressable accessibilityRole="button" disabled={busy} onPress={press} style={{padding:10}}><Text style={{fontWeight:'600'}}>{label}</Text></Pressable>;
 if(!commands.length&&!error)return <SaveFeedback/>;
 return <><SaveFeedback/><View style={{padding:16,borderRadius:14,backgroundColor:'#FFF0DC',gap:12}}><Text style={{fontWeight:'700',color:'#153C32'}}>Saved on this device · {commands.length} awaiting sync</Text>{commands.map(c=><View key={c.id} style={{gap:6}}><Text>{c.label} — {c.state==='blocked'?'Needs review':'Pending sync'}</Text>{c.reason?<Text>{c.reason}</Text>:null}{c.state==='blocked'?<>
  <Text>{c.kind==='reading'?`Reading: ${c.args.p_value} ${c.meterUnit??''}`:String(c.args.p_description??c.args.p_notes??'Original details and any photo are kept on this device.')}</Text>
  {button(c.reason?.startsWith('Check this unusually')?'Confirm reading and retry':'Retry this entry',()=>void sync(c.id,c.reason?.startsWith('Check this unusually')??false))}
  {c.kind==='reading'?button('Review and correct reading',()=>void openReview(c)):null}
  {remove===c.id?<><Text>Remove this blocked copy from the device? Re-enter it first if it is still needed. This does not delete anything already received by the server.</Text>{button('Confirm removal',()=>void run(async()=>{await discardBlockedEntry(c.id);setRemove(null);} ))}{button('Keep entry',()=>setRemove(null))}</>:button('Remove blocked copy',()=>setRemove(c.id))}
 </>:null}</View>)}
 {review?<View style={{gap:10}}><Text style={{fontWeight:'700'}}>Review {review.asset.name}</Text><Text>Current accepted reading: {review.asset.current_hours} {review.asset.meter_unit}. Saving confirms the value below.</Text><TextInput accessibilityLabel="Reviewed meter reading" value={value} onChangeText={setValue} keyboardType="decimal-pad" style={{padding:12,backgroundColor:'white',borderRadius:8}}/><TextInput accessibilityLabel="Reason for reviewing queued reading" placeholder="Reason for correction" value={reason} onChangeText={setReason} style={{padding:12,backgroundColor:'white',borderRadius:8}}/>{button('Confirm corrected reading',()=>void resubmit())}{button('Cancel review',()=>setReview(null))}</View>:null}
 {error?<Text>{error}</Text>:null}{button(busy?'Syncing…':'Sync now',()=>void sync())}</View></>;
}
