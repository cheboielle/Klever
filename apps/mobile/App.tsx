import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,AppState,KeyboardAvoidingView,Modal,Platform,Pressable,RefreshControl,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import type {Session} from '@supabase/supabase-js';
import type {Access,Asset,AssetStatus,MeterUnit} from '@klever/domain';
import {configured,rpc,supabase,storedSessionForOffline} from './src/client';
import {ServicePanel} from './src/ServicePanel';
import {TaskPanel} from './src/TaskPanel';
import {ProfilePhoto} from './src/ProfilePhoto';
import {StarterLibrary} from './src/StarterLibrary';
import {AssetCare} from './src/AssetCare';
import {activateOffline,currentOffline,clearOffline,networkFailure,readCache,saveCache,subscribeOffline} from './src/offlineStore';
import {offlineEntryAllowed} from '../../packages/domain/src/offline';
import {flushQueue,queueEntry,subscribeSynced} from './src/offlineSync';
import {ReadingCorrection} from './src/ReadingCorrection';
import {PendingSync} from './src/PendingSync';
import {notificationTarget} from './src/notificationTarget';
import {NotificationSetup} from './src/NotificationSetup';
import {configureBackgroundSync} from './src/backgroundSync';
import {ExportPanel} from './src/ExportPanel';
import {BusinessSettings} from './src/BusinessSettings';
import {NotificationSettings} from './src/NotificationSettings';

const colors={ink:'#153C32',green:'#226A50',paper:'#F5F6F0',muted:'#6B7870',line:'#DFE5DC',white:'#FFFFFF',amber:'#8D5C19',red:'#A23D37'};
type Member={phone:string;user_id:string;name:string;role:string;is_active:boolean};
type AssetType={id:string;name:string};
type HourLog={correction_of:string|null;correction_of_setup:string|null;meter_unit:MeterUnit;id:string;value:string|number;delta:string|number;capture_time:string;server_time:string;reason:string|null};
const statuses:AssetStatus[]=['Active','Out of Service','Workshop','Other'];
const errText=(e:unknown)=>e instanceof Error?e.message:'Something went wrong. Please try again.';

function Button({title,onPress,disabled=false,secondary=false}:{title:string;onPress:()=>void;disabled?:boolean;secondary?:boolean}){
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({pressed})=>[s.button,secondary&&s.secondary,disabled&&{opacity:.45},pressed&&{opacity:.8}]}>
    <Text style={[s.buttonText,secondary&&{color:colors.ink}]}>{title}</Text>
  </Pressable>;
}
function Field({label,value,onChangeText,secure=false,numeric=false}:{label:string;value:string;onChangeText:(v:string)=>void;secure?:boolean;numeric?:boolean}){
  return <View style={{gap:7}}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText}
    secureTextEntry={secure} autoCapitalize="none" autoCorrect={false} keyboardType={numeric?'decimal-pad':label==='Email'?'email-address':'default'} style={s.input}/></View>;
}
function Notice({text}:{text:string}){return <View accessibilityLiveRegion="polite" style={s.notice}><Text style={s.noticeText}>{text}</Text></View>;}

