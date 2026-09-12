import {cacheKey,currentOffline,networkFailure,readCache,saveCache} from './offlineStore';
import { createClient,type Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key);
const authStorageKey=url?`sb-${new URL(url).hostname.split('.')[0]}-auth-token`:'klever-unconfigured';
// Browser preview sessions are memory-only. The Stage B portal gets its own
// server-cookie session flow; native credentials always use encrypted storage.
const memory = new Map<string,string>();
const storage = {
  getItem: (name:string) => Platform.OS==='web' ? Promise.resolve(memory.get(name) ?? null) : SecureStore.getItemAsync(name),
  setItem: (name:string,value:string) => Platform.OS==='web' ? Promise.resolve(void memory.set(name,value)) : SecureStore.setItemAsync(name,value),
  removeItem: (name:string) => Platform.OS==='web' ? Promise.resolve(void memory.delete(name)) : SecureStore.deleteItemAsync(name),
};
export const supabase = configured ? createClient(url!,key!,{
  auth:{storage,storageKey:authStorageKey,autoRefreshToken:true,persistSession:true,detectSessionInUrl:false},
}) : null;

export async function rpc<T>(name:string,args?:Record<string,unknown>):Promise<T>{
  if(!supabase) throw new Error('The app connection has not been configured.');
  const owner=currentOffline();const cachedReads=['workspace_overview','list_asset_services','list_past_asset_services','list_service_history','list_tasks','list_task_history','list_asset_issues','list_compliance','get_profile_photo','get_starter_library'];
  const key=cacheKey(name,args);
  const {data,error}=await supabase.rpc(name,args);
  if(error){if(cachedReads.includes(name)&&networkFailure(error)&&owner===currentOffline()){const cached=readCache<T>(key);if(cached!==undefined)return cached;}throw Object.assign(new Error(error.message),{code:error.code});}
  if(cachedReads.includes(name)&&owner===currentOffline())await saveCache(key,name.includes('history')&&Array.isArray(data)?data.slice(0,50):data);
  return data as T;
}

// Evidence uses a non-cached POST download because direct Storage GETs can be cached.
export async function downloadServicePhoto(submissionId:string,kind:'service'|'task'|'profile'='service'):Promise<Blob>{
  if(!supabase)throw new Error('The app connection has not been configured.');
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)throw new Error('Sign in to view this photo.');
  const response=await fetch(`${url}/functions/v1/service-photo`,{method:'POST',headers:{apikey:key!,Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({submissionId,kind}),cache:'no-store'});
  if(!response.ok)throw new Error('Photo unavailable. Check your access and connection.');
  return response.blob();
}

// Read only after a network refresh failure. This identifies the cached account;
// server authorization still uses Supabase, and offline writes use the last verified access window.
export async function storedSessionForOffline():Promise<Session|null>{
 const raw=await storage.getItem(authStorageKey);if(!raw)return null;
 try{const value=JSON.parse(raw);return value?.user?.id&&typeof value.access_token==='string'&&typeof value.refresh_token==='string'?value as Session:null;}catch{return null;}
}
