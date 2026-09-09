// No reusable download link: authorize each POST before streaming private bytes.
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const headers={...cors,'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache'};
Deno.serve(async(request:Request)=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers});
  try{
    const authorization=request.headers.get('authorization');
    if(!authorization?.startsWith('Bearer '))return new Response('Sign in required',{status:401,headers});
    const {submissionId,kind='service'}=await request.json();
    if(kind!=='service'&&kind!=='task'&&kind!=='profile')return new Response('Invalid photo type',{status:400,headers});
    if(typeof submissionId!=='string'||!/^[0-9a-f-]{36}$/i.test(submissionId))return new Response('Invalid photo request',{status:400,headers});
    const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!;
    const access=await fetch(base+'/rest/v1/rpc/authorize_'+kind+'_photo',{method:'POST',headers:{apikey:key,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({p_id:submissionId}),cache:'no-store'});
    if(!access.ok)return new Response('Photo unavailable',{status:403,headers});
    const path=await access.json();
    if(typeof path!=='string')return new Response('Photo unavailable',{status:403,headers});
    const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const photo=await fetch(base+'/storage/v1/object/authenticated/evidence/'+path,{headers:{apikey:secret,Authorization:'Bearer '+secret},cache:'no-store'});
    if(!photo.ok)return new Response('Photo could not be loaded',{status:502,headers});
    return new Response(photo.body,{headers:{...headers,'Content-Type':'image/jpeg','X-Content-Type-Options':'nosniff'}});
  }catch{return new Response('Photo could not be loaded',{status:500,headers});}
});
