// Temporary local Stage A provisioning page; never deploy this helper.
// The owner enters a password directly. Neither password nor admin key is logged or saved.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
const base=process.env.EXPO_PUBLIC_SUPABASE_URL,admin=process.env.KLEVER_ADMIN_KEY;
const email=process.env.KLEVER_OWNER_EMAIL;
if(base!=='https://blzubtujrxpcnfphcrny.supabase.co'||!admin||!email)throw Error('Explicit development owner configuration required');
const port=8082,origin=`http://127.0.0.1:${port}`,csrf=randomBytes(32).toString('hex');
let busy=false,done=false;
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function page(message=''){
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Klever — choose your password</title><style>body{margin:0;background:#f5f6f0;color:#153c32;font:17px system-ui;padding:28px}main{max-width:430px;margin:8vh auto;background:white;padding:32px;border-radius:20px}h1{font-size:30px}label{display:block;margin-top:20px}input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #cbd6cc;border-radius:10px;font:inherit;margin-top:8px}button,a{display:block;background:#226a50;color:white;border:0;border-radius:10px;padding:15px;text-align:center;font:inherit;margin-top:24px;text-decoration:none}p{line-height:1.6}small{color:#6b7870}</style><main><small>KLEVER ASSETS</small><h1>${done?'Your workspace is ready':'Choose your password'}</h1><p>${escape(email)}</p>${message?`<p role="status">${escape(message)}</p>`:''}${done?'<a href="http://localhost:8081/">Open Klever and sign in</a>':`<p>This creates your owner login for the early test app.</p><form method="post" action="/setup"><input type="hidden" name="csrf" value="${csrf}"><label>New password<input type="password" name="password" autocomplete="new-password" minlength="6" maxlength="128" required></label><label>Repeat password<input type="password" name="confirm" autocomplete="new-password" minlength="6" maxlength="128" required></label><small>Use at least 6 characters. You do not need to send it in chat.</small><button>Create my owner login</button></form>`}</main></html>`;
}
async function api(path,body,method='POST'){
  const response=await fetch(base+path,{method,headers:{apikey:admin,Authorization:`Bearer ${admin}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error('Account setup could not finish. Please tell the builder; your password has not been logged.');
  return data;
}
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('Referrer-Policy','same-origin');
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);res.end();return;}
  if(req.method==='GET'&&(req.url==='/'||req.url==='/setup')){res.end(page());return;}
  if(done){res.end(page());return;}
  if(busy){res.end(page('Setup is already processing. Please wait a moment before trying again.'));return;}
  if(req.method!=='POST'||req.url!=='/setup'){res.writeHead(404);res.end(page('Open the setup form below to continue.'));return;}
  // Privacy settings may omit Origin or send "null". The unguessable form token
  // remains mandatory, along with the loopback Host and cross-site checks.
  if((req.headers.origin&&req.headers.origin!=='null'&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site'){
    res.end(page('Please enter your password again using this refreshed setup form.'));return;
  }
  let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){res.writeHead(413);res.end();return;}}
  const form=new URLSearchParams(body),password=form.get('password')??'';
  if(form.get('csrf')!==csrf){res.end(page('The setup page was restarted. Please enter your password again below.'));return;}
  if(password.length<6||password.length>128||password!==form.get('confirm')){res.end(page('Passwords must match and contain 6–128 characters.'));return;}
  busy=true;let created;
  try{
    created=await api('/auth/v1/admin/users',{email,password,email_confirm:true});
    const tenant=await api('/rest/v1/rpc/provision_business',{p_owner:created.id,p_name:'Klever',p_owner_name:'Che',p_write_until:new Date(Date.now()+90*86400000).toISOString()});
    done=true;res.end(page('Sign in with your email and the password you just chose.'));
    console.log(JSON.stringify({status:'owner_provisioned',email,user_id:created.id,tenant_id:tenant,internal_access_days:90}));
    server.close();
  }catch{
    if(created?.id)await api('/auth/v1/admin/users/'+created.id,undefined,'DELETE').catch(()=>{});
    res.end(page('Setup could not finish. Tell the builder so it can be checked before you try again.'));
    console.log('Owner setup failed; no credentials logged.');
  }finally{busy=false;}
});
server.listen(port,'127.0.0.1',()=>console.log(`Private owner setup ready at ${origin}/`));

