import {expect,it,vi} from 'vitest';
import {notificationTarget} from '../apps/mobile/src/notificationTarget';
const id='00000000-0000-4000-8000-000000000001';
it('routes meter reminders to entry only after current asset access is confirmed',async()=>{
 const asset={id,archived:false,meter_unit:'km'} as any;
 expect(await notificationTarget({kind:'hour_log',assetId:id},async()=>({allowed:true}),async()=>asset)).toEqual({kind:'reading',asset});
 expect(await notificationTarget({kind:'hour_log',assetId:id},async()=>({allowed:true}),async()=>null)).toEqual({kind:'unavailable'});
 const load=vi.fn();expect(await notificationTarget({kind:'hour_log',assetId:id},async()=>({allowed:false}),load)).toEqual({kind:'denied'});expect(load).not.toHaveBeenCalled();
});
it('checks current access before reading notification assets',async()=>{
 const loadAsset=vi.fn();expect(await notificationTarget({assetId:id},async()=>({allowed:false}),loadAsset)).toEqual({kind:'denied'});expect(loadAsset).not.toHaveBeenCalled();
});
it('handles withdrawn assignments and archived assets without using notification text as asset data',async()=>{
 expect(await notificationTarget({assetId:id,name:'Outdated asset'},async()=>({allowed:true}),async()=>null)).toEqual({kind:'unavailable'});
 expect(await notificationTarget({assetId:id},async()=>({allowed:true}),async()=>({id,archived:true} as any))).toEqual({kind:'unavailable'});
});
it('opens only the current permitted asset and permits read-only access',async()=>{
 const asset={id,name:'Current server name',archived:false} as any;
 expect(await notificationTarget({assetId:id,name:'Old name'},async()=>({allowed:true,can_write:false}),async()=>asset)).toEqual({kind:'asset',asset});
});
it('leaves a network failure retryable instead of falling back to cached permission',async()=>{
 const loadAsset=vi.fn();await expect(notificationTarget({assetId:id},async()=>{throw Error('Network unavailable');},loadAsset)).rejects.toThrow(/Network/);expect(loadAsset).not.toHaveBeenCalled();
});
it('opens company task alerts and ignores malformed or URL payloads',async()=>{
 const load=vi.fn(async()=>({allowed:true}));
 expect(await notificationTarget({kind:'task_due',assetId:null},load,vi.fn())).toEqual({kind:'tasks'});
 load.mockClear();expect(await notificationTarget({assetId:'https://unexpected.example'},load,vi.fn())).toEqual({kind:'ignored'});
 expect(await notificationTarget({url:'https://unexpected.example'},load,vi.fn())).toEqual({kind:'ignored'});expect(load).not.toHaveBeenCalled();
});
