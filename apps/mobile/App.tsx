import {DetailTile} from './src/DetailTile';
import {nativeInteractionActive} from './src/nativeInteraction';
import {FormScroll} from './src/FormScroll';
import {SelectField} from './src/SelectField';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {KeyboardProvider} from 'react-native-keyboard-controller';
import Ionicons from '@expo/vector-icons/Ionicons';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,AppState,KeyboardAvoidingView,Modal,Platform,Pressable,RefreshControl,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {StatusBar} from 'expo-status-bar';
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
import {AssetArchive} from './src/AssetArchive';
import {AssetTypeSettings} from './src/AssetTypeSettings';
import {TeamAccessControls} from './src/TeamAccessControls';
import {TeamInvitations} from './src/TeamInvitations';
import {JoinWorkspace} from './src/JoinWorkspace';
import {InvitationLink} from './src/InvitationLink';
import {InvitationCode} from './src/InvitationCode';
import {ReadingCorrection} from './src/ReadingCorrection';
import {PendingSync} from './src/PendingSync';
import {notificationTarget} from './src/notificationTarget';
import {NotificationSetup} from './src/NotificationSetup';
import {configureBackgroundSync} from './src/backgroundSync';
import {ExportPanel} from './src/ExportPanel';
import {BusinessSettings} from './src/BusinessSettings';
import {NotificationSettings} from './src/NotificationSettings';

const colors={ink:'#153C32',green:'#226A50',paper:'#F5F6F0',muted:'#6B7870',line:'#DFE5DC',white:'#FFFFFF',amber:'#8D5C19',red:'#A23D37'};
type Member={contact_email:string;job_title:string;phone:string;user_id:string;name:string;role:string;is_active:boolean};
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

