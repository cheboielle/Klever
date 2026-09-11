import type {Access,Asset} from '@klever/domain';
type Target={kind:'ignored'|'denied'|'tasks'|'assets'|'unavailable'}|{kind:'asset'|'reading';asset:Asset}|{kind:'task';taskId:string;asset:Asset|null};
export async function notificationTarget(data:unknown,loadAccess:()=>Promise<Access>,loadAsset:(id:string)=>Promise<Asset|null>):Promise<Target>{
 if(!data||typeof data!=='object'||Array.isArray(data))return {kind:'ignored'};
 const payload=data as Record<string,unknown>,assetId=payload.assetId;
 const taskId=payload.kind==='task_due'?payload.recordId:null;
 if(taskId!=null&&(typeof taskId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(taskId)))return {kind:'ignored'};
 if(assetId!=null&&(typeof assetId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(assetId)))return {kind:'ignored'};
 if(assetId==null&&typeof payload.kind!=='string')return {kind:'ignored'};
 // Notification text is a hint only. Current server access and asset rows decide what opens.
 const access=await loadAccess();
 if(!access.allowed)return {kind:'denied'};
 if(assetId){const asset=await loadAsset(assetId as string);if(!asset||asset.archived)return {kind:'unavailable'};return taskId?{kind:'task',taskId:taskId as string,asset}:{kind:payload.kind==='hour_log'?'reading':'asset',asset};}
 if(taskId)return {kind:'task',taskId:taskId as string,asset:null};
 return {kind:payload.kind==='task_due'?'tasks':'assets'};
}
