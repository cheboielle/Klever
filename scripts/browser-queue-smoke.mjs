// Isolated browser queued reading/access checks; not physical phone restart proof.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(resolve('tmp/browser-qa/package.json'));const {chromium}=require('playwright');
const base=process.env.EXPO_PUBLIC_SUPABASE_URL,key=process.env.KLEVER_ADMIN_KEY,pub=process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if(base!=='https://blzubtujrxpcnfphcrny.supabase.co'||!key||!pub)throw Error('Explicit development connection required');
const secrets=[key],users=[],tenants=[],stamp=randomUUID();let browser,phase='setup',passed=0;
const pass=label=>{passed++;console.log('PASS '+label);};
async function request(path,{token=key,method='POST',body}={}){
 const r=await fetch(base+path,{method,headers:{apikey:pub,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok){if(path.startsWith('/rest/v1/rpc/')){const failure=await r.json().catch(()=>null);console.error('Database check: '+(failure?.message??r.status));}throw Error('Development request failed');}return r.json().catch(()=>null);
}
const rpc=(name,body,token)=>{if(phase.startsWith('setup'))phase='setup '+name;return request('/rest/v1/rpc/'+name,{body,token});};
const button=(page,name)=>page.getByRole('button',{name,exact:true}),field=(page,name)=>page.getByRole('textbox',{name,exact:true});
async function account(label){
 const email=`klever-queue-ui-${stamp}-${label}@example.invalid`,password=randomBytes(24).toString('base64url');
 const user=await request('/auth/v1/admin/users',{body:{email,password,email_confirm:true}});users.push(user.id);
 const session=await request('/auth/v1/token?grant_type=password',{token:pub,body:{email,password}});secrets.push(password,session.access_token,session.refresh_token);return {id:user.id,email,password,token:session.access_token};
}
async function login(page,user){await page.goto('http://127.0.0.1:8085/');await field(page,'Email').fill(user.email);await field(page,'Password').fill(user.password);await button(page,'Sign in').click();await page.getByRole('tab',{name:/Assets/}).waitFor();}


async function openAsset(page,name){await page.getByRole('button',{name:new RegExp(name)}).click();await button(page,'Save reading').waitFor();}
async function reading(page,name,value){await openAsset(page,name);await field(page,'Current meter reading (hours)').fill(String(value));await button(page,'Save reading').click();await button(page,'Save reading').waitFor({state:'detached'});}
async function until(fn){for(let i=0;i<30;i++){if(await fn())return;await new Promise(r=>setTimeout(r,500));}throw Error('Expected server state did not arrive');}
try{
 const owner=await account('owner'),tech=await account('tech');const tenant=await rpc('provision_business',{p_owner:owner.id,p_name:'TEST ONLY queue UI '+stamp,p_owner_name:'QA Owner',p_write_until:new Date(Date.now()+3600000).toISOString()});tenants.push(tenant);await rpc('provision_staff',{p_tenant:tenant,p_user:tech.id,p_name:'QA Technician'});
 const type=await rpc('save_asset_type',{p_name:'QA equipment'},owner.token),assets=[];
 for(const [name,initial] of [['QA queue A',100],['QA queue B',200]]){const id=await rpc('save_asset',{p_name:name,p_type:type,p_serial:name,p_initial_hours:initial,p_meter_unit:'hours'},owner.token);assets.push(id);await rpc('assign_asset',{p_asset:id,p_user:tech.id,p_assigned:true},owner.token);}
 const value=async id=>Number((await request('/rest/v1/assets?id=eq.'+id+'&select=current_hours',{method:'GET'}))[0].current_hours);
 browser=await chromium.launch({channel:'chrome',headless:true});const oc=await browser.newContext({viewport:{width:412,height:915}}),tc=await browser.newContext({viewport:{width:412,height:915}}),op=await oc.newPage(),tp=await tc.newPage();[op,tp].forEach(p=>p.setDefaultTimeout(30000));await login(op,owner);await login(tp,tech);
 phase='stale offline reading does not reduce meter and unrelated entry syncs';await tc.setOffline(true);await reading(tp,'QA queue A',110);await reading(tp,'QA queue B',205);await tp.getByText('Saved on this device · 2 awaiting sync',{exact:true}).waitFor();await reading(op,'QA queue A',120);await until(async()=>await value(assets[0])===120);await tc.setOffline(false);await button(tp,'Sync now').click();await tp.getByText('The asset reading changed. An administrator needs to review this entry.',{exact:true}).waitFor();await until(async()=>await value(assets[1])===205);assert.equal(await value(assets[0]),120);await tp.getByText('Saved on this device · 1 awaiting sync',{exact:true}).waitFor();
 pass('Stale offline reading stays visible for review without reducing the meter; unrelated queued reading syncs');
 phase='technician review refuses lower value and accepts corrected newer reading';await button(tp,'Review and correct reading').click();await field(tp,'Reviewed meter reading').fill('115');await field(tp,'Reason for reviewing queued reading').fill('QA review');await button(tp,'Confirm corrected reading').click();await tp.getByText('An administrator must correct an accepted reading before a lower value can be saved.',{exact:true}).waitFor();assert.equal(await value(assets[0]),120);await field(tp,'Reviewed meter reading').fill('125');await button(tp,'Confirm corrected reading').click();await until(async()=>await value(assets[0])===125);await tp.getByText(/awaiting sync$/).waitFor({state:'detached'});assert.equal((await request('/rest/v1/hour_logs?asset_id=eq.'+assets[0]+'&select=id',{method:'GET'})).length,2);
 pass('Technician cannot reduce an accepted reading during review; corrected reading saves once and clears queue');
 phase='queued reading after reassignment stays blocked';await openAsset(tp,'QA queue B');await tc.setOffline(true);await field(tp,'Current meter reading (hours)').fill('210');await button(tp,'Save reading').click();await tp.getByText('Saved on this device · 1 awaiting sync',{exact:true}).waitFor();await rpc('assign_asset',{p_asset:assets[1],p_user:tech.id,p_assigned:false},owner.token);await tc.setOffline(false);await button(tp,'Sync now').click();await tp.getByText(/QA queue B: 210 hours.*Needs review/).waitFor();assert.equal(await value(assets[1]),205);
 pass('Reassignment blocks queued asset writing on reconnect and retains a visible blocked copy');
 phase='deactivation clears pending work and denies access';await rpc('manage_staff',{p_user:tech.id,p_action:'deactivate'},owner.token);await button(tp,'Sync now').click();await button(tp,'Sign in').waitFor();assert.equal(await tp.getByText(/awaiting sync$/).count(),0);assert.equal(await value(assets[1]),205);
 pass('Confirmed deactivation clears the browser workspace and pending copy without applying forbidden reading');
 console.log(`${passed} browser queue/access checks passed; native restart persistence remains unverified.`);
}catch(error){
 mkdirSync('tmp/browser-queue',{recursive:true});let detail=error instanceof Error?error.message:'Unknown test error';for(const secret of secrets)if(secret)detail=detail.replaceAll(secret,'[redacted]');writeFileSync('tmp/browser-queue/failure-error.txt',detail);
 if(browser){mkdirSync('tmp/browser-queue',{recursive:true});let i=0;for(const c of browser.contexts())for(const p of c.pages()){await p.screenshot({path:`tmp/browser-queue/failure-${i}.png`,fullPage:true,mask:[p.locator('input')]}).catch(()=>{});writeFileSync(`tmp/browser-queue/failure-${i++}.txt`,await p.locator('body').innerText().catch(()=>''));}}
 console.error('Browser queue check failed during: '+phase);process.exitCode=1;
}finally{
 await browser?.close();mkdirSync('tmp',{recursive:true});const photos=[];
 // Collect only this run's tenant photo reservations, including a failed finalization.
 for(const tenant of tenants){try{for(const row of await request(`/rest/v1/profile_photo_uploads?tenant_id=eq.${tenant}&select=object_path`,{method:'GET'}))if(row.object_path)photos.push(row.object_path);}catch{console.error('Photo cleanup listing requires retry');process.exitCode=1;}}
 writeFileSync('tmp/browser-queue-users.json',JSON.stringify(users));writeFileSync('tmp/browser-queue-photos.json',JSON.stringify(photos));
 const ids=tenants.map(id=>{assert.ok(/^[a-f0-9-]{36}$/.test(id));return `'${id}'`;}).join(',');
 if(ids)writeFileSync('tmp/browser-queue-cleanup.sql',`begin;\nupdate public.tenants set write_until=now()-interval '1 day' where id in (${ids});\ndelete from private.service_notification_state where tenant_id in (${ids});\n${['profile_photos','profile_photo_uploads','issue_resolutions','issues','compliance_items','staff_invitations','notification_rules','device_tokens','notification_outbox','service_corrections','service_admin_details','service_history','service_uploads','asset_service_settings','service_types','hour_logs','asset_history','asset_assignments','assets','asset_types','memberships','tenants'].map(t=>`delete from public.${t} where ${t==='tenants'?'id':'tenant_id'} in (${ids});`).join('\n')}\ncommit;`);
 console.log('Exact queue test cleanup manifests written.');
}
