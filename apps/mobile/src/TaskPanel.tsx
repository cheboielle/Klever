import {DateField} from './DateField';
import {SelectField} from './SelectField';
import {nativeInteraction} from './nativeInteraction';
import {queueEntry,flushQueue} from './offlineSync';
import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Image,Platform,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import type {Asset} from '@klever/domain';
import {rpc,supabase,downloadServicePhoto} from './client';
import {stampPhoto,photoBytes,deletePhoto} from './stampPhoto';

type Config={completion_mode:'shared'|'individual';name:string;instructions:string;cadence:'daily'|'weekly'|'fortnightly'|'monthly'|'custom';days:number|null;checklist:{id:string;label:string}[];photo_required:boolean;notes_required:boolean};
type Task={can_complete:boolean;schedule_due:string;participants:{user_id:string;name:string;next_due:string;due:boolean}[];id:string;asset_id:string|null;config:Config;next_due:string;occurrence_id:string;revision:number;archived:boolean;due:boolean;today:string};
type History={correction:{reason:string;next_due:string;server_time:string}|null;id:string;due_date:string;capture_time:string;received_at:string;performer_name:string;snapshot:Config;checked_ids:string[];notes:string;object_path:string|null};
const empty:Config={completion_mode:'shared',name:'',instructions:'',cadence:'daily',days:1,checklist:[],photo_required:false,notes_required:false};
function Button({label,press,disabled=false}:{label:string;press:()=>void;disabled?:boolean}){return <Pressable accessibilityRole="button" onPress={press} disabled={disabled} style={[s.button,disabled&&{opacity:.4}]}><Text style={s.buttonText}>{label}</Text></Pressable>;}
function Field({label,value,set,multiline=false}:{label:string;value:string;set:(v:string)=>void;multiline?:boolean}){return <View style={s.group}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={set} multiline={multiline} style={s.input}/></View>;}
function Check({label,checked,toggle,disabled=false}:{label:string;checked:boolean;toggle:()=>void;disabled?:boolean}){return <Pressable accessibilityRole="checkbox" accessibilityState={{checked,disabled}} disabled={disabled} onPress={toggle} style={s.check}><Text style={s.label}>{checked?'✓':'□'} {label}</Text></Pressable>;}
const message=(e:unknown)=>e instanceof Error?e.message:'Unable to save. Check your connection and retry.';

