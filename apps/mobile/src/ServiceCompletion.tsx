import {nativeInteraction} from './nativeInteraction';
import {currentOffline} from './offlineStore';
import {queueEntry,flushQueue} from './offlineSync';
import React,{useEffect,useRef,useState} from 'react';
import {Image,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {CameraView,useCameraPermissions} from 'expo-camera';
import * as Crypto from 'expo-crypto';
import type {Asset} from '@klever/domain';
import {rpc,supabase,downloadServicePhoto} from './client';
import {stampPhoto,photoBytes,deletePhoto} from './stampPhoto';

export type ServiceConfig={name:string;instructions:string;mode:'meter'|'calendar'|'both';meter_unit:'hours'|'km';interval_reading:number|null;interval_days:number|null};
type History={corrections:{action:string;reason:string;baseline_reading:number|null;baseline_date:string|null;meter_unit:string;server_time:string}[];id:string;state:string;capture_time:string;server_time:string;reading:number;meter_unit:string;performer_name:string;snapshot:ServiceConfig;object_path:string;cost:number|null;currency:string|null;mechanic_notes:string|null};
function Button({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean}){return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button,disabled&&{opacity:.4}]}><Text style={s.buttonText}>{label}</Text></Pressable>;}

export function ServiceCompletion({asset,service,admin,writable,onSaved,onCancel}:{asset:Asset;service:{id:string;config:ServiceConfig;settings_revision:number};admin:boolean;writable:boolean;onSaved:()=>void;onCancel:()=>void}){
  const currency=useRef(currentOffline()?.snapshot().access?.reporting_currency??'NZD').current;
  const [permission,requestPermission]=useCameraPermissions(),[cameraOpen,setCameraOpen]=useState(false),[ready,setReady]=useState(false),[imageReady,setImageReady]=useState(false);
  const [photo,setPhoto]=useState<{uri:string;width:number;height:number;capture:string}|null>(null),[reading,setReading]=useState(String(asset.current_hours));
  const [cost,setCost]=useState(''),[notes,setNotes]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
  const camera=useRef<CameraView|null>(null),frame=useRef<View|null>(null),submission=useRef<{id:string;uri:string;reading:number}|null>(null),files=useRef<string[]>([]);
  useEffect(()=>()=>{for(const file of files.current)deletePhoto(file);},[]);
  async function capture(){
    if(!camera.current||busy||!ready)return;setBusy(true);setError('');
    try{const capture=new Date().toISOString();const image=await camera.current.takePictureAsync({quality:.9});if(!image)throw Error('No photo was captured. Try again.');files.current.push(image.uri);setImageReady(false);setPhoto({...image,capture});submission.current=null;setCameraOpen(false);}
    catch(e){setError(e instanceof Error?e.message:'Unable to take the photo.');}finally{setBusy(false);}
  }
  async function save(){
    if(!photo||!imageReady||busy||!writable)return;setBusy(true);setError('');
    try{
      const number=Number(reading);
      if(!reading.trim()||!Number.isFinite(number)||number<0||number>Number(asset.current_hours))throw Error('Enter a service reading no higher than the current asset reading. Log a newer meter reading first if needed.');
      if(admin&&cost.trim()&&(!Number.isFinite(Number(cost))||Number(cost)<0))throw Error('Enter a valid cost.');
      if(!submission.current){
        const uri=await stampPhoto(photo.uri,`Captured ${photo.capture}`,frame);files.current.push(uri);
        submission.current={id:Crypto.randomUUID(),uri,reading:number};
      }
      const pending=submission.current;
      await queueEntry({id:pending.id,kind:'service',label:`${asset.name}: ${service.config.name}`,assetId:asset.id,args:{p_id:pending.id,p_asset:asset.id,p_service:service.id,p_reading:pending.reading,p_capture_time:photo.capture,p_snapshot:service.config,p_settings_revision:service.settings_revision},finalArgs:{p_cost:admin&&cost.trim()?Number(cost):null,p_mechanic_notes:admin?notes:'',p_currency:admin?currency:null}},pending.uri);
      setResult('Service and photo saved on this device. They will sync when connected; check Pending sync for progress or anything needing review.');void flushQueue();
    }catch(e){setError(e instanceof Error?e.message:'The service could not be saved. Your photo is still here; retry when connected.');}finally{setBusy(false);}
  }
  if(result)return <View style={s.card}><Text style={s.text}>{result}</Text><Button label="Done" onPress={onSaved}/></View>;
  return <View style={s.card}>
    <Text style={s.title}>Complete {service.config.name}</Text><Text style={s.text}>{service.config.instructions||'Follow the applicable maintenance instructions for this asset.'}</Text>
    <Text style={s.label}>Service reading ({asset.meter_unit})</Text><TextInput accessibilityLabel="Service reading" value={reading} onChangeText={setReading} editable={!submission.current&&!busy} keyboardType="decimal-pad" style={s.input}/>
    <Text style={s.small}>Current asset reading: {asset.current_hours} {asset.meter_unit}</Text>
    {cameraOpen?<>
      {permission?.granted?<CameraView ref={camera} facing="back" mode="picture" onCameraReady={()=>setReady(true)} onMountError={()=>{setError('Camera unavailable. Use a phone with a working camera to record this service.');setCameraOpen(false);}} style={s.camera}/>:<><Text style={s.text}>Camera access is required for a service photo.</Text><Button label="Allow camera" onPress={()=>void nativeInteraction(()=>requestPermission())}/></>}
      <Button label="Take service photo" onPress={()=>void capture()} disabled={busy||!ready||!permission?.granted}/>
    </>:photo?<>
      <View ref={frame} collapsable={false} style={{width:'100%',backgroundColor:'#153C32'}}><Image source={{uri:photo.uri}} style={{width:'100%',aspectRatio:photo.width/photo.height}} onLoad={()=>setImageReady(true)} onError={()=>setError('The captured photo could not be loaded. Retake it.')}/><Text style={s.stamp}>Captured {photo.capture}</Text></View>
      {!submission.current?<Button label="Retake photo" onPress={()=>{setReady(false);setCameraOpen(true);}} disabled={busy}/>:null}
    </>:<Button label="Open camera" onPress={()=>{setReady(false);setCameraOpen(true);}} disabled={busy||!writable}/>}
    {admin?<><Text style={s.label}>Cost ({currency}, optional)</Text><TextInput accessibilityLabel="Service cost" value={cost} onChangeText={setCost} keyboardType="decimal-pad" style={s.input} editable={!busy}/><Text style={s.label}>Mechanic notes (admin only)</Text><TextInput accessibilityLabel="Mechanic notes" value={notes} onChangeText={setNotes} multiline style={s.input} editable={!busy}/></>:null}
    {error?<Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>:null}
    <Button label={busy?'Saving photo and service…':'Save completed service'} onPress={()=>void save()} disabled={busy||!photo||!imageReady||!writable}/>
    <Button label="Cancel" onPress={onCancel} disabled={busy}/>
  </View>;
}

