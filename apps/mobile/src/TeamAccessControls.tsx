import React,{useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import type {Asset} from '@klever/domain';
import {rpc,supabase} from './client';
type Action='activate'|'deactivate'|'sign_out'|'promote'|'demote'|'transfer';
const labels:Record<Action,string>={activate:'Reactivate',deactivate:'Deactivate',sign_out:'Remote sign out',promote:'Make admin',demote:'Make technician',transfer:'Transfer ownership'};
export function TeamAccessControls({member,ownerId,viewerId,viewerIsOwner,writable,online,assets,onSaved,onOpenAsset}:{member:{user_id:string;name:string;role:string;is_active:boolean};ownerId:string|null;viewerId:string;viewerIsOwner:boolean;writable:boolean;online:boolean;assets:Asset[];onSaved:()=>Promise<void>;onOpenAsset:(asset:Asset)=>Promise<void>}){
 const [action,setAction]=useState<Action|null>(null),[assigned,setAssigned]=useState<Asset[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const targetIsOwner=member.user_id===ownerId;
 async function choose(next:Action){if(busy)return;setBusy(true);setMessage('');try{
  if(next==='deactivate'){
   const result=await supabase!.from('asset_assignments').select('asset_id').eq('user_id',member.user_id);
   if(result.error)throw result.error;setAssigned(assets.filter(a=>result.data.some(row=>row.asset_id===a.id)));
  }else setAssigned([]);
  setAction(next);
 }catch{setMessage('Unable to load current assignments. Reconnect and retry.');}finally{setBusy(false);}}
 async function confirm(){if(!action||busy)return;setBusy(true);setMessage('');try{await rpc('manage_staff',{p_user:member.user_id,p_action:action});setAction(null);await onSaved();}catch(e){setMessage((e instanceof Error?e.message:'Unable to update access.')+' Refresh the team before retrying if the connection was lost.');}finally{setBusy(false);}}
 const button=(label:string,press:()=>void,disabled=false)=><Pressable accessibilityRole="button" disabled={disabled} onPress={press} style={{padding:12,borderRadius:10,backgroundColor:'#EAF0E7',opacity:disabled?.5:1}}><Text style={{color:'#153C32',fontWeight:'600'}}>{label}</Text></Pressable>;
 if(member.user_id===viewerId)return null;
 return <View style={{gap:10}}>{action?<>
 <Text style={{fontWeight:'700'}}>{labels[action]} — {member.name}?</Text>
 <Text>{action==='deactivate'?'Access will stop on their next online request. Unsynced phone entries will be cleared when it reconnects. History is kept.':action==='sign_out'?'Existing sessions will stop working. They can sign in again while active.':action==='activate'?'This team member can sign in again and will count toward the staff limit.':action==='promote'?'Admins can manage all assets, team details and maintenance records, including private costs.':action==='demote'?'They will see assigned equipment and business tasks only. Existing sessions will be signed out.':`This person becomes the business owner. You remain an admin and lose owner-only controls. The new owner controls future role and ownership changes.`}</Text>
 {action==='deactivate'&&assigned.length?<><Text>Review these assignments now, or deactivate first and reassign afterward:</Text>{assigned.map(asset=><View key={asset.id}>{button('Review '+asset.name,()=>void onOpenAsset(asset),busy)}</View>)}</>:null}
 {button('Confirm '+labels[action].toLowerCase(),()=>void confirm(),busy||!online||(!writable&&!['deactivate','sign_out'].includes(action)))}
 {button('Cancel',()=>setAction(null),busy)}
 </>:<>
 {member.is_active?<>{button('Remote sign out',()=>void choose('sign_out'),busy||!online)}{!targetIsOwner?button('Deactivate',()=>void choose('deactivate'),busy||!online):null}</>:!targetIsOwner?button('Reactivate',()=>void choose('activate'),busy||!writable):null}
 {viewerIsOwner&&member.is_active&&!targetIsOwner?<>{button(member.role==='admin'?'Make technician':'Make admin',()=>void choose(member.role==='admin'?'demote':'promote'),busy||!writable)}{button('Transfer ownership',()=>void choose('transfer'),busy||!writable)}</>:null}
 </>}{message?<Text accessibilityLiveRegion="polite">{message}</Text>:null}</View>;
}
