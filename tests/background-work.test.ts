import {beforeEach,describe,it,expect,vi} from 'vitest';
const env=vi.hoisted(()=>({session:vi.fn(),activate:vi.fn(),clear:vi.fn(),flush:vi.fn()}));
vi.mock('../apps/mobile/src/client',()=>({supabase:{auth:{getSession:env.session}}}));
vi.mock('../apps/mobile/src/offlineStore',()=>({activateOffline:env.activate,clearOffline:env.clear}));
vi.mock('../apps/mobile/src/offlineSync',()=>({flushQueue:env.flush}));
import {runBackgroundSync} from '../apps/mobile/src/backgroundWork';
beforeEach(()=>{vi.clearAllMocks();env.session.mockResolvedValue({data:{session:{user:{id:'user-a'}}},error:null});env.flush.mockResolvedValue({online:true,synced:1});});
describe('background queue entry',()=>{
 it('restores the current account and limits each OS run',async()=>{expect(await runBackgroundSync()).toBe(true);expect(env.activate).toHaveBeenCalledWith('user-a');expect(env.flush).toHaveBeenCalledWith({maxCommands:3});});
 it('preserves queued data when token refresh fails',async()=>{env.session.mockResolvedValue({data:{session:null},error:Error('Network unavailable')});expect(await runBackgroundSync()).toBe(false);expect(env.clear).not.toHaveBeenCalled();expect(env.flush).not.toHaveBeenCalled();});
 it('clears local account data only when signed out is confirmed',async()=>{env.session.mockResolvedValue({data:{session:null},error:null});expect(await runBackgroundSync()).toBe(true);expect(env.clear).toHaveBeenCalledOnce();expect(env.flush).not.toHaveBeenCalled();});
 it('does not flush when the account changes while opening local storage',async()=>{env.session.mockResolvedValueOnce({data:{session:{user:{id:'user-a'}}},error:null}).mockResolvedValueOnce({data:{session:{user:{id:'user-b'}}},error:null});expect(await runBackgroundSync()).toBe(false);expect(env.flush).not.toHaveBeenCalled();expect(env.clear).not.toHaveBeenCalled();});
});
