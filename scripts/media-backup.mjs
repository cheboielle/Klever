// Operator-only Storage byte backup. This is paired with a database backup, never substituted for it.
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const objectName=/^[a-f0-9-]{36}\/(task-|profile-)?[a-f0-9-]{36}\.jpg$/;
export function storageTransport(project,key,fetcher=fetch){
 assert.match(project,/^[a-z]{20}$/);assert(key,'A server credential is required');
 const base=`https://${project}.supabase.co/storage/v1`;
 async function request(path,body){
  const response=await fetcher(base+path,{method:body?'POST':'GET',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json','Cache-Control':'no-cache'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error(`Storage backup request failed (${response.status})`);
  return response;
 }
 return {
  list:async(prefix,offset)=> (await request('/object/list/evidence',{prefix,offset,limit:100,sortBy:{column:'name',order:'asc'}})).json(),
  download:async name=>Buffer.from(await (await request('/object/authenticated/evidence/'+name.split('/').map(encodeURIComponent).join('/'))).arrayBuffer()),
 };
}
export async function inventory(transport){
 const files=[],folders=[''];
 for(let i=0;i<folders.length;i++){
  const prefix=folders[i];
  for(let offset=0;;offset+=100){
   const page=await transport.list(prefix,offset);assert(Array.isArray(page),'Invalid Storage listing');
   for(const entry of page){
    assert(typeof entry.name==='string'&&!entry.name.includes('/')&&!['.','..'].includes(entry.name),'Invalid object name');
    const name=prefix?prefix+'/'+entry.name:entry.name;
    if(entry.id==null){assert(!prefix&&/^[a-f0-9-]{36}$/.test(entry.name),'Unexpected evidence folder');folders.push(name);}
    else{assert.match(name,objectName);assert(Number(entry.metadata?.size)>0,'Missing photo size');files.push({name,id:entry.id,updated_at:entry.updated_at,size:Number(entry.metadata.size),mimetype:entry.metadata.mimetype});}
   }
   if(page.length<100)break;
  }
 }
 files.sort((a,b)=>a.name.localeCompare(b.name));
 assert(new Set(files.map(f=>f.name)).size===files.length,'Listing changed during backup');
 return files;
}
export async function backupMedia({project,directory,transport}){
 assert.match(project,/^[a-z]{20}$/);
 // New directory only: failed runs and earlier valid copies are never overwritten.
 const root=resolve(directory);await mkdir(root,{recursive:false});await mkdir(join(root,'objects'));
 const started_at=new Date().toISOString(),before=await inventory(transport),objects=[];
 for(const file of before){
  const bytes=await transport.download(file.name);
  assert(bytes.length===file.size,'Photo length differs from its Storage metadata');
  const sha256=hash(bytes),local=hash(file.name)+'.jpg';
  await writeFile(join(root,'objects',local),bytes,{flag:'wx'});
  objects.push({...file,local,sha256});
 }
 assert.deepEqual(await inventory(transport),before,'Storage changed during backup; retry into a new directory');
 const manifest={version:1,kind:'klever-evidence-bytes',project,bucket:'evidence',started_at,completed_at:new Date().toISOString(),objects};
 await writeFile(join(root,'manifest.pending.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
 await verifyMedia(root,'manifest.pending.json');
 await rename(join(root,'manifest.pending.json'),join(root,'manifest.json'));
 return {files:objects.length,bytes:objects.reduce((n,o)=>n+o.size,0)};
}
export async function verifyMedia(directory,manifestName='manifest.json'){
 assert(['manifest.json','manifest.pending.json'].includes(manifestName));
 const root=resolve(directory),manifest=JSON.parse(await readFile(join(root,manifestName),'utf8'));
 assert(manifest.version===1&&manifest.kind==='klever-evidence-bytes'&&manifest.bucket==='evidence','Unsupported media backup');
 assert.match(manifest.project,/^[a-z]{20}$/);assert(Array.isArray(manifest.objects));
 const names=new Set();let bytesTotal=0;
 for(const file of manifest.objects){
  assert.match(file.name,objectName);assert(!names.has(file.name),'Duplicate backup object');names.add(file.name);
  assert(file.local===hash(file.name)+'.jpg','Invalid local backup path');assert.match(file.sha256,/^[a-f0-9]{64}$/);
  const bytes=await readFile(join(root,'objects',file.local));
  assert(bytes.length===file.size&&hash(bytes)===file.sha256,'Missing or damaged backup photo');bytesTotal+=bytes.length;
 }
 return {files:names.size,bytes:bytesTotal};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const [mode,directory]=process.argv.slice(2);assert(directory&&['backup','verify'].includes(mode),'Use: media-backup.mjs backup|verify DIRECTORY');
  const result=mode==='verify'?await verifyMedia(directory):await backupMedia({project:process.env.KLEVER_BACKUP_PROJECT,directory,transport:storageTransport(process.env.KLEVER_BACKUP_PROJECT,process.env.KLEVER_ADMIN_KEY)});
  console.log(`Verified media copy: ${result.files} files, ${result.bytes} bytes. Database backup and combined restore are separate required checks.`);
 }catch(error){console.error(error instanceof Error?error.message:'Media backup failed');process.exitCode=1;}
}
