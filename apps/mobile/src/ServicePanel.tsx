import {DateField} from './DateField';
import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Pressable,StyleSheet,Text,TextInput,View} from './brandUI';
import type {Asset,MeterUnit} from '@klever/domain';
import {rpc} from './client';
import {ServiceCompletion,ServiceHistory} from './ServiceCompletion';

type Config={name:string;instructions:string;mode:'meter'|'calendar'|'both';meter_unit:MeterUnit;interval_reading:number|null;interval_days:number|null};
type Schedule={id:string;config:Config;type_default:boolean;has_override:boolean;definition_revision:number;settings_revision:number;baseline_reading:number|null;baseline_date:string|null;baseline_kind:'unknown'|'last_service'|'starting_point';unit_mismatch:boolean;missing_baseline:boolean;due:boolean;next_reading:number|null;next_date:string|null;remaining:number|null};
function Input({label,value,set,multiline=false,numeric=false}:{label:string;value:string;set:(s:string)=>void;multiline?:boolean;numeric?:boolean}){
  return <View style={styles.group}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} style={[styles.input,multiline&&{minHeight:90,textAlignVertical:'top'}]} value={value} onChangeText={set} multiline={multiline} keyboardType={numeric?'decimal-pad':'default'}/></View>;
}
function Action({label,onPress,disabled=false,secondary=false}:{label:string;onPress:()=>void;disabled?:boolean;secondary?:boolean}){
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button,secondary&&styles.secondary,disabled&&{opacity:.4}]}><Text style={[styles.buttonText,secondary&&styles.label]}>{label}</Text></Pressable>;
}
function Choices<T extends string>({options,value,set}:{options:{value:T;label:string}[];value:T;set:(v:T)=>void}){
  return <View style={styles.choices}>{options.map(option=><Pressable key={option.value} accessibilityRole="radio" accessibilityState={{checked:value===option.value}} onPress={()=>set(option.value)} style={[styles.choice,value===option.value&&styles.chosen]}><Text style={styles.label}>{option.label}</Text></Pressable>)}</View>;
}
const format=(n:number)=>Number(n).toLocaleString();

