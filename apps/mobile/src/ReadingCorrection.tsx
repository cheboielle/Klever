import React,{useRef,useState} from 'react';
import {Pressable,Text,TextInput,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import type {Asset} from '@klever/domain';
import {rpc} from './client';
export function ReadingCorrection({asset,writable,onSaved}:{asset:Asset;writable:boolean;onSaved:()=>Promise<void>}){
 const [open,setOpen]=useState(false),[value,setValue]=useState(String(asset.current_hours)),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const submission=useRef<Record<string,unknown>|null>(null);
 async function save(){if(busy||!writable||!confirmed)return;setBusy(true);setMessage('');try{
  if(!submission.current){
   if(!/^\d+(\.\d{1,2})?$/.test(value.trim())||!Number.isFinite(Number(value))||Number(value)>=10000000000)throw Error('Enter the correct current meter reading.');
   if(!reason.trim()||reason.trim().length>1000)throw Error('Explain the correction in 1000 characters or fewer.');
   submission.current={p_id:Crypto.randomUUID(),p_asset:asset.id,p_value:Number(value),p_expected_revision:asset.meter_revision,p_capture_time:new Date().toISOString(),p_reason:reason.trim(),p_confirmed:true};
  }
  const result=await rpc<{status:string}>('correct_asset_reading',submission.current);
  if(result.status==='conflict'){submission.current=null;throw Error('A newer reading was saved. Close this asset and reopen it to review the latest reading.');}
  if(result.status!=='accepted')throw Error('Confirm the corrected reading before saving.');
  setOpen(false);await onSaved();
 }catch(e){setMessage(e instanceof Error?e.message:'Unable to save. Reconnect and retry.');}finally{setBusy(false);}}
 const button=(label:string,press:()=>void,disabled=false)=><Pressable accessibilityRole="button" disabled={disabled} onPress={press} style={{padding:13,borderRadius:10,backgroundColor:'#EAF0E7',opacity:disabled?.5:1}}><Text style={{color:'#153C32',fontWeight:'600'}}>{label}</Text></Pressable>;
 return <View style={{gap:10}}>{!open?button('Correct current reading',()=>{setOpen(true);setMessage('');},!writable):<>
 <Text style={{fontWeight:'700'}}>Correct {asset.current_hours} {asset.meter_unit}</Text><Text>Enter the correct current counter value. The original reading or setup record stays in history; this does not record a service.</Text>
 <TextInput accessibilityLabel="Correct current reading" keyboardType="decimal-pad" value={value} editable={writable&&!busy&&!submission.current} onChangeText={v=>{setValue(v);setConfirmed(false);}} style={{padding:12,backgroundColor:'white'}}/>
 <TextInput accessibilityLabel="Reading correction reason" value={reason} editable={writable&&!busy&&!submission.current} onChangeText={setReason} placeholder="Reason for correction" style={{padding:12,backgroundColor:'white'}}/>
 <Pressable accessibilityRole="checkbox" accessibilityState={{checked:confirmed}} disabled={busy||Boolean(submission.current)} onPress={()=>setConfirmed(!confirmed)} style={{padding:12}}><Text>{confirmed?'✓ ':''}I confirm {value||'the reading'} {asset.meter_unit} is the correct current value.</Text></Pressable>
 {submission.current?<Text>A save has been attempted. Retry these same details to safely check its result.</Text>:null}
 {button(busy?'Saving…':submission.current?'Retry correction':'Save correction',()=>void save(),busy||!writable||!confirmed)}
 {button('Close correction',()=>setOpen(false),busy)}
 </>}{message?<Text accessibilityLiveRegion="polite">{message}</Text>:null}</View>;
}
