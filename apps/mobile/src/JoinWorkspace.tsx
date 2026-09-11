import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Text,View} from './brandUI';
import {SafeAreaView} from './brandUI';
import {FormScroll} from './FormScroll';
import {rpc,supabase} from './client';
import {InvitationButton as Button,InvitationField as Field,invitationStyles as s} from './InvitationFields';
import type {Access} from '@klever/domain';

type Invitation={id:string;business_name:string;email:string;name:string;phone:string;job_title:string;expires_at:string};
export function JoinWorkspace({email,onJoined,onSignOut}:{email:string;onJoined:()=>Promise<void>;onSignOut:()=>Promise<void>}){
 const [rows,setRows]=useState<Invitation[]>([]),[selected,setSelected]=useState<Invitation|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [name,setName]=useState(''),[phone,setPhone]=useState(''),[title,setTitle]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
 const [passwordSet,setPasswordSet]=useState(false);
 const alive=useRef(true),operation=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const load=useCallback(async()=>{
  if(operation.current)return;operation.current=true;setBusy(true);setMessage('');
  try{const invitations=await rpc<Invitation[]>('my_staff_invitations');if(alive.current){setRows(invitations);setSelected(null);setPassword('');setConfirm('');}}
  catch(e){if(alive.current)setMessage(e instanceof Error?e.message:'Unable to check invitations. Reconnect and retry.');}
  finally{operation.current=false;if(alive.current)setBusy(false);}
 },[]);
 useEffect(()=>{void load();},[load]);
 async function join(){
  if(!selected||operation.current)return;
  if(!passwordSet&&(password.length<6||password!==confirm)){setMessage('Use at least 6 characters and enter the same password in both fields.');return;}
  operation.current=true;setBusy(true);setMessage('');
  try{
   if(!passwordSet){
    const result=await supabase!.auth.updateUser({password});
    if(result.error&&result.error.code!=='same_password')throw result.error;
    setPasswordSet(true);setPassword('');setConfirm('');
   }
   await rpc('accept_staff_invitation',{p_id:selected.id,p_name:name.trim(),p_phone:phone.trim(),p_job_title:title.trim()});
   await onJoined();
  }catch(e){
   // A lost acceptance response must not make a successfully joined account retry a used invite.
   const access=await rpc<Access>('access_status').catch(()=>null);
   if(access?.allowed)await onJoined();
   else if(alive.current)setMessage(e instanceof Error?e.message:'Unable to join. Check your connection and try again.');
  }finally{operation.current=false;if(alive.current)setBusy(false);}
 }
 return <SafeAreaView style={{flex:1,backgroundColor:'#F5F6F0'}}><FormScroll contentContainerStyle={{padding:24,gap:18,maxWidth:620,width:'100%',alignSelf:'center'}}>
  <Text style={s.title}>Join your team</Text><Text style={s.text}>Signed in as {email}</Text>
  {busy?<ActivityIndicator color="#226A50"/>:null}
  {selected?<View style={s.card}>
   <Text style={s.title}>{selected.business_name}</Text><Text style={s.text}>Confirm your details and choose the password you’ll use to sign in. You’ll join as a technician.</Text>
   <Field label="Your name" value={name} onChange={setName} disabled={busy}/>
   <Field label="Your phone (optional)" kind="phone" value={phone} onChange={setPhone} disabled={busy} maxLength={40}/>
   <Field label="Your job title (optional)" value={title} onChange={setTitle} disabled={busy}/>
   {passwordSet?<Text style={s.text}>Your password is set. Continue to join the team.</Text>:<>
   <Field label="Choose password" kind="password" value={password} onChange={setPassword} disabled={busy} maxLength={256}/>
   <Text style={s.text}>At least 6 characters.</Text>
   <Field label="Confirm password" kind="password" value={confirm} onChange={setConfirm} disabled={busy} maxLength={256}/>
   </>}
   <Button title={busy?'Joining…':passwordSet?'Join team':'Set password and join team'} disabled={busy||!name.trim()||(!passwordSet&&(!password||!confirm))} onPress={()=>void join()}/>
   <Button title="Back to invitations" disabled={busy} onPress={()=>{setSelected(null);setPassword('');setConfirm('');}}/>
  </View>:<>
   {!busy&&!rows.length?<Text style={s.text}>There are no available invitations for this email. Ask your administrator to check the invitation email address or send a new invitation.</Text>:null}
   {rows.map(row=><View key={row.id} style={s.card}><Text style={s.title}>{row.business_name}</Text><Text style={s.text}>Expires {new Date(row.expires_at).toLocaleDateString()}</Text><Button title={'Join '+row.business_name} disabled={busy} onPress={()=>{setSelected(row);setName(row.name);setPhone(row.phone);setTitle(row.job_title);setMessage('');}}/></View>)}
   <Button title="Check again" disabled={busy} onPress={()=>void load()}/>
  </>}
  {message?<Text accessibilityLiveRegion="polite" style={s.text}>{message}</Text>:null}
  <Button title="Sign out" disabled={busy} onPress={()=>void onSignOut()}/>
 </FormScroll></SafeAreaView>;
}
