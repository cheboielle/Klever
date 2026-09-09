import type {Access,Asset} from '@klever/domain';
type Target={kind:'ignored'|'denied'|'unlock'|'tasks'|'assets'|'unavailable'}|{kind:'asset';asset:Asset};
export async function notificationTarget(data:unknown,unlocked:boolean,loadAccess:()=>Promise<Access>,loadAsset:(id:string)=>Promise<Asset|null>):Promise<Target>{
 if(!data||typeof data!=='object'||Array.isArray(data))return {kind:'ignored'};
 const payload=data as Record<string,unknown>,assetId=payload.assetId;
 if(assetId!=null&&(typeof assetId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(assetId)))return {kind:'ignored'};
 if(assetId==null&&typeof payload.kind!=='string')return {kind:'ignored'};
 // Notification text is a hint only. Current server access and asset rows decide what opens.
 const access=await loadAccess();
 if(!access.allowed)return {kind:'denied'};
 if(access.app_lock&&!unlocked)return {kind:'unlock'};
 if(assetId){const asset=await loadAsset(assetId as string);return asset&&!asset.archived?{kind:'asset',asset}:{kind:'unavailable'};}
 return {kind:payload.kind==='task_due'?'tasks':'assets'};
}
