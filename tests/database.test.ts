import {attentionItems} from '../apps/mobile/src/workspaceOverview';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync,readdirSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

// Real PostgreSQL policies/functions run in PGlite. Only Supabase's managed
// Auth/Storage schemas are fixtures. Hosted Auth/Storage is a separate rollout gate.
let db: PGlite;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ownerA=id(1), techA=id(2), ownerB=id(3), techB=id(4), adminA=id(5);
let tenantA:string, tenantB:string, typeA:string, typeB:string, assetA:string, assetB:string, unassigned:string;
const session=(u:string)=>u.replace('00000000-','10000000-');
async function asUser<T>(user:string, work:()=>Promise<T>):Promise<T> {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:user,session_id:session(user),role:'authenticated'})]);
  try{return await work();}finally{await db.exec('reset role');}
}
async function value(sql:string,params:unknown[]=[]):Promise<any>{
  const r=await db.query(sql,params); return Object.values(r.rows[0] as object)[0];
}
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
    create table auth.refresh_tokens(id bigint primary key,session_id uuid references auth.sessions(id) on delete cascade);
    create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on all functions in schema auth to authenticated;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text unique not null,metadata jsonb);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select,insert on storage.objects to authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  `);
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  for(const u of [ownerA,techA,ownerB,techB,adminA]){
    await db.query('insert into auth.users values($1)',[u]);
    await db.query('insert into auth.sessions values($1,$2)',[session(u),u]);
  }
  tenantA=await value("select public.provision_business($1,'Business A','Owner A',now()+interval '30 days')",[ownerA]);
  tenantB=await value("select public.provision_business($1,'Business B','Owner B',now()+interval '30 days')",[ownerB]);
  await db.query("select public.provision_staff($1,$2,'Technician A')",[tenantA,techA]);
  await db.query("select public.provision_staff($1,$2,'Admin A')",[tenantA,adminA]);
  await db.query("select public.provision_staff($1,$2,'Technician B')",[tenantB,techB]);
  await asUser(ownerA,async()=>{
    await value("select public.manage_staff($1,'promote')",[adminA]);
    typeA=await value("select public.save_asset_type('Truckmount')");
    assetA=await value("select public.save_asset('Machine A',$1,'A-001',1240)",[typeA]);
    unassigned=await value("select public.save_asset('Unassigned',$1)",[typeA]);
    await value('select public.assign_asset($1,$2,true)',[assetA,techA]);
  });
  await asUser(ownerB,async()=>{
    typeB=await value("select public.save_asset_type('Vehicle')");
    assetB=await value("select public.save_asset('Machine B',$1)",[typeB]);
    await value('select public.assign_asset($1,$2,true)',[assetB,techB]);
    await value('select public.log_hours($1,$2,1,0,now())',[id(99),assetB]);
  });
},30000);
afterAll(async()=>{await db?.close();});

describe('tenant and assignment isolation',()=>{
  for(const table of ['tenants','memberships','asset_types','assets','asset_assignments','asset_history','hour_logs','service_types','asset_service_settings','service_uploads','service_history','service_admin_details','service_corrections','tasks','task_submissions','task_completions','task_corrections','task_person_state','profile_photos','profile_photo_uploads','template_applications','issues','issue_resolutions','notification_outbox','compliance_items','device_tokens','notification_rules']){
    it(`owner A cannot read business B ${table}`,async()=>{
      await asUser(ownerA,async()=>{
        const column=table==='tenants'?'id':'tenant_id';
        expect((await db.query(`select * from public.${table} where ${column}=$1`,[tenantB])).rows).toHaveLength(0);
      });
    });
    it(`client cannot directly mutate ${table}`,async()=>{
      await asUser(ownerA,async()=>{
        await expect(db.exec(`delete from public.${table}`)).rejects.toThrow(/permission denied/);
        const column=table==='tenants'?'name':table==='memberships'?'name':table==='asset_types'?'name':table==='assets'?'name':table==='hour_logs'?'reason':table==='asset_history'?'reason':'tenant_id';
        await expect(db.exec(`update public.${table} set ${column}=${column}`)).rejects.toThrow(/permission denied/);
        await expect(db.exec(`insert into public.${table} default values`)).rejects.toThrow(/permission denied/);
      });
    });
  }
  it('anonymous has no rows or mutation access',async()=>{
    await db.exec('set role anon');
    try{
      await expect(db.exec('select * from public.assets')).rejects.toThrow(/permission denied/);
      await expect(db.exec('select public.access_status()')).rejects.toThrow(/permission denied/);
    }finally{await db.exec('reset role');}
  });
  it('technician sees only assigned assets and own profile',async()=>{
    await asUser(techA,async()=>{
      expect((await db.query('select id from public.assets')).rows).toEqual([{id:assetA}]);
      expect((await db.query('select user_id from public.memberships')).rows).toEqual([{user_id:techA}]);
      expect((await db.query('select * from public.tenants')).rows).toHaveLength(0);
      expect((await db.query('select * from public.asset_history')).rows).toHaveLength(0);
      await expect(value('select public.log_hours($1,$2,1,0,now())',[id(100),unassigned])).rejects.toThrow(/unavailable/);
      await expect(value("select public.save_asset('Sneaky',$1)",[typeA])).rejects.toThrow(/Admin/);
    });
  });
  it('cross-tenant foreign keys and RPC targeting fail',async()=>{
    await asUser(ownerA,async()=>{
      await expect(value("select public.save_asset('Wrong type',$1)",[typeB])).rejects.toThrow(/foreign key/);
      await expect(value('select public.assign_asset($1,$2,true)',[assetA,techB])).rejects.toThrow(/unavailable/);
      await expect(value("select public.set_asset_status($1,'Workshop','test')",[assetB])).rejects.toThrow(/unavailable/);
      await expect(value("select public.manage_staff($1,'deactivate')",[ownerB])).rejects.toThrow(/unavailable/);
      await expect(value("select public.provision_business($1,'Forged','Name',now())",[techA])).rejects.toThrow(/permission denied/);
    });
  });
  it('technician cannot change role or deactivate anyone',async()=>{
    await asUser(techA,async()=>{
      await expect(value("select public.manage_staff($1,'promote')",[techA])).rejects.toThrow(/Admin/);
    });
  });
  it('admins cannot change or deactivate the owner',async()=>{
    await asUser(adminA,async()=>{
      await expect(value("select public.manage_staff($1,'deactivate')",[ownerA])).rejects.toThrow(/owner/);
      await expect(value("select public.manage_staff($1,'promote')",[techA])).rejects.toThrow(/Owner/);
    });
  });
});

describe('accepted meter history',()=>{
  const first=id(201), timestamp='2026-09-09T01:00:00Z';
  it('rejects malformed readings and missing concurrency revision',async()=>{
    await asUser(techA,async()=>{
      await expect(value('select public.log_hours($1,$2,1248,null,now())',[id(200),assetA])).rejects.toThrow(/Valid reading/);
      await expect(value('select public.log_hours($1,$2,1248.123,0,now())',[id(200),assetA])).rejects.toThrow(/decimal/);
    });
  });
  it('accepts a reading and returns the same logical result on retry',async()=>{
    await asUser(techA,async()=>{
      const args=[first,assetA,1248,0,timestamp];
      expect(await value('select public.log_hours($1,$2,$3,$4,$5)',args)).toMatchObject({status:'accepted',revision:1,duplicate:false});
      expect(await value('select public.log_hours($1,$2,$3,$4,$5)',args)).toMatchObject({status:'accepted',revision:1,duplicate:true});
      expect(await value('select count(*) from public.hour_logs where asset_id=$1',[assetA])).toBe(1);
    });
  });
  it('stale and lower readings cannot reduce accepted hours',async()=>{
    await asUser(techA,async()=>{
      expect(await value('select public.log_hours($1,$2,1250,0,now())',[id(202),assetA])).toMatchObject({status:'conflict'});
      expect(await value('select public.log_hours($1,$2,1200,1,now())',[id(203),assetA])).toMatchObject({status:'conflict'});
      expect(Number(await value('select current_hours from public.assets where id=$1',[assetA]))).toBe(1248);
    });
  });
  it('large jump asks for confirmation and does not insert',async()=>{
    await asUser(techA,async()=>{
      expect(await value('select public.log_hours($1,$2,90000,1,now())',[id(204),assetA])).toMatchObject({status:'confirmation_required'});
      expect(await value('select count(*) from public.hour_logs where asset_id=$1',[assetA])).toBe(1);
    });
  });
  it('admin correction appends and technician cannot see other actor evidence',async()=>{
    await asUser(techA,async()=>{
      await expect(value("select public.log_hours($1,$2,1245,1,now(),true,$3,'typo')",[id(205),assetA,first])).rejects.toThrow(/Only admins/);
    });
    await asUser(ownerA,async()=>{
      expect(await value("select public.log_hours($1,$2,1245,1,now(),true,$3,'Confirmed meter typo')",[id(206),assetA,first])).toMatchObject({status:'accepted',revision:2});
      expect(await value('select count(*) from public.hour_logs where asset_id=$1',[assetA])).toBe(2);
      expect(Number(await value('select value from public.hour_logs where id=$1',[first]))).toBe(1248);
    });
    await asUser(techA,async()=>expect(await value('select count(*) from public.hour_logs where asset_id=$1',[assetA])).toBe(1));
  });
});

describe('asset meter units',()=>{
  let vehicle:string;
  it('preserves existing hours assets and accepts kilometres without the hours jump warning',async()=>{
    await asUser(ownerB,async()=>{
      expect(await value('select meter_unit from public.assets where id=$1',[assetB])).toBe('hours');
      vehicle=await value("select public.save_asset('Van',$1,'KM-TEST',80000,null,'km')",[typeB]);
      await value('select public.assign_asset($1,$2,true)',[vehicle,techB]);
    });
    await asUser(techB,async()=>{
      expect(await value('select meter_unit from public.assets where id=$1',[vehicle])).toBe('km');
      const args=[id(301),vehicle,'2026-09-09T02:00:00Z'];
      expect(await value('select public.log_hours($1,$2,80050,0,$3)',args)).toMatchObject({status:'accepted'});
      expect(await value('select public.log_hours($1,$2,80050,0,$3)',args)).toMatchObject({duplicate:true});
      expect(await value('select meter_unit from public.hour_logs where id=$1',[id(301)])).toBe('km');
      expect(await value('select public.log_hours($1,$2,79999,1,now())',[id(302),vehicle])).toMatchObject({status:'conflict'});
      expect(await value('select public.log_hours($1,$2,95000,1,now())',[id(303),vehicle])).toMatchObject({status:'confirmation_required'});
    });
  });
  it('cannot reinterpret an existing meter or choose an unsupported unit',async()=>{
    await asUser(ownerB,async()=>{
      await expect(value("select public.save_asset('Van',$1,'KM-TEST',0,$2,'hours')",[typeB,vehicle])).rejects.toThrow(/cannot change meter units/);
      await expect(value("select public.save_asset('Van',$1,'',0,null,'miles')",[typeB])).rejects.toThrow(/Choose hours or kilometres/);
      await value("select public.save_asset('Renamed van',$1,'KM-TEST',0,$2)",[typeB,vehicle]);
      expect(await value('select meter_unit from public.assets where id=$1',[vehicle])).toBe('km');
      expect(Number(await value('select current_hours from public.assets where id=$1',[vehicle]))).toBe(80050);
    });
    await asUser(techA,async()=>expect((await db.query('select * from public.assets where id=$1',[vehicle])).rows).toHaveLength(0));
  });
});

describe('editing details and correcting meter setup',()=>{
  let editable:string;
  it('admin edits staff contact details without changing role or access',async()=>{
    await asUser(ownerA,async()=>{
      await value("select public.save_staff_details($1,'Updated technician','+64 21 555 0123')",[techA]);
      expect((await db.query('select name,phone,role,is_active from public.memberships where user_id=$1',[techA])).rows[0]).toEqual({name:'Updated technician',phone:'+64 21 555 0123',role:'technician',is_active:true});
      await expect(value("select public.save_staff_details($1,'Other business','123')",[techB])).rejects.toThrow(/unavailable/);
    });
    await asUser(techA,async()=>{
      await expect(value("select public.save_staff_details($1,'Not permitted','123')",[techA])).rejects.toThrow(/Admin/);
      expect((await db.query('select phone from public.memberships where user_id=$1',[techB])).rows).toHaveLength(0);
    });
  });
  it('protects staff email/title with the same tenant, role and write checks',async()=>{
    await asUser(ownerA,async()=>{
      await value("select public.save_staff_details($1,'Updated technician','123','tech@example.nz','Senior technician')",[techA]);
      expect((await db.query('select contact_email,job_title,role,is_active from public.memberships where user_id=$1',[techA])).rows[0]).toEqual({contact_email:'tech@example.nz',job_title:'Senior technician',role:'technician',is_active:true});
      await expect(value("select public.save_staff_details($1,'Other','123','other@example.nz','Title')",[techB])).rejects.toThrow(/unavailable/);
      await expect(value("select public.save_staff_details($1,'Wrong','123','invalid','Title')",[techA])).rejects.toThrow(/valid contact email/);
      await value("select public.save_staff_details($1,'Updated technician','456')",[techA]);
      expect(await value('select contact_email from public.memberships where user_id=$1',[techA])).toBe('tech@example.nz');
    });
    await asUser(techA,async()=>{
      await expect(value("select public.save_staff_details($1,'No','123','tech@example.nz','Title')",[techA])).rejects.toThrow(/Admin/);
      expect((await db.query('select contact_email,job_title from public.memberships where user_id=$1',[techB])).rows).toHaveLength(0);
    });
    await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenantA]);
    try{await asUser(ownerA,()=>expect(value("select public.save_staff_details($1,'No','123','','')",[techA])).rejects.toThrow(/read-only/));}
    finally{await db.query("update public.tenants set write_until=now()+interval '30 days' where id=$1",[tenantA]);}
  });
  it('descriptive edits preserve the reading and meter unit',async()=>{
    await asUser(ownerB,async()=>{
      editable=await value("select public.save_asset('Setup typo',$1,'old',10)",[typeB]);
      await value('select public.log_hours($1,$2,12,0,now())',[id(401),editable]);
      expect(await value("select public.edit_asset($1,'Updated name',$2,'new serial','hours',999,1)",[editable,typeB])).toMatchObject({status:'accepted'});
      expect((await db.query('select name,serial,current_hours,meter_unit from public.assets where id=$1',[editable])).rows[0]).toMatchObject({name:'Updated name',serial:'new serial',current_hours:'12.00',meter_unit:'hours'});
    });
  });
  it('unit correction requires confirmation, retains history and rejects stale queued readings',async()=>{
    await asUser(ownerB,async()=>{
      const args=[editable,typeB];
      expect(await value("select public.edit_asset($1,'Updated name',$2,'new serial','km',80000,1,'Selected wrong unit',false)",args)).toMatchObject({status:'confirmation_required'});
      expect(await value('select meter_unit from public.assets where id=$1',[editable])).toBe('hours');
      expect(await value("select public.edit_asset($1,'Updated name',$2,'new serial','km',80000,1,'Selected wrong unit',true)",args)).toMatchObject({status:'accepted'});
      expect(await value('select meter_unit from public.hour_logs where id=$1',[id(401)])).toBe('hours');
      expect(await value("select count(*) from public.asset_history where asset_id=$1 and kind='meter_unit_correction'",[editable])).toBe(1);
      expect(await value('select public.log_hours($1,$2,13,1,now())',[id(402),editable])).toMatchObject({status:'conflict'});
      expect(await value('select public.log_hours($1,$2,80010,2,now())',[id(403),editable])).toMatchObject({status:'accepted'});
      expect(await value('select meter_unit from public.hour_logs where id=$1',[id(403)])).toBe('km');
      await expect(value("select public.log_hours($1,$2,80011,3,now(),true,$3,'Wrong unit target')",[id(404),editable,id(401)])).rejects.toThrow(/this meter unit/);
      await expect(value("select public.edit_asset($1,'Invalid type',$2,'','hours',10,3,'Typo',true)",[editable,typeA])).rejects.toThrow(/foreign key/);
      expect(await value('select meter_unit from public.assets where id=$1',[editable])).toBe('km');
    });
    await asUser(ownerA,async()=>{
      await expect(value("select public.edit_asset($1,'No',$2,'','km',1,3,'No',true)",[editable,typeA])).rejects.toThrow(/unavailable/);
    });
    await asUser(techB,async()=>{
      await expect(value("select public.edit_asset($1,'No',$2,'','km',1,3,'No',true)",[editable,typeB])).rejects.toThrow(/Admin/);
    });
  });
  it('read-only business cannot edit contacts or asset setup',async()=>{
    await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenantB]);
    try{await asUser(ownerB,async()=>{
      await expect(value("select public.save_staff_details($1,'No','123')",[techB])).rejects.toThrow(/read-only/);
      await expect(value("select public.edit_asset($1,'No',$2,'','km',1,3)",[editable,typeB])).rejects.toThrow(/read-only/);
    });}finally{await db.query("update public.tenants set write_until=now()+interval '30 days' where id=$1",[tenantB]);}
  });
});

describe('service schedules and baselines',()=>{
  let firstAsset:string,secondAsset:string,service:string;
  const config={name:'Oil service',instructions:'Follow the machine manual.',mode:'meter',meter_unit:'hours',interval_reading:100,interval_days:null};
  const schedules=(asset:string)=>value('select public.list_asset_services($1)',[asset]);
  it('calculates 1240 / 1200 / 100 as 60 remaining and keeps type baselines separate',async()=>{
    await asUser(ownerB,async()=>{
      firstAsset=await value("select public.save_asset('Schedule machine one',$1,'',1240)",[typeB]);
      secondAsset=await value("select public.save_asset('Schedule machine two',$1,'',500)",[typeB]);
      await value('select public.assign_asset($1,$2,true)',[firstAsset,techB]);
      const result=await value("select public.save_service_schedule($1,$2,'type',1200,null,'last_service')",[firstAsset,JSON.stringify(config)]);
      service=result.id;
      expect((await schedules(firstAsset))[0]).toMatchObject({remaining:60,next_reading:1300,due:false,missing_baseline:false});
      expect((await schedules(secondAsset))[0]).toMatchObject({baseline_reading:null,missing_baseline:true,due:false});
    });
  });
  it('per-asset overrides survive edits to type defaults and stale form saves conflict',async()=>{
    await asUser(ownerB,async()=>{
      let second=(await schedules(secondAsset))[0];
      await value("select public.save_service_schedule($1,$2,'asset',450,null,'starting_point',$3,$4,$5)",[secondAsset,JSON.stringify({...config,interval_reading:50}),service,second.definition_revision,second.settings_revision]);
      let first=(await schedules(firstAsset))[0];
      const args=[firstAsset,JSON.stringify({...config,interval_reading:200}),service,first.definition_revision,first.settings_revision];
      expect(await value("select public.save_service_schedule($1,$2,'type',1200,null,'last_service',$3,$4,$5)",args)).toMatchObject({status:'accepted'});
      expect(await value("select public.save_service_schedule($1,$2,'type',1200,null,'last_service',$3,$4,$5)",args)).toMatchObject({status:'conflict'});
      expect((await schedules(firstAsset))[0]).toMatchObject({remaining:160,next_reading:1400});
      expect((await schedules(secondAsset))[0]).toMatchObject({has_override:true,next_reading:500,due:true,baseline_kind:'starting_point'});
    });
  });
  it('Calendar and Both become due on the business date with no new reading',async()=>{
    await asUser(ownerB,async()=>{
      const baselineDate=await value("select ((now() at time zone 'Pacific/Auckland')::date-30)::text");
      for(const mode of ['calendar','both']){
        const result=await value("select public.save_service_schedule($1,$2,'asset',1200,$3,'last_service')",[firstAsset,JSON.stringify({...config,name:mode,mode,interval_days:30}),baselineDate]);
        expect((await schedules(firstAsset)).find((x:any)=>x.id===result.id)).toMatchObject({due:true,missing_baseline:false});
      }
    });
  });
  it('assigned tech can read due state but cannot edit, and other tenants cannot target schedules',async()=>{
    await asUser(techB,async()=>{
      expect((await schedules(firstAsset)).length).toBeGreaterThan(0);
      await expect(schedules(secondAsset)).rejects.toThrow(/unavailable/);
      await expect(value("select public.save_service_schedule($1,$2,'asset')",[firstAsset,JSON.stringify(config)])).rejects.toThrow(/Admin/);
    });
    await asUser(ownerA,async()=>{
      await expect(schedules(firstAsset)).rejects.toThrow(/unavailable/);
      await expect(value('select public.archive_asset_service($1,$2)',[firstAsset,service])).rejects.toThrow(/unavailable/);
    });
  });
  it('rejects invalid intervals/baselines and read-only edits',async()=>{
    await asUser(ownerB,async()=>{
      await expect(value("select public.save_service_schedule($1,$2,'asset')",[firstAsset,JSON.stringify({...config,interval_reading:0})])).rejects.toThrow(/positive meter/);
      await expect(value("select public.save_service_schedule($1,$2,'asset',99999,null,'last_service')",[firstAsset,JSON.stringify(config)])).rejects.toThrow(/current reading/);
      await expect(value("select public.save_service_schedule($1,$2,'asset')",[firstAsset,JSON.stringify({...config,mode:'both',interval_days:1.5})])).rejects.toThrow(/whole calendar/);
    });
    await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenantB]);
    try{await asUser(ownerB,async()=>{
      expect((await schedules(firstAsset)).length).toBeGreaterThan(0);
      await expect(value('select public.archive_asset_service($1,$2)',[firstAsset,service])).rejects.toThrow(/read-only/);
    });}finally{await db.query("update public.tenants set write_until=now()+interval '30 days' where id=$1",[tenantB]);}
  });
  it('meter-unit correction invalidates meter baselines without altering calendar schedules',async()=>{
    await asUser(ownerB,async()=>{
      await value("select public.edit_asset($1,'Schedule machine one',$2,'','km',50000,0,'Setup unit correction',true)",[firstAsset,typeB]);
      const rows=await schedules(firstAsset);
      expect(rows.find((x:any)=>x.id===service)).toMatchObject({baseline_reading:null,unit_mismatch:true,missing_baseline:true,next_reading:null});
      expect(rows.find((x:any)=>x.config.mode==='calendar')).toMatchObject({due:true,unit_mismatch:false,missing_baseline:false});
      await value('select public.archive_asset_service($1,$2)',[secondAsset,service]);
      expect((await schedules(secondAsset)).some((x:any)=>x.id===service)).toBe(false);
      expect((await schedules(firstAsset)).some((x:any)=>x.id===service)).toBe(true);
    });
  });
});

describe('required service photo and immutable completion',()=>{
  let machine:string,service:string,path:string,latePath:string;
  const first=id(501),late=id(502);
  const config={name:'Evidence service',instructions:'Original service instructions',mode:'both',meter_unit:'hours',interval_reading:100,interval_days:30};
  it('requires a successfully uploaded JPEG before completion',async()=>{
    await asUser(ownerB,async()=>{
      machine=await value("select public.save_asset('Evidence machine',$1,'PHOTO',1310)",[typeB]);
      await value('select public.assign_asset($1,$2,true)',[machine,techB]);
      const date=await value("select ((now() at time zone 'Pacific/Auckland')::date-31)::text");
      service=(await value("select public.save_service_schedule($1,$2,'asset',1200,$3,'last_service')",[machine,JSON.stringify(config),date])).id;
      const prepared=await value('select public.prepare_service_photo($1,$2,$3,1310,now(),$4,1)',[first,machine,service,JSON.stringify(config)]);path=prepared.path;
      await expect(value('select public.complete_service($1)',[first])).rejects.toThrow(/photo has not finished/);
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('evidence',$1,'{\"size\":256,\"mimetype\":\"image/jpeg\"}')",[path]);
      expect((await db.query('select * from storage.objects where name=$1',[path])).rows).toHaveLength(0);
    });
    await asUser(techB,async()=>{latePath=(await value('select public.prepare_service_photo($1,$2,$3,1310,now(),$4,1)',[late,machine,service,JSON.stringify(config)])).path;});
  });
  it('completion resets both baselines once and preserves private admin fields',async()=>{
    await asUser(ownerB,async()=>{
      expect(await value("select public.complete_service($1,75.50,'Private mechanic note')",[first])).toMatchObject({status:'applied',duplicate:false});
      expect(await value('select public.complete_service($1)',[first])).toMatchObject({status:'applied',duplicate:true});
      const schedule=(await value('select public.list_asset_services($1)',[machine]))[0];
      expect(schedule).toMatchObject({next_reading:1410,remaining:100,due:false});
      expect(schedule.next_date).toBe(await value("select ((now() at time zone 'Pacific/Auckland')::date+30)::text"));
      const history=await value('select public.list_service_history($1,$2)',[machine,service]);
      expect(history).toHaveLength(1);expect(history[0]).toMatchObject({cost:75.5,mechanic_notes:'Private mechanic note',snapshot:config});
      expect(await value('select public.authorize_service_photo($1)',[first])).toBe(path);
      expect((await db.query('select * from storage.objects where name=$1',[path])).rows).toHaveLength(0);
      await expect(db.query("update storage.objects set metadata='{}' where name=$1",[path])).rejects.toThrow(/permission denied/);
    });
    await asUser(techB,async()=>{
      expect(await value('select public.list_service_history($1,$2)',[machine,service])).toHaveLength(0);
      expect((await db.query('select * from public.service_admin_details')).rows).toHaveLength(0);
      expect((await db.query('select * from storage.objects where name=$1',[path])).rows).toHaveLength(0);
      await expect(db.query("insert into storage.objects(bucket_id,name,metadata) values('evidence','forged.jpg','{}')")).rejects.toThrow(/row-level security/);
    });
  });
  it('late upload stays visible for correction and cannot overwrite a newer baseline',async()=>{
    await asUser(techB,async()=>{
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('evidence',$1,'{\"size\":256,\"mimetype\":\"image/jpeg\"}')",[latePath]);
      await expect(value('select public.complete_service($1,20)',[late])).rejects.toThrow(/Only admins/);
      expect(await value('select public.complete_service($1)',[late])).toMatchObject({status:'pending_correction'});
      expect((await value('select public.list_asset_services($1)',[machine]))[0]).toMatchObject({next_reading:1410});
      expect((await value('select public.list_service_history($1,$2)',[machine,service]))[0]).toMatchObject({state:'pending_correction',cost:null,mechanic_notes:null});
      expect(await value('select public.authorize_service_photo($1)',[late])).toBe(latePath);
      expect((await db.query('select * from storage.objects where name=$1',[latePath])).rows).toHaveLength(0);
    });
    await asUser(ownerA,async()=>{
      await expect(value('select public.complete_service($1)',[first])).rejects.toThrow(/unavailable/);
      expect((await db.query('select * from storage.objects where name=$1',[latePath])).rows).toHaveLength(0);
    });
    await asUser(ownerB,async()=>value('select public.assign_asset($1,$2,false)',[machine,techB]));
    await asUser(techB,async()=>{
      expect((await db.query('select * from storage.objects where name=$1',[latePath])).rows).toHaveLength(0);
      await expect(value('select public.list_service_history($1,$2)',[machine,service])).rejects.toThrow(/unavailable/);
      await expect(value('select public.authorize_service_photo($1)',[late])).rejects.toThrow(/unavailable/);
    });
  });
  it('admin resolves a delayed record or voids it without changing its original evidence',async()=>{
    await asUser(ownerB,async()=>{
      let schedule=(await value('select public.list_asset_services($1)',[machine]))[0];
      const date=await value("select ((now() at time zone 'Pacific/Auckland')::date)::text");
      const args=[id(503),late,date,schedule.settings_revision];
      expect(await value("select public.correct_service($1,$2,'replace','Reviewed delayed upload',1305,$3,$4,false)",args)).toMatchObject({status:'confirmation_required'});
      expect(await value("select public.correct_service($1,$2,'replace','Reviewed delayed upload',1305,$3,$4,true)",args)).toMatchObject({status:'accepted',duplicate:false});
      expect(await value("select public.correct_service($1,$2,'replace','Reviewed delayed upload',1305,$3,$4,true)",args)).toMatchObject({duplicate:true});
      expect((await value('select public.list_asset_services($1)',[machine]))[0]).toMatchObject({next_reading:1405});
      expect(Number(await value('select reading from public.service_uploads where id=$1',[late]))).toBe(1310);
      const history=await value('select public.list_service_history($1,$2)',[machine,service]);
      expect(history.find((x:any)=>x.id===late).corrections).toHaveLength(1);
      schedule=(await value('select public.list_asset_services($1)',[machine]))[0];
      expect(await value("select public.correct_service($1,$2,'void','Duplicate maintenance entry',1310,$3,$4,true)",[id(504),late,date,schedule.settings_revision])).toMatchObject({status:'accepted'});
      expect((await value('select public.list_asset_services($1)',[machine]))[0]).toMatchObject({next_reading:1410});
      expect(await value('select count(*) from public.service_corrections where history_id=$1',[late])).toBe(2);
    });
    await asUser(techB,async()=>{
      await expect(value("select public.correct_service($1,$2,'void','Not allowed',0,null,1,true)",[id(505),late])).rejects.toThrow(/Admin/);
    });
    await asUser(ownerA,async()=>{
      await expect(value("select public.correct_service($1,$2,'void','Wrong business',0,null,1,true)",[id(505),late])).rejects.toThrow(/unavailable/);
    });
  });
});


describe('recurring task workflows',()=>{
 let shared:string, assetTask:string, foreignTask:string, pending:string, original:any;
 const config={name:'Daily check',instructions:'Check before starting',cadence:'daily',days:1,checklist:[{id:'oil',label:'Oil checked'}],notes_required:true,photo_required:true};
 const list=(asset:string|null=null)=>value('select public.list_tasks($1)',[asset]);
 const prepare=(user:string,task:any,n:number,checked=['oil'],notes='All good',photo=true)=>asUser(user,()=>value('select public.prepare_task($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id(n),task.id,task.occurrence_id,task.revision,JSON.stringify(task.config),JSON.stringify(checked),notes,'2026-09-09T05:00:00Z',photo]));
 it('calendar recurrence skips missed days and preserves monthly anchor across February',async()=>{
  expect(await value("select private.next_task_date('2024-01-31','2024-02-29','monthly',null)::text")).toBe('2024-03-31');
  expect(await value("select private.next_task_date('2025-01-31','2025-02-28','monthly',null)::text")).toBe('2025-03-31');
  expect(await value("select private.next_task_date('2026-01-01','2026-01-25','custom',7)::text")).toBe('2026-01-29');
 });
 it('admin sets up shared and asset tasks, with tenant and assignment boundaries',async()=>{
  await asUser(ownerA,async()=>{
   shared=(await value("select public.save_task(null,null,$1,'2020-01-01',0)",[JSON.stringify(config)])).id;
   assetTask=(await value("select public.save_task(null,$1,$2,'2020-01-01',0)",[unassigned,JSON.stringify(config)])).id;
   await expect(value("select public.save_task(null,$1,$2,'2020-01-01',0)",[assetB,JSON.stringify(config)])).rejects.toThrow(/unavailable/);
  });
  await asUser(ownerB,async()=>{foreignTask=(await value("select public.save_task(null,null,$1,'2020-01-01',0)",[JSON.stringify(config)])).id;});
  await asUser(techA,async()=>{
   original=(await list()).items[0];expect(original.id).toBe(shared);
   await expect(value('select public.list_tasks($1)',[unassigned])).rejects.toThrow(/unavailable/);
   await expect(value('select public.list_task_history($1)',[foreignTask])).rejects.toThrow(/unavailable/);
   await expect(value("select public.save_task(null,null,$1,'2020-01-01',0)",[JSON.stringify(config)])).rejects.toThrow(/Admin/);
  });
 });
 it('required checklist, notes and uploaded photo enforced; two submissions close one occurrence',async()=>{
  await expect(prepare(techA,original,601,[])).rejects.toThrow(/every checklist/);
  await expect(prepare(techA,original,601,['oil'],'')).rejects.toThrow(/required task notes/);
  await expect(prepare(techA,original,601,['oil'],'fine',false)).rejects.toThrow(/required task photo/);
  const reserved=await prepare(techA,original,601);pending=reserved.path;
  await prepare(ownerA,original,602);
  await asUser(techA,async()=>{
   await expect(value('select public.complete_task($1)',[id(601)])).rejects.toThrow(/not finished uploading/);
   await expect(value('select public.authorize_task_photo($1)',[id(601)])).rejects.toThrow(/unavailable/);
   await db.query("insert into storage.objects(bucket_id,name,metadata) values('evidence',$1,'{\"size\":100,\"mimetype\":\"image/jpeg\"}')",[pending]);
   expect(await value('select public.complete_task($1)',[id(601)])).toMatchObject({status:'completed',duplicate:false});
   expect(await value('select public.complete_task($1)',[id(601)])).toMatchObject({status:'completed',duplicate:true});
   const result=await list();expect(result.items[0].next_due>result.today).toBe(true);
   expect(await value('select public.authorize_task_photo($1)',[id(601)])).toBe(pending);
  });
  await asUser(ownerA,async()=>expect(await value('select public.complete_task($1)',[id(602)])).toMatchObject({status:'already_completed'}));
  expect(await value('select count(*) from public.task_completions where task_id=$1',[shared])).toBe(1);
  expect(await prepare(ownerA,original,603)).toMatchObject({status:'already_completed'});
 });
 it('shared task history stays actor-private and photo permissions are live',async()=>{
  await asUser(adminA,async()=>expect((await value('select public.list_task_history($1)',[shared])).length).toBe(1));
  await asUser(techB,async()=>{await expect(value('select public.authorize_task_photo($1)',[id(601)])).rejects.toThrow(/unavailable/);});
  await db.query('delete from auth.sessions where id=$1',[session(techA)]);
  await asUser(techA,async()=>{await expect(value('select public.authorize_task_photo($1)',[id(601)])).rejects.toThrow(/Access denied/);});
  await db.query('insert into auth.sessions values($1,$2)',[session(techA),techA]);
 });
 it('voiding retains evidence and reopens only the requested schedule, idempotently',async()=>{
  await asUser(techA,async()=>{await expect(value("select public.void_task_completion($1,$2,'Wrong signoff','2026-09-09',2,true)",[id(605),id(601)])).rejects.toThrow(/Admin/);});
  await asUser(ownerA,async()=>{
   const task=(await list()).items[0];
   expect(await value("select public.void_task_completion($1,$2,'Wrong signoff','2026-09-09',$3,true)",[id(605),id(601),task.revision])).toMatchObject({status:'saved',duplicate:false});
   expect(await value("select public.void_task_completion($1,$2,'Wrong signoff','2026-09-09',$3,true)",[id(605),id(601),task.revision])).toMatchObject({status:'saved',duplicate:true});
   expect((await value('select public.list_task_history($1)',[shared]))[0]).toMatchObject({notes:'All good',correction:{reason:'Wrong signoff'}});
  });
 });
 it('individual business tasks advance one technician only and block completing for someone else',async()=>{
  const individual={...config,completion_mode:'individual',photo_required:false,notes_required:false,checklist:[]};
  let task:any, person:any;
  // Existing admin temporarily becomes technician; no extra account/seat needed.
  await asUser(ownerA,async()=>{person=(await value("select public.save_task(null,null,$1,'2020-01-01',0)",[JSON.stringify(individual)])).id;});
  await db.query("update public.memberships set role='technician' where user_id=$1",[adminA]);
  await asUser(techA,async()=>{task=(await list()).items.find((t:any)=>t.id===person);expect(task.can_complete).toBe(true);expect(task.participants).toHaveLength(0);expect((await db.query('select user_id from public.task_person_state where task_id=$1',[person])).rows).toEqual([{user_id:techA}]);});
  let other:any;await asUser(adminA,async()=>{other=(await list()).items.find((t:any)=>t.id===person);expect(other.occurrence_id).not.toBe(task.occurrence_id);});
  await expect(prepare(techA,other,610,[],'',false)).rejects.toThrow(/schedule changed/);
  await prepare(techA,task,610,[],'',false);
  await asUser(techA,async()=>{expect(await value('select public.complete_task($1)',[id(610)])).toMatchObject({status:'completed'});});
  await asUser(adminA,async()=>{expect((await list()).items.find((t:any)=>t.id===person).next_due).toBe('2020-01-01');expect(await value('select public.list_task_history($1)',[person])).toHaveLength(0);});
  await asUser(ownerA,async()=>{
   const visible=(await list()).items.find((t:any)=>t.id===person);expect(visible.can_complete).toBe(false);expect(visible.participants.filter((p:any)=>p.due)).toHaveLength(1);
   await value("select public.void_task_completion($1,$2,'Incorrect check','2020-01-01',$3,true)",[id(611),id(610),visible.revision]);
  });
  await asUser(techA,async()=>{expect((await list()).items.find((t:any)=>t.id===person).next_due).toBe('2020-01-01');});
  // Returning to shared mode starts a distinct occurrence, leaving history intact.
  await asUser(ownerA,async()=>{const visible=(await list()).items.find((t:any)=>t.id===person);await value('select public.save_task($1,null,$2,$3,$4)',[person,JSON.stringify({...individual,completion_mode:'shared'}),visible.schedule_due,visible.revision]);expect((await value('select public.list_task_history($1)',[person])).length).toBe(1);});
  await db.query("update public.memberships set role='admin' where user_id=$1",[adminA]);
  // Keep later tests' single shared-task fixture stable.
  await asUser(ownerA,async()=>{const visible=(await list()).items.find((t:any)=>t.id===person);await value('select public.save_task($1,null,$2,$3,$4,true)',[person,JSON.stringify(visible.config),visible.next_due,visible.revision]);});
 });
 it('edited instructions preserve submitted labels, archive preserves history, read-only rejects completion',async()=>{
  let current:any;
  await asUser(ownerA,async()=>{
   current=(await list()).items[0];
   expect(await value('select public.save_task($1,null,$2,$3,1)',[shared,JSON.stringify(config),current.next_due])).toMatchObject({status:'conflict'});
   await value('select public.save_task($1,null,$2,$3,$4,true)',[shared,JSON.stringify({...config,name:'Renamed',checklist:[]}),current.next_due,current.revision]);
   expect((await list()).items).toHaveLength(0);
   expect((await value('select public.list_task_history($1)',[shared]))[0].snapshot.checklist[0].label).toBe('Oil checked');
  });
  await asUser(techA,async()=>{
    expect((await value('select public.list_tasks(null,true)')).items.some((t:any)=>t.id===shared)).toBe(true);
    const own=await value('select public.list_task_history($1)',[shared]);
    expect(own.length).toBeGreaterThan(0);
    await expect(value('select public.save_task($1,null,$2,$3,$4,false)',[shared,JSON.stringify(config),current.next_due,current.revision])).rejects.toThrow(/Admin/);
  });
  await asUser(ownerA,async()=>{

   const archived=(await value('select public.list_tasks(null,true)')).items.find((t:any)=>t.id===shared);
   await value('select public.save_task($1,null,$2,$3,$4,false)',[shared,JSON.stringify(archived.config),archived.next_due,archived.revision]);
   current=(await list()).items[0];
  });
  await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenantA]);
  await expect(prepare(techA,current,604,[])).rejects.toThrow(/read-only/);
  await db.query("update public.tenants set write_until=now()+interval '30 days' where id=$1",[tenantA]);
 });
});


describe('editable private asset and staff photos',()=>{
 const photo=id(701),replacement=id(702),staffPhoto=id(703);let path:string;
 const upload=async(p:string)=>db.query("insert into storage.objects(bucket_id,name,metadata) values('evidence',$1,'{\"size\":100,\"mimetype\":\"image/jpeg\"}')",[p]);
 it('only admins may upload configuration photos, and finalization requires actual upload',async()=>{
  await asUser(techA,async()=>{await expect(value("select public.prepare_profile_photo($1,'member',$2)",[photo,techA])).rejects.toThrow(/Admin/);});
  await asUser(ownerA,async()=>{
   await expect(value("select public.prepare_profile_photo($1,'asset',$2)",[photo,assetB])).rejects.toThrow(/unavailable/);
   path=await value("select public.prepare_profile_photo($1,'asset',$2)",[photo,assetA]);
   await expect(value("select public.save_profile_photo('asset',$1,$2,0)",[assetA,photo])).rejects.toThrow(/not finished uploading/);
   await upload(path);
   expect(await value("select public.save_profile_photo('asset',$1,$2,0)",[assetA,photo])).toMatchObject({status:'saved',revision:1});
   expect(await value("select public.save_profile_photo('asset',$1,$2,0)",[assetA,photo])).toMatchObject({status:'saved',revision:1});
  });
  await asUser(techA,async()=>expect(await value('select public.authorize_profile_photo($1)',[photo])).toBe(path));
  await asUser(ownerB,async()=>{await expect(value('select public.authorize_profile_photo($1)',[photo])).rejects.toThrow(/unavailable/);});
 });
 it('replacement is atomic, rejects stale edits and makes the superseded photo inaccessible',async()=>{
  await asUser(ownerA,async()=>{
   const next=await value("select public.prepare_profile_photo($1,'asset',$2)",[replacement,assetA]);await upload(next);
   expect(await value("select public.save_profile_photo('asset',$1,$2,0)",[assetA,replacement])).toMatchObject({status:'conflict'});
   expect(await value('select public.authorize_profile_photo($1)',[photo])).toBe(path);
   expect(await value("select public.save_profile_photo('asset',$1,$2,1)",[assetA,replacement])).toMatchObject({status:'saved',revision:2});
   await expect(value('select public.authorize_profile_photo($1)',[photo])).rejects.toThrow(/unavailable/);
  });
  await asUser(ownerA,async()=>value('select public.assign_asset($1,$2,false)',[assetA,techA]));
  await asUser(techA,async()=>{await expect(value('select public.authorize_profile_photo($1)',[replacement])).rejects.toThrow(/unavailable/);});
  await asUser(ownerA,async()=>value('select public.assign_asset($1,$2,true)',[assetA,techA]));
 });
 it('staff photos follow profile privacy; removal preserves history and read-only forbids editing',async()=>{
  await asUser(ownerA,async()=>{const p=await value("select public.prepare_profile_photo($1,'member',$2)",[staffPhoto,techA]);await upload(p);await value("select public.save_profile_photo('member',$1,$2,0)",[techA,staffPhoto]);});
  await asUser(techA,async()=>{expect(await value('select public.authorize_profile_photo($1)',[staffPhoto])).toContain('profile-');await expect(value("select public.get_profile_photo('member',$1)",[ownerA])).rejects.toThrow(/unavailable/);});
  await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenantA]);
  await asUser(ownerA,async()=>{await expect(value("select public.save_profile_photo('member',$1,null,1)",[techA])).rejects.toThrow(/read-only/);expect(await value('select public.authorize_profile_photo($1)',[staffPhoto])).toContain('profile-');});
  await db.query("update public.tenants set write_until=now()+interval '30 days' where id=$1",[tenantA]);
  await asUser(ownerA,async()=>{await value("select public.save_profile_photo('asset',$1,null,2)",[assetA]);await expect(value('select public.authorize_profile_photo($1)',[replacement])).rejects.toThrow(/unavailable/);expect(await value("select count(*) from public.asset_history where asset_id=$1 and kind='photo_changed'",[assetA])).toBe(3);});
  await db.query('delete from auth.sessions where id=$1',[session(techA)]);
  await asUser(techA,async()=>{await expect(value('select public.authorize_profile_photo($1)',[staffPhoto])).rejects.toThrow(/Access denied/);});
  await db.query('insert into auth.sessions values($1,$2)',[session(techA),techA]);
 });
});


describe('starter maintenance library',()=>{
 it('preserves the supplied catalogue and applies once without overwriting later edits',async()=>{
  const source=JSON.parse(readFileSync('klever_assets_template_seed.json','utf8'));
  expect(await value("select content from public.maintenance_catalog where id='truckmount-v1'")).toEqual(source);
  await asUser(ownerA,async()=>{
   const first=await value("select public.apply_starter_library($1,'Titan 425',true)",[unassigned]);expect(first).toMatchObject({status:'applied',services:3,tasks:2});
   const schedules=await value('select public.list_asset_services($1)',[unassigned]);expect(schedules.every((x:any)=>x.missing_baseline)).toBe(true);
   const chosen=schedules.find((x:any)=>x.config.interval_reading===25);expect(chosen.config.instructions).toContain('25-50');
   await value("select public.save_service_schedule($1,$2,'asset',null,null,'unknown',$3,$4,$5)",[unassigned,JSON.stringify({...chosen.config,interval_reading:40}),chosen.id,chosen.definition_revision,chosen.settings_revision]);
   expect(await value("select public.apply_starter_library($1,'Titan 425',true)",[unassigned])).toMatchObject({status:'already_applied'});
   expect((await value('select public.list_asset_services($1)',[unassigned])).find((x:any)=>x.id===chosen.id).config.interval_reading).toBe(40);
   expect((await value('select public.list_tasks($1)',[unassigned])).items).toHaveLength(3); // one existing task + two starters
  });
 });
 it('engine-less models exclude engine-only checks, and kilometre assets reject hour templates',async()=>{
  await asUser(ownerB,async()=>{
   // Restore the test meter to hours without creating additional assets.
   await db.exec('reset role');await db.query("update public.assets set meter_unit='hours' where id=$1",[assetB]);await db.exec('set role authenticated');
   await value("select public.apply_starter_library($1,'CDS 4.8',true)",[assetB]);
   const library=await value('select public.get_starter_library($1)',[assetB]);expect(library.applied.note).not.toContain('Phase 2');
   const tasks=(await value('select public.list_tasks($1)',[assetB])).items;expect(tasks.flatMap((t:any)=>t.config.checklist).some((i:any)=>i.label.includes('engine oil dipstick'))).toBe(false);
  });
  await asUser(techA,async()=>{await expect(value("select public.apply_starter_library($1,'Titan 425',true)",[assetA])).rejects.toThrow(/Admin/);});
  await asUser(ownerA,async()=>{await expect(value("select public.apply_starter_library($1,'Titan 425',true)",[assetB])).rejects.toThrow(/unavailable/);});
  await db.query("update public.assets set meter_unit='km' where id=$1",[assetA]);
  await asUser(ownerA,async()=>{await expect(value("select public.apply_starter_library($1,'Titan 425',true)",[assetA])).rejects.toThrow(/use hours/);});
  await db.query("update public.assets set meter_unit='hours' where id=$1",[assetA]);
 });
});


describe('issues and compliance',()=>{
 it('urgent issue retries create one report and both admin channels, with private original evidence',async()=>{
  await asUser(techA,async()=>{
   expect(await value("select public.report_issue($1,$2,'Urgent','Pump leaking','2026-09-09T05:00:00Z')",[id(801),assetA])).toMatchObject({duplicate:false});
   expect(await value("select public.report_issue($1,$2,'Urgent','Pump leaking','2026-09-09T05:00:00Z')",[id(801),assetA])).toMatchObject({duplicate:true});
   expect((await db.query('select * from public.notification_outbox')).rows).toHaveLength(0);
   await expect(value("select public.resolve_issue($1,$2,'Fixed')",[id(802),id(801)])).rejects.toThrow(/Admin/);
  });
  expect(await value('select count(*) from public.notification_outbox where source_id=$1',[id(801)])).toBe(4);
  await asUser(ownerB,async()=>{await expect(value('select public.list_asset_issues($1)',[assetA])).rejects.toThrow(/unavailable/);});
  await asUser(ownerA,async()=>{await value("select public.resolve_issue($1,$2,'Hose replaced')",[id(802),id(801)]);expect(await value("select public.resolve_issue($1,$2,'Hose replaced')",[id(802),id(801)])).toMatchObject({duplicate:true});});
  await asUser(techA,async()=>{const issue=(await value('select public.list_asset_issues($1)',[assetA]))[0];expect(issue.description).toBe('Pump leaking');expect(issue.resolutions).toHaveLength(1);});
 });
 it('compliance renewal is editable, version checked and audited, but denied to technicians',async()=>{
  let item:any;
  await asUser(ownerA,async()=>{const saved=await value("select public.save_compliance(null,$1,'WOF','2027-01-01','{30,7}',true,0)",[assetA]);item=(await value('select public.list_compliance($1)',[assetA])).find((x:any)=>x.id===saved.id);expect(item.lead_days).toEqual([30,7]);expect(await value("select public.save_compliance($1,$2,'WOF','2028-01-01','{30,7}',false,0)",[item.id,assetA])).toMatchObject({status:'conflict'});await value("select public.save_compliance($1,$2,'WOF','2028-01-01','{30,7}',false,1)",[item.id,assetA]);});
  await asUser(techA,async()=>{expect((await value('select public.list_compliance($1)',[assetA]))[0].due_date).toBe('2028-01-01');await expect(value("select public.save_compliance($1,$2,'WOF','2029-01-01','{7}',false,2)",[item.id,assetA])).rejects.toThrow(/Admin/);});
  await asUser(ownerA,async()=>{expect(await value("select count(*) from public.asset_history where asset_id=$1 and kind='compliance_changed'",[assetA])).toBe(2);});
  await asUser(ownerB,async()=>{await expect(value('select public.list_compliance($1)',[assetA])).rejects.toThrow(/unavailable/);});
 });
});

describe('protected exports',()=>{
 it('denies technicians, anonymous and cross-tenant asset exports',async()=>{
  await asUser(techA,async()=>{await expect(value("select public.export_data('services')")).rejects.toThrow(/Admin/);});
  await asUser(ownerA,async()=>{await expect(value("select public.export_data('assets',$1)",[assetB])).rejects.toThrow(/unavailable/);const report=await value("select public.export_data('assets')");expect(report.rows.every((r:any)=>r.name!=='Machine B')).toBe(true);});
  expect(await value("select has_function_privilege('anon','public.export_data(text,uuid)','execute')")).toBe(false);
 });
 it('retains corrected service evidence and permits exports while read-only',async()=>{
  await db.exec('begin');try{
   await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenantB]);
   await asUser(ownerB,async()=>{const report=await value("select public.export_data('services')");expect(report.rows.length).toBeGreaterThan(0);expect(report.rows.some((r:any)=>r.corrections.length===2&&r.photo_path&&r.service)).toBe(true);});
   await asUser(ownerA,async()=>{const report=await value("select public.export_data('tasks')");expect(report.rows.length).toBeGreaterThan(0);expect(report.rows.some((r:any)=>r.corrections.length>0&&r.effective_completion===false)).toBe(true);});
  }finally{await db.exec('rollback');}
 });
});

describe('server reminders',()=>{
 it('sends individual overdue reminders only for each unfinished technician and escalates after seven days',async()=>{
  await db.exec('begin');try{
   await db.exec('delete from public.notification_outbox');await db.query("update public.notification_rules set enabled=(kind='task_due') where tenant_id=$1",[tenantA]);
   const task=await asUser(ownerA,()=>value("select public.save_task(null,null,$1,'2026-09-01',0)",[JSON.stringify({name:'Wash own van',instructions:'',cadence:'daily',days:1,completion_mode:'individual',checklist:[],notes_required:false,photo_required:false})]));
   await value("select public.schedule_notifications('2026-09-09T00:00Z')");
   const rows=(await db.query('select recipient_id from public.notification_outbox where tenant_id=$1 and payload->>\'record_id\'=$2',[tenantA,task.id])).rows;
   expect(rows.map((r:any)=>r.recipient_id).sort()).toEqual([ownerA,adminA,techA].sort());
   await db.query("update public.task_person_state set next_due='2026-09-20' where task_id=$1",[task.id]);
   await value("select public.schedule_notifications('2026-09-10T00:00Z')");expect(await value('select count(*) from public.notification_outbox where payload->>\'record_id\'=$1',[task.id])).toBe(3);
  }finally{await db.exec('rollback');}
 });
 it('notifies service crossings once and starts a new cycle after the baseline advances',async()=>{
  await db.exec('begin');try{
   await db.exec('delete from public.notification_outbox');await db.query("update public.notification_rules set enabled=(kind='service_due') where tenant_id=$1",[tenantA]);
   const service=await asUser(ownerA,()=>value("select public.save_service_schedule($1,$2,'asset',0,null,'starting_point')",[assetA,JSON.stringify({name:'Reminder test',instructions:'',mode:'meter',meter_unit:'hours',interval_reading:1,interval_days:null})]));
   await value("select public.schedule_notifications('2026-09-09T00:00Z')");const count=await value('select count(*) from public.notification_outbox where payload->>\'record_id\'=$1',[service.id]);expect(count).toBe(3);
   await value("select public.schedule_notifications('2026-09-09T00:01Z')");expect(await value('select count(*) from public.notification_outbox where payload->>\'record_id\'=$1',[service.id])).toBe(count);
   await db.query('update public.asset_service_settings set baseline_reading=999999 where service_id=$1',[service.id]);await value("select public.schedule_notifications('2026-09-09T00:02Z')");
   await db.query('update public.asset_service_settings set baseline_reading=0 where service_id=$1',[service.id]);await value("select public.schedule_notifications('2026-09-09T00:03Z')");expect(await value('select count(*) from public.notification_outbox where payload->>\'record_id\'=$1',[service.id])).toBe(count*2);
  }finally{await db.exec('rollback');}
 });
 it('protects settings from technicians and stale admin saves',async()=>{
  await asUser(techA,async()=>{await expect(value('select public.notification_settings()')).rejects.toThrow(/Admin/);await expect(value('select public.schedule_notifications()')).rejects.toThrow(/permission denied/);});
  await asUser(ownerA,async()=>{expect((await value('select public.notification_settings()')).rules).toHaveLength(6);
   expect(await value("select public.save_notification_rule('hour_log',true,'assigned','push','17:00','{1,2,3,4,5,6,7}',0)")).toEqual({status:'conflict'});
  });
 });
 it('queues daily reminders once, falls back to admins, and respects local weekdays',async()=>{
  await db.exec('begin');try{
   await db.exec('delete from public.notification_outbox');
   await db.query("update public.notification_rules set enabled=(kind='hour_log'),weekdays='{1}',local_time='17:00' where tenant_id=$1",[tenantA]);
   // Monday in Auckland, Sunday in UTC.
   await value("select public.schedule_notifications('2026-09-14T04:59:00Z')");
   expect(await value('select count(*) from public.notification_outbox where tenant_id=$1',[tenantA])).toBe(0);
   await value("select public.schedule_notifications('2026-09-14T05:00:00Z')");
   const count=await value('select count(*) from public.notification_outbox where tenant_id=$1',[tenantA]);expect(count).toBeGreaterThan(0);
   await value("select public.schedule_notifications('2026-09-14T05:01:00Z')");expect(await value('select count(*) from public.notification_outbox where tenant_id=$1',[tenantA])).toBe(count);
   expect(await value('select count(*) from public.notification_outbox where tenant_id=$1 and recipient_id=$2',[tenantA,ownerA])).toBeGreaterThan(0);
   await value("select public.schedule_notifications('2026-09-15T05:00:00Z')");expect(await value('select count(*) from public.notification_outbox where tenant_id=$1',[tenantA])).toBe(count);
  }finally{await db.exec('rollback');}
 });
 it('uses the first valid time after a daylight-saving gap and suppresses repeated local occurrences',async()=>{
  expect(await value("select private.reminder_time_due('2026-09-26T13:59Z','Pacific/Auckland','02:30','{7}')")).toBe(false);
  expect(await value("select private.reminder_time_due('2026-09-26T14:00Z','Pacific/Auckland','02:30','{7}')")).toBe(true);
  await db.exec('begin');try{
   await db.exec('delete from public.notification_outbox');await db.query("update public.notification_rules set enabled=(kind='hour_log'),weekdays='{7}',local_time='02:30' where tenant_id=$1",[tenantA]);
   await value("select public.schedule_notifications('2027-04-03T13:30Z')");const count=await value('select count(*) from public.notification_outbox where tenant_id=$1',[tenantA]);expect(count).toBeGreaterThan(0);
   await value("select public.schedule_notifications('2027-04-03T14:30Z')");expect(await value('select count(*) from public.notification_outbox where tenant_id=$1',[tenantA])).toBe(count);
  }finally{await db.exec('rollback');}
 });
});

describe('notification worker authorization and leases',()=>{
 it('prioritizes urgent delivery and skips cancelled candidates without wasting the requested slot',async()=>{
  await db.exec('begin');try{
   await db.exec('delete from public.notification_outbox');
   for(const [n,event,recipient,age] of [[970,'hour_log',ownerA,'2 hours'],[971,'urgent_issue',techA,'1 hour'],[972,'urgent_issue',ownerA,'0 hours']] as const){
    await db.query("insert into public.notification_outbox(id,tenant_id,source_id,event_type,recipient_id,channel,payload,created_at) values($1,$2,$1,$3,$4,'push','{}',now()-$5::interval)",[id(n),tenantA,event,recipient,age]);
   }
   const claimed=await value('select public.claim_notifications(1)');expect(claimed).toHaveLength(1);expect(claimed[0].id).toBe(id(972));
   expect(await value('select status from public.notification_outbox where id=$1',[id(971)])).toBe('cancelled');
   expect((await value('select public.claim_notifications(1)'))[0].id).toBe(id(970));
  }finally{await db.exec('rollback');}
 });

 it('lets a phone withdraw its own registration while protecting another user and read-only data',async()=>{
  await asUser(ownerA,()=>value("select public.register_device_token($1,'ExpoPushToken[owner-test]','ios')",[id(859)]));
  await asUser(techA,()=>value('select public.unregister_device_token($1)',[id(859)]));
  expect(await value('select count(*) from public.device_tokens where installation_id=$1',[id(859)])).toBe(1);
  await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenantA]);
  try{await asUser(ownerA,()=>value('select public.unregister_device_token($1)',[id(859)]));expect(await value('select count(*) from public.device_tokens where installation_id=$1',[id(859)])).toBe(0);}finally{await db.query("update public.tenants set write_until=now()+interval '30 days' where id=$1",[tenantA]);}
 });
 it('keeps device registrations private and removes them with a revoked session',async()=>{
  await asUser(techA,async()=>value("select public.register_device_token($1,'ExpoPushToken[synthetic]','ios')",[id(850)]));
  await asUser(ownerA,async()=>expect((await db.query('select * from public.device_tokens')).rows).toHaveLength(0));
  await db.query('delete from auth.sessions where id=$1',[session(techA)]);
  expect(await value('select count(*) from public.device_tokens where installation_id=$1',[id(850)])).toBe(0);
  await db.query('insert into auth.sessions values($1,$2)',[session(techA),techA]);
 });
 it('prevents clients claiming jobs and prevents stale workers acknowledging a replacement lease',async()=>{
  await asUser(ownerA,async()=>{await expect(value('select public.claim_notifications(1)')).rejects.toThrow(/permission denied/);});
  const jobs=await value('select public.claim_notifications(50)');expect(jobs.length).toBeGreaterThan(0);
  expect(await value('select public.claim_notifications(50)')).toEqual([]);
  const first=jobs[0];await db.query("update public.notification_outbox set lease_until=now()-interval '1 second' where id=$1",[first.id]);
  const replacement=(await value('select public.claim_notifications(1)'))[0];expect(replacement.lease_id).not.toBe(first.lease_id);
  expect(await value("select public.finish_notification($1,$2,'sent','{}')",[first.id,first.lease_id])).toBe(false);
  expect(await value("select public.finish_notification($1,$2,'pending','{}','Synthetic connection failure')",[replacement.id,replacement.lease_id])).toBe(true);
  expect(await value('select status from public.notification_outbox where id=$1',[first.id])).toBe('pending');
  expect(await value('select public.claim_notifications(50)')).toEqual([]);
 });
 it('cancels queued operational messages when the business becomes read-only',async()=>{
  await db.query("update public.notification_outbox set lease_until=null,next_attempt_at=now()-interval '1 second' where tenant_id=$1",[tenantA]);
  await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenantA]);
  expect(await value('select public.claim_notifications(50)')).toEqual([]);
  expect(await value("select count(*) from public.notification_outbox where tenant_id=$1 and status<>'cancelled'",[tenantA])).toBe(0);
  await db.query("update public.tenants set write_until=now()+interval '30 days' where id=$1",[tenantA]);
 });
});

describe('business settings and recorded currency',()=>{
 it('restricts edits to current writable admins and rejects stale settings',async()=>{
  const original=await asUser(ownerA,()=>value('select public.business_settings()'));
  await asUser(techA,async()=>{
   await expect(value('select public.business_settings()')).rejects.toThrow(/Admin/);
   await expect(value("select public.save_business_settings('Forged','Pacific/Auckland',true,'AUD',1)")).rejects.toThrow(/Admin/);
  });
  await db.exec('set role anon');try{await expect(value('select public.business_settings()')).rejects.toThrow(/permission denied/);}finally{await db.exec('reset role');}
  await asUser(ownerA,async()=>{
   expect(await value("select public.save_business_settings('Business A','Pacific/Auckland',true,'AUD',$1)",[original.revision])).toBe(true);
   expect(await value("select public.save_business_settings('Stale','Pacific/Auckland',false,'NZD',$1)",[original.revision])).toBe(false);
   expect(await value('select public.access_status()')).toMatchObject({app_lock:false,reporting_currency:'AUD'});
  });
  expect(await asUser(ownerB,()=>value('select public.business_settings()'))).toMatchObject({name:'Business B',currency:'NZD'});
  await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenantA]);
  try{await asUser(ownerA,async()=>{
   const current=await value('select public.business_settings()');expect(current.currency).toBe('AUD');
   await expect(value("select public.save_business_settings('Business A','Pacific/Auckland',false,'NZD',$1)",[current.revision])).rejects.toThrow(/read-only/);
  });}finally{await db.query("update public.tenants set write_until=now()+interval '30 days',app_lock=false,reporting_currency='NZD' where id=$1",[tenantA]);}
 });
 it('keeps earlier costs and delayed submissions in their recorded currency',async()=>{
  await asUser(ownerB,async()=>{
   const before=await value("select public.export_data('services')");expect(before.rows.find((r:any)=>r.id===id(501))).toMatchObject({currency:'NZD',cost:75.5});
   const settings=await value('select public.business_settings()');
   expect(await value("select public.save_business_settings('Business B','Pacific/Auckland',false,'AUD',$1)",[settings.revision])).toBe(true);
   const config={name:'Currency service',instructions:'Synthetic instructions',mode:'meter',meter_unit:'hours',interval_reading:100,interval_days:null};
   const service=(await value("select public.save_service_schedule($1,$2,'asset',0,null,'last_service')",[assetB,JSON.stringify(config)])).id;
   const prepared=await value('select public.prepare_service_photo($1,$2,$3,1,now(),$4,1)',[id(990),assetB,service,JSON.stringify(config)]);
   await db.query(`insert into storage.objects(bucket_id,name,metadata) values('evidence',$1,'{"size":256,"mimetype":"image/jpeg"}')`,[prepared.path]);
   await value("select public.complete_service($1,12.50,'Delayed offline cost','NZD')",[id(990)]);
   const history=await value('select public.list_service_history($1,$2)',[assetB,service]);expect(history[0]).toMatchObject({currency:'NZD',cost:12.5});
   const after=await value("select public.export_data('services')");expect(after.rows.find((r:any)=>r.id===id(501))).toMatchObject({currency:'NZD',cost:75.5});
   // A retry cannot rewrite the saved cost or its currency.
   await value("select public.complete_service($1,999,'Retry','AUD')",[id(990)]);
   expect((await value('select public.list_service_history($1,$2)',[assetB,service]))[0]).toMatchObject({currency:'NZD',cost:12.5});
  });
 });
});

describe('asset archive and type editing',()=>{
 let machine:string,type:string,service:string,task:any;
 const config={name:'Archive service',instructions:'Synthetic instructions',mode:'meter',meter_unit:'hours',interval_reading:10,interval_days:null};
 it('archives without deleting assignments, pending evidence or setup',async()=>{
  await asUser(ownerB,async()=>{
   type=await value("select public.save_asset_type('Archive test type')");machine=await value("select public.save_asset('Archive test asset',$1,'ARCHIVE',10)",[type]);await value('select public.assign_asset($1,$2,true)',[machine,techB]);
   service=(await value("select public.save_service_schedule($1,$2,'asset',0,null,'last_service')",[machine,JSON.stringify(config)])).id;
   const photo=await value('select public.prepare_service_photo($1,$2,$3,10,now(),$4,1)',[id(985),machine,service,JSON.stringify(config)]);
   await db.query(`insert into storage.objects(bucket_id,name,metadata) values('evidence',$1,'{"size":256,"mimetype":"image/jpeg"}')`,[photo.path]);
   const cfg={name:'Archive task',instructions:'Task instructions',cadence:'daily',days:1,checklist:[],notes_required:false,photo_required:false};
   const taskId=(await value("select public.save_task(null,$1,$2,'2020-01-01',0)",[machine,JSON.stringify(cfg)])).id;
   task=(await value('select public.list_tasks($1)',[machine])).items.find((t:any)=>t.id===taskId);
   await value("select public.prepare_task($1,$2,$3,$4,$5,'[]','',now(),false)",[id(986),task.id,task.occurrence_id,task.revision,JSON.stringify(task.config)]);
   await value("select public.report_issue($1,$2,'Urgent','Synthetic pending alert',now())",[id(987),machine]);
   await value("select public.set_asset_archived($1,true,'Sold equipment')",[machine]);await value("select public.set_asset_archived($1,true,'Retry')",[machine]);
   expect(Number(await value('select current_hours from public.assets where id=$1',[machine]))).toBe(10);
   expect(await value("select count(*) from public.asset_history where asset_id=$1 and kind='archived'",[machine])).toBe(1);
   expect((await value("select public.export_data('assets',$1)",[machine])).rows[0].archived).toBe(true);
   expect(await value('select count(*) from public.asset_assignments where asset_id=$1',[machine])).toBe(1);
  });
  expect(await value("select count(*) from public.notification_outbox where payload->>'asset_id'=$1 and status<>'cancelled'",[machine])).toBe(0);
  await asUser(techB,async()=>{expect((await db.query('select * from public.assets where id=$1',[machine])).rows).toHaveLength(0);await expect(value('select public.list_asset_services($1)',[machine])).rejects.toThrow(/unavailable/);});
 });
 it('blocks prepared and new work until restored, including admin submissions',async()=>{
  await asUser(ownerB,async()=>{
   await expect(value('select public.complete_service($1)',[id(985)])).rejects.toThrow(/archived/);
   await expect(value('select public.complete_task($1)',[id(986)])).rejects.toThrow(/archived/);
   await expect(value('select public.prepare_service_photo($1,$2,$3,10,now(),$4,1)',[id(988),machine,service,JSON.stringify(config)])).rejects.toThrow(/archived/);
   await expect(value('select public.log_hours($1,$2,11,0,now())',[id(988),machine])).rejects.toThrow(/archived/);
   expect((await value('select public.list_asset_services($1)',[machine]))[0].baseline_reading).toBe(0);
   await value("select public.set_asset_archived($1,false,'Return to service')",[machine]);
   expect((await value('select public.list_asset_services($1)',[machine]))[0].baseline_reading).toBe(0);
   expect(await value('select public.complete_service($1)',[id(985)])).toMatchObject({status:'applied'});
   expect(await value('select public.complete_task($1)',[id(986)])).toMatchObject({status:'completed'});
  });
  await asUser(techB,async()=>{expect((await db.query('select * from public.assets where id=$1',[machine])).rows).toHaveLength(1);});
 });
 it('keeps removed service evidence discoverable without exposing another performer or tenant',async()=>{
  await asUser(ownerB,async()=>{
   expect(await value('select public.list_past_asset_services($1)',[machine])).toEqual([]);
   await value('select public.archive_asset_service($1,$2)',[machine,service]);
   expect((await value('select public.list_past_asset_services($1)',[machine])).map((r:any)=>r.id)).toContain(service);
   expect((await value('select public.list_service_history($1,$2)',[machine,service]))).toHaveLength(1);
  });
  await asUser(techB,async()=>{expect(await value('select public.list_past_asset_services($1)',[machine])).toEqual([]);});
  await asUser(ownerA,async()=>{await expect(value('select public.list_past_asset_services($1)',[machine])).rejects.toThrow(/unavailable/);});
  await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenantB]);
  try{await asUser(ownerB,async()=>{expect(await value('select public.list_past_asset_services($1)',[machine])).toHaveLength(1);});}
  finally{await db.query("update public.tenants set write_until=now()+interval '30 days' where id=$1",[tenantB]);}
 });
 it('restricts archive and rename actions, retaining admin exports while read-only',async()=>{
  await asUser(techB,async()=>{await expect(value("select public.set_asset_archived($1,true,'Denied')",[machine])).rejects.toThrow(/Admin/);await expect(value("select public.save_asset_type('Denied',$1)",[type])).rejects.toThrow(/Admin/);});
  await asUser(ownerA,async()=>{await expect(value("select public.set_asset_archived($1,true,'Denied')",[machine])).rejects.toThrow(/unavailable/);await expect(value("select public.save_asset_type('Denied',$1)",[type])).rejects.toThrow(/unavailable/);});
  await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenantB]);
  try{await asUser(ownerB,async()=>{await expect(value("select public.set_asset_archived($1,true,'Denied')",[machine])).rejects.toThrow(/read-only/);expect((await value("select public.export_data('services',$1)",[machine])).rows).toHaveLength(1);});}finally{await db.query("update public.tenants set write_until=now()+interval '30 days' where id=$1",[tenantB]);}
 });
 it('renames the shared type with an asset audit record without rewriting evidence',async()=>{
  await asUser(ownerB,async()=>{
   await value("select public.save_asset_type('Renamed type',$1)",[type]);await value("select public.save_asset_type('Renamed type',$1)",[type]);
   expect(await value("select count(*) from public.asset_history where asset_id=$1 and kind='type_renamed'",[machine])).toBe(1);
   expect((await value('select public.list_service_history($1,$2)',[machine,service]))[0].snapshot).toMatchObject(config);
   expect((await value("select public.export_data('assets',$1)",[machine])).rows[0].type).toBe('Renamed type');
  });
 });
});

describe('current counter correction',()=>{
 let machine:string;const first=id(980),second=id(981),capture='2026-09-09T01:00:00Z';
 it('corrects a mistaken setup without fabricating an earlier reading',async()=>{
  await asUser(ownerB,async()=>{
   machine=await value("select public.save_asset('Correction setup',$1,'',5000,null,'km')",[typeB]);
   expect(await value("select public.correct_asset_reading($1,$2,4500,0,$3,'Setup typo',false)",[first,machine,capture])).toMatchObject({status:'confirmation_required'});
   expect(await value("select public.correct_asset_reading($1,$2,4500,0,$3,'Setup typo',true)",[first,machine,capture])).toMatchObject({status:'accepted',revision:1});
   const row=(await db.query('select * from public.hour_logs where id=$1',[first])).rows[0] as any;expect(row.correction_of).toBeNull();expect(row.correction_of_setup).toBeTruthy();expect(Number(row.delta)).toBe(-500);
   expect(await value("select (details->>'initial_hours')::numeric from public.asset_history where id=$1",[row.correction_of_setup])).toBe('5000');
   expect((await value("select public.export_data('logs',$1)",[machine])).rows[0]).toMatchObject({correction_of_setup:row.correction_of_setup,reading:4500,unit:'km'});
  });
 });
 it('links later corrections, protects a newer counter and preserves retry identity',async()=>{
  await asUser(ownerB,async()=>{
   expect(await value("select public.correct_asset_reading($1,$2,4600,0,$3,'Later correction',true)",[second,machine,capture])).toMatchObject({status:'conflict'});
   expect(await value("select public.correct_asset_reading($1,$2,4600,1,$3,'Later correction',true)",[second,machine,capture])).toMatchObject({status:'accepted',revision:2});
   expect(await value('select correction_of from public.hour_logs where id=$1',[second])).toBe(first);
   expect(await value("select public.correct_asset_reading($1,$2,4500,0,$3,'Setup typo',true)",[first,machine,capture])).toMatchObject({duplicate:true});
   expect(Number(await value('select current_hours from public.assets where id=$1',[machine]))).toBe(4600);
   expect(await value('select count(*) from public.hour_logs where asset_id=$1',[machine])).toBe(2);
  });
 });
 it('denies technicians, another business and read-only correction requests',async()=>{
  await asUser(techB,async()=>{await expect(value("select public.correct_asset_reading($1,$2,1,2,$3,'Not allowed',true)",[id(982),machine,capture])).rejects.toThrow(/Admin/);});
  await asUser(ownerA,async()=>{await expect(value("select public.correct_asset_reading($1,$2,1,2,$3,'Not allowed',true)",[id(982),machine,capture])).rejects.toThrow(/unavailable/);});
  await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenantB]);
  try{await asUser(ownerB,async()=>{await expect(value("select public.correct_asset_reading($1,$2,1,2,$3,'Not allowed',true)",[id(982),machine,capture])).rejects.toThrow(/read-only/);});}finally{await db.query("update public.tenants set write_until=now()+interval '30 days' where id=$1",[tenantB]);}
 });
 it('links to the new-unit setup when correcting immediately after a unit change',async()=>{
  await asUser(ownerB,async()=>{
   await value("select public.edit_asset($1,'Correction setup',$2,'','hours',100,2,'Wrong unit',true)",[machine,typeB]);
   expect(await value("select public.correct_asset_reading($1,$2,90,3,$3,'Correct hour baseline',true)",[id(983),machine,capture])).toMatchObject({status:'accepted'});
   const row=(await db.query('select * from public.hour_logs where id=$1',[id(983)])).rows[0] as any;expect(row.meter_unit).toBe('hours');expect(row.correction_of).toBeNull();
   expect(await value('select kind from public.asset_history where id=$1',[row.correction_of_setup])).toBe('meter_unit_correction');
  });
 });
});

describe('live access changes',()=>{
  it('ordinary admins cannot promote staff or transfer ownership',async()=>{
    await asUser(adminA,async()=>{
      await expect(value("select public.manage_staff($1,'promote')",[techA])).rejects.toThrow(/Owner access/);
      await expect(value("select public.manage_staff($1,'transfer')",[techA])).rejects.toThrow(/Owner access/);
      await expect(value("select public.manage_staff($1,'deactivate')",[ownerA])).rejects.toThrow(/Transfer ownership/);
    });
  });
  it('reactivation requires an available seat and restores login without losing assignments',async()=>{
    await asUser(ownerA,()=>value("select public.manage_staff($1,'deactivate')",[techA]));
    await db.query('update public.tenants set seat_limit=2 where id=$1',[tenantA]);
    try{await asUser(ownerA,async()=>{await expect(value("select public.manage_staff($1,'activate')",[techA])).rejects.toThrow(/limit/);});}
    finally{await db.query('update public.tenants set seat_limit=3 where id=$1',[tenantA]);await asUser(ownerA,()=>value("select public.manage_staff($1,'activate')",[techA]));await db.query('insert into auth.sessions values($1,$2)',[session(techA),techA]);}
    await asUser(techA,async()=>{expect(await value('select public.access_status()')).toMatchObject({allowed:true});expect((await db.query('select * from public.assets')).rows).toHaveLength(1);});
  });

  it('seat limit is enforced on provisioning accepted staff',async()=>{
    const extra=id(7);await db.query('insert into auth.users values($1)',[extra]);
    await expect(value("select public.provision_staff($1,$2,'Extra staff')",[tenantA,extra])).rejects.toThrow(/limit/);
    expect(await value('select count(*) from public.memberships where tenant_id=$1',[tenantA])).toBe(3);
  });
  it('owner transfer preserves one active owner and removes former owner privileges',async()=>{
    await asUser(ownerA,async()=>value("select public.manage_staff($1,'transfer')",[adminA]));
    await asUser(ownerA,async()=>{
      expect(await value('select public.access_status()')).toMatchObject({role:'admin'});
      await expect(value("select public.manage_staff($1,'transfer')",[techA])).rejects.toThrow(/Owner/);
    });
    await asUser(adminA,async()=>{
      expect(await value('select public.access_status()')).toMatchObject({role:'owner'});
      await value("select public.manage_staff($1,'transfer')",[ownerA]);
    });
    await expect(db.query('update public.memberships set is_active=false where user_id=$1',[ownerA])).rejects.toThrow(/active owner/);
  });
  it('read-only denies writes but preserves reads',async()=>{
    await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenantA]);
    await asUser(ownerA,async()=>{
      expect(await value('select public.access_status()')).toMatchObject({allowed:true,can_write:false});
      expect((await db.query('select * from public.assets')).rows).toHaveLength(2);
      await expect(value("select public.save_asset_type('Denied')")).rejects.toThrow(/read-only/);
      await expect(value("select public.manage_staff($1,'activate')",[techA])).rejects.toThrow(/read-only/);
    });
    await db.query("update public.tenants set write_until=now()+interval '30 days' where id=$1",[tenantA]);
  });
  it('reassignment immediately removes technician access',async()=>{
    await asUser(ownerA,async()=>value('select public.assign_asset($1,$2,false)',[assetA,techA]));
    await asUser(techA,async()=>expect((await db.query('select * from public.assets')).rows).toHaveLength(0));
    await asUser(ownerA,async()=>value('select public.assign_asset($1,$2,true)',[assetA,techA]));
  });
  it('remote sign-out denies the old session and removes refresh tokens',async()=>{
    await db.query('insert into auth.refresh_tokens values(1,$1)',[session(techA)]);
    await asUser(ownerA,async()=>value("select public.manage_staff($1,'sign_out')",[techA]));
    await asUser(techA,async()=>{
      expect(await value('select public.access_status()')).toMatchObject({allowed:false,reason:'signed_out'});
      expect((await db.query('select * from public.assets')).rows).toHaveLength(0);
      await expect(value('select public.log_hours($1,$2,1246,2,now())',[id(207),assetA])).rejects.toThrow(/Access denied/);
    });
    expect(await value('select count(*) from auth.refresh_tokens')).toBe(0);
    await db.query('insert into auth.sessions values($1,$2)',[session(techA),techA]);
    await asUser(techA,async()=>expect(await value('select public.access_status()')).toMatchObject({allowed:true}));
  });
  it('deactivated user is denied even with a newly minted test session',async()=>{
    await asUser(ownerA,async()=>value("select public.manage_staff($1,'deactivate')",[techA]));
    await db.query('insert into auth.sessions values($1,$2)',[session(techA),techA]);
    await asUser(techA,async()=>{
      expect(await value('select public.access_status()')).toMatchObject({allowed:false,reason:'inactive'});
      expect((await db.query('select * from public.assets')).rows).toHaveLength(0);
    });
  });
});


describe('staff invitation acceptance',()=>{
 const owner=id(1300),admin=id(1301),joiner=id(1302),second=id(1303),outsider=id(1304),unconfirmed=id(1305);
 let tenant:string,otherTenant:string,invite:string,nextInvite:string;
 beforeAll(async()=>{
  for(const user of [owner,admin,joiner,second,outsider,unconfirmed]){
   await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)',[user,`${user}@example.invalid`,user===unconfirmed?null:new Date().toISOString()]);
   await db.query('insert into auth.sessions values($1,$2)',[session(user),user]);
  }
  tenant=await value("select public.provision_business($1,'Invitation business','Invite owner',now()+interval '1 day')",[owner]);
  otherTenant=await value("select public.provision_business($1,'Other invitation business','Other owner',now()+interval '1 day')",[outsider]);
  await value("select public.provision_staff($1,$2,'Invite admin')",[tenant,admin]);
  await asUser(owner,()=>value("select public.manage_staff($1,'promote')",[admin]));
 });
 const create=(user:string,emailUser:string,key:number)=>asUser(user,()=>value("select public.create_staff_invitation($1,$2,'New staff','123','Technician')",[id(key),`${emailUser}@example.invalid`]));
 it('creates one pending invitation per email without consuming a seat; retries keep its identity',async()=>{
  invite=(await create(admin,joiner,1310)).id;
  expect((await create(admin,joiner,1310)).id).toBe(invite);
  expect((await create(owner,joiner,1311)).id).toBe(invite);
  nextInvite=(await create(owner,second,1312)).id;
  expect(Number(await value('select count(*) from public.memberships where tenant_id=$1 and is_active',[tenant]))).toBe(2);
  expect(Number(await value('select count(*) from public.staff_invitations where tenant_id=$1',[tenant]))).toBe(2);
  await asUser(outsider,()=>expect(value("select public.create_staff_invitation($1,$2,'Forged')",[invite,`${joiner}@example.invalid`])).rejects.toThrow(/unavailable/));
 });
 it('only shows invitations to current admins or their verified recipient',async()=>{
  await asUser(outsider,async()=>{
   expect((await db.query('select id from public.staff_invitations where tenant_id=$1',[tenant])).rows).toHaveLength(0);
   await expect(value('select public.cancel_staff_invitation($1)',[invite])).rejects.toThrow(/unavailable/);
   await expect(value("select public.accept_staff_invitation($1,'Other person')",[invite])).rejects.toThrow(/unavailable/);
  });
  await asUser(joiner,async()=>{
   expect((await value('select public.my_staff_invitations()')).map((i:any)=>i.id)).toEqual([invite]);
   expect((await db.query('select id from public.staff_invitations')).rows).toHaveLength(0);
   await expect(value("select public.create_staff_invitation($1,'nobody@example.invalid','No')",[id(1313)])).rejects.toThrow(/Access denied/);
  });
  await db.exec('set role anon');try{await expect(value('select public.my_staff_invitations()')).rejects.toThrow(/permission denied/);}finally{await db.exec('reset role');}
 });
 it('requires confirmed email and a current unrevoked session before joining',async()=>{
  await create(owner,unconfirmed,1314);
  await asUser(unconfirmed,()=>expect(value('select public.my_staff_invitations()')).rejects.toThrow(/Confirm your email/));
  await db.query('delete from auth.sessions where user_id=$1',[joiner]);
  try{await asUser(joiner,()=>expect(value("select public.accept_staff_invitation($1,'Joiner')",[invite])).rejects.toThrow(/Sign in again/));}
  finally{await db.query('insert into auth.sessions values($1,$2)',[session(joiner),joiner]);}
 });
 it('accepts once as technician with personal details, regardless of the inviting admin role',async()=>{
  await asUser(joiner,()=>value("select public.accept_staff_invitation($1,'Confirmed name','456','Field operator')",[invite]));
  expect((await db.query('select role,name,phone,contact_email,job_title from public.memberships where user_id=$1',[joiner])).rows[0]).toEqual({role:'technician',name:'Confirmed name',phone:'456',contact_email:`${joiner}@example.invalid`,job_title:'Field operator'});
  await asUser(joiner,async()=>{
   await expect(value("select public.accept_staff_invitation($1,'Repeat')",[invite])).rejects.toThrow(/no longer available/);
   expect(await value('select public.my_staff_invitations()')).toEqual([]);
   await expect(value('select public.cancel_staff_invitation($1)',[nextInvite])).rejects.toThrow(/Admin/);
  });
 });
 it('rechecks the last seat on acceptance and does not consume an unsuccessful invitation',async()=>{
  await asUser(second,()=>expect(value("select public.accept_staff_invitation($1,'Second')",[nextInvite])).rejects.toThrow(/Staff limit/));
  expect(await value('select accepted_at from public.staff_invitations where id=$1',[nextInvite])).toBeNull();
  expect(Number(await value('select count(*) from public.memberships where tenant_id=$1 and is_active',[tenant]))).toBe(3);
 });
 it('rejects expired and cancelled invitations while allowing read-only cancellation',async()=>{
  await db.query("update public.staff_invitations set expires_at=now()-interval '1 second' where id=$1",[nextInvite]);
  await asUser(second,()=>expect(value("select public.accept_staff_invitation($1,'Second')",[nextInvite])).rejects.toThrow(/expired/));
  nextInvite=(await create(owner,second,1315)).id;
  expect(nextInvite).toBe(id(1315));
  await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenant]);
  try{
   await asUser(second,()=>expect(value("select public.accept_staff_invitation($1,'Second')",[nextInvite])).rejects.toThrow(/read-only/));
   await expect(create(owner,second,1316)).rejects.toThrow(/read-only/);
   await asUser(owner,()=>value('select public.cancel_staff_invitation($1)',[nextInvite]));
   await asUser(second,()=>expect(value("select public.accept_staff_invitation($1,'Second')",[nextInvite])).rejects.toThrow(/no longer available/));
  }finally{await db.query("update public.tenants set write_until=now()+interval '1 day' where id=$1",[tenant]);}
 });
 it('cannot use a new invitation to reactivate an existing deactivated membership',async()=>{
  await asUser(owner,()=>value("select public.manage_staff($1,'deactivate')",[joiner]));
  await expect(create(owner,joiner,1317)).rejects.toThrow(/already has business access/);
 });
 it('withdraws joining authority if the inviter no longer has admin access',async()=>{
  const pending=(await create(admin,second,1318)).id;
  await asUser(owner,()=>value("select public.manage_staff($1,'demote')",[admin]));
  await asUser(second,async()=>{
   expect(await value('select public.my_staff_invitations()')).toEqual([]);
   await expect(value("select public.accept_staff_invitation($1,'Second')",[pending])).rejects.toThrow(/unavailable/);
  });
 });
});


describe('staff invitation delivery authorization',()=>{
 const owner=id(1400),admin=id(1401),tech=id(1402),other=id(1403);let tenant:string;
 beforeAll(async()=>{
  for(const u of [owner,admin,tech,other]){await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[u,`${u}@example.invalid`]);await db.query('insert into auth.sessions values($1,$2)',[session(u),u]);}
  tenant=await value("select public.provision_business($1,'Delivery test','Owner',now()+interval '1 day')",[owner]);
  await value("select public.provision_business($1,'Other delivery test','Other',now()+interval '1 day')",[other]);
  await value("select public.provision_staff($1,$2,'Admin')",[tenant,admin]);
  await value("select public.provision_staff($1,$2,'Tech')",[tenant,tech]);
  await asUser(owner,()=>value("select public.manage_staff($1,'promote')",[admin]));
 });
 const create=(key:number,actor=owner)=>asUser(actor,()=>value("select public.create_staff_invitation($1,$2,'Recipient')",[id(key),`delivery-${key}@example.invalid`]));
 it('derives recipient and business from current admin access, never from supplied authority',async()=>{
  await create(1410);const context=await asUser(owner,()=>value('select public.staff_invitation_delivery_context($1)',[id(1410)]));
  expect(context).toMatchObject({email:'delivery-1410@example.invalid',business_name:'Delivery test',existing_auth:false,delivery_status:'not_sent'});
  for(const actor of [tech,other])await asUser(actor,()=>expect(value('select public.staff_invitation_delivery_context($1)',[id(1410)])).rejects.toThrow(/Admin|unavailable/));
 });
 it('serializes sends and only lets the service record the matching current attempt',async()=>{
  await create(1411);const first=await asUser(owner,()=>value('select public.claim_staff_invitation_delivery($1)',[id(1411)]));expect(first.status).toBe('claimed');
  expect(await asUser(owner,()=>value('select public.claim_staff_invitation_delivery($1)',[id(1411)]))).toEqual({status:'wait'});
  await asUser(owner,()=>expect(value("select public.finish_staff_invitation_delivery($1,$2,'sent')",[id(1411),first.attempt])).rejects.toThrow(/permission denied/));
  await db.exec('set role service_role');try{
   expect(await value("select public.finish_staff_invitation_delivery($1,$2,'sent')",[id(1411),id(1499)])).toBe(false);
   expect(await value("select public.finish_staff_invitation_delivery($1,$2,'sent')",[id(1411),first.attempt])).toBe(true);
   expect(await value("select public.finish_staff_invitation_delivery($1,$2,'failed')",[id(1411),first.attempt])).toBe(false);
  }finally{await db.exec('reset role');}
  expect(await value('select last_sent_at is not null from public.staff_invitations where id=$1',[id(1411)])).toBe(true);
  await db.query("update public.staff_invitations set delivery_started_at=now()-interval '3 minutes' where id=$1",[id(1411)]);
  const second=await asUser(owner,()=>value('select public.claim_staff_invitation_delivery($1)',[id(1411)]));expect(second.attempt).not.toBe(first.attempt);
  await asUser(owner,()=>expect(value('select public.staff_invitation_delivery_context($1,$2)',[id(1411),first.attempt])).rejects.toThrow(/attempt unavailable/));
 });
 it('cancellation and expiry stop a claimed attempt before provider sending',async()=>{
  await create(1412);const claim=await asUser(owner,()=>value('select public.claim_staff_invitation_delivery($1)',[id(1412)]));
  await asUser(owner,()=>value('select public.cancel_staff_invitation($1)',[id(1412)]));
  await asUser(owner,()=>expect(value('select public.staff_invitation_delivery_context($1,$2)',[id(1412),claim.attempt])).rejects.toThrow(/unavailable/));
  await create(1413);await db.query("update public.staff_invitations set expires_at=now()-interval '1 second' where id=$1",[id(1413)]);
  await asUser(owner,()=>expect(value('select public.claim_staff_invitation_delivery($1)',[id(1413)])).rejects.toThrow(/unavailable/));
 });
 it('allows read-only status inspection but denies sending and rechecks entitlement mid-attempt',async()=>{
  await create(1414);const claim=await asUser(owner,()=>value('select public.claim_staff_invitation_delivery($1)',[id(1414)]));
  await db.query("update public.tenants set write_until=now()-interval '1 second' where id=$1",[tenant]);
  try{await asUser(owner,async()=>{
   expect((await value('select public.staff_invitation_delivery_context($1)',[id(1414)])).id).toBe(id(1414));
   await expect(value('select public.claim_staff_invitation_delivery($1)',[id(1414)])).rejects.toThrow(/read-only/);
   await expect(value('select public.staff_invitation_delivery_context($1,$2)',[id(1414),claim.attempt])).rejects.toThrow(/read-only/);
  });}finally{await db.query("update public.tenants set write_until=now()+interval '1 day' where id=$1",[tenant]);}
 });
 it('rechecks current session and original inviter authority',async()=>{
  await create(1415,admin);await db.query('delete from auth.sessions where user_id=$1',[admin]);
  await asUser(admin,()=>expect(value('select public.claim_staff_invitation_delivery($1)',[id(1415)])).rejects.toThrow(/Access denied/));
  await db.query('insert into auth.sessions values($1,$2)',[session(admin),admin]);
  await asUser(owner,()=>value("select public.manage_staff($1,'demote')",[admin]));
  await asUser(owner,()=>expect(value('select public.claim_staff_invitation_delivery($1)',[id(1415)])).rejects.toThrow(/unavailable/));
 });
});

describe('shared branding and invitation photos',()=>{
 const owner=id(1501),tech=id(1502),joiner=id(1503),logo=id(1510),replacement=id(1511),inv=id(1520),portrait=id(1521);let tenant:string;
 const upload=async(p:string)=>db.query("insert into storage.objects(bucket_id,name,metadata) values('evidence',$1,'{\"size\":100,\"mimetype\":\"image/jpeg\"}')",[p]);
 beforeAll(async()=>{
  for(const u of [owner,tech,joiner]){await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[u,u+'@branding.test']);await db.query('insert into auth.sessions values($1,$2)',[session(u),u]);}
  tenant=await value("select public.provision_business($1,'Branding test','Owner',now()+interval '30 days')",[owner]);
  await value("select public.provision_staff($1,$2,'Technician')",[tenant,tech]);
 });
 it('shares the admin theme with current members, isolates businesses and rejects stale edits',async()=>{
  await asUser(owner,async()=>{expect(await value('select public.save_business_branding($1,0)',['ocean'])).toBe(true);expect(await value('select public.save_business_branding($1,0)',['plum'])).toBe(false);await expect(value('select public.save_business_branding($1,1)',['invalid'])).rejects.toThrow(/colour/);});
  await asUser(tech,async()=>{expect(await value('select public.business_branding()')).toMatchObject({tenant_id:tenant,theme:'ocean',revision:1});await expect(value("select public.save_business_branding('plum',1)")).rejects.toThrow(/Admin/);});
  await asUser(ownerB,async()=>expect(await value('select public.business_branding()')).toMatchObject({tenant_id:tenantB,theme:'forest'}));
 });
 it('allows member logo reads but only same-business admin uploads with actual bytes',async()=>{
  await asUser(tech,async()=>{await expect(value("select public.prepare_profile_photo($1,'business',$2)",[logo,tenant])).rejects.toThrow(/Admin/);});
  await asUser(owner,async()=>{
   await expect(value("select public.prepare_profile_photo($1,'business',$2)",[logo,tenantB])).rejects.toThrow(/unavailable/);
   const path=await value("select public.prepare_profile_photo($1,'business',$2)",[logo,tenant]);
   await expect(value("select public.save_profile_photo('business',$1,$2,0)",[tenant,logo])).rejects.toThrow(/not finished/);await upload(path);
   expect(await value("select public.save_profile_photo('business',$1,$2,0)",[tenant,logo])).toMatchObject({status:'saved'});
  });
  await asUser(tech,async()=>expect(await value('select public.authorize_profile_photo($1)',[logo])).toContain('profile-'));
  await asUser(ownerB,async()=>{await expect(value("select public.get_profile_photo('business',$1)",[tenant])).rejects.toThrow(/unavailable/);await expect(value('select public.authorize_profile_photo($1)',[logo])).rejects.toThrow(/unavailable/);});
 });
 it('keeps the old logo on conflicting replacement and removes access to superseded media',async()=>{
  await asUser(owner,async()=>{await upload(await value("select public.prepare_profile_photo($1,'business',$2)",[replacement,tenant]));expect(await value("select public.save_profile_photo('business',$1,$2,0)",[tenant,replacement])).toMatchObject({status:'conflict'});expect(await value('select public.authorize_profile_photo($1)',[logo])).toContain('profile-');await value("select public.save_profile_photo('business',$1,$2,1)",[tenant,replacement]);await expect(value('select public.authorize_profile_photo($1)',[logo])).rejects.toThrow(/unavailable/);});
 });
 it('blocks branding edits in read-only while retaining logo reads',async()=>{
  await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenant]);
  try{await asUser(owner,async()=>{await expect(value("select public.save_business_branding('plum',1)")).rejects.toThrow(/read-only/);await expect(value("select public.save_profile_photo('business',$1,null,2)",[tenant])).rejects.toThrow(/read-only/);expect(await value('select public.authorize_profile_photo($1)',[replacement])).toContain('profile-');});}finally{await db.query("update public.tenants set write_until=now()+interval '30 days' where id=$1",[tenant]);}
 });
 it('blocks deactivated and revoked users from branding and logo reads',async()=>{
  await asUser(owner,()=>value("select public.manage_staff($1,'deactivate')",[tech]));
  await asUser(tech,async()=>{await expect(value('select public.business_branding()')).rejects.toThrow(/Access denied/);await expect(value('select public.authorize_profile_photo($1)',[replacement])).rejects.toThrow(/Access denied/);});
  await asUser(owner,()=>value("select public.manage_staff($1,'activate')",[tech]));
  await db.query('delete from auth.sessions where user_id=$1',[tech]);
  await asUser(tech,()=>expect(value('select public.business_branding()')).rejects.toThrow(/Access denied/));
  await db.query('insert into auth.sessions values($1,$2)',[session(tech),tech]);
 });
 it('stores a pending invitation photo privately and transfers it on verified acceptance',async()=>{
  await asUser(owner,async()=>{await value("select public.create_staff_invitation($1,$2,'New staff')",[inv,joiner+'@branding.test']);await upload(await value("select public.prepare_profile_photo($1,'invitation',$2)",[portrait,inv]));await value("select public.save_profile_photo('invitation',$1,$2,0)",[inv,portrait]);});
  await asUser(tech,()=>expect(value('select public.authorize_profile_photo($1)',[portrait])).rejects.toThrow(/unavailable/));
  await asUser(ownerB,()=>expect(value("select public.prepare_profile_photo($1,'invitation',$2)",[id(1522),inv])).rejects.toThrow(/unavailable/));
  await asUser(joiner,()=>value("select public.accept_staff_invitation($1,'New staff')",[inv]));
  await asUser(joiner,async()=>{expect(await value("select public.get_profile_photo('member',$1)",[joiner])).toMatchObject({id:portrait});expect(await value('select public.authorize_profile_photo($1)',[portrait])).toContain('profile-');});
  await asUser(owner,()=>expect(value("select public.prepare_profile_photo($1,'invitation',$2)",[id(1523),inv])).rejects.toThrow(/unavailable/));
 });
 it('cancelled invitations stop photo finalization and business logo removal restores empty state',async()=>{
  await asUser(owner,async()=>{
   await value("select public.create_staff_invitation($1,'cancel@branding.test','Cancelled')",[id(1530)]);
   await upload(await value("select public.prepare_profile_photo($1,'invitation',$2)",[id(1531),id(1530)]));
   await value('select public.cancel_staff_invitation($1)',[id(1530)]);
   await expect(value("select public.save_profile_photo('invitation',$1,$2,0)",[id(1530),id(1531)])).rejects.toThrow(/unavailable/);
   await value("select public.save_profile_photo('business',$1,null,2)",[tenant]);expect(await value("select public.get_profile_photo('business',$1)",[tenant])).toMatchObject({id:null,revision:3});await expect(value('select public.authorize_profile_photo($1)',[replacement])).rejects.toThrow(/unavailable/);
  });
 });
});

describe('custom branding and current workspace summaries',()=>{
 const owner=id(1601),tech=id(1602);let tenant:string,assigned:string,hidden:string;
 beforeAll(async()=>{for(const user of [owner,tech]){await db.query('insert into auth.users(id) values($1)',[user]);await db.query('insert into auth.sessions values($1,$2)',[session(user),user]);}tenant=await value("select public.provision_business($1,'Overview','Owner',now()+interval '30 days')",[owner]);await value("select public.provision_staff($1,$2,'Tech')",[tenant,tech]);await asUser(owner,async()=>{const type=await value("select public.save_asset_type('Equipment')");assigned=await value("select public.save_asset('Assigned',$1,'',10)",[type]);hidden=await value("select public.save_asset('Admin only',$1,'',10)",[type]);await value('select public.assign_asset($1,$2,true)',[assigned,tech]);});await db.query("update public.notification_rules set local_time='00:00',weekdays=array[1,2,3,4,5,6,7],enabled=true where tenant_id=$1 and kind='hour_log'",[tenant]);});
 it('stores exact HEX under admin entitlement and revision checks',async()=>{await asUser(owner,async()=>{expect(await value("select public.save_business_branding('#ffee00',0)")).toBe(true);expect(await value('select public.business_branding()')).toMatchObject({theme:'#FFEE00'});expect(await value("select public.save_business_branding('#123456',0)")).toBe(false);await expect(value("select public.save_business_branding('invalid',1)")).rejects.toThrow(/HEX/);});await asUser(tech,()=>expect(value("select public.save_business_branding('#123456',1)")).rejects.toThrow(/Admin/));});
 it('returns only current assigned assets to technicians and the whole business to admins',async()=>{await asUser(tech,async()=>{const result=await value('select public.workspace_overview()');expect(result.assets.map((a:any)=>a.id)).toEqual([assigned]);expect(result.assets[0].reading_due).toBe(true);expect(attentionItems(result,[{id:assigned,name:'Assigned',meter_unit:'hours',archived:false} as any])).toMatchObject([{kind:'hour_log',assetId:assigned}]);});await asUser(owner,async()=>expect((await value('select public.workspace_overview()')).assets).toHaveLength(2));await asUser(ownerB,async()=>expect((await value('select public.workspace_overview()')).assets.map((a:any)=>a.id)).not.toContain(assigned));});
 it('uses the existing daily meter reminder baseline and removes withdrawn access',async()=>{await asUser(tech,async()=>{await value('select public.log_hours($1,$2,11,0,now())',[id(1603),assigned]);expect((await value('select public.workspace_overview()')).assets[0].reading_due).toBe(false);});await asUser(owner,()=>value('select public.assign_asset($1,$2,false)',[assigned,tech]));await asUser(tech,async()=>expect((await value('select public.workspace_overview()')).assets).toEqual([]));});
 it('retains read-only summaries but blocks revoked and inactive viewers',async()=>{await db.query("update public.tenants set write_until=now()-interval '1 day' where id=$1",[tenant]);await asUser(owner,async()=>{expect((await value('select public.workspace_overview()')).assets).toHaveLength(2);await expect(value("select public.save_business_branding('#123456',1)")).rejects.toThrow(/read-only/);});await db.query('update public.memberships set is_active=false where user_id=$1',[tech]);await asUser(tech,()=>expect(value('select public.workspace_overview()')).rejects.toThrow(/Access denied/));await db.query('delete from auth.sessions where user_id=$1',[owner]);await asUser(owner,()=>expect(value('select public.workspace_overview()')).rejects.toThrow(/Access denied/));});
});
