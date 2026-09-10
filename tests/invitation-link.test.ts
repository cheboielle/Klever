import {expect,it,vi} from 'vitest';
import {invitationProof,openInvitation} from '../apps/mobile/src/invitationAuth';
const hash='a'.repeat(64),proof={token_hash:hash,type:'invite' as const};
it('accepts only the exact app invitation route and email proof types',()=>{
 expect(invitationProof(`kleverassets://join?token_hash=${hash}&type=invite`)).toEqual(proof);
 expect(invitationProof(`kleverassets://join/?token_hash=${hash}&type=magiclink`)?.type).toBe('magiclink');
 for(const url of [
  `https://join?token_hash=${hash}&type=invite`,
  `kleverassets://join.evil?token_hash=${hash}&type=invite`,
  `kleverassets://elsewhere/join?token_hash=${hash}&type=invite`,
  `kleverassets://join?token_hash=${hash}&type=recovery`,
  `kleverassets://join?token_hash=${hash}&type=invite&type=magiclink`,
  `kleverassets://join?token_hash=${hash}&token_hash=${hash}&type=invite`,
  `kleverassets://join?invitation_id=123&type=invite`,
  `kleverassets://join?token_hash=${hash}&type=invite&redirect_to=https://example.com`,
  `kleverassets://join?token_hash=${hash}&type=invite#access_token=unexpected`,
 ])expect(invitationProof(url)).toBeNull();
});
it('never consumes an invitation link over an existing or uncertain session',async()=>{
 const verifyOtp=vi.fn();
 await expect(openInvitation(proof,{getSession:async()=>({data:{session:{user:'owner'}},error:null}),verifyOtp})).rejects.toThrow('already signed in');
 await expect(openInvitation(proof,{getSession:async()=>({data:{session:null},error:new Error('offline')}),verifyOtp})).rejects.toThrow('Unable to check');
 expect(verifyOtp).not.toHaveBeenCalled();
});
it('requires successful Supabase verification and does not echo provider/token errors',async()=>{
 const getSession=async()=>({data:{session:null},error:null});
 const verifyOtp=vi.fn(async()=>({data:{session:{user:'recipient'}},error:null}));
 await openInvitation(proof,{getSession,verifyOtp});
 expect(verifyOtp).toHaveBeenCalledWith(proof);
 await expect(openInvitation(proof,{getSession,verifyOtp:async()=>({data:{session:null},error:{message:hash}})})).rejects.toThrow('expired or has already been used');
 await expect(openInvitation(proof,{getSession,verifyOtp:async()=>({data:{session:null},error:null})})).rejects.toThrow('expired or has already been used');
});
