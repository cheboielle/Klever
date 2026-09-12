import {ColourPicker} from './ColourPicker';
import React,{useEffect,useState} from 'react';
import {View,Text,Pressable,ThemeContext,resolveTheme,type ThemeName} from './brandUI';
import {ProfilePhoto} from './ProfilePhoto';
import {rpc} from './client';
export type Branding={tenant_id:string;theme:ThemeName;revision:number};
export function BrandingSettings({writable,onSaved}:{writable:boolean;onSaved:()=>Promise<void>}){
 const [colourValid,setColourValid]=useState(true);
 const [saved,setSaved]=useState<Branding|null>(null),[choice,setChoice]=useState<ThemeName>('forest'),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function load(){const value=await rpc<Branding>('business_branding');setSaved(value);setChoice(value.theme);}
 useEffect(()=>{let alive=true;rpc<Branding>('business_branding').then(value=>{if(alive){setSaved(value);setChoice(value.theme);}}).catch(e=>{if(alive)setMessage(e.message);});return()=>{alive=false;};},[]);
 async function save(){if(!saved||busy)return;setBusy(true);setMessage('');try{
  const ok=await rpc<boolean>('save_business_branding',{p_theme:choice,p_revision:saved.revision});
  if(!ok){await load();throw Error('The theme changed elsewhere. The latest choice has been loaded; choose again.');}
  await load();await onSaved();setMessage('Business theme saved for everyone.');
 }catch(e){setMessage(e instanceof Error?e.message:'Unable to save the theme. Retry when connected.');}finally{setBusy(false);}}
 return <View style={{gap:16}}><Text style={{fontSize:21,fontWeight:'700',color:'#153C32'}}>Your business branding</Text><Text>Choose the colours and logo your whole team sees.</Text>
 {message?<Text accessibilityLiveRegion="polite">{message}</Text>:null}
 {saved?<><ColourPicker value={choice} onChange={setChoice} disabled={!writable||busy} onValidityChange={setColourValid}/>
 <ThemeContext.Provider value={choice}><View style={{padding:16,gap:12,borderRadius:16,backgroundColor:'#F5F6F0',borderWidth:1,borderColor:'#DFE5DC'}}><Text style={{fontWeight:'700',color:'#153C32'}}>Theme preview</Text><Text style={{color:'#153C32'}}>Your equipment. Your team.</Text><View style={{backgroundColor:resolveTheme(choice).brand,padding:14,borderRadius:10}}><Text style={{color:resolveTheme(choice).onBrand,fontWeight:'700'}}>Save reading</Text></View></View></ThemeContext.Provider>
 <Pressable accessibilityRole="button" disabled={busy||!writable||!colourValid||choice===saved.theme} onPress={()=>void save()} style={{padding:14,minHeight:48,backgroundColor:'#EAF0E7',borderRadius:12,opacity:busy||!writable||choice===saved.theme?.5:1}}><Text style={{fontWeight:'700',color:'#153C32'}}>{busy?'Saving theme…':'Save business theme'}</Text></Pressable>
 <ProfilePhoto kind="business" target={saved.tenant_id} editable writable={writable&&!busy} onChanged={()=>void onSaved()}/></>:<Pressable accessibilityRole="button" onPress={()=>void load().catch(e=>setMessage(e.message))} style={{padding:14,minHeight:48}}><Text>{message?"Retry loading branding":"Loading branding…"}</Text></Pressable>}
 </View>;
}
