import {ProfilePhoto} from './ProfilePhoto';
import {DetailTile} from './DetailTile';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Text,View} from './brandUI';
import * as Crypto from 'expo-crypto';
import {rpc,supabase} from './client';
import {sendStaffInvitation} from './invitationDelivery';
import {InvitationButton as Button,InvitationField as Field,invitationStyles as s} from './InvitationFields';

type Invitation={id:string;name:string;email:string;expires_at:string;delivery_status:string;delivery_started_at:string|null;last_sent_at:string|null};
export function TeamInvitations({writable,online}:{writable:boolean;online:boolean}){
 const [rows,setRows]=useState<Invitation[]>([]),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[title,setTitle]=useState('');
 const [photoEditing,setPhotoEditing]=useState(false);
 const [photoInvitation,setPhotoInvitation]=useState<string|null>(null);
 const request=useRef<string|null>(null),alive=useRef(true),operation=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const load=useCallback(async()=>{
  if(!online){setRows([]);return;}
  const result=await supabase!.from('staff_invitations').select('id,name,email,expires_at,delivery_status,delivery_started_at,last_sent_at').is('accepted_at',null).is('cancelled_at',null).order('created_at',{ascending:false});
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
  const result=await rpc<{id:string;status:string}>('create_staff_invitation',{p_id:request.current,p_email:email.trim(),p_name:name.trim(),p_phone:phone.trim(),p_job_title:title.trim()});
  if(!alive.current)return;
  request.current=null;
  if(result.status!=='pending')throw Error('This invitation is no longer pending. Refresh before creating another.');
  setPhotoInvitation(result.id);await load();
 });}
 function start(){setPhotoInvitation(null);request.current=null;setName('');setEmail('');setPhone('');setTitle('');setMessage('');setOpen(true);}
 const edit=(setter:(v:string)=>void)=>(value:string)=>{request.current=null;setter(value);};
 return <View style={s.card}>
  <Text style={s.title}>Invite a team member</Text>
  <Text style={s.text}>New team members join as technicians. They count toward your staff limit when they accept.</Text>
  <Text style={s.text}>They will receive an email code to verify their address and choose a password. We will show you if email sending is unavailable.</Text>
  {open?photoInvitation?<><Text style={s.title}>Add a profile picture (optional)</Text><Text style={s.text}>Save a photo now, or skip this step. It will appear on their staff profile after they join.</Text><ProfilePhoto kind="invitation" target={photoInvitation} onEditingChange={setPhotoEditing} editable writable={writable&&!busy}/><Button title="Save and send invitation" disabled={busy||photoEditing||!writable} onPress={()=>void act(async()=>{try{setMessage(await sendStaffInvitation(photoInvitation));setOpen(false);setPhotoInvitation(null);}finally{await load();}})}/><Button title="Finish without sending" disabled={busy||photoEditing} onPress={()=>{setOpen(false);setPhotoInvitation(null);setMessage("Invitation saved. You can add a photo or send it from Pending invitations.");}}/></>:<>
   <Field label="Team member name" value={name} onChange={edit(setName)} disabled={busy}/>
   <Field label="Invitation email" kind="email" value={email} onChange={edit(setEmail)} disabled={busy} maxLength={254}/>
   <Field label="Phone (optional)" kind="phone" value={phone} onChange={edit(setPhone)} disabled={busy} maxLength={40}/>
   <Field label="Job title (optional)" value={title} onChange={edit(setTitle)} disabled={busy}/>
   <Button title={busy?'Preparing invitation…':'Continue to photo'} onPress={()=>void save()} disabled={busy||!writable||!name.trim()||!email.trim()}/>
   <Button title="Cancel" onPress={()=>setOpen(false)} disabled={busy}/>
  </>:<Button title="Add team member" onPress={start} disabled={busy||!writable}/>}
  {message?<Text accessibilityLiveRegion="polite" style={s.text}>{message}</Text>:null}
  {rows.length?<Text style={s.title}>Pending invitations</Text>:null}
  {rows.map(row=><View key={row.id} style={{gap:8,paddingVertical:10,borderTopWidth:1,borderColor:'#DFE5DC'}}>
   <Text style={s.buttonText}>{row.name}</Text>{new Date(row.expires_at).getTime()>Date.now()?<DetailTile icon="person-outline" title={"Profile picture for "+row.name}><ProfilePhoto kind="invitation" target={row.id} editable writable={writable&&!busy}/></DetailTile>:null}<Text style={s.text}>{row.email}</Text>
   <Text style={s.text}>{new Date(row.expires_at).getTime()<=Date.now()?'Expired':'Expires '+new Date(row.expires_at).toLocaleDateString()}</Text>
   <Text style={s.text}>{row.delivery_status==='sent'?'Email accepted for sending'+(row.last_sent_at?' on '+new Date(row.last_sent_at).toLocaleString():''):row.delivery_status==='sending'?'Sending started. Refresh to check the outcome; if it remains unconfirmed after two minutes, check with the recipient before resending.':row.delivery_status==='unknown'?'Sending could not be confirmed. Check with the recipient before resending.':row.delivery_status==='failed'?'Email could not be sent.':'No email sent yet.'}</Text>
   <Button title={'Send invitation email to '+row.name} disabled={busy||!writable||new Date(row.expires_at).getTime()<=Date.now()} onPress={()=>void act(async()=>{try{setMessage(await sendStaffInvitation(row.id));}finally{await load();}})}/>
   <Button title={'Cancel invitation for '+row.name} disabled={busy||!online} onPress={()=>void act(async()=>{await rpc('cancel_staff_invitation',{p_id:row.id});if(alive.current){setMessage('Invitation cancelled.');await load();}})}/>
  </View>)}
  <Button title="Refresh invitations" disabled={busy||!online} onPress={()=>void act(load)}/>
 </View>;
}
