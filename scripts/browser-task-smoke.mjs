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
 const email=`klever-task-ui-${stamp}-${label}@example.invalid`,password=randomBytes(24).toString('base64url');
 const user=await request('/auth/v1/admin/users',{body:{email,password,email_confirm:true}});users.push(user.id);
 const session=await request('/auth/v1/token?grant_type=password',{token:pub,body:{email,password}});secrets.push(password,session.access_token,session.refresh_token);return {id:user.id,email,password,token:session.access_token};
}
async function login(page,user){await page.goto('http://127.0.0.1:8085/');await field(page,'Email').fill(user.email);await field(page,'Password').fill(user.password);await button(page,'Sign in').click();await page.getByRole('tab',{name:/Assets/}).waitFor();}

async function tasks(page){await page.getByRole('tab',{name:/Tasks/}).click();await button(page,'Refresh tasks').waitFor();}
async function openTask(page,name){await page.getByRole('button',{name:new RegExp(name)}).click();await button(page,'Back to tasks').waitFor();}
async function complete(page,notes){await field(page,'Task notes').fill(notes);await button(page,'Complete task').click();await page.getByText('Task saved and synced. Its completed record is shown below.',{exact:true}).waitFor();}
try{
 const owner=await account('owner'),a=await account('a'),b=await account('b');
 const tenant=await rpc('provision_business',{p_owner:owner.id,p_name:'TEST ONLY task UI '+stamp,p_owner_name:'QA Owner',p_write_until:new Date(Date.now()+3600000).toISOString()});tenants.push(tenant);
 await rpc('provision_staff',{p_tenant:tenant,p_user:a.id,p_name:'QA Technician A'});await rpc('provision_staff',{p_tenant:tenant,p_user:b.id,p_name:'QA Technician B'});
 browser=await chromium.launch({channel:'chrome',headless:true});
 const contexts=await Promise.all([owner,a,b].map(()=>browser.newContext({viewport:{width:412,height:915}})));
 const pages=await Promise.all(contexts.map(c=>c.newPage()));const [op,ap,bp]=pages;pages.forEach(p=>p.setDefaultTimeout(30000));
 phase='admin creates both company completion modes';await login(op,owner);await tasks(op);
 for(const [name,mode] of [['QA shared task','One completion for everyone'],['QA individual task','Each technician completes it']]){
  await button(op,'Add task').click();await field(op,'Task name').fill(name);await op.getByRole('radio',{name:mode,exact:true}).click();await button(op,'Save task').click();await op.getByRole('button',{name:new RegExp(name)}).waitFor();
 }
 pass('Admin creates company tasks using both completion choices through the UI');
 const list=token=>rpc('list_tasks',{p_asset:null,p_archived:false},token);
 const initial=await list(owner.token);const today=initial.today;const shared=initial.items.find(t=>t.config.name==='QA shared task');const individual=initial.items.find(t=>t.config.name==='QA individual task');
 phase='shared completion advances everyone';await login(ap,a);await tasks(ap);await openTask(ap,'QA shared task');await complete(ap,'Shared completion by A');
 await login(bp,b);await tasks(bp);const sharedAfter=(await list(b.token)).items.find(t=>t.id===shared.id);assert.ok(sharedAfter.next_due>today);
 await bp.getByRole('button',{name:/QA shared task/}).getByText('Next due '+sharedAfter.next_due,{exact:true}).waitFor();
 assert.equal((await request('/rest/v1/task_completions?task_id=eq.'+shared.id+'&select=id',{method:'GET'})).length,1);
 pass('One shared completion advances the due date for the other technician with one server record');
 phase='individual completion leaves second technician due';await button(ap,'Back to tasks').click();await openTask(ap,'QA individual task');await complete(ap,'Individual completion by A');
 await button(bp,'Refresh tasks').click();await bp.getByRole('button',{name:'Refresh tasks',exact:true,disabled:false}).waitFor();await bp.getByRole('button',{name:/QA individual task/}).getByText('Due '+today,{exact:true}).waitFor();
 await button(op,'Refresh tasks').click();await op.getByRole('button',{name:'Refresh tasks',exact:true,disabled:false}).waitFor();await openTask(op,'QA individual task');
 await op.getByText('QA Technician A',{exact:true}).locator('..').getByText(/^Next due /).waitFor();await op.getByText('QA Technician B',{exact:true}).locator('..').getByText('Still due '+today,{exact:true}).waitFor();assert.equal(await button(op,'Complete task').count(),0);
 pass('Individual completion advances only that technician; admin progress still shows the second technician due');
 phase='offline task queues then reconnects without duplicate';await openTask(bp,'QA individual task');await contexts[2].setOffline(true);await field(bp,'Task notes').fill('Offline completion by B');await button(bp,'Complete task').click();await bp.getByText('Task and any photo saved on this device. Check Pending sync for progress or anything needing review.',{exact:true}).waitFor();
 assert.equal((await request('/rest/v1/task_completions?task_id=eq.'+individual.id+'&select=id',{method:'GET'})).length,1);
 await contexts[2].setOffline(false);if(await button(bp,'Sync now').count())await button(bp,'Sync now').click();
 await bp.getByText('Task saved and synced. Its completed record is shown below.',{exact:true}).waitFor({timeout:60000});await button(bp,'Refresh history').click();await bp.getByText('Offline completion by B',{exact:true}).waitFor();
 assert.equal((await request('/rest/v1/task_completions?task_id=eq.'+individual.id+'&select=id',{method:'GET'})).length,2);assert.equal(await bp.getByText('TypeError: Failed to fetch',{exact:true}).count(),0);
 await button(op,'Back to tasks').click();await op.getByRole('button',{name:'Refresh tasks',exact:true,disabled:false}).waitFor();await openTask(op,'QA individual task');assert.equal(await op.getByText(/^Still due /).count(),0);
 pass('Brief browser disconnection queues the second completion; reconnection syncs once and clears both technicians due status');
 console.log(`${passed} browser task checks passed; physical phone offline behaviour remains unverified.`);
}catch(error){
 mkdirSync('tmp/browser-task',{recursive:true});let detail=error instanceof Error?error.message:'Unknown test error';for(const secret of secrets)if(secret)detail=detail.replaceAll(secret,'[redacted]');writeFileSync('tmp/browser-task/failure-error.txt',detail);
 if(browser){mkdirSync('tmp/browser-task',{recursive:true});let i=0;for(const c of browser.contexts())for(const p of c.pages()){await p.screenshot({path:`tmp/browser-task/failure-${i}.png`,fullPage:true,mask:[p.locator('input')]}).catch(()=>{});writeFileSync(`tmp/browser-task/failure-${i++}.txt`,await p.locator('body').innerText().catch(()=>''));}}
 console.error('Browser task check failed during: '+phase);process.exitCode=1;
}finally{
 await browser?.close();mkdirSync('tmp',{recursive:true});const photos=[];
 // Collect only this run's tenant photo reservations, including a failed finalization.
 for(const tenant of tenants){try{for(const row of await request(`/rest/v1/service_uploads?tenant_id=eq.${tenant}&select=object_path`,{method:'GET'}))if(row.object_path)photos.push(row.object_path);}catch{console.error('Photo cleanup listing requires retry');process.exitCode=1;}}
 writeFileSync('tmp/browser-task-users.json',JSON.stringify(users));writeFileSync('tmp/browser-task-photos.json',JSON.stringify(photos));
 const ids=tenants.map(id=>{assert.ok(/^[a-f0-9-]{36}$/.test(id));return `'${id}'`;}).join(',');
 if(ids)writeFileSync('tmp/browser-task-cleanup.sql',`begin;\nupdate public.tenants set write_until=now()-interval '1 day' where id in (${ids});\ndelete from private.service_notification_state where tenant_id in (${ids});\n${['task_corrections','task_completions','task_submissions','task_person_state','tasks','staff_invitations','notification_rules','device_tokens','notification_outbox','service_corrections','service_admin_details','service_history','service_uploads','asset_service_settings','service_types','hour_logs','asset_history','asset_assignments','assets','asset_types','memberships','tenants'].map(t=>`delete from public.${t} where ${t==='tenants'?'id':'tenant_id'} in (${ids});`).join('\n')}\ncommit;`);
 console.log('Exact task test cleanup manifests written.');
}
