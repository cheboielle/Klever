import {nativeInteraction} from './nativeInteraction';
import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Image,Platform,Pressable,StyleSheet,Text,View} from './brandUI';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import {rpc,supabase,downloadServicePhoto} from './client';
import {stampPhoto,photoBytes,deletePhoto} from './stampPhoto';

type Props={kind:'asset'|'member'|'business'|'invitation';target:string;editable?:boolean;writable?:boolean;compact?:boolean;header?:boolean;onEditingChange?:(editing:boolean)=>void;onChanged?:()=>void};
const errorText=(e:unknown)=>e instanceof Error?e.message:'Unable to save this photo. Check your connection and retry.';
export function ProfilePhoto({kind,target,editable=false,writable=false,compact=false,header=false,onEditingChange,onChanged}:Props){
 const [current,setCurrent]=useState<{id:string|null;revision:number}>({id:null,revision:0}),[uri,setUri]=useState<string|null>(null),[loading,setLoading]=useState(true),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[remove,setRemove]=useState(false);
 const [draft,setDraft]=useState<{uri:string;width:number;height:number}|null>(null),[ready,setReady]=useState(false);
 const frame=useRef<View|null>(null),files=useRef<string[]>([]),live=useRef(true),generation=useRef(0),pending=useRef<{id:string;uri:string}|null>(null);
 useEffect(()=>{onEditingChange?.(editing||busy);return()=>onEditingChange?.(false);},[editing,busy,onEditingChange]);
 const label=kind==='asset'?'Asset photo':kind==='business'?'Business logo':'Profile picture';
 async function load(){const ticket=++generation.current;setLoading(true);setError('');try{
  const result=await rpc<{id:string|null;revision:number}>('get_profile_photo',{p_kind:kind,p_target:target});
  if(!live.current||ticket!==generation.current)return;setCurrent(result);setUri(null);
  if(result.id){const blob=await downloadServicePhoto(result.id,'profile');const image=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Unable to display the photo.'));reader.readAsDataURL(blob);});if(live.current&&ticket===generation.current)setUri(image);}
 }catch(e){if(live.current&&ticket===generation.current)setError(errorText(e));}finally{if(live.current&&ticket===generation.current)setLoading(false);}}
 useEffect(()=>{live.current=true;void load();return()=>{live.current=false;generation.current++;files.current.forEach(deletePhoto);};},[kind,target]);
 async function pick(camera:boolean){if(busy||!writable)return;setBusy(true);setError('');try{
  if(camera&&Platform.OS!=='web'){const permission=await nativeInteraction(()=>ImagePicker.requestCameraPermissionsAsync());if(!permission.granted)throw Error('Allow camera access in your phone settings, or choose a photo.');}
  const options:ImagePicker.ImagePickerOptions={mediaTypes:['images'],quality:.85,allowsMultipleSelection:false};
  const result=await nativeInteraction(()=>camera?ImagePicker.launchCameraAsync(options):ImagePicker.launchImageLibraryAsync(options));
  if(!result.canceled){const photo=result.assets[0];if(!live.current){deletePhoto(photo.uri);return;}files.current.push(photo.uri);setReady(false);setDraft(photo);pending.current=null;}
 }catch(e){if(live.current)setError(errorText(e));}finally{if(live.current)setBusy(false);}}
 async function save(clear=false){if(busy||!writable||(!clear&&(!draft||!ready)))return;setBusy(true);setError('');try{
  let upload:string|null=null;
  if(!clear){
   if(!pending.current){const normalized=await stampPhoto(draft!.uri,'',frame);files.current.push(normalized);pending.current={id:Crypto.randomUUID(),uri:normalized};}
   const p=pending.current;upload=p.id;
   const path=await rpc<string>('prepare_profile_photo',{p_id:p.id,p_kind:kind,p_target:target});
   const bytes=await photoBytes(p.uri);if(bytes.byteLength>10485760)throw Error('This photo is too large. Cancel and choose a smaller photo.');
   const {error}=await supabase!.storage.from('evidence').upload(path,bytes,{contentType:'image/jpeg',upsert:false,cacheControl:'0'});
   if(error&&!/already exists|duplicate/i.test(error.message)&&String((error as {statusCode?:string}).statusCode)!=='409')throw error;
  }
  const result=await rpc<{status:string}>('save_profile_photo',{p_kind:kind,p_target:target,p_upload:upload,p_revision:current.revision});
  if(result.status==='conflict')throw Error('Someone changed this photo. Cancel, refresh the photo and try again.');
  if(live.current){setDraft(null);pending.current=null;setEditing(false);setRemove(false);await load();onChanged?.();}
 }catch(e){if(live.current)setError(errorText(e));}finally{if(live.current)setBusy(false);}}
 const button=(title:string,press:()=>void,disabled=false)=><Pressable accessibilityRole="button" onPress={press} disabled={disabled} style={[s.button,disabled&&{opacity:.4}]}><Text style={s.buttonText}>{title}</Text></Pressable>;
 if(header)return uri?<Image accessibilityLabel="Business logo" onError={()=>setUri(null)} source={{uri}} resizeMode="contain" style={{width:44,height:44,borderRadius:8,backgroundColor:"white"}}/>:<Text accessibilityLabel="Klever" style={{width:38,height:38,lineHeight:37,textAlign:"center",borderRadius:12,fontSize:29,fontWeight:"800",backgroundColor:"#153C32",color:"white"}}>k</Text>;
 return <View style={compact?s.compact:s.group}>
  {!compact?<Text style={s.label}>{label}</Text>:null}
  {loading?<ActivityIndicator/>:uri?<Image accessibilityLabel={label} source={{uri}} style={compact?s.thumb:[s.photo,kind==='member'&&s.avatar]} resizeMode={kind==='member'?'cover':'contain'}/>:<View style={compact?s.thumb:s.empty}><Text style={s.muted}>{compact?'Photo':`No ${label.toLowerCase()} yet`}</Text></View>}
  {error?<View style={s.group}><Text style={s.error}>{error}</Text>{button('Refresh photo',()=>void load(),busy)}</View>:null}
  {editable&&!compact?<>
   {!editing?button(current.id?'Change photo':'Add photo',()=>{setEditing(true);setError('');},busy||loading||!writable):<View style={s.group}>
    {draft?<View ref={frame} collapsable={false} style={{width:'100%',backgroundColor:'white'}}><Image accessibilityLabel="New photo preview" source={{uri:draft.uri}} style={{width:'100%',aspectRatio:draft.width/draft.height}} onLoad={()=>setReady(true)} onError={()=>setError('Unable to open this photo. Choose another image.')}/></View>:null}
    {button('Take photo',()=>void pick(true),busy||!!pending.current||!writable)}{button('Choose from gallery',()=>void pick(false),busy||!!pending.current||!writable)}
    {draft?button(busy?'Saving photo…':pending.current?'Retry saving photo':'Save photo',()=>void save(),busy||!ready||!writable):null}
    {current.id&&!draft?<>{remove?<><Text style={s.muted}>Remove this picture from the {kind==='asset'?'asset':'profile'}?</Text>{button('Confirm removal',()=>void save(true),busy||!writable)}</>:button('Remove photo',()=>setRemove(true),busy||!writable)}</>:null}
    {button('Cancel',()=>{setEditing(false);setDraft(null);setRemove(false);pending.current=null;setError('');},busy)}
   </View>}
  </>:null}
 </View>;
}
const s=StyleSheet.create({group:{gap:12},compact:{width:64,minHeight:64},thumb:{width:64,height:64,borderRadius:12,backgroundColor:'#EAF0E7',alignItems:'center',justifyContent:'center'},photo:{width:'100%',height:220,borderRadius:14,backgroundColor:'#EAF0E7'},avatar:{width:112,height:112,borderRadius:56},empty:{padding:18,borderRadius:12,backgroundColor:'#EAF0E7'},label:{fontSize:15,fontWeight:'700',color:'#153C32'},muted:{fontSize:13,color:'#6B7870'},button:{padding:13,borderRadius:10,backgroundColor:'#EAF0E7',alignItems:'center'},buttonText:{fontSize:14,fontWeight:'600',color:'#153C32'},error:{fontSize:13,color:'#A23D37',lineHeight:19}});
