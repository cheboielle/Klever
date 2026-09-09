import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backupMedia,inventory,verifyMedia} from '../scripts/media-backup.mjs';
const project='blzubtujrxpcnfphcrny',tenant='00000000-0000-4000-8000-000000000001';
const photo='00000000-0000-4000-8000-000000000002.jpg',bytes=Buffer.from('synthetic photo bytes');
const entry={name:photo,id:'photo-id',updated_at:'2026-09-09',metadata:{size:bytes.length,mimetype:'image/jpeg'}};
const directories:string[]=[];
async function directory(){const root=await mkdtemp(join(tmpdir(),'klever-media-test-'));directories.push(root);return join(root,'backup');}
function transport(){return {list:async(prefix:string)=>prefix?[entry]:[{name:tenant,id:null}],download:async()=>bytes};}
afterEach(async()=>{for(const dir of directories.splice(0))await rm(dir,{recursive:true,force:true});});
it('copies and verifies photo bytes with original Storage names and rejects later damage',async()=>{
 const dir=await directory();expect(await backupMedia({project,directory:dir,transport:transport()})).toEqual({files:1,bytes:bytes.length});
 expect(await verifyMedia(dir)).toEqual({files:1,bytes:bytes.length});
 const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));expect(manifest.objects[0].name).toBe(tenant+'/'+photo);
 await writeFile(join(dir,'objects',manifest.objects[0].local),'damaged');await expect(verifyMedia(dir)).rejects.toThrow(/damaged/);
});
it('does not label an incomplete download as a successful backup',async()=>{
 const dir=await directory();await expect(backupMedia({project,directory:dir,transport:{...transport(),download:async()=>Buffer.from('short')}})).rejects.toThrow(/length/);
 await expect(readFile(join(dir,'manifest.json'))).rejects.toThrow(/ENOENT/);
});
it('detects Storage changes between the opening and closing inventories',async()=>{
 const dir=await directory();let count=0;
 await expect(backupMedia({project,directory:dir,transport:{...transport(),list:async(prefix:string)=>prefix?[{...entry,updated_at:String(count++)}]:[{name:tenant,id:null}]}})).rejects.toThrow(/Storage changed/);
 await expect(readFile(join(dir,'manifest.json'))).rejects.toThrow(/ENOENT/);
});
it('never overwrites an existing backup directory',async()=>{
 const dir=await directory();await backupMedia({project,directory:dir,transport:transport()});
 await expect(backupMedia({project,directory:dir,transport:transport()})).rejects.toThrow(/EEXIST/);
 expect((await verifyMedia(dir)).files).toBe(1);
});
it('does not read paths outside the backup if its manifest has been changed',async()=>{
 const dir=await directory();await backupMedia({project,directory:dir,transport:transport()});
 const path=join(dir,'manifest.json'),manifest=JSON.parse(await readFile(path,'utf8'));manifest.objects[0].local='../outside.jpg';await writeFile(path,JSON.stringify(manifest));
 await expect(verifyMedia(dir)).rejects.toThrow(/Invalid local/);
});
it('reads all listing pages instead of silently truncating a large business',async()=>{
 const entries=Array.from({length:101},(_,i)=>({...entry,name:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}.jpg`,id:String(i)}));
 const rows=await inventory({list:async(prefix:string,offset:number)=>prefix?entries.slice(offset,offset+100):[{name:tenant,id:null}]});
 expect(rows).toHaveLength(101);
});
