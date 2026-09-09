import React,{useState,useEffect,useRef} from 'react';
import {AppState,Pressable,Text,View} from 'react-native';
import * as Notifications from 'expo-notifications';
import {registerPhoneAlerts} from './pushRegistration.native';
Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:false})});
export function NotificationSetup({onOpenAlert,showControls=true}:{showControls?:boolean;onOpenAlert:(data:unknown)=>Promise<boolean>}){
 const response=Notifications.useLastNotificationResponse(),openAlert=useRef(onOpenAlert),handled=useRef<string|null>(null);
 openAlert.current=onOpenAlert;
 const [retry,setRetry]=useState<Notifications.NotificationResponse|null>(null);
 async function openResponse(value:Notifications.NotificationResponse){
  try{const opened=await openAlert.current(value.notification.request.content.data);
   if(opened){setRetry(null);if(Notifications.getLastNotificationResponse()?.notification.request.identifier===value.notification.request.identifier)Notifications.clearLastNotificationResponse();}
   else {setRetry(value);setMessage('Unlock or reconnect, then open the alert again.');}
  }catch{setRetry(value);setMessage('Reconnect to open this alert. Your saved work is still available.');}
 }
 useEffect(()=>{if(!response||response.actionIdentifier!==Notifications.DEFAULT_ACTION_IDENTIFIER)return;const id=response.notification.request.identifier;if(handled.current===id)return;handled.current=id;void openResponse(response);},[response]);
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
 return <View style={{gap:8,display:showControls?'flex':'none'}}><Pressable accessibilityRole="button" disabled={busy} onPress={()=>void enable()} style={{padding:12,borderRadius:10,backgroundColor:'#EAF0E7'}}><Text style={{fontWeight:'600',color:'#153C32'}}>{busy?'Registering phone…':'Enable phone alerts'}</Text></Pressable>{retry?<Pressable accessibilityRole="button" onPress={()=>void openResponse(retry)} style={{padding:12,backgroundColor:'#EAF0E7'}}><Text>Open alert again</Text></Pressable>:null}{message?<Text style={{fontSize:13,color:'#53665B'}}>{message}</Text>:null}</View>;
}
