import React,{useState} from 'react';
import {Pressable,Text,TextInput,View} from 'react-native';
import type {Asset} from '@klever/domain';
import {rpc} from './client';
export function AssetArchive({asset,writable,onSaved}:{asset:Asset;writable:boolean;onSaved:()=>Promise<void>}){
 const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const action=asset.archived?'Restore asset':'Archive asset';
 async function save(){if(busy||!writable)return;setBusy(true);setMessage('');try{await rpc('set_asset_archived',{p_asset:asset.id,p_archived:!asset.archived,p_reason:reason.trim()});await onSaved();}catch(e){setMessage(e instanceof Error?e.message:'Unable to update this asset. Reconnect and retry.');}finally{setBusy(false);}}
 const button=(label:string,press:()=>void,disabled=false)=><Pressable accessibilityRole="button" onPress={press} disabled={disabled} style={{padding:12,borderRadius:10,backgroundColor:'#EAF0E7',opacity:disabled?.5:1}}><Text style={{color:'#153C32',fontWeight:'600'}}>{label}</Text></Pressable>;
 return <View style={{gap:12}}>{!open?button(action,()=>setOpen(true),!writable):<>
 <Text>{asset.archived?'Restore this asset to active work? Existing assignments, readings and schedules resume without resetting due dates.':'Archive this asset? It leaves active work and reminders. Admins keep access to history and exports. Any unsynced work must wait until the asset is restored.'}</Text>
 <TextInput accessibilityLabel="Asset archive or restore reason" placeholder="Reason" value={reason} onChangeText={setReason} maxLength={1000} editable={!busy&&writable} style={{padding:12,backgroundColor:'white'}}/>
 {button('Confirm '+action.toLowerCase(),()=>void save(),!writable||busy||!reason.trim())}{button('Cancel',()=>setOpen(false),busy)}
 </>}{message?<Text accessibilityLiveRegion="polite">{message}</Text>:null}</View>;
}
