import {supabase} from './client';

export async function sendStaffInvitation(id:string):Promise<string>{
 const result=await supabase!.functions.invoke('staff-invitation',{body:{invitationId:id,action:'send'}});
 if(result.error)throw new Error('Invitation saved, but email sending could not be confirmed. Refresh the invitations before retrying.');
 switch(result.data?.status){
  case 'sent':return 'Invitation email accepted for sending. Ask them to check their inbox and spam folder.';
  case 'not_configured':return 'Invitation saved. No email was sent because invitation email delivery is not set up yet.';
  case 'wait':return 'Please wait two minutes between invitation emails, then refresh or retry.';
  case 'failed':return 'Invitation saved, but the email could not be sent. Please retry later.';
  case 'unknown':return 'We could not confirm whether the email was sent. Check with the recipient before resending; only the latest code will work.';
  default:throw new Error('Invitation saved, but email sending could not be confirmed. Refresh before retrying.');
 }
}
