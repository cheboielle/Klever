import React,{useState,useEffect} from 'react';
import {AppState,Pressable,Text,View} from 'react-native';
import * as Notifications from 'expo-notifications';
import {registerPhoneAlerts} from './pushRegistration.native';
Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:false})});
export function NotificationSetup(){
 useEffect(()=>{
  const refresh=()=>{void registerPhoneAlerts().catch(()=>{});};refresh();
  const state=AppState.addEventListener('change',value=>{if(value==='active')refresh();});
  const token=Notifications.addPushTokenListener(refresh);
  return()=>{state.remove();token.remove();};
 },[]);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function enable(){if(busy)return;setBusy(true);setMessage('');try{
  if(!await registerPhoneAlerts(true))throw Error('Sign in and reconnect before enabling phone alerts.');setMessage('This phone is registered for alerts. Delivery becomes available when your business notification service is activated.');
 }catch(e){setMessage(e instanceof Error?e.message:'Unable to enable alerts. Check your connection and retry.');}finally{setBusy(false);}}
 return <View style={{gap:8}}><Pressable accessibilityRole="button" disabled={busy} onPress={()=>void enable()} style={{padding:12,borderRadius:10,backgroundColor:'#EAF0E7'}}><Text style={{fontWeight:'600',color:'#153C32'}}>{busy?'Registering phone…':'Enable phone alerts'}</Text></Pressable>{message?<Text style={{fontSize:13,color:'#53665B'}}>{message}</Text>:null}</View>;
}
