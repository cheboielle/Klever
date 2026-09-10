// Isolated browser contexts and disposable development fixtures. No saved browser
// profile, real credentials, trace recording or provider email delivery is used.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(resolve('tmp/browser-qa/package.json'));
const {chromium}=require('playwright');
const base=process.env.EXPO_PUBLIC_SUPABASE_URL,key=process.env.KLEVER_ADMIN_KEY,pub=process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const preview='http://127.0.0.1:8085/';
if(base!=='https://blzubtujrxpcnfphcrny.supabase.co'||!key||!pub)throw new Error('Explicit development connection required');
const users=new Set(),tenants=[],stamp=randomUUID();let browser,phase='setup',passed=0;
const pass=label=>{passed++;console.log('PASS '+label);};
async function request(path,{token=key,method='POST',body}={}){
 const result=await fetch(base+path,{method,headers:{apikey:pub,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!result.ok)throw new Error('Development request failed');return result.json();
}
const rpc=(name,body,token)=>request('/rest/v1/rpc/'+name,{body,token});
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const field=(page,name)=>page.getByRole('textbox',{name,exact:true});
async function login(page,email,password){
 await page.goto(preview);await field(page,'Email').fill(email);await field(page,'Password').fill(password);await button(page,'Sign in').click();
 await page.getByRole('tab',{name:/Assets/}).waitFor();
}
async function run(){
 try{
  const ownerEmail=`klever-ui-${stamp}-owner@example.invalid`,ownerPassword=randomBytes(24).toString('base64url');
  const recipientEmail=`klever-ui-${stamp}-recipient@example.invalid`,recipientPassword=randomBytes(6).toString('hex').slice(0,6);
  const owner=await request('/auth/v1/admin/users',{body:{email:ownerEmail,password:ownerPassword,email_confirm:true}});users.add(owner.id);
  const tenant=await rpc('provision_business',{p_owner:owner.id,p_name:'TEST ONLY browser '+stamp,p_owner_name:'QA Owner',p_write_until:new Date(Date.now()+3600000).toISOString()});tenants.push(tenant);
  const session=await request('/auth/v1/token?grant_type=password',{token:pub,body:{email:ownerEmail,password:ownerPassword}});
  browser=await chromium.launch({channel:'chrome',headless:true});
  const ownerContext=await browser.newContext({viewport:{width:412,height:915}}),recipientContext=await browser.newContext({viewport:{width:412,height:915}});
  const ownerPage=await ownerContext.newPage(),recipientPage=await recipientContext.newPage();
  ownerPage.setDefaultTimeout(20000);recipientPage.setDefaultTimeout(20000);
  phase='owner sign-in and long business header';await login(ownerPage,ownerEmail,ownerPassword);
  const menu=await button(ownerPage,'Open menu').boundingBox();assert.ok(menu&&menu.x>=0&&menu.x+menu.width<=412);await button(ownerPage,'Open menu').click();await button(ownerPage,'Settings').waitFor();await button(ownerPage,'Close').click();pass('Long business name keeps the menu visible and usable at phone width');
  await ownerPage.getByRole('tab',{name:/Team/}).click();
  async function invite(name,email){
   await button(ownerPage,'Add team member').click();await field(ownerPage,'Team member name').fill(name);await field(ownerPage,'Invitation email').fill(email);
   await button(ownerPage,'Save and send invitation').click();
   await ownerPage.getByText('Invitation saved. No email was sent because invitation email delivery is not set up yet.',{exact:true}).waitFor();
  }
  phase='prepare and cancel invitation';await invite('QA Cancelled',`klever-ui-${stamp}-cancel@example.invalid`);
  await button(ownerPage,'Cancel invitation for QA Cancelled').click();await ownerPage.getByText('Invitation cancelled.',{exact:true}).waitFor();
  await button(ownerPage,'Cancel invitation for QA Cancelled').waitFor({state:'detached'});pass('Admin creates and cancels an invitation with honest disabled-email feedback');
  phase='prepare recipient invitation';await invite('QA Recipient',recipientEmail);await button(ownerPage,'Send invitation email to QA Recipient').waitFor();
  const invitations=await request(`/rest/v1/staff_invitations?tenant_id=eq.${tenant}&email=eq.${encodeURIComponent(recipientEmail)}&select=id`,{method:'GET'});assert.equal(invitations.length,1);
  // Auth generation returns a code but does not send an email. Keep proof only in memory.
  const proof=await request('/auth/v1/admin/generate_link',{body:{type:'invite',email:recipientEmail}});users.add(proof.id);assert.ok(typeof proof.email_otp==='string');
  phase='recipient verifies email code';await recipientPage.goto(preview);await button(recipientPage,'I have an invitation').click();
  await field(recipientPage,'Invitation email').fill(recipientEmail);await field(recipientPage,'Invitation code').fill(proof.email_otp);await button(recipientPage,'Verify invitation').click();
  await button(recipientPage,'Join TEST ONLY browser '+stamp).click();
  await field(recipientPage,'Your name').fill('QA Recipient');await field(recipientPage,'Your phone (optional)').fill('021-000-QA');await field(recipientPage,'Your job title (optional)').fill('Test technician');
  await field(recipientPage,'Choose password').fill(recipientPassword);await field(recipientPage,'Confirm password').fill(recipientPassword);
  phase='recipient sets password and joins';await button(recipientPage,'Set password and join team').click();await recipientPage.getByRole('tab',{name:/Assets/}).waitFor();
  await recipientPage.getByText('Your administrator will assign your equipment here.',{exact:true}).waitFor();assert.equal(await recipientPage.getByRole('tab',{name:/Team/}).count(),0);
  pass('Recipient verifies code, confirms details and joins through the UI with a six-character password');
  mkdirSync('tmp/browser-invitation',{recursive:true});await recipientPage.screenshot({path:'tmp/browser-invitation/technician.png',fullPage:true});
  phase='owner sees accepted profile';await login(ownerPage,ownerEmail,ownerPassword);await ownerPage.getByRole('tab',{name:/Team/}).click();
  await ownerPage.getByText('QA Recipient',{exact:true}).waitFor();await ownerPage.getByText('021-000-QA',{exact:true}).waitFor();await ownerPage.getByText('Test technician',{exact:true}).waitFor();
  assert.equal(await button(ownerPage,'Cancel invitation for QA Recipient').count(),0);
  await ownerPage.screenshot({path:'tmp/browser-invitation/team.png',fullPage:true});pass('Owner sees the accepted profile details and no pending invitation');
  phase='owner deactivates synthetic technician';await button(ownerPage,'Deactivate').click();await button(ownerPage,'Confirm deactivate').click();await ownerPage.getByText('Inactive',{exact:true}).waitFor();
  phase='deactivated technician sign-in is rejected';await recipientPage.goto(preview);await field(recipientPage,'Email').fill(recipientEmail);await field(recipientPage,'Password').fill(recipientPassword);await button(recipientPage,'Sign in').click();
  await recipientPage.getByText('Your access has changed. Please sign in again or contact your administrator.',{exact:true}).waitFor();assert.equal(await recipientPage.getByRole('tab',{name:/Assets/}).count(),0);
  pass('Admin deactivation in the UI blocks a fresh technician login');
  console.log(`${passed} browser invitation checks passed.`);
 }catch{
  if(browser){mkdirSync('tmp/browser-invitation',{recursive:true});let index=0;for(const context of browser.contexts())for(const page of context.pages()){await page.screenshot({path:`tmp/browser-invitation/failure-${index}.png`,fullPage:true,mask:[page.locator('input')]}).catch(()=>{});writeFileSync(`tmp/browser-invitation/failure-${index++}.txt`,await page.locator('body').innerText().catch(()=>''));}}
  // Playwright action logs can contain entered credentials. Report only the step.
  console.error('Browser invitation check failed during: '+phase);process.exitCode=1;
 }finally{
  if(browser)await browser.close();mkdirSync('tmp',{recursive:true});
  const ids=tenants.map(id=>{assert.ok(/^[a-f0-9-]{36}$/.test(id));return `'${id}'`;}).join(',');
  writeFileSync('tmp/browser-invitation-users.json',JSON.stringify([...users]));
  if(ids)writeFileSync('tmp/browser-invitation-cleanup.sql',`begin;\nupdate public.tenants set write_until=now()-interval '1 day' where id in (${ids});\ndelete from public.staff_invitations where tenant_id in (${ids});\ndelete from public.notification_rules where tenant_id in (${ids});\ndelete from public.memberships where tenant_id in (${ids});\ndelete from public.tenants where id in (${ids});\ncommit;`);
  console.log('Exact browser test cleanup manifests written.');
 }
}
await run();
