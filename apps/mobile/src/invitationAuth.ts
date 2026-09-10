export type InvitationProof={token_hash:string;type:'invite'|'magiclink'};
export type InvitationCodeProof={email:string;token:string;type:'email'};

// Only accept our invitation route and Supabase email proofs. An invitation UUID,
// arbitrary redirect or recovery link cannot be used here as a login credential.
export function invitationProof(raw:string):InvitationProof|null{
 if(raw.length>2048)return null;
 try{
  const url=new URL(raw);
  if(url.protocol!=='kleverassets:'||url.hostname!=='join'||url.port||url.username||url.password||!['','/'].includes(url.pathname)||url.hash)return null;
  if([...url.searchParams.keys()].some(key=>!['token_hash','type'].includes(key)))return null;
  const hashes=url.searchParams.getAll('token_hash'),types=url.searchParams.getAll('type');
  if(hashes.length!==1||types.length!==1||!['invite','magiclink'].includes(types[0])||!/^[A-Za-z0-9_-]{20,256}$/.test(hashes[0]))return null;
  return {token_hash:hashes[0],type:types[0] as InvitationProof['type']};
 }catch{return null;}
}

type InvitationAuth={
 getSession:()=>Promise<{data:{session:unknown};error:unknown}>;
 verifyOtp:(proof:InvitationProof|InvitationCodeProof)=>Promise<{data:{session:unknown};error:unknown}>;
};
export async function openInvitation(proof:InvitationProof|InvitationCodeProof,auth:InvitationAuth):Promise<void>{
 const current=await auth.getSession().catch(()=>{throw new Error('Unable to check your sign-in. Reopen the app and try again.');});
 if(current.error)throw new Error('Unable to check your sign-in. Reopen the app and try again.');
 if(current.data.session)throw new Error('You are already signed in. Close this message and sign out first, then reopen the invitation from your email.');
 const result=await auth.verifyOtp(proof).catch(()=>{throw new Error('Unable to verify your invitation. Check your connection and try again.');});
 if(result.error||!result.data.session)throw new Error('This code or sign-in link is invalid, has expired or has already been used. Check your email or ask your administrator for a new invitation email.');
}
