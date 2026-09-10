// Real UI/Auth/database/storage/export paths, using Chromium's synthetic camera.
// This is browser media coverage, NOT physical phone/camera/offline acceptance.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFRawStream} from 'pdf-lib';
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
 const email=`klever-service-ui-${stamp}-${label}@example.invalid`,password=randomBytes(24).toString('base64url');
 const user=await request('/auth/v1/admin/users',{body:{email,password,email_confirm:true}});users.push(user.id);
 const session=await request('/auth/v1/token?grant_type=password',{token:pub,body:{email,password}});secrets.push(password,session.access_token,session.refresh_token);return {id:user.id,email,password,token:session.access_token};
}
async function login(page,user){await page.goto('http://127.0.0.1:8085/');await field(page,'Email').fill(user.email);await field(page,'Password').fill(user.password);await button(page,'Sign in').click();await page.getByRole('tab',{name:/Assets/}).waitFor();}
async function openService(page){await page.getByRole('button',{name:/QA service asset/}).click();await page.getByRole('button',{name:/QA oil service/}).click();await button(page,'Record completed service').waitFor();}
async function complete(page,admin){
 await button(page,'Record completed service').click();assert.equal(await button(page,'Save completed service').isDisabled(),true);
 if(admin){await field(page,'Service cost').fill('125.50');await field(page,'Mechanic notes').fill('PRIVATE TEST mechanic note');}
 else{assert.equal(await field(page,'Service cost').count(),0);assert.equal(await field(page,'Mechanic notes').count(),0);}
 await button(page,'Open camera').click();await page.waitForFunction(()=>{const video=document.querySelector('video');return video&&video.readyState>=2&&video.videoWidth>0;});await button(page,'Take service photo').click();
 await button(page,'Save completed service').click();await page.getByText('Service and photo saved and synced.',{exact:true}).waitFor();
 await button(page,'Done').click();
}
try{
 const owner=await account('owner'),tech=await account('tech');
 const tenant=await rpc('provision_business',{p_owner:owner.id,p_name:'TEST ONLY service UI '+stamp,p_owner_name:'QA Owner',p_write_until:new Date(Date.now()+3600000).toISOString()});tenants.push(tenant);
 await rpc('provision_staff',{p_tenant:tenant,p_user:tech.id,p_name:'QA Technician'});
 const type=await rpc('save_asset_type',{p_name:'QA equipment'},owner.token);
 const asset=await rpc('save_asset',{p_name:'QA service asset',p_type:type,p_serial:'QA-SERVICE-UI',p_initial_hours:1240,p_meter_unit:'hours'},owner.token);
 await rpc('assign_asset',{p_asset:asset,p_user:tech.id,p_assigned:true},owner.token);
 const service=await rpc('save_service_schedule',{p_asset:asset,p_config:{name:'QA oil service',instructions:'Synthetic service evidence test. Do not use as maintenance guidance.',mode:'meter',meter_unit:'hours',interval_reading:100,interval_days:null},p_scope:'asset',p_baseline_reading:1200,p_baseline_kind:'last_service'},owner.token);
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const ownerContext=await browser.newContext({viewport:{width:412,height:915},permissions:['camera'],acceptDownloads:true});
 const techContext=await browser.newContext({viewport:{width:412,height:915},permissions:['camera'],acceptDownloads:true});
 const ownerPage=await ownerContext.newPage(),techPage=await techContext.newPage();ownerPage.setDefaultTimeout(30000);techPage.setDefaultTimeout(30000);
 phase='owner service camera, private cost and sync';await login(ownerPage,owner);await openService(ownerPage);await complete(ownerPage,true);
 await ownerPage.getByText('Cost: NZD 125.50',{exact:true}).waitFor();await ownerPage.getByText('PRIVATE TEST mechanic note',{exact:true}).waitFor();
 await button(ownerPage,'View evidence photo').click();await ownerPage.getByLabel('Service evidence photo',{exact:true}).waitFor();
 mkdirSync('tmp/browser-service',{recursive:true});await ownerPage.getByLabel('Service evidence photo',{exact:true}).screenshot({path:'tmp/browser-service/evidence.png'});
 pass('Admin captures a synthetic-camera photo through the UI, saves cost/notes and receives confirmed sync');
 phase='technician evidence and private detail limits';await login(techPage,tech);await openService(techPage);
 assert.equal(await techPage.getByText('PRIVATE TEST mechanic note',{exact:true}).count(),0);assert.equal(await button(techPage,'View evidence photo').count(),0);
 await complete(techPage,false);await button(techPage,'View evidence photo').click();await techPage.getByLabel('Service evidence photo',{exact:true}).waitFor();
 assert.equal(await button(techPage,'Correct or void this record').count(),0);assert.equal(await techPage.getByText('Cost: NZD 125.50',{exact:true}).count(),0);
 pass('Technician submits and sees own photo while admin evidence, costs, notes and correction controls stay hidden');
 phase='admin voids original service and confirms baseline';await login(ownerPage,owner);await openService(ownerPage);
 const original=ownerPage.getByText('QA Owner · 1240 hours',{exact:true}).locator('..');await original.getByRole('button',{name:'Correct or void this record',exact:true}).click();
 await button(ownerPage,'Void record').click();await field(ownerPage,'Correction reason').fill('QA service void - preserve original evidence');await field(ownerPage,'Corrected baseline reading').fill('1210');
 assert.equal(await button(ownerPage,'Save correction').isDisabled(),true);await ownerPage.getByRole('checkbox',{name:/I confirm this correction and baseline/}).click();phase='save confirmed service void';await button(ownerPage,'Save correction').click();
 await ownerPage.getByText('Original service voided',{exact:true}).waitFor();await ownerPage.getByText('QA service void - preserve original evidence',{exact:true}).waitFor();
 await ownerPage.getByText('70 hours remaining · due at 1,310 hours',{exact:true}).waitFor();
 await ownerPage.getByText('QA Owner · 1240 hours',{exact:true}).locator('..').getByRole('button',{name:'View evidence photo',exact:true}).click();await ownerPage.getByLabel('Service evidence photo',{exact:true}).waitFor();
 pass('Service void requires confirmation, preserves original photo/cost and recalculates the explicitly chosen baseline');
 phase='download and inspect actual CSV/PDF';await ownerPage.getByRole('button',{name:/Export this asset/}).click();
 for(const format of ['CSV','PDF']){
  const pending=ownerPage.waitForEvent('download');await button(ownerPage,format).nth(2).click();const download=await pending;await download.saveAs('tmp/browser-service/maintenance.'+format.toLowerCase());
 }
 const csv=readFileSync('tmp/browser-service/maintenance.csv','utf8');assert.ok(csv.includes('PRIVATE TEST mechanic note')&&csv.includes('QA service void')&&csv.includes('QA Technician')&&csv.includes('125.5'));
 const pdf=await PDFDocument.load(readFileSync('tmp/browser-service/maintenance.pdf'));assert.ok(pdf.getPageCount()>0);
 const imageCount=pdf.context.enumerateIndirectObjects().filter(([,object])=>object instanceof PDFRawStream&&object.dict.get(PDFName.of('Subtype'))===PDFName.of('Image')).length;assert.ok(imageCount>=2);
 pass('Actual browser downloads contain both services, private details, correction history and embedded PDF photos');
 console.log(`${passed} browser service checks passed using a simulated camera.`);
}catch(error){
 mkdirSync('tmp/browser-service',{recursive:true});let detail=error instanceof Error?error.message:'Unknown test error';for(const secret of secrets)if(secret)detail=detail.replaceAll(secret,'[redacted]');writeFileSync('tmp/browser-service/failure-error.txt',detail);
 if(browser){mkdirSync('tmp/browser-service',{recursive:true});let i=0;for(const c of browser.contexts())for(const p of c.pages()){await p.screenshot({path:`tmp/browser-service/failure-${i}.png`,fullPage:true,mask:[p.locator('input')]}).catch(()=>{});writeFileSync(`tmp/browser-service/failure-${i++}.txt`,await p.locator('body').innerText().catch(()=>''));}}
 console.error('Browser service check failed during: '+phase);process.exitCode=1;
}finally{
 await browser?.close();mkdirSync('tmp',{recursive:true});const photos=[];
 // Collect only this run's tenant photo reservations, including a failed finalization.
 for(const tenant of tenants){try{for(const row of await request(`/rest/v1/service_uploads?tenant_id=eq.${tenant}&select=object_path`,{method:'GET'}))if(row.object_path)photos.push(row.object_path);}catch{console.error('Photo cleanup listing requires retry');process.exitCode=1;}}
 writeFileSync('tmp/browser-service-users.json',JSON.stringify(users));writeFileSync('tmp/browser-service-photos.json',JSON.stringify(photos));
 const ids=tenants.map(id=>{assert.ok(/^[a-f0-9-]{36}$/.test(id));return `'${id}'`;}).join(',');
 if(ids)writeFileSync('tmp/browser-service-cleanup.sql',`begin;\nupdate public.tenants set write_until=now()-interval '1 day' where id in (${ids});\ndelete from private.service_notification_state where tenant_id in (${ids});\n${['staff_invitations','notification_rules','device_tokens','notification_outbox','service_corrections','service_admin_details','service_history','service_uploads','asset_service_settings','service_types','hour_logs','asset_history','asset_assignments','assets','asset_types','memberships','tenants'].map(t=>`delete from public.${t} where ${t==='tenants'?'id':'tenant_id'} in (${ids});`).join('\n')}\ncommit;`);
 console.log('Exact service test cleanup manifests written.');
}
