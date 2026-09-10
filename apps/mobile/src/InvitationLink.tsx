import React,{useEffect,useRef,useState} from 'react';
import {Linking,Modal,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {FormScroll} from './FormScroll';
import {supabase} from './client';
import {invitationProof,openInvitation,type InvitationProof} from './invitationAuth';
import {InvitationButton as Button,invitationStyles as s} from './InvitationFields';

export function InvitationLink(){
 const [proof,setProof]=useState<InvitationProof|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const running=useRef(false);
 useEffect(()=>{
  let active=true;
  const receive=(url:string)=>{if(!active||running.current)return;const next=invitationProof(url);if(next){setProof(next);setMessage('');}};
  const subscription=Linking.addEventListener('url',event=>receive(event.url));
  void Linking.getInitialURL().then(url=>{if(url)receive(url);}).catch(()=>{});
  return()=>{active=false;subscription.remove();};
 },[]);
 async function accept(){
  if(!proof||running.current||!supabase)return;
  running.current=true;setBusy(true);setMessage('');
  try{await openInvitation(proof,supabase.auth);setProof(null);}
  catch(e){setMessage(e instanceof Error?e.message:'Unable to open your invitation. Check your connection and retry.');}
  finally{running.current=false;setBusy(false);}
 }
 return <Modal visible={Boolean(proof)} animationType="slide" onRequestClose={()=>{if(!running.current)setProof(null);}}>
  <SafeAreaView style={{flex:1,backgroundColor:'#F5F6F0'}}><FormScroll contentContainerStyle={{padding:24,maxWidth:620,width:'100%',alignSelf:'center'}}><View style={s.card}>
   <Text style={s.title}>Your team invitation</Text>
   <Text style={s.text}>Continue to verify your email, review your business invitation and choose your password.</Text>
   {message?<Text accessibilityLiveRegion="polite" style={s.text}>{message}</Text>:null}
   <Button title={busy?'Opening invitation…':'Continue'} disabled={busy||!supabase} onPress={()=>void accept()}/>
   <Button title="Close" disabled={busy} onPress={()=>{setProof(null);setMessage('');}}/>
  </View></FormScroll></SafeAreaView>
 </Modal>;
}