export function ServiceHistory({asset,service,admin,writable,onCorrected,allowCorrection=true}:{asset:Asset;service:{id:string;config:ServiceConfig;settings_revision:number;baseline_reading:number|null;baseline_date:string|null};admin:boolean;writable:boolean;onCorrected:()=>void;allowCorrection?:boolean}){
  const serviceId=service.id;
  const [correcting,setCorrecting]=useState<string|null>(null),[action,setAction]=useState<'replace'|'void'>('replace'),[reason,setReason]=useState(''),[baseline,setBaseline]=useState(''),[date,setDate]=useState(''),[confirmed,setConfirmed]=useState(false);
  const correctionId=useRef<string|null>(null);
  const [records,setRecords]=useState<History[]>([]),[error,setError]=useState(''),[image,setImage]=useState<{id:string;uri:string}|null>(null),[busy,setBusy]=useState(false);
  const live=useRef(true);
  useEffect(()=>{live.current=true;rpc<History[]>('list_service_history',{p_asset:asset.id,p_service:serviceId}).then(r=>{if(live.current)setRecords(r);}).catch(()=>{if(live.current)setError('Unable to load service history. Reopen this service to retry.');});return()=>{live.current=false;};},[asset.id,serviceId]);
  async function openPhoto(record:History){
    if(busy)return;setBusy(true);setError('');
    try{
      const data=await downloadServicePhoto(record.id);
      const uri=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Unable to display the photo.'));reader.readAsDataURL(data);});
      if(live.current)setImage({id:record.id,uri});
    }catch{if(live.current)setError('Unable to load the photo. Check your connection and retry.');}finally{if(live.current)setBusy(false);}
  }
  function editCorrection(record:History){setCorrecting(record.id);setAction('replace');setReason('');setBaseline(String(service.baseline_reading??''));setDate(service.baseline_date??'');setConfirmed(false);correctionId.current=null;setError('');}
  async function correct(){
    if(!correcting||busy||!writable)return;setBusy(true);setError('');
    try{
      if(!reason.trim()||!confirmed)throw Error('Enter the reason and confirm the baseline to use.');
      if(baseline&&(!Number.isFinite(Number(baseline))||Number(baseline)<0))throw Error('Enter a valid baseline reading.');
      if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Enter the baseline date as YYYY-MM-DD.');
      correctionId.current??=Crypto.randomUUID();
      const result=await rpc<{status:string}>('correct_service',{p_id:correctionId.current,p_history:correcting,p_action:action,p_reason:reason.trim(),p_baseline_reading:service.config.mode!=='calendar'&&baseline.trim()?Number(baseline):null,p_baseline_date:service.config.mode!=='meter'&&date?date:null,p_settings_revision:service.settings_revision,p_confirmed:confirmed});
      if(result.status!=='accepted')throw Error('The schedule changed. Close this service and reopen it before correcting.');
      setCorrecting(null);onCorrected();
    }catch(e){setError(e instanceof Error?e.message:'Unable to save the correction.');}finally{setBusy(false);}
  }
  return <View style={{gap:12}}><Text style={s.label}>Service history</Text>{error?<Text style={s.error}>{error}</Text>:null}{records.length?records.map(record=><View key={record.id} style={s.card}>
    <Text style={s.label}>{record.performer_name} · {record.reading} {record.meter_unit}</Text><Text style={s.small}>Captured {new Date(record.capture_time).toLocaleString()}</Text><Text style={s.small}>Received {new Date(record.server_time).toLocaleString()}</Text>
    {record.state==='pending_correction'&&!record.corrections.length?<Text style={s.error}>Saved for administrator baseline review</Text>:null}
    <Text style={s.text}>{record.snapshot.instructions}</Text>{record.cost!==null?<Text style={s.text}>Cost: {record.currency} {Number(record.cost).toFixed(2)}</Text>:null}{record.mechanic_notes?<Text style={s.text}>{record.mechanic_notes}</Text>:null}
    {record.corrections.map((correction,index)=><View key={index} style={s.card}><Text style={s.label}>{correction.action==='void'?'Original service voided':'Service correction'}</Text><Text style={s.text}>{correction.reason}</Text><Text style={s.small}>Baseline set to {correction.baseline_reading??'unknown'} {correction.meter_unit}{correction.baseline_date?` · ${correction.baseline_date}`:''}</Text><Text style={s.small}>{new Date(correction.server_time).toLocaleString()}</Text></View>)}
    {admin&&allowCorrection&&correcting!==record.id?<Button label="Correct or void this record" onPress={()=>editCorrection(record)} disabled={busy||!writable}/>:null}
    {correcting===record.id?<View style={s.card}><Text style={s.label}>Correct this service record</Text><Button label={action==='replace'?'✓ Correct record':'Correct record'} onPress={()=>setAction('replace')}/><Button label={action==='void'?'✓ Void record':'Void record'} onPress={()=>setAction('void')}/><Text style={s.text}>The original photo and entry stay visible. Confirm the baseline the schedule should use after this correction; leave unknown values blank.</Text><TextInput accessibilityLabel="Correction reason" placeholder="Reason for correction" value={reason} onChangeText={setReason} style={s.input}/>{service.config.mode!=='calendar'?<><Text style={s.label}>Baseline reading ({asset.meter_unit})</Text><TextInput accessibilityLabel="Corrected baseline reading" value={baseline} onChangeText={v=>{setBaseline(v);setConfirmed(false);}} keyboardType="decimal-pad" style={s.input}/></>:null}{service.config.mode!=='meter'?<><Text style={s.label}>Baseline date (YYYY-MM-DD)</Text><TextInput accessibilityLabel="Corrected baseline date" value={date} onChangeText={v=>{setDate(v);setConfirmed(false);}} style={s.input}/></>:null}<Pressable accessibilityRole="checkbox" accessibilityState={{checked:confirmed}} onPress={()=>setConfirmed(!confirmed)}><Text style={s.label}>{confirmed?'✓ ':''}I confirm this correction and baseline</Text></Pressable><Button label="Save correction" onPress={()=>void correct()} disabled={busy||!confirmed||!writable}/><Button label="Cancel correction" onPress={()=>setCorrecting(null)} disabled={busy}/></View>:null}
    <Button label={busy?'Loading photo…':'View evidence photo'} onPress={()=>void openPhoto(record)} disabled={busy}/>{image?.id===record.id?<Image accessibilityLabel="Service evidence photo" source={{uri:image.uri}} style={{width:'100%',height:300}} resizeMode="contain"/>:null}
  </View>):<Text style={s.small}>No submitted services visible yet.</Text>}</View>;
}
const s=StyleSheet.create({card:{padding:16,gap:12,borderRadius:14,borderWidth:1,borderColor:'#DFE5DC',backgroundColor:'white'},title:{fontSize:18,fontWeight:'700',color:'#153C32'},label:{fontSize:14,fontWeight:'600',color:'#153C32'},text:{fontSize:14,lineHeight:22,color:'#53665B'},small:{fontSize:12,lineHeight:19,color:'#6B7870'},input:{padding:13,borderWidth:1,borderColor:'#CBD6CC',borderRadius:10,fontSize:16,color:'#153C32'},button:{padding:14,borderRadius:10,backgroundColor:'#226A50',alignItems:'center'},buttonText:{color:'white',fontWeight:'700'},error:{color:'#A23D37',fontSize:14,lineHeight:22},camera:{height:320,width:'100%'},stamp:{position:'absolute',bottom:0,left:0,right:0,backgroundColor:'#000B',color:'white',padding:8,fontSize:11}});
