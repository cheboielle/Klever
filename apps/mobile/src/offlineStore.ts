import AsyncStorage from '@react-native-async-storage/async-storage';
import {OfflineQueue,type OfflineState} from '../../../packages/domain/src/offline';
import {clearMedia} from './offlineMedia';
let active:OfflineQueue|null=null;let switching:Promise<void>=Promise.resolve();
const listeners=new Set<()=>void>();
export const subscribeOffline=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const notifyOffline=()=>listeners.forEach(fn=>fn());
export const currentOffline=()=>active;
export async function activateOffline(userId:string){
 const run=switching.then(async()=>{if(active?.userId===userId)return;active=null;const key='klever-offline-v1:'+userId;const raw=await AsyncStorage.getItem(key);const value=raw?JSON.parse(raw) as OfflineState:null;await AsyncStorage.setItem('klever-offline-last-user',userId);active=new OfflineQueue(userId,{read:async()=>null,write:s=>AsyncStorage.setItem(key,JSON.stringify(s)),remove:()=>AsyncStorage.removeItem(key)},value);notifyOffline();});switching=run.catch(()=>{});return run;
}
export async function clearOffline(){
 const run=switching.then(async()=>{const previous=active;const user=previous?.userId??await AsyncStorage.getItem('klever-offline-last-user');active=null;
  try{if(previous)await previous.clear();else if(user)await AsyncStorage.removeItem('klever-offline-v1:'+user);if(user)await clearMedia(user);await AsyncStorage.removeItem('klever-offline-last-user');}finally{notifyOffline();}
 });switching=run.catch(()=>{});return run;
}
export function networkFailure(e:unknown){return /network|failed to fetch|fetch failed|load failed|timed?\s*out|connection refused/i.test(e instanceof Error?e.message:String((e as {message?:string})?.message??e));}
export function cacheKey(name:string,args?:Record<string,unknown>){return name+':'+JSON.stringify(args??{});}
export async function saveCache(key:string,data:unknown){const q=active;if(q)await q.change(s=>{s.cache[key]=data;});}
export function readCache<T>(key:string):T|undefined{return active?.snapshot().cache[key] as T|undefined;}
