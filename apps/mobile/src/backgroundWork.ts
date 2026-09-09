import {supabase} from './client';
import {activateOffline,clearOffline} from './offlineStore';
import {flushQueue} from './offlineSync';
// Shared with the OS task adapter so its account/error behaviour can be tested without a phone.
export async function runBackgroundSync():Promise<boolean>{
 if(!supabase)return true;
 try{
  const {data,error}=await supabase.auth.getSession();
  if(error)return false; // A failed refresh must preserve offline work.
  if(!data.session){await clearOffline();return true;}
  const user=data.session.user.id;await activateOffline(user);
  const latest=await supabase.auth.getSession();
  if(latest.error||latest.data.session?.user.id!==user)return false;
  const result=await flushQueue({maxCommands:3});return result.online;
 }catch{return false;}
}
