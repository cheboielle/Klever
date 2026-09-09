import React,{useState} from 'react';
import {Platform,Pressable,Text,View} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import {rpc} from './client';
Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:false})});
export function NotificationSetup(){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function enable(){if(busy)return;setBusy(true);setMessage('');try{
  if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('default',{name:'Maintenance alerts',importance:Notifications.AndroidImportance.HIGH});
  const granted=await Notifications.requestPermissionsAsync();if(granted.status!=='granted')throw Error('Notifications are not enabled. You can allow them in your phone settings.');
  let installation=await SecureStore.getItemAsync('klever-installation-id');if(!installation){installation=Crypto.randomUUID();await SecureStore.setItemAsync('klever-installation-id',installation);}
  const token=await Notifications.getExpoPushTokenAsync({projectId:'a33d4b36-8e52-4f3f-9de9-b960fac88b3b'});
  await rpc('register_device_token',{p_installation:installation,p_token:token.data,p_platform:Platform.OS});setMessage('This phone is registered for alerts. Delivery becomes available when your business notification service is activated.');
 }catch(e){setMessage(e instanceof Error?e.message:'Unable to enable alerts. Check your connection and retry.');}finally{setBusy(false);}}
 return <View style={{gap:8}}><Pressable accessibilityRole="button" disabled={busy} onPress={()=>void enable()} style={{padding:12,borderRadius:10,backgroundColor:'#EAF0E7'}}><Text style={{fontWeight:'600',color:'#153C32'}}>{busy?'Registering phone…':'Enable phone alerts'}</Text></Pressable>{message?<Text style={{fontSize:13,color:'#53665B'}}>{message}</Text>:null}</View>;
}