export default function App(){
  const [session,setSession]=useState<Session|null>(null),[access,setAccess]=useState<Access|null>(null);
  const [boot,setBoot]=useState(true),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [assets,setAssets]=useState<Asset[]>([]),[members,setMembers]=useState<Member[]>([]),[types,setTypes]=useState<AssetType[]>([]);
  const [page,setPage]=useState<'assets'|'team'|'tasks'>('assets'),[selected,setSelected]=useState<Asset|null>(null);
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false);
  const [photoVersion,setPhotoVersion]=useState(0),[scheduleVersion,setScheduleVersion]=useState(0);
  const [search,setSearch]=useState(''),[showAdd,setShowAdd]=useState(false),[newName,setNewName]=useState(''),[serial,setSerial]=useState(''),[initialHours,setInitialHours]=useState('0'),[typeId,setTypeId]=useState(''),[newType,setNewType]=useState('');
  const [editingAsset,setEditingAsset]=useState<Asset|null>(null),[editingMember,setEditingMember]=useState<Member|null>(null);
  const [memberName,setMemberName]=useState(''),[memberPhone,setMemberPhone]=useState(''),[meterReason,setMeterReason]=useState(''),[meterConfirmed,setMeterConfirmed]=useState(false);
  const [meterChanges,setMeterChanges]=useState<{id:string;reason:string;server_time:string;details:{previous_reading:number;previous_unit:MeterUnit;reading:number;meter_unit:MeterUnit}}[]>([]);
  const [meterUnit,setMeterUnit]=useState<MeterUnit>('hours');
  const [hours,setHours]=useState(''),[logs,setLogs]=useState<HourLog[]>([]),[reason,setReason]=useState(''),[nextStatus,setNextStatus]=useState<AssetStatus>('Active');
  const [assignmentIds,setAssignmentIds]=useState<string[]>([]),[locked,setLocked]=useState(false),[online,setOnline]=useState(false);
  const generation=useRef(0), detailGeneration=useRef(0), pendingReading=useRef<{id:string;capture:string}|null>(null);
  const admin=access?.role==='owner'||access?.role==='admin';
  const writable=Boolean(access?.can_write&&online&&!locked);
  const [,offlineRender]=useState(0);useEffect(()=>subscribeOffline(()=>offlineRender(v=>v+1)),[]);
  const offlineState=currentOffline()?.snapshot();
  const pendingAssets=assets.map(asset=>{const pending=offlineState?.commands.filter(c=>c.kind==='reading'&&c.assetId===asset.id&&c.meterUnit===asset.meter_unit&&c.state==='pending').at(-1);return pending?{...asset,current_hours:Number(pending.args.p_value)}:asset;});
  const captureWritable=Boolean(!locked&&offlineState&&offlineEntryAllowed(offlineState));

  const clearData=useCallback(()=>{
    generation.current++;detailGeneration.current++;setAccess(null);setAssets([]);setMembers([]);setTypes([]);setSelected(null);setLogs([]);setAssignmentIds([]);setShowAdd(false);setEditingAsset(null);setEditingMember(null);setMeterChanges([]);setHours('');setReason('');setPage('assets');setOnline(false);pendingReading.current=null;
  },[]);
  const signOut=useCallback(async()=>{
    try{await clearOffline();}finally{clearData();setSession(null);setPassword('');await supabase?.auth.signOut({scope:'local'});}
  },[clearData]);

  const refresh=useCallback(async(unlock=true)=>{
    if(!supabase||!session)return;
    try{await activateOffline(session.user.id);}catch(e){setError(errText(e));return;}
    const ticket=++generation.current;setLoading(true);setOnline(false);
    try{
      const a=await rpc<Access>('access_status');
      if(ticket!==generation.current)return;
      if(!a.allowed){
        await signOut();
        setError(a.reason==='not_provisioned'?'Your login is ready, but your business access has not been set up yet.':'Your access has changed. Please sign in again or contact your administrator.');
        return;
      }
      await currentOffline()?.validated(a);if(unlock&&a.app_lock&&Platform.OS!=='web')setLocked(true);setAccess(a);
      const canAdmin=a.role!=='technician';
      const results=await Promise.all([
        supabase.from('assets').select('id,asset_type_id,name,serial,status,current_hours,meter_revision,archived,meter_unit').eq('archived',false).order('name'),
        supabase.from('asset_types').select('id,name').order('name'),
        canAdmin?supabase.from('memberships').select('user_id,name,phone,role,is_active').order('name'):Promise.resolve({data:[],error:null}),
      ]);
      for(const result of results)if(result.error)throw new Error(result.error.message);
      if(ticket!==generation.current)return;
      const previous=readCache<{assets:Asset[]}>('workspace');
      if(previous&&JSON.stringify(previous.assets.map(x=>x.id).sort())!==JSON.stringify((results[0].data??[]).map(x=>x.id).sort()))await currentOffline()?.change(s=>{s.cache={};});
      if(ticket!==generation.current)return;
      await saveCache('workspace',{access:a,assets:results[0].data,types:results[1].data,members:results[2].data});
      setAccess(a);setAssets(results[0].data as Asset[]);setTypes(results[1].data as AssetType[]);setMembers(results[2].data as Member[]);setOnline(true);setError('');
      void Promise.allSettled([rpc('list_tasks',{p_asset:null,p_archived:false}),...(results[0].data??[]).flatMap(asset=>[rpc('list_asset_services',{p_asset:asset.id}),rpc('list_tasks',{p_asset:asset.id,p_archived:false}),rpc('list_asset_issues',{p_asset:asset.id}),rpc('list_compliance',{p_asset:asset.id})])]);
      if(unlock&&a.app_lock&&Platform.OS!=='web'){
        setLocked(true);
        const result=await LocalAuthentication.authenticateAsync({promptMessage:'Unlock Klever Assets',disableDeviceFallback:false});
        if(ticket===generation.current)setLocked(!result.success);
      }else if(!a.app_lock||Platform.OS==='web')setLocked(false);
    }catch(e){if(ticket===generation.current){
      const cached=networkFailure(e)?readCache<{access:Access;assets:Asset[];members:Member[];types:AssetType[]}>('workspace'):undefined;
      if(cached){setAccess(currentOffline()?.snapshot().access??cached.access);setAssets(cached.assets);setMembers(cached.members);setTypes(cached.types);setError('Offline — showing saved data. New entries stay on this device until they sync.');
       if(unlock&&cached.access.app_lock&&Platform.OS!=='web'){setLocked(true);const result=await LocalAuthentication.authenticateAsync({promptMessage:'Unlock Klever Assets',disableDeviceFallback:false});if(ticket===generation.current)setLocked(!result.success);}
      }else setError('Unable to refresh your workspace. Check your connection and retry.');
    }}
    finally{if(ticket===generation.current)setLoading(false);}
  },[signOut,session?.user.id]);

  useEffect(()=>{
    if(!supabase){setBoot(false);return;}
    let alive=true;
    supabase.auth.getSession().then(async({data,error})=>{const recovered=error&&networkFailure(error)?await storedSessionForOffline():null;if(alive){if(error&&!recovered)setError(error.message);setSession(data.session??recovered);setBoot(false);}});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,next)=>{
      if(event==='INITIAL_SESSION'&&!next)return;
      if(event==='SIGNED_OUT'){clearData();void clearOffline().catch(()=>setError('Signed out. Some local files could not be cleared; reopen the app to retry.'));}setSession(next);setBoot(false);
    });
    return()=>{alive=false;subscription.unsubscribe();};
  },[clearData]);
  useEffect(()=>{if(session)void refresh();},[session?.user.id,refresh]);
  useEffect(()=>{void configureBackgroundSync(Boolean(session)).catch(()=>{});},[session?.user.id]);
  useEffect(()=>{
    if(AppState.currentState==='active')supabase?.auth.startAutoRefresh();
    const sub=AppState.addEventListener('change',state=>{
      if(state==='active'){supabase?.auth.startAutoRefresh();if(session)void refresh();}
      else {supabase?.auth.stopAutoRefresh();if(access?.app_lock)setLocked(true);}
    });
    return()=>sub.remove();
  },[session?.user.id,access?.app_lock,refresh]);

  useEffect(()=>subscribeSynced(()=>{if(session)void refresh(false);}),[session?.user.id,refresh]);
  useEffect(()=>{if(!session)return;let active=true;let running=false;const sync=async()=>{if(running||AppState.currentState!=='active')return;running=true;try{const result=await flushQueue();if(active)setOnline(result.online);if(active&&(result.online&&!online))await refresh(false);}finally{running=false;}};void sync();const timer=setInterval(()=>void sync(),30000);return()=>{active=false;clearInterval(timer);};},[session?.user.id,online,refresh]);

  async function run(action:()=>Promise<void>){
    if(busy)return;setBusy(true);setError('');
    try{await action();}catch(e){setError(errText(e));}finally{setBusy(false);}
  }
  async function login(){
    await run(async()=>{
      if(!supabase)throw new Error('The app connection has not been configured.');
      const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
      if(error)throw error;setPassword('');
    });
  }
  async function openAlert(data:unknown):Promise<boolean>{
    if(locked||!session||!supabase)return false;
    const ticket=generation.current,client=supabase;
    const target=await notificationTarget(data,Platform.OS==='web'||Boolean(access?.app_lock&&!locked),()=>rpc<Access>('access_status'),async id=>{
      const result=await client.from('assets').select('id,asset_type_id,name,serial,status,current_hours,meter_revision,archived,meter_unit').eq('id',id).maybeSingle();
      if(result.error)throw result.error;return result.data as Asset|null;
    });
    if(ticket!==generation.current)return false;
    if(target.kind==='denied'){await signOut();return true;}
    if(target.kind==='unlock'){await refresh();return false;}
    if(target.kind==='asset'){setPage('assets');await openAsset(target.asset);}
    else if(target.kind==='tasks'||target.kind==='assets'){setSelected(null);setPage(target.kind);}
    else if(target.kind==='unavailable'){setSelected(null);setPage('assets');setError('This alert’s asset is no longer available to you.');}
    return true;
  }
  async function openAsset(asset:Asset){
    const ticket=++detailGeneration.current;
    setSelected(asset);setHours('');setReason('');setNextStatus(asset.status);setLogs([]);setMeterChanges([]);setAssignmentIds([]);pendingReading.current=null;
    await run(async()=>{
      const [history,assigned,changes]=await Promise.all([
        supabase!.from('hour_logs').select('id,value,delta,capture_time,server_time,reason,meter_unit,correction_of,correction_of_setup').eq('asset_id',asset.id).order('revision',{ascending:false}).limit(20),
        supabase!.from('asset_assignments').select('user_id').eq('asset_id',asset.id),
        admin?supabase!.from('asset_history').select('id,reason,server_time,details').eq('asset_id',asset.id).eq('kind','meter_unit_correction').order('server_time',{ascending:false}):Promise.resolve({data:[],error:null}),
      ]);
      if(ticket!==detailGeneration.current)return;
      if(history.error||assigned.error||changes.error){const failure=history.error??assigned.error??changes.error;const saved=networkFailure(failure)?readCache<{logs:HourLog[];assignments:string[];changes:typeof meterChanges}>('asset:'+asset.id):undefined;if(saved){setLogs(saved.logs);setAssignmentIds(saved.assignments);setMeterChanges(saved.changes);return;}throw failure;}
      await saveCache('asset:'+asset.id,{logs:history.data,assignments:assigned.data.map(x=>x.user_id),changes:changes.data});
      setMeterChanges(changes.data as typeof meterChanges);
      setLogs(history.data as HourLog[]);setAssignmentIds(assigned.data.map(x=>x.user_id));
    });
  }
  async function saveReading(confirmed=false){
    if(!selected||!hours.trim())return;
    const reading=Number(hours);
    if(!Number.isFinite(reading)||reading<0){setError('Enter a valid machine reading.');return;}
    // Save a stable command ID durably before acknowledging the reading.
    pendingReading.current??={id:Crypto.randomUUID(),capture:new Date().toISOString()};
    await run(async()=>{
      await queueEntry({id:pendingReading.current!.id,kind:'reading',meterUnit:selected.meter_unit,label:`${selected.name}: ${reading} ${selected.meter_unit}`,assetId:selected.id,args:{p_id:pendingReading.current!.id,p_asset:selected.id,p_value:reading,p_expected_revision:selected.meter_revision,p_capture_time:pendingReading.current!.capture,p_confirmed:confirmed}});
      pendingReading.current=null;setSelected(null);setHours('');void flushQueue().then(result=>{if(result.synced)void refresh(false);});
    });
  }
  async function createAsset(){
    await run(async()=>{
      if(!newName.trim()||!typeId)throw new Error('Enter an asset name and choose its type.');
      const reading=Number(initialHours);if(!Number.isFinite(reading)||reading<0)throw new Error('Enter a valid starting reading.');
      if(editingAsset){
        const result=await rpc<{status:string}>('edit_asset',{p_asset:editingAsset.id,p_name:newName.trim(),p_type:typeId,p_serial:serial.trim(),p_meter_unit:meterUnit,p_reading:reading,p_expected_revision:editingAsset.meter_revision,p_reason:meterReason.trim(),p_confirmed:meterConfirmed});
        if(result.status==='conflict')throw new Error('A new reading was recorded. Close this form and reopen the asset before editing.');
        if(result.status==='confirmation_required')throw new Error('Confirm the unit and current reading below before saving.');
      }else await rpc('save_asset',{p_name:newName.trim(),p_type:typeId,p_serial:serial.trim(),p_initial_hours:reading,p_meter_unit:meterUnit});
      setEditingAsset(null);
      setShowAdd(false);setNewName('');setSerial('');setInitialHours('0');setMeterUnit('hours');await refresh();
    });
  }
  function staffAction(member:Member,action:string){
    const deactivate=action==='deactivate';
    Alert.alert(deactivate?'Deactivate staff member?':'Sign out this staff member?',deactivate?
      `${member.name} will lose access. Unsynced entries on their phone will be cleared when it reconnects. Their history is kept. Review their assigned assets afterward.`:
      `${member.name} will be signed out on their next online request. They can sign in again while active.`,[
      {text:'Cancel',style:'cancel'},{text:deactivate?'Deactivate':'Sign out',style:'destructive',onPress:()=>void run(async()=>{await rpc('manage_staff',{p_user:member.user_id,p_action:action});await refresh();})},
    ]);
  }

  if(boot)return <View style={s.center}><ActivityIndicator color={colors.green}/><Text style={s.muted}>Opening your workspace…</Text></View>;
  if(!configured)return <View style={s.center}><Text style={s.title}>Connection needed</Text><Text style={s.muted}>The app’s Supabase connection must be configured before signing in.</Text></View>;
  if(!session)return <KeyboardAvoidingView style={s.root} behavior={Platform.OS==='ios'?'padding':undefined}><StatusBar style="dark"/>
    <ScrollView contentContainerStyle={s.login} keyboardShouldPersistTaps="handled">
      <View style={s.brand}><Text style={s.mark}>k</Text><Text style={s.brandText}>KLEVER ASSETS</Text></View>
      <View style={{gap:16,marginTop:54,marginBottom:28}}><Text style={s.eyebrow}>READY FOR THE DAY</Text><Text style={s.hero}>Keep your{ '\n'}equipment moving.</Text><Text style={s.subtitle}>Your machines, maintenance and team.{ '\n'}One place to stay on top of it.</Text></View>
      <View style={s.card}><Text style={s.heading}>Welcome back</Text><Text style={s.muted}>Sign in to your business workspace.</Text>
        <Field label="Email" value={email} onChangeText={setEmail}/><Field label="Password" value={password} onChangeText={setPassword} secure/>
        {error?<Notice text={error}/>:null}<Button title={busy?'Signing in…':'Sign in'} onPress={()=>void login()} disabled={busy||!email.trim()||!password}/>
      </View><Text style={[s.muted,{marginTop:28,textAlign:'center'}]}>Simple maintenance. A better working day.</Text>
    </ScrollView></KeyboardAvoidingView>;

  if(locked)return <View style={s.center}><Text style={s.title}>Workspace locked</Text><Text style={s.muted}>Use your device credentials to continue.</Text><Button title="Unlock" onPress={()=>void refresh()}/><Button title="Sign out" onPress={()=>void signOut()} secondary/></View>;
  if(!access)return <View style={s.center}>{loading?<ActivityIndicator color={colors.green}/>:null}<Text style={s.title}>Opening your business</Text>{error?<Notice text={error}/>:null}<Button title="Retry" onPress={()=>void refresh()}/><Button title="Sign out" onPress={()=>void signOut()} secondary/></View>;

  const filtered=pendingAssets.filter(a=>`${a.name} ${a.serial}`.toLowerCase().includes(search.toLowerCase()));
  return <View style={s.root}><StatusBar style="dark"/>
    <View style={s.top}><View style={s.brand}><Text style={s.mark}>k</Text><View><Text style={s.brandText}>KLEVER ASSETS</Text><Text style={s.small}>{access.tenant_name}</Text></View></View><Pressable accessibilityRole="button" onPress={()=>void signOut()}><Text style={s.link}>Sign out</Text></Pressable></View>
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={()=>void refresh()} tintColor={colors.green}/> }>
      <Text style={s.eyebrow}>{admin?'YOUR WORKSPACE':'YOUR ASSIGNED EQUIPMENT'}</Text><Text style={s.hero}>{page==='assets'?'A clear view of\nyour equipment.':page==='tasks'?'Your shared jobs.':'Your people.'}</Text>
      <Text style={s.subtitle}>Good to see you, {access.name?.split(' ')[0]}.</Text><NotificationSetup onOpenAlert={openAlert}/>{admin?<><BusinessSettings writable={writable} onSaved={()=>refresh()}/><NotificationSettings writable={writable}/><ExportPanel/></>:null}
      <PendingSync/>{!online&&offlineState&&!offlineEntryAllowed(offlineState)?<Notice text="Reconnect to confirm access before adding new entries. Existing pending entries are kept."/>:null}{error?<Notice text={error}/>:null}{!access.can_write?<Notice text="This workspace is read-only. Your records remain available."/>:null}
      {page==='assets'?<>
        <View style={s.stats}><View style={s.stat}><Text style={s.statNumber}>{assets.length}</Text><Text style={s.small}>Assets</Text></View><View style={s.stat}><Text style={s.statNumber}>{assets.filter(a=>a.status==='Active').length}</Text><Text style={s.small}>Active</Text></View><View style={s.stat}><Text style={s.statNumber}>{assets.filter(a=>a.status==='Workshop').length}</Text><Text style={s.small}>In workshop</Text></View></View>
        <View style={s.sectionRow}><Text style={s.heading}>Asset register</Text>{admin?<Pressable disabled={!writable} onPress={()=>{setError('');setEditingAsset(null);setNewName('');setSerial('');setInitialHours('0');setMeterUnit('hours');setMeterReason('');setMeterConfirmed(false);setTypeId(types[0]?.id??'');setShowAdd(true);}}><Text style={[s.link,!writable&&{opacity:.4}]}>+ Add asset</Text></Pressable>:null}</View>
        <TextInput accessibilityLabel="Search assets" value={search} onChangeText={setSearch} style={s.input} placeholder="Search by name or serial…" placeholderTextColor={colors.muted}/>
        {filtered.length?filtered.map(a=><Pressable key={a.id} accessibilityRole="button" onPress={()=>void openAsset(a)} style={s.assetCard}>
          <ProfilePhoto key={a.id+':'+photoVersion} kind="asset" target={a.id} compact/><View style={{flex:1,gap:5}}><Text style={s.assetName}>{a.name}</Text><Text style={s.small}>{a.serial||'No serial recorded'}</Text><Text style={[s.badge,{color:a.status==='Active'?colors.green:colors.amber}]}>{a.status}</Text></View><View style={{alignItems:'flex-end',gap:5}}><Text style={s.hours}>{Number(a.current_hours).toLocaleString()}</Text><Text style={s.small}>{a.meter_unit}</Text><Text style={s.link}>View →</Text></View>
        </Pressable>):<View style={s.card}><Text style={s.heading}>{search?'No matching assets':'A fresh start'}</Text><Text style={s.muted}>{admin?'Add your first machine or vehicle to get started.':'Your administrator will assign your equipment here.'}</Text></View>}
      </>:page==='tasks'?<TaskPanel assets={assets} admin={Boolean(admin)} writable={writable} captureWritable={captureWritable}/>:<>
        <View style={s.sectionRow}><Text style={s.heading}>Staff</Text><Text style={s.small}>{members.filter(m=>m.is_active).length} active</Text></View>
        {members.map(m=><View key={m.user_id} style={s.card}><View style={s.sectionRow}><Text style={s.assetName}>{m.name}</Text><Text style={s.badge}>{m.is_active?'Active':'Inactive'}</Text></View><Text style={s.small}>{m.user_id===access.user_id?access.role:m.role}</Text><Text style={s.muted}>{m.phone||'No phone number recorded'}</Text><ProfilePhoto kind="member" target={m.user_id} editable writable={writable}/><Button title="Edit details" secondary disabled={!writable||busy} onPress={()=>{setEditingMember(m);setMemberName(m.name);setMemberPhone(m.phone);setError('');}}/>
          {m.user_id!==access.user_id&&m.is_active?<View style={s.row}><Button title="Remote sign out" onPress={()=>staffAction(m,'sign_out')} secondary disabled={busy||!online}/><Button title="Deactivate" onPress={()=>staffAction(m,'deactivate')} secondary disabled={busy||!online}/></View>:null}
        </View>)}
      </>}
    </ScrollView>
    {<View style={s.tabs}>{(admin?['assets','tasks','team'] as const:['assets','tasks'] as const).map(p=><Pressable key={p} style={[s.tab,page===p&&s.tabSelected]} onPress={()=>setPage(p)}><Text style={[s.tabText,page===p&&{color:colors.green}]}>{p==='assets'?'Assets':p==='tasks'?'Tasks':'Team'}</Text></Pressable>)}</View>}

    <Modal visible={showAdd} animationType="slide" onRequestClose={()=>setShowAdd(false)}><View style={s.root}><ScrollView contentContainerStyle={s.modal} keyboardShouldPersistTaps="handled"><View style={s.sectionRow}><Text style={s.title}>{editingAsset?'Edit asset':'Add an asset'}</Text><Pressable onPress={()=>setShowAdd(false)}><Text style={s.link}>Close</Text></Pressable></View>
      <Field label="Asset name" value={newName} onChangeText={setNewName}/><Field label="Serial number" value={serial} onChangeText={setSerial}/><Text style={s.label}>Track this asset in</Text><View style={s.row}>{(['hours','km'] as const).map(unit=><Pressable key={unit} accessibilityRole="radio" accessibilityState={{checked:meterUnit===unit}} onPress={()=>{setMeterUnit(unit);setMeterConfirmed(false);}} style={[s.chip,meterUnit===unit&&s.selectedChip]}><Text style={s.label}>{unit==='hours'?'Hours':'Kilometres (km)'}</Text></Pressable>)}</View>{!editingAsset||meterUnit!==editingAsset.meter_unit?<Field label={meterUnit==='km'?'Current kilometres (km)':'Current hours'} value={initialHours} onChangeText={v=>{setInitialHours(v);setMeterConfirmed(false);}} numeric/>:null}
      {editingAsset&&meterUnit!==editingAsset.meter_unit?<><Notice text="Enter the correct current reading in the new unit. Earlier readings keep their original units."/><Field label="Reason for unit correction" value={meterReason} onChangeText={setMeterReason}/><Pressable accessibilityRole="checkbox" accessibilityState={{checked:meterConfirmed}} onPress={()=>setMeterConfirmed(!meterConfirmed)} style={s.chip}><Text style={s.label}>{meterConfirmed?'✓ ':''}I confirm {initialHours||'the reading'} {meterUnit} is correct</Text></Pressable></>:null}
      <Text style={s.label}>Asset type</Text><View style={s.wrap}>{types.map(t=><Pressable key={t.id} style={[s.chip,typeId===t.id&&s.selectedChip]} onPress={()=>setTypeId(t.id)}><Text style={s.label}>{t.name}</Text></Pressable>)}</View>
      <Field label="New type name" value={newType} onChangeText={setNewType}/><Button title="Create asset type" secondary disabled={busy||!newType.trim()||!writable} onPress={()=>void run(async()=>{const id=await rpc<string>('save_asset_type',{p_name:newType.trim()});setNewType('');await refresh();setTypeId(id);})}/>
      {error?<Notice text={error}/>:null}<Button title={busy?'Saving…':'Save asset'} onPress={()=>void createAsset()} disabled={busy||!writable}/>
    </ScrollView></View></Modal>

    <Modal visible={Boolean(editingMember)} animationType="slide" onRequestClose={()=>setEditingMember(null)}><View style={s.root}><ScrollView contentContainerStyle={s.modal} keyboardShouldPersistTaps="handled"><View style={s.sectionRow}><Text style={s.title}>Edit team member</Text><Pressable onPress={()=>setEditingMember(null)}><Text style={s.link}>Close</Text></Pressable></View><Field label="Name" value={memberName} onChangeText={setMemberName}/><Field label="Phone number" value={memberPhone} onChangeText={setMemberPhone}/>{error?<Notice text={error}/>:null}<Button title={busy?'Saving…':'Save details'} disabled={busy||!writable||!memberName.trim()} onPress={()=>void run(async()=>{await rpc('save_staff_details',{p_user:editingMember!.user_id,p_name:memberName.trim(),p_phone:memberPhone.trim()});setEditingMember(null);await refresh();})}/></ScrollView></View></Modal>

    <Modal visible={Boolean(selected)} animationType="slide" onRequestClose={()=>setSelected(null)}><View style={s.root}><ScrollView contentContainerStyle={s.modal} keyboardShouldPersistTaps="handled"><View style={s.sectionRow}><Text style={s.eyebrow}>ASSET DETAILS</Text><Pressable onPress={()=>setSelected(null)}><Text style={s.link}>Close</Text></Pressable></View>
      {selected?<ProfilePhoto key={selected.id} kind="asset" target={selected.id} editable={Boolean(admin)} writable={writable} onChanged={()=>setPhotoVersion(v=>v+1)}/>:null}<Text style={s.title}>{selected?.name}</Text><Text style={s.muted}>{selected?.serial||'No serial recorded'}</Text><View style={s.card}><Text style={s.statNumber}>{Number(selected?.current_hours??0).toLocaleString()} <Text style={s.subtitle}>{selected?.meter_unit}</Text></Text><Text style={s.badge}>{selected?.status}</Text></View>
      {admin?<Button title="Edit asset details" secondary disabled={!writable||busy} onPress={()=>{setEditingAsset(selected);setNewName(selected!.name);setSerial(selected!.serial);setTypeId(selected!.asset_type_id);setInitialHours(String(selected!.current_hours));setMeterUnit(selected!.meter_unit);setMeterReason('');setMeterConfirmed(false);setError('');setSelected(null);setShowAdd(true);}}/>:null}
      <>{selected?<View style={{gap:24}}><>{admin?<StarterLibrary asset={selected} writable={writable} onApplied={()=>setScheduleVersion(v=>v+1)}/>:null}</><ServicePanel key={selected.id+scheduleVersion} asset={selected} admin={Boolean(admin)} writable={writable} captureWritable={captureWritable}/><TaskPanel key={selected.id+scheduleVersion} asset={selected} assets={assets} admin={Boolean(admin)} writable={writable} captureWritable={captureWritable}/></View>:null}</>
      {admin&&selected?<ExportPanel assetId={selected.id}/>:null}<>{selected?<AssetCare key={selected.id} assetId={selected.id} admin={Boolean(admin)} writable={writable} captureWritable={captureWritable}/>:null}</>{admin&&selected?<ReadingCorrection key={selected.id+':'+selected.meter_revision} asset={selected} writable={writable} onSaved={async()=>{setSelected(null);await refresh(false);}}/>:null}<Text style={s.heading}>Log a reading</Text><Field label={selected?.meter_unit==='km'?'Current odometer reading (km)':'Current meter reading (hours)'} value={hours} numeric onChangeText={v=>{pendingReading.current=null;setHours(v);}}/><Button title={busy?'Saving…':'Save reading'} onPress={()=>void saveReading()} disabled={busy||!captureWritable||!hours.trim()}/>
      {error?<Notice text={error}/>:null}
      {admin?<><Text style={s.heading}>Asset status</Text><View style={s.wrap}>{statuses.map(status=><Pressable key={status} onPress={()=>setNextStatus(status)} style={[s.chip,status===nextStatus&&s.selectedChip]}><Text style={s.label}>{status}</Text></Pressable>)}</View><Field label="Reason for change" value={reason} onChangeText={setReason}/><Button title="Update status" secondary disabled={!writable||busy||!reason.trim()} onPress={()=>void run(async()=>{await rpc('set_asset_status',{p_asset:selected!.id,p_status:nextStatus,p_reason:reason.trim()});setSelected(null);await refresh();})}/>
        <Text style={s.heading}>Assigned staff</Text>{members.filter(m=>m.is_active).map(m=><Pressable key={m.user_id} disabled={!writable||busy} style={s.sectionRow} onPress={()=>void run(async()=>{await rpc('assign_asset',{p_asset:selected!.id,p_user:m.user_id,p_assigned:!assignmentIds.includes(m.user_id)});setAssignmentIds(ids=>ids.includes(m.user_id)?ids.filter(x=>x!==m.user_id):[...ids,m.user_id]);})}><Text style={s.label}>{m.name}</Text><Text style={s.link}>{assignmentIds.includes(m.user_id)?'Assigned ✓':'Assign +'}</Text></Pressable>)}</>:null}
      {meterChanges.length?<><Text style={s.heading}>Meter unit corrections</Text>{meterChanges.map(change=><View style={s.card} key={change.id}><Text style={s.label}>{change.details.previous_reading} {change.details.previous_unit} → {change.details.reading} {change.details.meter_unit}</Text><Text style={s.muted}>{change.reason}</Text><Text style={s.small}>{new Date(change.server_time).toLocaleString()}</Text></View>)}</>:null}
      <Text style={s.heading}>{admin?'Recent readings':'Your recent readings'}</Text>{logs.length?logs.map(log=><View style={s.card} key={log.id}><View style={s.sectionRow}><Text style={s.assetName}>{Number(log.value).toLocaleString()} {log.meter_unit}</Text><Text style={s.small}>{Number(log.delta)>=0?'+':''}{Number(log.delta)} {log.meter_unit}</Text></View><Text style={s.small}>Captured {new Date(log.capture_time).toLocaleString()}</Text><Text style={s.small}>Received {new Date(log.server_time).toLocaleString()}</Text>{log.correction_of||log.correction_of_setup?<Text style={s.small}>{log.correction_of_setup?'Correction of a setup reading':'Correction of an earlier reading'} — original retained</Text>:null}{log.reason?<Text style={s.muted}>{log.reason}</Text>:null}</View>):<Text style={s.muted}>No readings recorded yet.</Text>}
    </ScrollView></View></Modal>
  </View>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:colors.paper},center:{flex:1,backgroundColor:colors.paper,padding:28,justifyContent:'center',gap:18},
  login:{padding:28,paddingTop:74,maxWidth:580,width:'100%',alignSelf:'center',paddingBottom:50},content:{padding:24,gap:18,maxWidth:760,width:'100%',alignSelf:'center',paddingBottom:40},modal:{padding:24,paddingTop:64,gap:20,maxWidth:760,width:'100%',alignSelf:'center',paddingBottom:60},
  top:{paddingHorizontal:24,paddingTop:58,paddingBottom:20,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:colors.line},
  brand:{flexDirection:'row',alignItems:'center',gap:12},mark:{backgroundColor:colors.ink,color:colors.white,width:38,height:38,borderRadius:12,textAlign:'center',fontSize:29,fontWeight:'800',lineHeight:37},brandText:{fontSize:12,letterSpacing:1.8,fontWeight:'800',color:colors.ink},
  hero:{fontSize:39,fontWeight:'700',color:colors.ink,letterSpacing:-1.4,lineHeight:44},title:{fontSize:29,fontWeight:'700',color:colors.ink,letterSpacing:-.7},heading:{fontSize:21,fontWeight:'700',color:colors.ink},subtitle:{fontSize:16,color:colors.muted,lineHeight:25},eyebrow:{fontSize:11,color:colors.green,fontWeight:'800',letterSpacing:2},
  card:{backgroundColor:colors.white,borderWidth:1,borderColor:colors.line,borderRadius:20,padding:22,gap:16},input:{backgroundColor:colors.white,borderWidth:1,borderColor:'#CBD6CC',borderRadius:12,paddingHorizontal:15,paddingVertical:14,fontSize:16,color:colors.ink,minHeight:50},label:{fontSize:14,fontWeight:'600',color:colors.ink},muted:{fontSize:14,lineHeight:22,color:colors.muted},small:{fontSize:12,lineHeight:19,color:colors.muted},
  button:{backgroundColor:colors.green,borderRadius:12,paddingHorizontal:17,paddingVertical:15,alignItems:'center',minHeight:48},secondary:{backgroundColor:'#EAF0E7'},buttonText:{fontSize:14,fontWeight:'700',color:'white'},link:{fontSize:13,fontWeight:'700',color:colors.green},notice:{backgroundColor:'#FFF0DC',padding:15,borderRadius:12},noticeText:{fontSize:14,lineHeight:21,color:'#75551F'},
  stats:{flexDirection:'row',gap:12,marginVertical:8},stat:{flex:1,padding:17,backgroundColor:'#EAF0E7',borderRadius:17,gap:5},statNumber:{fontSize:30,fontWeight:'700',color:colors.ink},sectionRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},row:{flexDirection:'row',flexWrap:'wrap',gap:10},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},
  assetCard:{backgroundColor:colors.white,borderWidth:1,borderColor:colors.line,borderRadius:18,padding:18,flexDirection:'row',alignItems:'center',gap:14},assetIcon:{width:48,height:55,borderRadius:13,backgroundColor:'#EFF2E8',justifyContent:'center',alignItems:'center'},assetLetter:{fontSize:24,fontWeight:'700',color:colors.green},assetName:{fontSize:17,fontWeight:'700',color:colors.ink},hours:{fontSize:22,fontWeight:'700',color:colors.ink},badge:{fontSize:12,fontWeight:'700',color:colors.green},
  tabs:{flexDirection:'row',padding:12,paddingBottom:28,backgroundColor:'white',borderTopWidth:1,borderColor:colors.line,gap:8},tab:{flex:1,alignItems:'center',padding:14,borderRadius:12},tabSelected:{backgroundColor:'#EAF0E7'},tabText:{fontSize:14,fontWeight:'700',color:colors.muted},chip:{paddingHorizontal:14,paddingVertical:13,borderRadius:12,borderWidth:1,borderColor:colors.line,backgroundColor:'white'},selectedChip:{backgroundColor:'#DDEBDD',borderColor:colors.green},
});
