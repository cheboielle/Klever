import {beforeEach,describe,it,expect,vi} from 'vitest';
const env=vi.hoisted(()=>({rpc:vi.fn(),get:vi.fn(),q:{},cached:[{id:'cached-service'}],save:vi.fn()}));
vi.mock('../apps/mobile/node_modules/expo-secure-store',()=>({getItemAsync:env.get,setItemAsync:vi.fn(),deleteItemAsync:vi.fn()}));
vi.mock('../apps/mobile/node_modules/react-native',()=>({Platform:{OS:'android'}}));
vi.mock('../apps/mobile/src/offlineStore',()=>({cacheKey:(n:string)=>n,currentOffline:()=>env.q,networkFailure:(e:any)=>/network/i.test(e.message),readCache:()=>env.cached,saveCache:env.save}));
vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL','https://example.supabase.co');vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY','test-publishable');
const {rpc,storedSessionForOffline,supabase}=await import('../apps/mobile/src/client');
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(supabase!,'rpc').mockImplementation(env.rpc);});
describe('offline read boundaries',()=>{
 it('uses cached reads only for network failure, never an authorization denial',async()=>{
  env.rpc.mockResolvedValueOnce({data:null,error:{message:'Network unavailable'}});expect(await rpc('list_asset_services',{p_asset:'a'})).toEqual(env.cached);
  env.rpc.mockResolvedValueOnce({data:null,error:{message:'Asset unavailable',code:'42501'}});await expect(rpc('list_asset_services',{p_asset:'a'})).rejects.toThrow('Asset unavailable');expect(env.save).not.toHaveBeenCalled();
 });
 it('never substitutes a cached value for a write',async()=>{env.rpc.mockResolvedValueOnce({data:null,error:{message:'Network unavailable'}});await expect(rpc('save_task',{})).rejects.toThrow('Network unavailable');});
 it('can identify an expired stored session for offline cache without changing credentials or extending expiry',async()=>{
  const expired={access_token:'synthetic-expired',refresh_token:'synthetic-refresh',expires_at:1,user:{id:'a'}};env.get.mockResolvedValueOnce(JSON.stringify(expired));expect(await storedSessionForOffline()).toEqual(expired);expect(env.rpc).not.toHaveBeenCalled();env.get.mockResolvedValueOnce(null);expect(await storedSessionForOffline()).toBe(null);
 });
});