export default function App(){return <SafeAreaProvider><KeyboardProvider><Workspace/><InvitationLink/></KeyboardProvider></SafeAreaProvider>;}
function Workspace(){
  const [session,setSession]=useState<Session|null>(null),[access,setAccess]=useState<Access|null>(null),[ownerId,setOwnerId]=useState<string|null>(null);
  const [joining,setJoining]=useState(false),[invitationMode,setInvitationMode]=useState(false);
  const [boot,setBoot]=useState(true),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [assets,setAssets]=useState<Asset[]>([]),[members,setMembers]=useState<Member[]>([]),[types,setTypes]=useState<AssetType[]>([]);
  const [page,setPage]=useState<'assets'|'team'|'tasks'|'settings'>('assets'),[selected,setSelected]=useState<Asset|null>(null),[showArchived,setShowArchived]=useState(false);
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false);
  const [photoVersion,setPhotoVersion]=useState(0),[scheduleVersion,setScheduleVersion]=useState(0);
  const [statusFilter,setStatusFilter]=useState<AssetStatus|'all'>('all');
  const [menuOpen,setMenuOpen]=useState(false);
  const [quickReading,setQuickReading]=useState(false);
  const [search,setSearch]=useState(''),[showAdd,setShowAdd]=useState(false),[newName,setNewName]=useState(''),[serial,setSerial]=useState(''),[initialHours,setInitialHours]=useState('0'),[typeId,setTypeId]=useState(''),[newType,setNewType]=useState('');
  const [editingAsset,setEditingAsset]=useState<Asset|null>(null),[editingMember,setEditingMember]=useState<Member|null>(null);
  const [memberName,setMemberName]=useState(''),[memberPhone,setMemberPhone]=useState(''),[memberEmail,setMemberEmail]=useState(''),[memberTitle,setMemberTitle]=useState(''),[meterReason,setMeterReason]=useState(''),[meterConfirmed,setMeterConfirmed]=useState(false);
  const [meterChanges,setMeterChanges]=useState<{id:string;reason:string;server_time:string;details:{previous_reading:number;previous_unit:MeterUnit;reading:number;meter_unit:MeterUnit}}[]>([]);
  const [meterUnit,setMeterUnit]=useState<MeterUnit>('hours');
  const [hours,setHours]=useState(''),[logs,setLogs]=useState<HourLog[]>([]),[reason,setReason]=useState(''),[nextStatus,setNextStatus]=useState<AssetStatus>('Active');
  const [assignmentIds,setAssignmentIds]=useState<string[]>([]),[online,setOnline]=useState(false);
  const joiningRef=useRef(false);
  const generation=useRef(0), detailGeneration=useRef(0), pendingReading=useRef<{id:string;capture:string}|null>(null);
  const admin=access?.role==='owner'||access?.role==='admin';
  const writable=Boolean(access?.can_write&&online);
  const assetWritable=writable&&!selected?.archived;
  const activeAssets=assets.filter(asset=>!asset.archived);
  const [,offlineRender]=useState(0);useEffect(()=>subscribeOffline(()=>{offlineRender(v=>v+1);const latest=currentOffline()?.snapshot().access;if(latest?.allowed&&latest.user_id===session?.user.id)setAccess(latest);}),[session?.user.id]);
  const offlineState=currentOffline()?.snapshot();
  const pendingAssets=assets.map(asset=>{const pending=!asset.archived?offlineState?.commands.filter(c=>c.kind==='reading'&&c.assetId===asset.id&&c.meterUnit===asset.meter_unit&&c.state==='pending').at(-1):undefined;return pending?{...asset,current_hours:Number(pending.args.p_value)}:asset;});
  const captureWritable=Boolean(offlineState&&offlineEntryAllowed(offlineState));

  const clearData=useCallback(()=>{
    joiningRef.current=false;setJoining(false);setInvitationMode(false);
    generation.current++;detailGeneration.current++;setAccess(null);setOwnerId(null);setAssets([]);setMembers([]);setTypes([]);setSelected(null);setLogs([]);setAssignmentIds([]);setShowAdd(false);setEditingAsset(null);setEditingMember(null);setMeterChanges([]);setHours('');setReason('');setPage('assets');setMenuOpen(false);setShowArchived(false);setOnline(false);pendingReading.current=null;
  },[]);
  const signOut=useCallback(async()=>{
    try{await clearOffline();}finally{clearData();setSession(null);setPassword('');await supabase?.auth.signOut({scope:'local'});}
  },[clearData]);

  const refresh=useCallback(async()=>{
    if(!supabase||!session)return;
    try{await activateOffline(session.user.id);}catch(e){setError(errText(e));return;}
    const ticket=++generation.current;setLoading(true);setOnline(false);
    try{
      const a=await rpc<Access>('access_status');
      if(ticket!==generation.current)return;
      if(!a.allowed){
        if(a.reason==='not_provisioned'){
          if(joiningRef.current){setLoading(false);return;}
          clearData();setLoading(false);const clearedGeneration=generation.current;
          try{await clearOffline();}catch{if(clearedGeneration===generation.current)setError('Unable to clear saved workspace data. Please retry.');return;}
          if(clearedGeneration===generation.current){setLoading(false);setError('');joiningRef.current=true;setJoining(true);}
          return;
        }
        await signOut();
        setError('Your access has changed. Please sign in again or contact your administrator.');
        return;
      }
      await currentOffline()?.validated(a);joiningRef.current=false;setJoining(false);setAccess(a);
      const canAdmin=a.role!=='technician';
      const results=await Promise.all([
        supabase.from('assets').select('id,asset_type_id,name,serial,status,current_hours,meter_revision,archived,meter_unit').order('name'),
        supabase.from('asset_types').select('id,name').order('name'),
        canAdmin?supabase.from('memberships').select('user_id,name,phone,contact_email,job_title,role,is_active').order('name'):Promise.resolve({data:[],error:null}),
        canAdmin?supabase.from('tenants').select('owner_user_id').single():Promise.resolve({data:null,error:null}),
      ]);
      for(const result of results)if(result.error)throw new Error(result.error.message);
      if(ticket!==generation.current)return;
      const previous=readCache<{assets:Asset[]}>('workspace');
      if(previous&&JSON.stringify(previous.assets.map(x=>x.id).sort())!==JSON.stringify((results[0].data??[]).map(x=>x.id).sort()))await currentOffline()?.change(s=>{s.cache={};});
      if(ticket!==generation.current)return;
      await saveCache('workspace',{access:a,assets:results[0].data,types:results[1].data,members:results[2].data,ownerId:results[3].data?.owner_user_id??null});
      setAccess(a);setAssets(results[0].data as Asset[]);setTypes(results[1].data as AssetType[]);setMembers(results[2].data as Member[]);setOwnerId(results[3].data?.owner_user_id??null);setOnline(true);setError('');
      void Promise.allSettled([rpc('list_tasks',{p_asset:null,p_archived:false}),...(results[0].data??[]).filter(asset=>!asset.archived).flatMap(asset=>[rpc('list_asset_services',{p_asset:asset.id}),rpc('list_tasks',{p_asset:asset.id,p_archived:false}),rpc('list_asset_issues',{p_asset:asset.id}),rpc('list_compliance',{p_asset:asset.id})])]);
    }catch(e){if(ticket===generation.current){
      const cached=networkFailure(e)?readCache<{access:Access;assets:Asset[];members:Member[];types:AssetType[];ownerId?:string|null}>('workspace'):undefined;
      if(cached){setAccess(currentOffline()?.snapshot().access??cached.access);setAssets(cached.assets);setMembers(cached.members);setTypes(cached.types);setOwnerId(cached.ownerId??null);setError('Offline — showing saved data. New entries stay on this device until they sync.');
      }else setError('Unable to refresh your workspace. Check your connection and retry.');
    }}
    finally{if(ticket===generation.current)setLoading(false);}
  },[clearData,signOut,session?.user.id]);

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
  useEffect(()=>{void configureBackgroundSync(Boolean(session&&!joining)).catch(()=>{});},[session?.user.id,joining]);
  useEffect(()=>{
    if(AppState.currentState==='active')supabase?.auth.startAutoRefresh();
    const sub=AppState.addEventListener('change',state=>{
      if(state==='active'){supabase?.auth.startAutoRefresh();if(session&&!nativeInteractionActive())void refresh();}
      else {supabase?.auth.stopAutoRefresh();}
    });
    return()=>sub.remove();
  },[session?.user.id,refresh]);

  useEffect(()=>subscribeSynced(()=>{if(session)void refresh();}),[session?.user.id,refresh]);
  useEffect(()=>{if(!session||joining)return;let active=true;let running=false;const sync=async()=>{if(running||AppState.currentState!=='active')return;running=true;try{const result=await flushQueue();if(active)setOnline(result.online);if(active&&(result.online&&!online))await refresh();}finally{running=false;}};void sync();const timer=setInterval(()=>void sync(),30000);return()=>{active=false;clearInterval(timer);};},[session?.user.id,joining,online,refresh]);

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
    if(!session||!supabase)return false;
    const ticket=generation.current,client=supabase;
    const target=await notificationTarget(data,async()=>{const current=await rpc<Access>('access_status');if(ticket===generation.current&&current.allowed)setAccess(current);return current;},async id=>{
      const result=await client.from('assets').select('id,asset_type_id,name,serial,status,current_hours,meter_revision,archived,meter_unit').eq('id',id).maybeSingle();
      if(result.error)throw result.error;return result.data as Asset|null;
    });
    if(ticket!==generation.current)return false;
    if(target.kind==='denied'){await signOut();return true;}
    if(target.kind==='asset'||target.kind==='reading'){setPage('assets');await openAsset(target.asset,target.kind==='reading');}
    else if(target.kind==='tasks'||target.kind==='assets'){setSelected(null);setPage(target.kind);}
    else if(target.kind==='unavailable'){setSelected(null);setPage('assets');setError('This alert’s asset is no longer available to you.');}
    return true;
  }
  async function openAsset(asset:Asset,readingOnly=false){
    setQuickReading(readingOnly);
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
      pendingReading.current=null;setSelected(null);setHours('');void flushQueue().then(result=>{if(result.synced)void refresh();});
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


  if(boot)return <View style={s.center}><ActivityIndicator color={colors.green}/><Text style={s.muted}>Opening your workspace…</Text></View>;
  if(!configured)return <View style={s.center}><Text style={s.title}>Connection needed</Text><Text style={s.muted}>The app’s Supabase connection must be configured before signing in.</Text></View>;
  if(!session)return <KeyboardAvoidingView style={s.root} behavior={Platform.OS==='ios'?'padding':undefined}><StatusBar style="dark"/>
    <FormScroll contentContainerStyle={s.login} keyboardShouldPersistTaps="handled">
      <View style={s.brand}><Text style={s.mark}>k</Text><Text style={s.brandText}>KLEVER ASSETS</Text></View>
      <View style={{gap:16,marginTop:54,marginBottom:28}}><Text style={s.eyebrow}>READY FOR THE DAY</Text><Text style={s.hero}>Keep your{ '\n'}equipment moving.</Text><Text style={s.subtitle}>Your machines, maintenance and team.{ '\n'}One place to stay on top of it.</Text></View>
      <View style={s.card}>{invitationMode?<InvitationCode onCancel={()=>setInvitationMode(false)}/>:<><Text style={s.heading}>Welcome back</Text><Text style={s.muted}>Sign in to your business workspace.</Text>
        <Field label="Email" value={email} onChangeText={setEmail}/><Field label="Password" value={password} onChangeText={setPassword} secure/>
        {error?<Notice text={error}/>:null}<Button title={busy?'Signing in…':'Sign in'} onPress={()=>void login()} disabled={busy||!email.trim()||!password}/><Button title="I have an invitation" secondary disabled={busy} onPress={()=>{setPassword('');setError('');setInvitationMode(true);}}/>
      </>}</View><Text style={[s.muted,{marginTop:28,textAlign:'center'}]}>Simple maintenance. A better working day.</Text>
    </FormScroll></KeyboardAvoidingView>;

  if(joining)return <JoinWorkspace key={session.user.id} email={session.user.email??''} onJoined={refresh} onSignOut={signOut}/>;
  if(!access)return <View style={s.center}>{loading?<ActivityIndicator color={colors.green}/>:null}<Text style={s.title}>Opening your business</Text>{error?<Notice text={error}/>:null}<Button title="Retry" onPress={()=>void refresh()}/><Button title="Sign out" onPress={()=>void signOut()} secondary/></View>;

  const filtered=pendingAssets.filter(a=>a.archived===Boolean(admin&&showArchived)).filter(a=>statusFilter==='all'||a.status===statusFilter).filter(a=>`${a.name} ${a.serial}`.toLowerCase().includes(search.toLowerCase()));
  return <SafeAreaView style={s.root}><StatusBar style="dark"/>
    <View style={s.top}><View style={[s.brand,{flex:1,minWidth:0}]}><Text style={[s.mark,{flexShrink:0}]}>k</Text><View style={{flex:1,minWidth:0}}><Text style={s.brandText}>KLEVER ASSETS</Text><Text style={s.small} numberOfLines={1} ellipsizeMode="tail">{access.tenant_name}</Text></View></View><Pressable accessibilityRole="button" accessibilityLabel="Open menu" accessibilityState={{expanded:menuOpen}} onPress={()=>setMenuOpen(true)} style={{padding:12,flexShrink:0}}><Ionicons name="menu-outline" size={30} color={colors.ink}/></Pressable></View>
    <FormScroll contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={()=>void refresh()} tintColor={colors.green}/> }>
      <Text style={s.eyebrow}>{admin?'YOUR WORKSPACE':'YOUR ASSIGNED EQUIPMENT'}</Text><Text style={s.title}>{page==='assets'?'Assets':page==='tasks'?'Tasks':page==='team'?'Team':'Settings'}</Text>
      <Text style={s.subtitle}>{page==='settings'?'Manage your business, alerts and preferences.':`Good to see you, ${access.name?.split(' ')[0]}.`}</Text><NotificationSetup onOpenAlert={openAlert} showControls={page==='settings'}/>{page==='settings'&&admin?<><View style={s.card}><Ionicons name="business-outline" size={24} color={colors.green}/><Text style={s.muted}>Business name, timezone and service-cost currency.</Text><BusinessSettings writable={writable} onSaved={()=>refresh()}/></View><View style={s.card}><Ionicons name="pricetags-outline" size={24} color={colors.green}/><Text style={s.muted}>Name the types used to group your equipment.</Text><AssetTypeSettings types={types} writable={writable} onSaved={()=>refresh()}/></View><View style={s.card}><Ionicons name="notifications-outline" size={24} color={colors.green}/><Text style={s.muted}>Choose who receives reminders and when.</Text><NotificationSettings writable={writable}/></View><DetailTile title="Export business records" description="Download readings, maintenance and evidence"><ExportPanel/></DetailTile></>:null}
      <PendingSync/>{!online&&offlineState&&!offlineEntryAllowed(offlineState)?<Notice text="Reconnect to confirm access before adding new entries. Existing pending entries are kept."/>:null}{error?<Notice text={error}/>:null}{!access.can_write?<Notice text="This workspace is read-only. Your records remain available."/>:null}
      {page==='assets'?<>
        <View style={s.stats}>{([{value:'all',label:'Assets',icon:'cube-outline',count:activeAssets.length},{value:'Active',label:'Active',icon:'checkmark-circle-outline',count:activeAssets.filter(a=>a.status==='Active').length},{value:'Workshop',label:'In workshop',icon:'build-outline',count:activeAssets.filter(a=>a.status==='Workshop').length}] as const).map(tile=><Pressable key={tile.value} accessibilityRole="button" accessibilityState={{selected:statusFilter===tile.value&&!showArchived}} style={[s.stat,statusFilter===tile.value&&!showArchived&&{borderWidth:1,borderColor:colors.green}]} onPress={()=>{setShowArchived(false);setStatusFilter(tile.value);setSearch('');}}><Ionicons name={tile.icon} size={22} color={colors.green}/><Text style={s.statNumber}>{tile.count}</Text><Text style={s.small}>{tile.label}</Text></Pressable>)}</View>
        {statusFilter!=='all'?<Button title="Show all assets" secondary onPress={()=>setStatusFilter('all')}/>:null}
        <View style={s.sectionRow}><Text style={s.heading}>Asset register</Text>{admin?<Pressable disabled={!writable} onPress={()=>{setError('');setEditingAsset(null);setNewName('');setSerial('');setInitialHours('0');setMeterUnit('hours');setMeterReason('');setMeterConfirmed(false);setTypeId(types[0]?.id??'');setShowAdd(true);}}><Text style={[s.link,!writable&&{opacity:.4}]}>+ Add asset</Text></Pressable>:null}</View>
        {admin?<Button title={showArchived?'Show current assets':'Show archived assets'} secondary onPress={()=>{setShowArchived(!showArchived);setStatusFilter('all');}}/>:null}<TextInput accessibilityLabel="Search assets" value={search} onChangeText={setSearch} style={s.input} placeholder="Search by name or serial…" placeholderTextColor={colors.muted}/>
        {filtered.length?filtered.map(a=><Pressable key={a.id} accessibilityRole="button" onPress={()=>void openAsset(a)} style={s.assetCard}>
          <ProfilePhoto key={a.id+':'+photoVersion} kind="asset" target={a.id} compact/><View style={{flex:1,gap:5}}><Text style={s.assetName}>{a.name}</Text><Text style={s.small}>{a.serial||'No serial recorded'}</Text><Text style={[s.badge,{color:a.status==='Active'?colors.green:colors.amber}]}>{a.archived?'Archived':a.status}</Text></View><View style={{alignItems:'flex-end',gap:5}}><Text style={s.hours}>{Number(a.current_hours).toLocaleString()}</Text><Text style={s.small}>{a.meter_unit}</Text><Text style={s.link}>View →</Text>{!a.archived?<Pressable accessibilityRole="button" accessibilityLabel={`Log ${a.meter_unit} for ${a.name}`} disabled={!captureWritable} onPress={event=>{event.stopPropagation();void openAsset(a,true);}} style={{padding:10,minHeight:44,borderRadius:10,backgroundColor:"#EAF0E7",opacity:captureWritable?1:.4}}><Text style={s.link}>Log {a.meter_unit}</Text></Pressable>:null}</View>
        </Pressable>):<View style={s.card}><Text style={s.heading}>{search||statusFilter!=='all'?'No matching assets':showArchived?'No archived assets':'A fresh start'}</Text><Text style={s.muted}>{statusFilter!=='all'?'No assets have this status. Choose Show all assets to return.':showArchived?'Archived equipment and its history will appear here.':admin?'Add your first machine or vehicle to get started.':'Your administrator will assign your equipment here.'}</Text></View>}
      </>:page==='tasks'?<TaskPanel assets={activeAssets} admin={Boolean(admin)} writable={writable} captureWritable={captureWritable}/>:page==='team'?<>
        {admin?<TeamInvitations writable={writable} online={online}/>:null}
        <View style={s.sectionRow}><Text style={s.heading}>Staff</Text><Text style={s.small}>{members.filter(m=>m.is_active).length} active</Text></View>
        {members.map(m=><DetailTile key={m.user_id} title={m.name} description={`${m.job_title||m.role} · ${m.is_active?"Active":"Inactive"}`}><View style={s.sectionRow}><Text style={s.assetName}>{m.name}</Text><Text style={s.badge}>{m.is_active?'Active':'Inactive'}</Text></View><Text style={s.small}>{m.user_id===ownerId?'owner':m.user_id===access.user_id?access.role:m.role}</Text><Text style={s.muted}>{m.phone||'No phone number recorded'}</Text><Text style={s.muted}>{m.contact_email||'No contact email recorded'}</Text>{m.job_title?<Text style={s.muted}>{m.job_title}</Text>:null}<ProfilePhoto kind="member" target={m.user_id} editable writable={writable}/><Button title="Edit details" secondary disabled={!writable||busy} onPress={()=>{setEditingMember(m);setMemberName(m.name);setMemberPhone(m.phone);setMemberEmail(m.contact_email??'');setMemberTitle(m.job_title??'');setError('');}}/>
          <DetailTile title="Access & assignments" description="Equipment access and account controls"><TeamAccessControls member={m} ownerId={ownerId} viewerId={session.user.id} viewerIsOwner={access.role==='owner'} writable={writable} online={online} assets={activeAssets} onSaved={()=>refresh()} onOpenAsset={openAsset}/></DetailTile>
        </DetailTile>)}
      </>:null}
    </FormScroll>
    <View style={s.tabs}>{(admin?['assets','tasks','team'] as const:['assets','tasks'] as const).map(p=><Pressable key={p} accessibilityRole="tab" accessibilityState={{selected:page===p}} style={[s.tab,page===p&&s.tabSelected]} onPress={()=>setPage(p)}><Ionicons name={p==='assets'?'cube-outline':p==='tasks'?'checkbox-outline':p==='team'?'people-outline':'settings-outline'} size={23} color={page===p?colors.green:colors.muted}/><Text style={[s.tabText,page===p&&{color:colors.green}]}>{p==='assets'?'Assets':p==='tasks'?'Tasks':p==='team'?'Team':'Settings'}</Text></Pressable>)}</View>

    <Modal visible={showAdd} animationType="slide" onRequestClose={()=>setShowAdd(false)}><View style={s.root}><FormScroll contentContainerStyle={s.modal} keyboardShouldPersistTaps="handled"><View style={s.sectionRow}><Text style={s.title}>{editingAsset?'Edit asset':'Add an asset'}</Text><Pressable onPress={()=>setShowAdd(false)}><Text style={s.link}>Close</Text></Pressable></View>
      <Field label="Asset name" value={newName} onChangeText={setNewName}/><Field label="Serial number" value={serial} onChangeText={setSerial}/><Text style={s.label}>Track this asset in</Text><View style={s.row}>{(['hours','km'] as const).map(unit=><Pressable key={unit} accessibilityRole="radio" accessibilityState={{checked:meterUnit===unit}} onPress={()=>{setMeterUnit(unit);setMeterConfirmed(false);}} style={[s.chip,meterUnit===unit&&s.selectedChip]}><Text style={s.label}>{unit==='hours'?'Hours':'Kilometres (km)'}</Text></Pressable>)}</View>{!editingAsset||meterUnit!==editingAsset.meter_unit?<Field label={meterUnit==='km'?'Current kilometres (km)':'Current hours'} value={initialHours} onChangeText={v=>{setInitialHours(v);setMeterConfirmed(false);}} numeric/>:null}
      {editingAsset&&meterUnit!==editingAsset.meter_unit?<><Notice text="Enter the correct current reading in the new unit. Earlier readings keep their original units."/><Field label="Reason for unit correction" value={meterReason} onChangeText={setMeterReason}/><Pressable accessibilityRole="checkbox" accessibilityState={{checked:meterConfirmed}} onPress={()=>setMeterConfirmed(!meterConfirmed)} style={s.chip}><Text style={s.label}>{meterConfirmed?'✓ ':''}I confirm {initialHours||'the reading'} {meterUnit} is correct</Text></Pressable></>:null}
      <SelectField label="Asset type" value={typeId} options={types.map(t=>({value:t.id,label:t.name}))} onChange={setTypeId}/>
      <Field label="New type name" value={newType} onChangeText={setNewType}/><Button title="Create asset type" secondary disabled={busy||!newType.trim()||!writable} onPress={()=>void run(async()=>{const id=await rpc<string>('save_asset_type',{p_name:newType.trim()});setNewType('');await refresh();setTypeId(id);})}/>
      {error?<Notice text={error}/>:null}<Button title={busy?'Saving…':'Save asset'} onPress={()=>void createAsset()} disabled={busy||!writable}/>
    </FormScroll></View></Modal>

    <Modal visible={Boolean(editingMember)} animationType="slide" onRequestClose={()=>setEditingMember(null)}><View style={s.root}><FormScroll contentContainerStyle={s.modal} keyboardShouldPersistTaps="handled"><View style={s.sectionRow}><Text style={s.title}>Edit team member</Text><Pressable onPress={()=>setEditingMember(null)}><Text style={s.link}>Close</Text></Pressable></View><Field label="Name" value={memberName} onChangeText={setMemberName}/><Field label="Phone number" value={memberPhone} onChangeText={setMemberPhone}/><Field label="Email" value={memberEmail} onChangeText={setMemberEmail}/><Text style={s.small}>Contact email only. This does not change their sign-in email.</Text><Field label="Job title" value={memberTitle} onChangeText={setMemberTitle}/>{error?<Notice text={error}/>:null}<Button title={busy?'Saving…':'Save details'} disabled={busy||!writable||!memberName.trim()} onPress={()=>void run(async()=>{await rpc('save_staff_details',{p_user:editingMember!.user_id,p_name:memberName.trim(),p_phone:memberPhone.trim(),p_contact_email:memberEmail.trim(),p_job_title:memberTitle.trim()});setEditingMember(null);await refresh();})}/></FormScroll></View></Modal>

    <Modal visible={Boolean(selected)} animationType="slide" onRequestClose={()=>setSelected(null)}><View style={s.root}><FormScroll contentContainerStyle={s.modal} keyboardShouldPersistTaps="handled"><View style={s.sectionRow}><Text style={s.eyebrow}>{quickReading?"RECORD READING":"ASSET DETAILS"}</Text><Pressable onPress={()=>setSelected(null)}><Text style={s.link}>Close</Text></Pressable></View>
      {selected?.archived?<Notice text="Archived asset — history is available. Restore it to resume work."/>:null}{selected&&!quickReading?<ProfilePhoto key={selected.id} kind="asset" target={selected.id} editable={false} writable={assetWritable} onChanged={()=>setPhotoVersion(v=>v+1)}/>:null}<Text style={s.title}>{selected?.name}</Text><Text style={s.muted}>{selected?.serial||'No serial recorded'}</Text><View style={s.card}><Text style={s.statNumber}>{Number(selected?.current_hours??0).toLocaleString()} <Text style={s.subtitle}>{selected?.meter_unit}</Text></Text><Text style={s.badge}>{selected?.status}</Text></View>
      <DetailTile key={(selected?.id??"")+":reading"} title="Log a reading" description="Record the current hours or kilometres" initiallyOpen><Field label={selected?.meter_unit==='km'?'Current odometer reading (km)':'Current meter reading (hours)'} value={hours} numeric onChangeText={v=>{pendingReading.current=null;setHours(v);}}/><Button title={busy?'Saving…':'Save reading'} onPress={()=>void saveReading()} disabled={busy||(!captureWritable||Boolean(selected?.archived))||!hours.trim()}/></DetailTile>
      {error?<Notice text={error}/>:null}
      {!quickReading?<><>{selected?<View style={{gap:24}}><DetailTile title="Services" description="Due maintenance and service records"><ServicePanel key={selected.id+scheduleVersion} asset={selected} admin={Boolean(admin)} writable={assetWritable} captureWritable={captureWritable&&!selected?.archived}/></DetailTile><DetailTile title="Tasks" description="Checklists and recurring work"><TaskPanel key={selected.id+scheduleVersion} asset={selected} assets={activeAssets} admin={Boolean(admin)} writable={assetWritable} captureWritable={captureWritable&&!selected?.archived}/></DetailTile></View>:null}</>
      <DetailTile key={(selected?.id??"")+":care"} title="Issues & compliance" description="Report problems and view important dates"><>{selected?<AssetCare key={selected.id} assetId={selected.id} admin={Boolean(admin)} writable={assetWritable} captureWritable={captureWritable&&!selected?.archived}/>:null}</></DetailTile>
      {admin?<DetailTile key={(selected?.id??"")+":manage"} title="Manage asset" description="Details, assignments, corrections and setup">
      <DetailTile title="Details & photo">      {admin?<Button title="Edit asset details" secondary disabled={!assetWritable||busy} onPress={()=>{setEditingAsset(selected);setNewName(selected!.name);setSerial(selected!.serial);setTypeId(selected!.asset_type_id);setInitialHours(String(selected!.current_hours));setMeterUnit(selected!.meter_unit);setMeterReason('');setMeterConfirmed(false);setError('');setSelected(null);setShowAdd(true);}}/>:null}{selected?<ProfilePhoto key={selected.id} kind="asset" target={selected.id} editable writable={assetWritable} onChanged={()=>setPhotoVersion(v=>v+1)}/>:null}</DetailTile>
      <DetailTile title="Asset status">      <SelectField label="Choose status" value={nextStatus} options={statuses.map(value=>({value,label:value}))} onChange={setNextStatus}/><Field label="Reason for change" value={reason} onChangeText={setReason}/><Button title="Update status" secondary disabled={!assetWritable||busy||!reason.trim()} onPress={()=>void run(async()=>{await rpc('set_asset_status',{p_asset:selected!.id,p_status:nextStatus,p_reason:reason.trim()});setSelected(null);await refresh();})}/></DetailTile>
      <DetailTile title="Assigned staff">        {members.filter(m=>m.is_active).map(m=><Pressable key={m.user_id} disabled={!assetWritable||busy} style={s.sectionRow} onPress={()=>void run(async()=>{await rpc('assign_asset',{p_asset:selected!.id,p_user:m.user_id,p_assigned:!assignmentIds.includes(m.user_id)});setAssignmentIds(ids=>ids.includes(m.user_id)?ids.filter(x=>x!==m.user_id):[...ids,m.user_id]);})}><Text style={s.label}>{m.name}</Text><Text style={s.link}>{assignmentIds.includes(m.user_id)?'Assigned ✓':'Assign +'}</Text></Pressable>)}</DetailTile>
      <DetailTile title="Correct a reading">{admin&&selected?<ReadingCorrection key={selected.id+':'+selected.meter_revision} asset={selected} writable={assetWritable} onSaved={async()=>{setSelected(null);await refresh();}}/>:null}</DetailTile>
      <DetailTile title="Starter service templates"><>{admin&&selected?<StarterLibrary asset={selected} writable={assetWritable} onApplied={()=>setScheduleVersion(v=>v+1)}/>:null}</></DetailTile>
      <DetailTile title="Exports & archive">      {admin&&selected?<ExportPanel assetId={selected.id}/>:null}{admin&&selected?<AssetArchive asset={selected} writable={writable} onSaved={async()=>{setSelected(null);await refresh();}}/>:null}</DetailTile>
      </DetailTile>:null}
      <DetailTile key={(selected?.id??"")+":history"} title="Reading history" description="Previous readings and recorded corrections">      {meterChanges.length?<><Text style={s.heading}>Meter unit corrections</Text>{meterChanges.map(change=><View style={s.card} key={change.id}><Text style={s.label}>{change.details.previous_reading} {change.details.previous_unit} → {change.details.reading} {change.details.meter_unit}</Text><Text style={s.muted}>{change.reason}</Text><Text style={s.small}>{new Date(change.server_time).toLocaleString()}</Text></View>)}</>:null}
      <Text style={s.heading}>{admin?'Recent readings':'Your recent readings'}</Text>{logs.length?logs.map(log=><View style={s.card} key={log.id}><View style={s.sectionRow}><Text style={s.assetName}>{Number(log.value).toLocaleString()} {log.meter_unit}</Text><Text style={s.small}>{Number(log.delta)>=0?'+':''}{Number(log.delta)} {log.meter_unit}</Text></View><Text style={s.small}>Captured {new Date(log.capture_time).toLocaleString()}</Text><Text style={s.small}>Received {new Date(log.server_time).toLocaleString()}</Text>{log.correction_of||log.correction_of_setup?<Text style={s.small}>{log.correction_of_setup?'Correction of a setup reading':'Correction of an earlier reading'} — original retained</Text>:null}{log.reason?<Text style={s.muted}>{log.reason}</Text>:null}</View>):<Text style={s.muted}>No readings recorded yet.</Text>}</DetailTile>
      </>:null}
    </FormScroll></View></Modal>
    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={()=>setMenuOpen(false)}><View style={{flex:1,backgroundColor:'#0006',justifyContent:'flex-start'}}><Pressable accessibilityLabel="Dismiss menu" onPress={()=>setMenuOpen(false)} style={StyleSheet.absoluteFill}/><SafeAreaView style={{margin:16,padding:20,gap:16,backgroundColor:colors.paper,borderRadius:16}}><View style={s.sectionRow}><Text style={s.heading}>Menu</Text><Button title="Close" secondary onPress={()=>setMenuOpen(false)}/></View><Button title="Settings" secondary onPress={()=>{setSelected(null);setPage('settings');setMenuOpen(false);}}/><Button title="Sign out" secondary onPress={()=>{setMenuOpen(false);void signOut();}}/></SafeAreaView></View></Modal>
  </SafeAreaView>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:colors.paper},center:{flex:1,backgroundColor:colors.paper,padding:28,justifyContent:'center',gap:18},
  login:{padding:28,paddingTop:74,maxWidth:580,width:'100%',alignSelf:'center',paddingBottom:50},content:{padding:24,gap:18,maxWidth:760,width:'100%',alignSelf:'center',paddingBottom:40},modal:{padding:24,paddingTop:64,gap:20,maxWidth:760,width:'100%',alignSelf:'center',paddingBottom:60},
  top:{paddingHorizontal:24,paddingTop:12,paddingBottom:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:colors.line},
  brand:{flexDirection:'row',alignItems:'center',gap:12},mark:{backgroundColor:colors.ink,color:colors.white,width:38,height:38,borderRadius:12,textAlign:'center',fontSize:29,fontWeight:'800',lineHeight:37},brandText:{fontSize:12,letterSpacing:1.8,fontWeight:'800',color:colors.ink},
  hero:{fontSize:39,fontWeight:'700',color:colors.ink,letterSpacing:-1.4,lineHeight:44},title:{fontSize:29,fontWeight:'700',color:colors.ink,letterSpacing:-.7},heading:{fontSize:21,fontWeight:'700',color:colors.ink},subtitle:{fontSize:16,color:colors.muted,lineHeight:25},eyebrow:{fontSize:11,color:colors.green,fontWeight:'800',letterSpacing:2},
  card:{backgroundColor:colors.white,borderWidth:1,borderColor:colors.line,borderRadius:20,padding:22,gap:16},input:{backgroundColor:colors.white,borderWidth:1,borderColor:'#CBD6CC',borderRadius:12,paddingHorizontal:15,paddingVertical:14,fontSize:16,color:colors.ink,minHeight:50},label:{fontSize:14,fontWeight:'600',color:colors.ink},muted:{fontSize:14,lineHeight:22,color:colors.muted},small:{fontSize:12,lineHeight:19,color:colors.muted},
  button:{backgroundColor:colors.green,borderRadius:12,paddingHorizontal:17,paddingVertical:15,alignItems:'center',minHeight:48},secondary:{backgroundColor:'#EAF0E7'},buttonText:{fontSize:14,fontWeight:'700',color:'white'},link:{fontSize:13,fontWeight:'700',color:colors.green},notice:{backgroundColor:'#FFF0DC',padding:15,borderRadius:12},noticeText:{fontSize:14,lineHeight:21,color:'#75551F'},
  stats:{flexDirection:'row',gap:12,marginVertical:8},stat:{flex:1,padding:17,backgroundColor:'#EAF0E7',borderRadius:17,gap:5},statNumber:{fontSize:30,fontWeight:'700',color:colors.ink},sectionRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},row:{flexDirection:'row',flexWrap:'wrap',gap:10},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},
  assetCard:{backgroundColor:colors.white,borderWidth:1,borderColor:colors.line,borderRadius:18,padding:18,flexDirection:'row',alignItems:'center',gap:14},assetIcon:{width:48,height:55,borderRadius:13,backgroundColor:'#EFF2E8',justifyContent:'center',alignItems:'center'},assetLetter:{fontSize:24,fontWeight:'700',color:colors.green},assetName:{fontSize:17,fontWeight:'700',color:colors.ink},hours:{fontSize:22,fontWeight:'700',color:colors.ink},badge:{fontSize:12,fontWeight:'700',color:colors.green},
  tabs:{flexDirection:'row',padding:12,paddingBottom:8,backgroundColor:'white',borderTopWidth:1,borderColor:colors.line,gap:8},tab:{flex:1,alignItems:'center',padding:10,gap:4,borderRadius:12},tabSelected:{backgroundColor:'#EAF0E7'},tabText:{fontSize:14,fontWeight:'700',color:colors.muted},chip:{paddingHorizontal:14,paddingVertical:13,borderRadius:12,borderWidth:1,borderColor:colors.line,backgroundColor:'white'},selectedChip:{backgroundColor:'#DDEBDD',borderColor:colors.green},
});
