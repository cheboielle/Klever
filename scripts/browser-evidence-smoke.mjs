// Isolated company task UI acceptance; browser disconnection is not native offline proof.
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
 const email=`klever-evidence-ui-${stamp}-${label}@example.invalid`,password=randomBytes(24).toString('base64url');
 const user=await request('/auth/v1/admin/users',{body:{email,password,email_confirm:true}});users.push(user.id);
 const session=await request('/auth/v1/token?grant_type=password',{token:pub,body:{email,password}});secrets.push(password,session.access_token,session.refresh_token);return {id:user.id,email,password,token:session.access_token};
}
async function login(page,user){await page.goto('http://127.0.0.1:8085/');await field(page,'Email').fill(user.email);await field(page,'Password').fill(user.password);await button(page,'Sign in').click();await page.getByRole('tab',{name:/Assets/}).waitFor();}


async function until(fn){for(let i=0;i<30;i++){if(await fn())return;await new Promise(r=>setTimeout(r,500));}throw Error('Expected server state did not arrive');}
try{
 const owner=await account('owner');const tenant=await rpc('provision_business',{p_owner:owner.id,p_name:'TEST ONLY evidence UI '+stamp,p_owner_name:'QA Owner',p_write_until:new Date(Date.now()+3600000).toISOString()});tenants.push(tenant);
 const type=await rpc('save_asset_type',{p_name:'QA equipment'},owner.token);const asset=await rpc('save_asset',{p_name:'QA evidence asset',p_type:type,p_serial:'QA-EVIDENCE',p_initial_hours:100,p_meter_unit:'hours'},owner.token);
 const today=(await rpc('list_tasks',{p_asset:null,p_archived:false},owner.token)).today;
 const task=await rpc('save_task',{p_id:null,p_asset:null,p_config:{name:'QA required evidence',completion_mode:'shared',instructions:'QA checklist',cadence:'daily',days:1,checklist:[{id:randomUUID(),label:'Inspect filter'}],notes_required:true,photo_required:true},p_due:today,p_revision:0},owner.token);
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:412,height:915},acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(30000);await login(page,owner);await page.getByRole('tab',{name:/Tasks/}).click();await page.getByRole('button',{name:/QA required evidence/}).click();
 phase='required task evidence validation';await button(page,'Complete task').click();await page.getByText('Check every checklist item before completing the task.',{exact:true}).waitFor();await page.getByRole('checkbox',{name:/Inspect filter/}).click();await button(page,'Complete task').click();await page.getByText('Add the required task notes.',{exact:true}).waitFor();await field(page,'Task notes').fill('QA filter inspected');await button(page,'Complete task').click();await page.getByText('Add the required task photo.',{exact:true}).waitFor();assert.equal((await request('/rest/v1/task_completions?task_id=eq.'+task.id+'&select=id',{method:'GET'})).length,0);
 pass('Checklist, notes and photo omissions are shown clearly and create no completion');
 phase='task photo upload confirmed sync and evidence view';const chooser=page.waitForEvent('filechooser');await button(page,'Choose photo').click();await (await chooser).setFiles('tmp/browser-service/evidence.png');await page.waitForFunction(()=>Array.from(document.images).some(i=>i.complete&&i.naturalWidth>0));await button(page,'Complete task').click();await page.getByText('Task saved and synced. Its completed record is shown below.',{exact:true}).waitFor();await button(page,'View task photo').click();const records=await rpc('list_task_history',{p_task:task.id},owner.token);assert.equal(records.length,1);assert.equal(records[0].notes,'QA filter inspected');assert.equal(records[0].checked_ids.length,1);assert.ok(records[0].object_path);
 await page.waitForFunction(()=>Array.from(document.images).some(i=>i.complete&&i.naturalWidth>0&&i.getAttribute('src')?.startsWith('data:image')));pass('Required task photo uploads and the completed checklist/notes/photo are available after confirmed sync');
 phase='read-only access retains queued reading';await button(page,'Back to tasks').click();await page.getByRole('tab',{name:/Assets/}).click();await page.getByRole('button',{name:/QA evidence asset/}).click();await context.setOffline(true);await field(page,'Current meter reading (hours)').fill('105');await button(page,'Save reading').click();await page.getByText('Saved on this device · 1 awaiting sync',{exact:true}).waitFor();
 await request('/rest/v1/tenants?id=eq.'+tenant,{method:'PATCH',body:{write_until:new Date(Date.now()-60000).toISOString()}});await context.setOffline(false);await button(page,'Sync now').click();await page.getByText('This workspace is read-only. Your records remain available.',{exact:true}).waitFor();await page.getByText('Saved on this device · 1 awaiting sync',{exact:true}).waitFor();assert.equal(Number((await request('/rest/v1/assets?id=eq.'+asset+'&select=current_hours',{method:'GET'}))[0].current_hours),100);
 pass('Read-only access preserves the pending reading and prevents it reaching the accepted meter');
 phase='read-only export and restored access sync';await page.getByRole('button',{name:/QA evidence asset/}).click();assert.equal(await button(page,'Edit asset details').isDisabled(),true);await page.getByRole('button',{name:/Export this asset/}).click();const download=page.waitForEvent('download');await button(page,'CSV').first().click();mkdirSync('tmp/browser-evidence',{recursive:true});await (await download).saveAs('tmp/browser-evidence/readonly-assets.csv');assert.ok(readFileSync('tmp/browser-evidence/readonly-assets.csv','utf8').includes('QA evidence asset'));await page.getByText('Close',{exact:true}).click();
 await request('/rest/v1/tenants?id=eq.'+tenant,{method:'PATCH',body:{write_until:new Date(Date.now()+3600000).toISOString()}});await button(page,'Sync now').click();await until(async()=>Number((await request('/rest/v1/assets?id=eq.'+asset+'&select=current_hours',{method:'GET'}))[0].current_hours)===105);await page.getByText(/awaiting sync$/).waitFor({state:'detached'});assert.equal((await request('/rest/v1/hour_logs?asset_id=eq.'+asset+'&select=id',{method:'GET'})).length,1);
 pass('Read-only admin exports work; restoring synthetic write access syncs the retained entry exactly once');
 console.log(`${passed} browser evidence/read-only checks passed; no real billing or native phone proof.`);
}catch(error){
 mkdirSync('tmp/browser-evidence',{recursive:true});let detail=error instanceof Error?error.message:'Unknown test error';for(const secret of secrets)if(secret)detail=detail.replaceAll(secret,'[redacted]');writeFileSync('tmp/browser-evidence/failure-error.txt',detail);
 if(browser){mkdirSync('tmp/browser-evidence',{recursive:true});let i=0;for(const c of browser.contexts())for(const p of c.pages()){await p.screenshot({path:`tmp/browser-evidence/failure-${i}.png`,fullPage:true,mask:[p.locator('input')]}).catch(()=>{});writeFileSync(`tmp/browser-evidence/failure-${i++}.txt`,await p.locator('body').innerText().catch(()=>''));}}
 console.error('Browser evidence check failed during: '+phase);process.exitCode=1;
}finally{
 await browser?.close();mkdirSync('tmp',{recursive:true});const photos=[];
 // Collect only this run's tenant photo reservations, including a failed finalization.
 for(const tenant of tenants){try{for(const row of await request(`/rest/v1/task_submissions?tenant_id=eq.${tenant}&select=object_path`,{method:'GET'}))if(row.object_path)photos.push(row.object_path);}catch{console.error('Photo cleanup listing requires retry');process.exitCode=1;}}
 writeFileSync('tmp/browser-evidence-users.json',JSON.stringify(users));writeFileSync('tmp/browser-evidence-photos.json',JSON.stringify(photos));
 const ids=tenants.map(id=>{assert.ok(/^[a-f0-9-]{36}$/.test(id));return `'${id}'`;}).join(',');
 if(ids)writeFileSync('tmp/browser-evidence-cleanup.sql',`begin;\nupdate public.tenants set write_until=now()-interval '1 day' where id in (${ids});\ndelete from private.service_notification_state where tenant_id in (${ids});\n${['task_corrections','task_completions','task_submissions','task_person_state','tasks','staff_invitations','notification_rules','device_tokens','notification_outbox','service_corrections','service_admin_details','service_history','service_uploads','asset_service_settings','service_types','hour_logs','asset_history','asset_assignments','assets','asset_types','memberships','tenants'].map(t=>`delete from public.${t} where ${t==='tenants'?'id':'tenant_id'} in (${ids});`).join('\n')}\ncommit;`);
 console.log('Exact evidence test cleanup manifests written.');
}
