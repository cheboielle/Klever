import React,{useState} from 'react';
import {Pressable,Text,View} from './brandUI';
import {supabase} from './client';
import {saveExport} from './saveExport';
export function ExportPanel({assetId}:{assetId?:string}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function download(kind:string,format:string){if(busy||!supabase)return;setBusy(true);setMessage('Preparing your export…');try{const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('Sign in again to export.');
  const response=await fetch(process.env.EXPO_PUBLIC_SUPABASE_URL+'/functions/v1/export-report',{method:'POST',headers:{apikey:process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({kind,format,assetId:assetId??null}),cache:'no-store'});
  if(!response.ok)throw Error('Export could not be completed. Check your connection and admin access, then retry.');
  await saveExport(new Uint8Array(await response.arrayBuffer()),`klever-${kind}.${format}`,format==='pdf'?'application/pdf':'text/csv');setMessage('Export prepared.');
 }catch(e){setMessage(e instanceof Error?e.message:'Export failed. Please retry.');}finally{setBusy(false);}}
 return <View style={{gap:12,padding:14,borderRadius:12,borderWidth:1,borderColor:'#DFE5DC'}}><Pressable accessibilityRole="button" onPress={()=>setOpen(!open)}><Text style={{fontWeight:'700',color:'#153C32'}}>{assetId?'Export this asset':'Export business records'} {open?'−':'+'}</Text></Pressable>
 {open?<><Text>Exports include original records and corrections. A connection is required.</Text>{[['assets','Asset register'],['logs','Meter readings'],['services','Maintenance history with photos'],['tasks','Task history']].map(([kind,label])=><View key={kind} style={{gap:8}}><Text>{label}</Text><View style={{flexDirection:'row',gap:10}}>{['pdf','csv'].map(format=><Pressable accessibilityRole="button" key={format} disabled={busy} onPress={()=>void download(kind,format)} style={{padding:12,backgroundColor:'#EAF0E7',borderRadius:10,opacity:busy?.5:1}}><Text>{format.toUpperCase()}</Text></Pressable>)}</View></View>)}</>:null}
 {message?<Text accessibilityLiveRegion="polite">{message}</Text>:null}</View>;
}