export function TaskPanel({asset=null,assets,admin,writable,captureWritable=writable}:{asset?:Asset|null;assets:Asset[];admin:boolean;writable:boolean;captureWritable?:boolean}){
 const [items,setItems]=useState<Task[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[archived,setArchived]=useState(false);
 const [editing,setEditing]=useState<Task|null|undefined>(undefined),[open,setOpen]=useState<Task|null>(null),[cfg,setCfg]=useState<Config>(empty),[date,setDate]=useState(''),[scope,setScope]=useState<string|null>(asset?.id??null),[days,setDays]=useState('1'),[remove,setRemove]=useState(false);
 const [today,setToday]=useState('');const generation=useRef(0);
 async function load(){const ticket=++generation.current;setLoading(true);try{const result=await rpc<{items:Task[];today:string}>('list_tasks',{p_asset:asset?.id??null,p_archived:archived});if(ticket===generation.current){setItems(result.items);setToday(result.today);setError('');}}catch(e){if(ticket===generation.current)setError(message(e));}finally{if(ticket===generation.current)setLoading(false);}}
 useEffect(()=>{void load();return()=>{generation.current++;};},[asset?.id,archived]);
 function edit(task:Task|null){setEditing(task);setCfg(task?.config??{...empty,checklist:[]});setDate(task?.config.completion_mode==='individual'?task.schedule_due:task?.next_due??today);setScope(task?.asset_id??asset?.id??null);setDays(String(task?.config.days??1));setRemove(false);setError('');}
 async function save(archive=false){if(busy||!writable)return;setBusy(true);setError('');try{
  if(!cfg.name.trim())throw Error('Enter a task name.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Enter the due date as YYYY-MM-DD.');
  if(cfg.cadence==='custom'&&(!Number.isInteger(Number(days))||Number(days)<1))throw Error('Enter a positive number of days.');
  const result=await rpc<{status:string}>('save_task',{p_id:editing?.id??null,p_asset:scope,p_config:{...cfg,completion_mode:scope===null?cfg.completion_mode:'shared',days:cfg.cadence==='custom'?Number(days):cfg.days},p_due:date,p_revision:editing?.revision??0,p_archived:archive});
  if(result.status==='conflict')throw Error('This task changed. Cancel, refresh and reopen it before saving.');
  setEditing(undefined);setOpen(null);await load();
 }catch(e){setError(message(e));}finally{setBusy(false);}}
 if(open&&editing===undefined)return <TaskDetail task={open} admin={admin} writable={writable&&!open.archived} captureWritable={captureWritable&&!open.archived} onBack={()=>{setOpen(null);void load();}} onEdit={()=>edit(open)}/>;
 return <View style={s.group}><Text style={s.heading}>{asset?'Asset tasks':'Business tasks'}</Text>{!asset?<Text style={s.text}>Jobs for the whole team, completed once for everyone or separately by each technician.</Text>:null}
  {loading?<ActivityIndicator/>:null}{error?<Text style={s.error}>{error}</Text>:null}
  {editing===undefined?<>
   {!loading&&!items.length?<Text style={s.text}>{archived?'No archived tasks.':'No tasks set up yet.'}</Text>:null}
   {items.map(task=><Pressable key={task.id} accessibilityRole="button" onPress={()=>setOpen(task)} style={s.card}><Text style={s.title}>{task.config.name}</Text><Text style={[s.text,task.due&&{color:'#A23D37'}]}>{task.due?'Due':'Next due'} {task.next_due}</Text><Text style={s.text}>{task.config.completion_mode==='individual'?'Each technician':'One completion'}</Text><Text style={s.text}>{task.config.cadence==='custom'?`Every ${task.config.days} days`:task.config.cadence} · {task.config.checklist.length} checklist items</Text></Pressable>)}
   <Button label="Refresh tasks" press={()=>void load()} disabled={loading}/>
   {admin?<Button label="Add task" press={()=>edit(null)} disabled={!writable||!today}/>:null}<Button label={archived?'Show active tasks':'Show archived tasks'} press={()=>setArchived(!archived)}/>
  </>:<View style={s.card}>
   <Text style={s.title}>{editing?'Edit task':'New task'}</Text><Field label="Task name" value={cfg.name} set={name=>setCfg({...cfg,name})}/><Field label="Instructions" value={cfg.instructions} set={instructions=>setCfg({...cfg,instructions})} multiline/>
   <SelectField label="Applies to" value={scope??'business'} options={[{value:'business',label:'Whole business'},...assets.map(a=>({value:a.id,label:a.name}))]} onChange={value=>setScope(value==='business'?null:value)}/>
   {scope===null?<><Text style={s.label}>Who needs to complete this?</Text><View style={s.choices}>{([{value:'shared',label:'One completion for everyone'},{value:'individual',label:'Each technician completes it'}] as const).map(option=><Pressable key={option.value} accessibilityRole="radio" accessibilityState={{checked:cfg.completion_mode===option.value}} style={[s.choice,cfg.completion_mode===option.value&&s.chosen]} onPress={()=>setCfg({...cfg,completion_mode:option.value})}><Text style={s.label}>{option.label}</Text></Pressable>)}</View><Text style={s.text}>{cfg.completion_mode==='individual'?'Each active technician has their own due status. New technicians are included automatically.':'Any team member can complete the shared occurrence.'}</Text>{editing&&cfg.completion_mode!==editing.config.completion_mode?<Text style={s.text}>Changing this choice starts the new completion mode. Earlier records are kept; pending submissions from the previous mode need to be reopened.</Text>:null}</>:null}
   <SelectField label="Repeats" value={cfg.cadence} options={(['daily','weekly','fortnightly','monthly','custom'] as const).map(value=>({value,label:value==='custom'?'Custom days':value[0].toUpperCase()+value.slice(1)}))} onChange={cadence=>setCfg({...cfg,cadence})}/>
   {cfg.cadence==='custom'?<Field label="Days between tasks" value={days} set={setDays}/>:null}<DateField label="Next due date" value={date} onChange={setDate}/>
   <Text style={s.text}>{cfg.completion_mode==='individual'?'Changing the date or recurrence resets the future schedule for each technician. ':''}Late completion skips missed dates and moves to the next future date. Monthly tasks keep their intended day, using the last day of shorter months.</Text>
   <Text style={s.label}>Checklist</Text>{cfg.checklist.map((item,index)=><View key={item.id} style={s.group}><Field label={`Item ${index+1}`} value={item.label} set={label=>setCfg({...cfg,checklist:cfg.checklist.map(i=>i.id===item.id?{...i,label}:i)})}/><Button label={`Remove item ${index+1}`} press={()=>setCfg({...cfg,checklist:cfg.checklist.filter(i=>i.id!==item.id)})}/></View>)}
   <Button label="Add checklist item" press={()=>setCfg({...cfg,checklist:[...cfg.checklist,{id:Crypto.randomUUID(),label:''}]})} disabled={cfg.checklist.length>=100}/>
   <Check label="Photo required" checked={cfg.photo_required} toggle={()=>setCfg({...cfg,photo_required:!cfg.photo_required})}/><Check label="Notes required" checked={cfg.notes_required} toggle={()=>setCfg({...cfg,notes_required:!cfg.notes_required})}/>
   <Button label={busy?'Saving…':editing?.archived?'Save and restore task':'Save task'} press={()=>void save()} disabled={busy||!writable}/><Button label="Cancel" press={()=>{setEditing(undefined);setOpen(null);}} disabled={busy}/>
   {editing&&!editing.archived?<>{remove?<><Text style={s.text}>Archive this task? Its history will be kept.</Text><Button label="Confirm archive" press={()=>void save(true)} disabled={busy||!writable}/></>:<Button label="Archive task" press={()=>setRemove(true)} disabled={busy||!writable}/>}</>:null}
  </View>}
 </View>;
}

function TaskDetail({task,admin,writable,captureWritable,onBack,onEdit}:{task:Task;admin:boolean;writable:boolean;captureWritable:boolean;onBack:()=>void;onEdit:()=>void}){
 const [checked,setChecked]=useState<string[]>([]),[notes,setNotes]=useState(''),[photo,setPhoto]=useState<{uri:string;width:number;height:number;capture:string}|null>(null),[imageReady,setImageReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
 const [records,setRecords]=useState<History[]>([]),[historyLoading,setHistoryLoading]=useState(true),[viewPhoto,setViewPhoto]=useState<{id:string;uri:string}|null>(null);
 const [voiding,setVoiding]=useState<string|null>(null),[voidReason,setVoidReason]=useState(''),[voidDate,setVoidDate]=useState(task.today),[confirmed,setConfirmed]=useState(false);const voidId=useRef<string|null>(null);
 const pending=useRef<{id:string;capture:string;uri:string|null;notes:string;checked:string[]}|null>(null),frame=useRef<View|null>(null),files=useRef<string[]>([]),live=useRef(true);
 useEffect(()=>{live.current=true;void history();return()=>{live.current=false;files.current.forEach(deletePhoto);};},[task.id]);
 async function history(){setHistoryLoading(true);try{const rows=await rpc<History[]>('list_task_history',{p_task:task.id});if(live.current)setRecords(rows);}catch(e){if(live.current)setError(message(e));}finally{if(live.current)setHistoryLoading(false);}}
 async function pick(camera:boolean){if(busy)return;setBusy(true);setError('');try{
  if(camera&&Platform.OS!=='web'){const permission=await nativeInteraction(()=>ImagePicker.requestCameraPermissionsAsync());if(!permission.granted)throw Error('Allow camera access in your phone settings, or choose a photo.');}
  const options:ImagePicker.ImagePickerOptions={mediaTypes:['images'],quality:.8,allowsMultipleSelection:false};
  const picked=await nativeInteraction(()=>camera?ImagePicker.launchCameraAsync(options):ImagePicker.launchImageLibraryAsync(options));
  if(!picked.canceled){const image=picked.assets[0];files.current.push(image.uri);setImageReady(false);setPhoto({...image,capture:new Date().toISOString()});}
 }catch(e){setError(message(e));}finally{setBusy(false);}}
 async function save(){if(busy||!captureWritable)return;setBusy(true);setError('');try{
  if(checked.length!==task.config.checklist.length)throw Error('Check every checklist item before completing the task.');
  if(task.config.notes_required&&!notes.trim())throw Error('Add the required task notes.');
  if(task.config.photo_required&&!photo)throw Error('Add the required task photo.');
  if(photo&&!imageReady)throw Error('Wait for the photo to load, then retry.');
  if(!pending.current){const capture=new Date().toISOString();const uri=photo?await stampPhoto(photo.uri,`Added ${photo.capture}`,frame):null;if(uri)files.current.push(uri);pending.current={id:Crypto.randomUUID(),capture,uri,notes,checked:[...checked]};}
  const p=pending.current;
  await queueEntry({id:p.id,kind:'task',label:task.config.name,assetId:task.asset_id??undefined,args:{p_id:p.id,p_task:task.id,p_occurrence:task.occurrence_id,p_revision:task.revision,p_snapshot:task.config,p_checked:p.checked,p_notes:p.notes,p_capture_time:p.capture,p_photo:!!p.uri}},p.uri??undefined);
  setResult('Task and any photo saved on this device. Check Pending sync for progress or anything needing review.');void flushQueue();
 }catch(e){setError(message(e));}finally{setBusy(false);}}
 async function voidCompletion(){if(!voiding||busy||!writable)return;setBusy(true);setError('');try{
  if(!confirmed||!voidReason.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(voidDate))throw Error('Enter the reason and confirm a valid next due date.');
  voidId.current??=Crypto.randomUUID();const response=await rpc<{status:string}>('void_task_completion',{p_id:voidId.current,p_completion:voiding,p_reason:voidReason,p_next_due:voidDate,p_revision:task.revision,p_confirmed:confirmed});
  if(response.status==='conflict')throw Error('The task changed. Go back and reopen it before correcting.');setVoiding(null);setResult('Completion voided. The original record is retained and the next due date is updated.');void history();
 }catch(e){setError(message(e));}finally{setBusy(false);}}
 async function showPhoto(id:string){if(busy)return;setBusy(true);setError('');try{const blob=await downloadServicePhoto(id,'task');const uri=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Unable to display photo.'));reader.readAsDataURL(blob);});if(live.current)setViewPhoto({id,uri});}catch(e){if(live.current)setError(message(e));}finally{if(live.current)setBusy(false);}}
 return <View style={s.card}><Text style={s.heading}>{task.config.name}</Text><Text style={s.text}>Due {task.next_due}</Text><Text style={s.text}>{task.config.instructions||'No additional instructions.'}</Text>
  {task.config.completion_mode==='individual'&&admin?<View style={s.group}><Text style={s.title}>Technician progress</Text>{task.participants.length?task.participants.map(person=><View key={person.user_id} style={s.group}><Text style={s.label}>{person.name}</Text><Text style={s.text}>{person.due?'Still due':'Next due'} {person.next_due}</Text></View>):<Text style={s.text}>No active technicians yet. They will be included when added to the team.</Text>}</View>:null}
  {result?<Text accessibilityLiveRegion="polite" style={s.label}>{result}</Text>:!task.archived&&task.can_complete?<>
   {task.config.checklist.map(item=><Check key={item.id} label={item.label} checked={checked.includes(item.id)} toggle={()=>setChecked(checked.includes(item.id)?checked.filter(id=>id!==item.id):[...checked,item.id])} disabled={busy||!!pending.current||!captureWritable}/>)}
   <Text style={s.label}>Notes {task.config.notes_required?'(required)':'(optional)'}</Text><TextInput accessibilityLabel="Task notes" value={notes} onChangeText={setNotes} multiline editable={!busy&&!pending.current&&captureWritable} style={s.input}/>
   <Text style={s.label}>Photo {task.config.photo_required?'(required)':'(optional)'}</Text>
   {photo?<View ref={frame} collapsable={false} style={{backgroundColor:'#153C32',width:'100%'}}><Image source={{uri:photo.uri}} style={{width:'100%',aspectRatio:photo.width/photo.height}} onLoad={()=>setImageReady(true)} onError={()=>setError('Unable to load this photo. Choose another photo.')}/><Text style={s.stamp}>Added {photo.capture}</Text></View>:null}
   <Button label="Take photo" press={()=>void pick(true)} disabled={busy||!!pending.current||!captureWritable}/><Button label="Choose photo" press={()=>void pick(false)} disabled={busy||!!pending.current||!captureWritable}/>
   <Button label={busy?'Saving…':pending.current?'Retry completion':'Complete task'} press={()=>void save()} disabled={busy||!captureWritable}/>
  </>:null}
  {error?<Text style={s.error}>{error}</Text>:null}<Button label="Back to tasks" press={onBack} disabled={busy}/>{admin&&!result?<Button label="Edit task" press={onEdit} disabled={busy||!!pending.current}/>:null}
  <Text style={s.title}>Completion history</Text>{historyLoading?<ActivityIndicator/>:!records.length?<Text style={s.text}>No completed records visible yet.</Text>:null}
  {records.map(record=><View key={record.id} style={s.card}><Text style={s.label}>{record.snapshot.name} · {record.performer_name}</Text><Text style={s.text}>Scheduled {record.due_date}</Text><Text style={s.small}>Submitted {new Date(record.capture_time).toLocaleString()} · Received {new Date(record.received_at).toLocaleString()}</Text><Text style={s.text}>{record.snapshot.instructions}</Text>{record.snapshot.checklist.map(item=><Text key={item.id} style={s.text}>✓ {item.label}</Text>)}{record.notes?<Text style={s.text}>{record.notes}</Text>:null}{record.correction?<View style={s.group}><Text style={s.label}>Completion voided</Text><Text style={s.text}>{record.correction.reason}</Text><Text style={s.small}>Next due set to {record.correction.next_due} · {new Date(record.correction.server_time).toLocaleString()}</Text></View>:admin&&!result?<Button label="Void incorrect completion" press={()=>{setVoiding(record.id);setVoidReason('');setVoidDate(task.today);setConfirmed(false);voidId.current=null;}} disabled={busy||!writable}/>:null}
   {voiding===record.id?<View style={s.group}><Text style={s.text}>Keep the original evidence and reopen the task with the next due date below.</Text><Field label="Reason for voiding" value={voidReason} set={v=>{setVoidReason(v);setConfirmed(false);voidId.current=null;}}/><DateField label="Next due after correction" value={voidDate} onChange={v=>{setVoidDate(v);setConfirmed(false);voidId.current=null;}}/><Check label="I confirm this correction and next due date" checked={confirmed} toggle={()=>setConfirmed(!confirmed)}/><Button label="Confirm void" press={()=>void voidCompletion()} disabled={busy||!confirmed||!writable}/><Button label="Cancel correction" press={()=>setVoiding(null)} disabled={busy}/></View>:null}
   {record.object_path?<Button label="View task photo" press={()=>void showPhoto(record.id)} disabled={busy}/>:null}{viewPhoto?.id===record.id?<Image source={{uri:viewPhoto.uri}} style={{width:'100%',height:300}} resizeMode="contain"/>:null}</View>)}
  <Button label="Refresh history" press={()=>void history()} disabled={historyLoading||busy}/>
 </View>;
}
const s=StyleSheet.create({group:{gap:14},card:{padding:18,gap:14,borderRadius:16,borderWidth:1,borderColor:'#DFE5DC',backgroundColor:'white'},heading:{fontSize:21,fontWeight:'700',color:'#153C32'},title:{fontSize:17,fontWeight:'700',color:'#153C32'},label:{fontSize:14,fontWeight:'600',color:'#153C32'},text:{fontSize:14,lineHeight:22,color:'#53665B'},small:{fontSize:12,lineHeight:19,color:'#6B7870'},input:{padding:13,borderWidth:1,borderColor:'#CBD6CC',borderRadius:10,fontSize:16,color:'#153C32'},button:{padding:14,borderRadius:10,backgroundColor:'#226A50',alignItems:'center'},buttonText:{color:'white',fontWeight:'700'},error:{color:'#A23D37',fontSize:14,lineHeight:22},check:{paddingVertical:10},choices:{flexDirection:'row',flexWrap:'wrap',gap:8},choice:{padding:12,borderWidth:1,borderColor:'#DFE5DC',borderRadius:10},chosen:{backgroundColor:'#DDEBDD',borderColor:'#226A50'},stamp:{position:'absolute',bottom:0,left:0,right:0,backgroundColor:'#000B',color:'white',padding:8,fontSize:11}});
