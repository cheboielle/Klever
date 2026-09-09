import {nativeInteraction} from './nativeInteraction';
import {Platform} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import {rpc,supabase} from './client';
let pending:Promise<boolean>|null=null;
export async function registerPhoneAlerts(requestPermission=false):Promise<boolean>{
 if(pending){if(!requestPermission)return pending;await pending.catch(()=>{});return registerPhoneAlerts(true);}
 pending=register(requestPermission);try{return await pending;}finally{pending=null;}
}
async function register(requestPermission:boolean){
 if(!supabase)return false;const {data,error}=await supabase.auth.getSession();if(error||!data.session)return false;
 if(requestPermission&&Platform.OS==='android')await Notifications.setNotificationChannelAsync('default',{name:'Maintenance alerts',importance:Notifications.AndroidImportance.HIGH});
 const permission=requestPermission?await nativeInteraction(()=>Notifications.requestPermissionsAsync()):await Notifications.getPermissionsAsync();
 let installation=await SecureStore.getItemAsync('klever-installation-id');
 if(permission.status!=='granted'){
  if(installation)await rpc('unregister_device_token',{p_installation:installation});
  if(requestPermission)throw Error('Notifications are not enabled. You can allow them in your phone settings.');return false;
 }
 if(!installation){installation=Crypto.randomUUID();await SecureStore.setItemAsync('klever-installation-id',installation);}
 let token;try{token=await Notifications.getExpoPushTokenAsync({projectId:'a33d4b36-8e52-4f3f-9de9-b960fac88b3b'});}catch(e){if(e instanceof Error&&/firebase|googleServicesFile/i.test(e.message))throw Error('Phone alerts are not configured for this Android test version yet. You can keep using the app; alert setup is the next step.');throw e;}
 const current=await supabase.auth.getSession();if(current.error||current.data.session?.user.id!==data.session.user.id)return false;
 await rpc('register_device_token',{p_installation:installation,p_token:token.data,p_platform:Platform.OS});return true;
}
