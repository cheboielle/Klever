import React,{useRef,useState} from 'react';
import {Text,View} from './brandUI';
import {supabase} from './client';
import {openInvitation} from './invitationAuth';
import {InvitationButton as Button,InvitationField as Field,invitationStyles as s} from './InvitationFields';

export function InvitationCode({onCancel}:{onCancel:()=>void}){
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const running=useRef(false);
 async function verify(){
  if(!supabase||running.current)return;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())||!/^\d{6,10}$/.test(code.trim())){setMessage('Enter your invitation email address and the code from your latest invitation email.');return;}
  running.current=true;setBusy(true);setMessage('');
  try{await openInvitation({email:email.trim().toLowerCase(),token:code.trim(),type:'email'},supabase.auth);setCode('');}
  catch(e){setMessage(e instanceof Error?e.message:'Unable to verify your invitation. Check your connection and try again.');}
  finally{running.current=false;setBusy(false);}
 }
 return <View style={{gap:14}}><Text style={s.title}>Join your team</Text><Text style={s.text}>Enter the email address and code from your invitation. You’ll choose your password next.</Text>
  <Field label="Invitation email" kind="email" value={email} onChange={setEmail} maxLength={254} disabled={busy}/>
  <Field label="Invitation code" value={code} onChange={setCode} maxLength={10} disabled={busy}/>
  {message?<Text accessibilityLiveRegion="polite" style={s.text}>{message}</Text>:null}
  <Button title={busy?'Checking code…':'Verify invitation'} disabled={busy||!email.trim()||!code.trim()} onPress={()=>void verify()}/>
  <Button title="Back to sign in" disabled={busy} onPress={onCancel}/>
 </View>;
}
