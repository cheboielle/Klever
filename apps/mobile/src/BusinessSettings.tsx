import {SelectField} from './SelectField';
import {FormScroll} from './FormScroll';
import React,{useState} from 'react';
import {Modal,Platform,Pressable,ScrollView,Text,TextInput} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import {rpc} from './client';
type Settings={name:string;timezone:string;app_lock:boolean;currency:string;revision:number};
function Button({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean}){return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={{padding:13,borderRadius:10,backgroundColor:'#EAF0E7',opacity:disabled?.5:1}}><Text style={{color:'#153C32'}}>{label}</Text></Pressable>;}
export function BusinessSettings({writable,onSaved}:{writable:boolean;onSaved:()=>Promise<void>}){
 const [open,setOpen]=useState(false),[settings,setSettings]=useState<Settings|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setMessage('');try{await action();}catch(e){setMessage(e instanceof Error?e.message:'Unable to save. Check your connection and retry.');}finally{setBusy(false);}}
 function change(patch:Partial<Settings>){setSettings(s=>s?{...s,...patch}:s);}
 async function load(){setSettings(null);setSettings(await rpc<Settings>('business_settings'));}
 async function save(){if(!settings)return;
  if(settings.app_lock&&Platform.OS!=='web'&&await LocalAuthentication.getEnrolledLevelAsync()===LocalAuthentication.SecurityLevel.NONE)throw Error('Set a phone passcode or biometric unlock in your phone settings before enabling app lock.');
  const saved=await rpc<boolean>('save_business_settings',{p_name:settings.name.trim(),p_timezone:settings.timezone.trim(),p_lock:settings.app_lock,p_currency:settings.currency,p_revision:settings.revision});
  if(!saved)throw Error('Business settings changed elsewhere. Close and reopen to load the latest settings.');
  await load();setMessage('Business settings saved.');await onSaved();
 }
 return <><Button label="Business settings" onPress={()=>{setOpen(true);void run(load);}}/>
 <Modal visible={open} animationType="slide" onRequestClose={()=>setOpen(false)}><FormScroll contentContainerStyle={{padding:24,paddingTop:50,gap:15,backgroundColor:'#F5F6F0'}} keyboardShouldPersistTaps="handled">
 <Button label="Close" onPress={()=>setOpen(false)}/><Text style={{fontSize:26,fontWeight:'700',color:'#153C32'}}>Business settings</Text>
 {message?<Text accessibilityLiveRegion="polite">{message}</Text>:null}{busy?<Text>Working…</Text>:null}
 {settings?<><Text>Business name</Text><TextInput accessibilityLabel="Business name" value={settings.name} onChangeText={name=>change({name})} editable={writable&&!busy} style={{padding:12,backgroundColor:'white'}}/>
 <Text>Business timezone</Text><TextInput accessibilityLabel="Business timezone" autoCapitalize="none" value={settings.timezone} onChangeText={timezone=>change({timezone})} editable={writable&&!busy} style={{padding:12,backgroundColor:'white'}}/>
 <Text>Phone app lock</Text><Button label={settings.app_lock?'On — require phone unlock':'Off'} disabled={!writable||busy} onPress={()=>change({app_lock:!settings.app_lock})}/>
 <Text>When enabled, staff use their phone passcode or biometrics when opening or returning to the app. Each phone needs a passcode set up.</Text>
 <SelectField label="Currency for new service costs" value={settings.currency} options={['NZD','AUD','USD','CAD','GBP','EUR'].map(value=>({value,label:value}))} disabled={!writable||busy} onChange={currency=>change({currency})}/>
 <Text>Earlier costs keep their recorded currency. Amounts are never converted.</Text>
 <Button label="Save settings" disabled={!writable||busy||!settings.name.trim()||!settings.timezone.trim()} onPress={()=>void run(save)}/></>:!busy?<Button label="Retry" onPress={()=>void run(load)}/>:null}
 </FormScroll></Modal></>;
}
