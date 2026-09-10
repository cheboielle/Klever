import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Text,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import {rpc,supabase} from './client';
import {InvitationButton as Button,InvitationField as Field,invitationStyles as s} from './InvitationFields';

type Invitation={id:string;name:string;email:string;expires_at:string};
export function TeamInvitations({writable,online}:{writable:boolean;online:boolean}){
 const [rows,setRows]=useState<Invitation[]>([]),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[title,setTitle]=useState('');
 const request=useRef<string|null>(null),alive=useRef(true),operation=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const load=useCallback(async()=>{
  if(!online){setRows([]);return;}
  const result=await supabase!.from('staff_invitations').select('id,name,email,expires_at').is('accepted_at',null).is('cancelled_at',null).order('created_at',{ascending:false});
  if(result.error)throw new Error('Unable to load invitations. Reconnect and retry.');
  if(alive.current)setRows(result.data as Invitation[]);
 },[online]);
 useEffect(()=>{void load().catch(e=>{if(alive.current)setMessage(e.message);});},[load]);
 async function act(action:()=>Promise<void>){
  if(operation.current)return;operation.current=true;setBusy(true);setMessage('');
  try{await action();}catch(e){if(alive.current)setMessage(e instanceof Error?e.message:'Unable to update invitations. Reconnect and retry.');}
  finally{operation.current=false;if(alive.current)setBusy(false);}
 }
 async function save(){await act(async()=>{
  request.current??=Crypto.randomUUID();
  const result=await rpc<{status:string}>('create_staff_invitation',{p_id:request.current,p_email:email.trim(),p_name:name.trim(),p_phone:phone.trim(),p_job_title:title.trim()});
  if(!alive.current)return;
  request.current=null;setOpen(false);
  setMessage(result.status==='pending'?'Invitation saved. No email has been sent: invitation email delivery is still being connected.':'This invitation is no longer pending. Refresh the list before creating another.');
  await load();
 });}
 function start(){request.current=null;setName('');setEmail('');setPhone('');setTitle('');setMessage('');setOpen(true);}
 const edit=(setter:(v:string)=>void)=>(value:string)=>{request.current=null;setter(value);};
 return <View style={s.card}>
  <Text style={s.title}>Invite a team member</Text>
  <Text style={s.text}>New team members join as technicians. They count toward your staff limit when they accept.</Text>
  <Text style={s.text}>Email delivery is still being set up. You can prepare an invitation here; it will not send an email yet.</Text>
  {open?<>
   <Field label="Team member name" value={name} onChange={edit(setName)} disabled={busy}/>
   <Field label="Invitation email" kind="email" value={email} onChange={edit(setEmail)} disabled={busy} maxLength={254}/>
   <Field label="Phone (optional)" kind="phone" value={phone} onChange={edit(setPhone)} disabled={busy} maxLength={40}/>
   <Field label="Job title (optional)" value={title} onChange={edit(setTitle)} disabled={busy}/>
   <Button title={busy?'Saving…':'Save invitation'} onPress={()=>void save()} disabled={busy||!writable||!name.trim()||!email.trim()}/>
   <Button title="Cancel" onPress={()=>setOpen(false)} disabled={busy}/>
  </>:<Button title="Add team member" onPress={start} disabled={busy||!writable}/>}
  {message?<Text accessibilityLiveRegion="polite" style={s.text}>{message}</Text>:null}
  {rows.length?<Text style={s.title}>Pending invitations</Text>:null}
  {rows.map(row=><View key={row.id} style={{gap:8,paddingVertical:10,borderTopWidth:1,borderColor:'#DFE5DC'}}>
   <Text style={s.buttonText}>{row.name}</Text><Text style={s.text}>{row.email}</Text>
   <Text style={s.text}>{new Date(row.expires_at).getTime()<=Date.now()?'Expired':'Expires '+new Date(row.expires_at).toLocaleDateString()}</Text>
   <Button title={'Cancel invitation for '+row.name} disabled={busy||!online} onPress={()=>void act(async()=>{await rpc('cancel_staff_invitation',{p_id:row.id});if(alive.current){setMessage('Invitation cancelled.');await load();}})}/>
  </View>)}
  <Button title="Refresh invitations" disabled={busy||!online} onPress={()=>void act(load)}/>
 </View>;
}
