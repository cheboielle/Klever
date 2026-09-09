import {FormScroll} from './FormScroll';
import React,{useState} from 'react';
import {Modal,Pressable,ScrollView,Text,TextInput,View} from 'react-native';
import {rpc} from './client';
export function AssetTypeSettings({types,writable,onSaved}:{types:{id:string;name:string}[];writable:boolean;onSaved:()=>Promise<void>}){
 const [open,setOpen]=useState(false),[editing,setEditing]=useState<string|null>(null),[name,setName]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const button=(label:string,press:()=>void,disabled=false)=><Pressable accessibilityRole="button" onPress={press} disabled={disabled} style={{padding:12,borderRadius:10,backgroundColor:'#EAF0E7',opacity:disabled?.5:1}}><Text style={{color:'#153C32',fontWeight:'600'}}>{label}</Text></Pressable>;
 async function save(){if(!editing||busy)return;setBusy(true);setMessage('');try{await rpc('save_asset_type',{p_id:editing,p_name:name.trim()});setEditing(null);await onSaved();setMessage('Asset type renamed.');}catch(e){setMessage(e instanceof Error?e.message:'Unable to rename. Reconnect and retry.');}finally{setBusy(false);}}
 return <>{button('Asset types',()=>setOpen(true))}<Modal visible={open} onRequestClose={()=>setOpen(false)} animationType="slide"><FormScroll contentContainerStyle={{padding:24,paddingTop:50,gap:16,backgroundColor:'#F5F6F0'}}>
 {button('Close',()=>setOpen(false))}<Text style={{fontSize:26,fontWeight:'700'}}>Asset types</Text><Text>Renaming a type changes its label for all assets using it. Their service schedules and evidence are kept.</Text>
 {types.map(type=><View key={type.id}>{button(type.name,()=>{setEditing(type.id);setName(type.name);setMessage('');},busy||!writable)}</View>)}
 {!types.length?<Text>Create an asset type when adding your first asset.</Text>:null}
 {editing?<><TextInput accessibilityLabel="Asset type name" value={name} onChangeText={setName} editable={writable&&!busy} maxLength={80} style={{padding:12,backgroundColor:'white'}}/>{button(busy?'Saving…':'Save name',()=>void save(),!writable||busy||!name.trim())}{button('Cancel rename',()=>setEditing(null),busy)}</>:null}
 {message?<Text accessibilityLiveRegion="polite">{message}</Text>:null}</FormScroll></Modal></>;
}