export function ServicePanel({asset,admin,writable,captureWritable=writable,initialServiceId}:{asset:Asset;admin:boolean;writable:boolean;captureWritable?:boolean;initialServiceId?:string}){
  const [items,setItems]=useState<Schedule[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [past,setPast]=useState<{id:string;config:Config}[]>([]);
  const [completing,setCompleting]=useState<Schedule|null>(null),[historyKey,setHistoryKey]=useState(0);
  const [editor,setEditor]=useState<Schedule|null|undefined>(undefined),[expanded,setExpanded]=useState<string|null>(null),[remove,setRemove]=useState(false);
  const [name,setName]=useState(''),[instructions,setInstructions]=useState(''),[mode,setMode]=useState<Config['mode']>('meter'),[scope,setScope]=useState<'asset'|'type'>('asset');
  const [interval,setInterval]=useState(''),[days,setDays]=useState('30'),[baseline,setBaseline]=useState(''),[date,setDate]=useState(''),[kind,setKind]=useState<Schedule['baseline_kind']>('unknown');
  const request=useRef(0);
  const handledAlert=useRef<string|undefined>(undefined);
  useEffect(()=>{if(!initialServiceId||loading||error||handledAlert.current===initialServiceId)return;handledAlert.current=initialServiceId;const service=items.find(item=>item.id===initialServiceId);if(!service)setError('This service is no longer available for this asset.');else if(!service.due||service.unit_mismatch||service.missing_baseline){setExpanded(service.id);setError('This service is not currently due or needs its schedule checked. The current details are shown below.');}else setCompleting(service);},[initialServiceId,loading,error,items]);
  async function load(){
    const ticket=++request.current;setLoading(true);
    try{const [rows,retained]=await Promise.all([rpc<Schedule[]>('list_asset_services',{p_asset:asset.id}),rpc<{id:string;config:Config}[]>('list_past_asset_services',{p_asset:asset.id})]);if(ticket===request.current){setItems(rows);setPast(retained);setError('');}}
    catch(e){if(ticket===request.current)setError(e instanceof Error?e.message:'Unable to load services. Try again.');}
    finally{if(ticket===request.current)setLoading(false);}
  }
  useEffect(()=>{void load();return()=>{request.current++;};},[asset.id,asset.meter_revision]);
  function edit(item:Schedule|null){
    setEditor(item);setError('');setRemove(false);setName(item?.config.name??'');setInstructions(item?.config.instructions??'');
    setMode(item?.config.mode??'meter');setScope(item?.type_default&&!item.has_override?'type':'asset');
    setInterval(item?.unit_mismatch?'':String(item?.config.interval_reading??''));setDays(String(item?.config.interval_days??30));
    setBaseline(String(item?.baseline_reading??''));setDate(item?.baseline_date??'');setKind(item?.baseline_kind??'unknown');
  }
  async function save(){
    if(busy||!writable)return;setBusy(true);setError('');
    try{
      const reading=mode==='calendar'?null:Number(interval),calendar=mode==='meter'?null:Number(days);
      if(!name.trim())throw Error('Enter a service name.');
      if(reading!==null&&(!interval.trim()||!Number.isFinite(reading)||reading<=0))throw Error('Enter a positive meter interval.');
      if(calendar!==null&&(!Number.isInteger(calendar)||calendar<1))throw Error('Enter a positive number of calendar days.');
      if(kind!=='unknown'&&mode!=='meter'&&date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Enter the date as YYYY-MM-DD.');
      if(kind!=='unknown'&&baseline&&(!Number.isFinite(Number(baseline))||Number(baseline)<0))throw Error('Enter a valid last-service reading.');
      const result=await rpc<{status:string}>('save_service_schedule',{
        p_asset:asset.id,p_service:editor?.id??null,p_scope:scope,
        p_config:{name:name.trim(),instructions,mode,meter_unit:asset.meter_unit,interval_reading:reading,interval_days:calendar},
        p_baseline_reading:kind!=='unknown'&&baseline.trim()?Number(baseline):null,p_baseline_date:kind!=='unknown'&&date.trim()?date.trim():null,p_baseline_kind:kind,
        p_definition_revision:editor?.definition_revision??0,p_settings_revision:editor?.settings_revision??0,
      });
      if(result.status==='conflict')throw Error('This schedule changed while you were editing. Close the form, refresh services and reopen it.');
      setEditor(undefined);await load();
    }catch(e){setError(e instanceof Error?e.message:'Unable to save the schedule. Try again.');}finally{setBusy(false);}
  }
  async function archive(){
    if(!editor||busy||!writable)return;setBusy(true);setError('');
    try{await rpc('archive_asset_service',{p_asset:asset.id,p_service:editor.id});setEditor(undefined);await load();}
    catch(e){setError(e instanceof Error?e.message:'Unable to remove the schedule.');}finally{setBusy(false);}
  }
  if(completing)return <ServiceCompletion asset={asset} service={completing} admin={admin} writable={captureWritable} onCancel={()=>setCompleting(null)} onSaved={()=>{setCompleting(null);setHistoryKey(k=>k+1);void load();}}/>;
  return <View style={styles.panel}>
    <Text style={styles.heading}>Maintenance services</Text>
    {loading?<ActivityIndicator color="#226A50"/>:null}
    {error?<View accessibilityLiveRegion="polite" style={styles.notice}><Text style={styles.text}>{error}</Text><Action label="Refresh services" onPress={()=>void load()} secondary disabled={busy}/></View>:null}
    {editor===undefined?<>
      {!loading&&!items.length?<Text style={styles.text}>{admin?'Add a service interval to see when maintenance is due.':'No services have been set up for this asset yet.'}</Text>:null}
      {items.map(item=><View key={item.id} style={styles.card}>
        <Pressable accessibilityRole="button" onPress={()=>setExpanded(expanded===item.id?null:item.id)}>
          <Text style={styles.name}>{item.config.name}</Text>
          <Text style={[styles.status,item.due&&{color:'#A23D37'}]}>{item.unit_mismatch?'Check interval and baseline after unit change':item.due?'Due now':item.missing_baseline?'Baseline required':'Upcoming'}</Text>
          {item.next_reading!==null?<Text style={styles.text}>{item.remaining!<=0?`${format(Math.abs(item.remaining!))} ${asset.meter_unit} past the service threshold`:`${format(item.remaining!)} ${asset.meter_unit} remaining`} · due at {format(item.next_reading)} {asset.meter_unit}</Text>:null}
          {item.next_date?<Text style={styles.text}>Due date: {item.next_date}</Text>:null}
        </Pressable>
        {expanded===item.id?<View style={styles.group}>
          <Text style={styles.text}>{item.config.mode!=='calendar'?`Every ${format(item.config.interval_reading!)} ${item.config.meter_unit}`:''}{item.config.mode==='both'?' or ':''}{item.config.mode!=='meter'?`${item.config.interval_days} days`:''}{item.config.mode==='both'?' — whichever comes first':''}</Text>
          <Text style={styles.text}>{item.config.instructions||'No additional instructions.'}</Text>
          <Text style={styles.small}>{item.baseline_kind==='starting_point'?'Starting baseline — no service completion claimed':item.baseline_kind==='last_service'?'Entered last-service baseline':'Last-service baseline not entered'}</Text>
          {item.missing_baseline?<Text style={styles.text}>Complete the missing baseline to calculate every service threshold.</Text>:null}
          <Action label="Record completed service" onPress={()=>setCompleting(item)} disabled={!captureWritable||busy||item.unit_mismatch}/><ServiceHistory key={historyKey} asset={asset} service={item} admin={admin} writable={writable} onCorrected={()=>{setHistoryKey(k=>k+1);void load();}}/>
          {admin?<Action label="Edit service schedule" onPress={()=>edit(item)} secondary disabled={!writable||busy}/>:null}
        </View>:null}
      </View>)}
      {past.length?<View style={styles.group}><Text style={styles.heading}>Past service records</Text><Text style={styles.small}>These services are no longer on this asset's active schedule. Their submitted records and photos are retained.</Text>{past.map(item=><View key={item.id} style={styles.card}><Pressable accessibilityRole="button" onPress={()=>setExpanded(expanded===item.id?null:item.id)}><Text style={styles.name}>{item.config.name}</Text></Pressable>{expanded===item.id?<ServiceHistory asset={asset} service={{...item,settings_revision:0,baseline_reading:null,baseline_date:null}} admin={admin} writable={false} allowCorrection={false} onCorrected={()=>{}}/>:null}</View>)}</View>:null}
      {admin?<Action label="Add service schedule" onPress={()=>edit(null)} disabled={!writable||busy}/>:null}
    </>:<View style={styles.card}>
      <Text style={styles.name}>{editor?'Edit service schedule':'New service schedule'}</Text>
      <Input label="Service name" value={name} set={setName}/><Input label="Instructions" value={instructions} set={setInstructions} multiline/>
      <Text style={styles.label}>Schedule by</Text><Choices value={mode} set={setMode} options={[{value:'meter',label:asset.meter_unit==='km'?'Kilometres':'Hours'},{value:'calendar',label:'Calendar'},{value:'both',label:'Both'}]}/>
      {mode!=='calendar'?<Input label={`Interval (${asset.meter_unit})`} value={interval} set={setInterval} numeric/>:null}
      {mode!=='meter'?<Input label="Interval (calendar days)" value={days} set={setDays} numeric/>:null}
      <Text style={styles.label}>Apply this interval and instructions to</Text><Choices value={scope} set={setScope} options={[{value:'asset',label:'This asset'},{value:'type',label:'All assets of this type'}]}/>
      {scope==='type'?<Text style={styles.small}>Other assets of this type share these defaults. Their own overrides and last-service baselines stay separate.</Text>:null}
      <Text style={styles.label}>Baseline for {asset.name}</Text><Choices value={kind} set={setKind} options={[{value:'last_service',label:'Last service'},{value:'starting_point',label:'Starting point'},{value:'unknown',label:'Not known yet'}]}/>
      {kind!=='unknown'?<>
        {mode!=='calendar'?<Input label={`${kind==='starting_point'?'Starting':'Last-service'} reading (${asset.meter_unit})`} value={baseline} set={setBaseline} numeric/>:null}
        {mode!=='meter'?<DateField label={`${kind==='starting_point'?'Starting':'Last-service'} date`} value={date} onChange={setDate} clearable/>:null}
        <Text style={styles.small}>Current asset reading: {format(Number(asset.current_hours))} {asset.meter_unit}. Leave an unknown baseline blank.</Text>
      </>:<Text style={styles.small}>The service will show “Baseline required” until this is entered.</Text>}
      <Action label={busy?'Saving…':'Save service schedule'} onPress={()=>void save()} disabled={busy||!writable}/><Action label="Cancel" secondary onPress={()=>setEditor(undefined)} disabled={busy}/>
      {editor?<>{remove?<><Text style={styles.text}>Remove this service from this asset’s active schedule? Its records will be kept.</Text><Action label="Confirm removal" onPress={()=>void archive()} secondary disabled={busy||!writable}/></>:<Action label="Remove from this asset" onPress={()=>setRemove(true)} secondary disabled={busy||!writable}/>}</>:null}
    </View>}
  </View>;
}
const styles=StyleSheet.create({
  panel:{gap:16},heading:{fontSize:21,fontWeight:'700',color:'#153C32'},name:{fontSize:17,fontWeight:'700',color:'#153C32'},text:{fontSize:14,lineHeight:22,color:'#53665B'},small:{fontSize:12,lineHeight:19,color:'#6B7870'},status:{fontSize:14,fontWeight:'700',color:'#226A50',marginVertical:7},
  group:{gap:8},card:{backgroundColor:'white',borderWidth:1,borderColor:'#DFE5DC',borderRadius:18,padding:18,gap:15},label:{fontSize:14,fontWeight:'600',color:'#153C32'},input:{backgroundColor:'white',borderWidth:1,borderColor:'#CBD6CC',borderRadius:12,padding:14,fontSize:16,color:'#153C32',minHeight:50},
  choices:{flexDirection:'row',flexWrap:'wrap',gap:8},choice:{padding:12,borderWidth:1,borderColor:'#DFE5DC',borderRadius:10},chosen:{backgroundColor:'#DDEBDD',borderColor:'#226A50'},button:{backgroundColor:'#226A50',padding:15,borderRadius:12,alignItems:'center'},buttonText:{color:'white',fontWeight:'700',fontSize:14},secondary:{backgroundColor:'#EAF0E7'},notice:{backgroundColor:'#FFF0DC',padding:15,borderRadius:12,gap:10},
});
