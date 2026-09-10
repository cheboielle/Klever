import {handleInvitation} from './handler.ts';
Deno.serve((request:Request)=>handleInvitation(request,{
 url:Deno.env.get('SUPABASE_URL')!,anonKey:Deno.env.get('SUPABASE_ANON_KEY')!,serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
 enabled:Deno.env.get('INVITATIONS_ENABLED')==='true',resendKey:Deno.env.get('RESEND_API_KEY'),from:Deno.env.get('NOTIFICATION_FROM'),
}));
