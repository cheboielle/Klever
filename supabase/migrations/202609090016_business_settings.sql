alter table public.tenants add column reporting_currency text not null default 'NZD' check(reporting_currency in ('NZD','AUD','USD','CAD','GBP','EUR'));
alter table public.tenants add column settings_revision integer not null default 1;
alter table public.service_admin_details add column currency text not null default 'NZD' check(currency in ('NZD','AUD','USD','CAD','GBP','EUR'));
create function private.business_settings_revision() returns trigger language plpgsql set search_path='' as $$begin
 if (new.name,new.timezone,new.app_lock,new.reporting_currency) is distinct from (old.name,old.timezone,old.app_lock,old.reporting_currency) then new.settings_revision:=old.settings_revision+1;end if;return new;end$$;
create trigger business_settings_revision before update on public.tenants for each row execute function private.business_settings_revision();
create function public.business_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tid uuid:=private.require_access(true,false);begin return (select jsonb_build_object('name',name,'timezone',timezone,'app_lock',app_lock,'currency',reporting_currency,'revision',settings_revision) from public.tenants where id=tid);end$$;
create function public.save_business_settings(p_name text,p_timezone text,p_lock boolean,p_currency text,p_revision integer) returns boolean language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true);begin
 if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Choose a valid business timezone';end if;
 update public.tenants set name=btrim(p_name),timezone=p_timezone,app_lock=p_lock,reporting_currency=p_currency where id=tid and settings_revision=p_revision;return found;end$$;
revoke execute on function private.business_settings_revision(),public.business_settings(),public.save_business_settings(text,text,boolean,text,integer) from public,anon,authenticated;
grant execute on function public.business_settings(),public.save_business_settings(text,text,boolean,text,integer) to authenticated;
create or replace function public.access_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.memberships; t public.tenants;
begin
  if not exists(select 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid()) then
    return jsonb_build_object('allowed',false,'reason','signed_out');
  end if;
  select * into m from public.memberships where user_id=auth.uid();
  if not found then return jsonb_build_object('allowed',false,'reason','not_provisioned'); end if;
  if not m.is_active then return jsonb_build_object('allowed',false,'reason','inactive'); end if;
  select * into t from public.tenants where id=m.tenant_id;
  return jsonb_build_object('allowed',true,'user_id',m.user_id,'tenant_id',t.id,'tenant_name',t.name,'name',m.name,
    'role',case when t.owner_user_id=m.user_id then 'owner' else m.role end,
    'can_write',t.write_until>now(),'access_ends_at',t.write_until,'app_lock',t.app_lock,'reporting_currency',t.reporting_currency);
end $$;
drop function public.complete_service(uuid,numeric,text);
create function public.complete_service(p_id uuid,p_cost numeric default null,p_mechanic_notes text default '',p_currency text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(); u public.service_uploads; a public.assets; s public.asset_service_settings; current_schedule jsonb; state text:='applied'; service_date date; result public.service_history;
begin
  select * into u from public.service_uploads where id=p_id and tenant_id=tid and submitted_by=auth.uid();
  if not found or not private.can_asset(u.asset_id) then raise exception 'Service submission unavailable' using errcode='42501'; end if;
  select * into a from public.assets where id=u.asset_id and tenant_id=tid for update;
  select * into result from public.service_history where id=p_id;
  if found then return jsonb_build_object('status',result.state,'duplicate',true); end if;
  if not exists(select 1 from storage.objects where bucket_id='evidence' and name=u.object_path and (metadata->>'size')::bigint>0 and metadata->>'mimetype'='image/jpeg') then raise exception 'The required photo has not finished uploading. Retry the upload'; end if;
  if a.meter_unit<>u.meter_unit then raise exception 'The asset meter unit changed. Reopen the service'; end if;
  if not private.is_admin() and (p_cost is not null or length(coalesce(p_mechanic_notes,''))>0) then raise exception 'Only admins can record costs or mechanic notes' using errcode='42501'; end if;
  if p_cost is not null and (p_cost<0 or p_cost::text in ('NaN','Infinity','-Infinity') or p_cost<>round(p_cost,2)) then raise exception 'Enter a valid cost with up to two decimal places'; end if;
  if length(coalesce(p_mechanic_notes,''))>10000 then raise exception 'Mechanic notes are too long'; end if;
  select value into current_schedule from jsonb_array_elements(public.list_asset_services(a.id)) where value->>'id'=u.service_id::text;
  if current_schedule is null then raise exception 'Service is no longer active'; end if;
  select * into s from public.asset_service_settings where tenant_id=tid and asset_id=a.id and service_id=u.service_id for update;
  select (u.capture_time at time zone timezone)::date into service_date from public.tenants where id=tid;
  -- A delayed upload is evidence, but must not reset a newer baseline.
  if coalesce(s.revision,0)<>u.settings_revision or
    (s.baseline_reading is not null and u.reading<s.baseline_reading) or
    (s.baseline_date is not null and service_date<s.baseline_date) then state:='pending_correction'; end if;
  insert into public.service_history(id,tenant_id,asset_id,service_id,submitted_by,state) values(u.id,tid,a.id,u.service_id,auth.uid(),state);
  if private.is_admin() then insert into public.service_admin_details(tenant_id,history_id,cost,mechanic_notes,currency) values(tid,u.id,p_cost,coalesce(p_mechanic_notes,''),coalesce(p_currency,(select reporting_currency from public.tenants where id=tid))); end if;
  if state='applied' then
    insert into public.asset_service_settings(tenant_id,asset_id,service_id,baseline_reading,baseline_date,baseline_kind)
    values(tid,a.id,u.service_id,case when current_schedule->'config'->>'mode'<>'calendar' then u.reading end,
      case when current_schedule->'config'->>'mode'<>'meter' then service_date end,'last_service')
    on conflict(tenant_id,asset_id,service_id) do update set baseline_reading=excluded.baseline_reading,baseline_date=excluded.baseline_date,baseline_kind='last_service',revision=asset_service_settings.revision+1;
  end if;
  return jsonb_build_object('status',state,'duplicate',false);
end $$;
revoke execute on function public.complete_service(uuid,numeric,text,text) from public,anon,authenticated;
grant execute on function public.complete_service(uuid,numeric,text,text) to authenticated;
create or replace function public.list_service_history(p_asset uuid,p_service uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tid uuid:=private.require_access(false,false); admin boolean:=private.is_admin();
begin
  if not private.can_asset(p_asset) then raise exception 'Asset unavailable' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'state',h.state,'server_time',h.server_time,'capture_time',u.capture_time,
    'reading',u.reading,'meter_unit',u.meter_unit,'performer_name',u.performer_name,'snapshot',u.snapshot,'object_path',u.object_path,
    'cost',case when admin then d.cost end,'currency',case when admin then d.currency end,'mechanic_notes',case when admin then d.mechanic_notes end,
    'corrections',coalesce((select jsonb_agg(jsonb_build_object('action',c.action,'reason',c.reason,'baseline_reading',c.baseline_reading,'baseline_date',c.baseline_date,'meter_unit',c.meter_unit,'server_time',c.server_time) order by c.server_time desc,c.id)
      from public.service_corrections c where c.tenant_id=tid and c.history_id=h.id),'[]'::jsonb)) order by h.server_time desc)
    from public.service_history h join public.service_uploads u on u.id=h.id
    left join public.service_admin_details d on d.tenant_id=h.tenant_id and d.history_id=h.id
    where h.tenant_id=tid and h.asset_id=p_asset and h.service_id=p_service and (admin or h.submitted_by=auth.uid())),'[]'::jsonb);
end $$;

create or replace function public.export_data(p_kind text,p_asset uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tid uuid:=private.require_access(true,false);result jsonb;begin
 if p_asset is not null and not exists(select 1 from public.assets where id=p_asset and tenant_id=tid) then raise exception 'Asset unavailable' using errcode='42501';end if;
 if p_kind='assets' then
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'serial',a.serial,'type',t.name,'status',a.status,'meter_unit',a.meter_unit,'current_reading',a.current_hours,'archived',a.archived) order by a.name,a.id),'[]') into result from public.assets a join public.asset_types t on t.id=a.asset_type_id where a.tenant_id=tid and (p_asset is null or a.id=p_asset);
 elsif p_kind='logs' then
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'asset',a.name,'reading',h.value,'unit',h.meter_unit,'delta',h.delta,'performer',m.name,'capture_time',h.capture_time,'server_time',h.server_time,'correction_of',h.correction_of,'reason',h.reason) order by h.server_time,h.id),'[]') into result from public.hour_logs h join public.assets a on a.id=h.asset_id join public.memberships m on m.user_id=h.logged_by where h.tenant_id=tid and (p_asset is null or h.asset_id=p_asset);
 elsif p_kind='services' then
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'asset',u.asset_name,'serial',u.asset_serial,'service',u.snapshot->>'name','instructions',u.snapshot,'reading',u.reading,'unit',u.meter_unit,'performer',u.performer_name,'capture_time',u.capture_time,'server_time',h.server_time,'state',h.state,'photo_path',u.object_path,'cost',ad.cost,'currency',ad.currency,'mechanic_notes',ad.mechanic_notes,'corrections',coalesce((select jsonb_agg(jsonb_build_object('action',c.action,'reason',c.reason,'reading',c.baseline_reading,'unit',c.meter_unit,'date',c.baseline_date,'server_time',c.server_time) order by c.server_time,c.id) from public.service_corrections c where c.history_id=h.id),'[]')) order by u.capture_time,h.id),'[]') into result from public.service_history h join public.service_uploads u on u.id=h.id left join public.service_admin_details ad on ad.history_id=h.id where h.tenant_id=tid and (p_asset is null or h.asset_id=p_asset);
 elsif p_kind='tasks' then
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'asset',t.asset_name,'task',t.snapshot->>'name','instructions',t.snapshot,'checked_ids',t.checked_ids,'notes',t.notes,'performer',t.performer_name,'capture_time',t.capture_time,'server_time',t.server_time,'due_date',t.due_date,'effective_completion',not exists(select 1 from public.task_corrections c where c.completion_id=t.id),'photo_path',t.object_path,'corrections',coalesce((select jsonb_agg(jsonb_build_object('reason',c.reason,'server_time',c.server_time) order by c.server_time,c.id) from public.task_corrections c where c.completion_id=t.id),'[]')) order by t.capture_time,t.id),'[]') into result from public.task_submissions t where t.tenant_id=tid and exists(select 1 from public.task_completions cc where cc.id=t.id) and (p_asset is null or t.asset_id=p_asset);
 else raise exception 'Choose assets, logs, services or tasks';end if;
 return jsonb_build_object('kind',p_kind,'business',(select name from public.tenants where id=tid),'timezone',(select timezone from public.tenants where id=tid),'generated_at',now(),'asset',(select jsonb_build_object('name',name,'serial',serial,'meter_unit',meter_unit,'current_reading',current_hours) from public.assets where id=p_asset and tenant_id=tid),'rows',result);
end$$;
revoke execute on function public.export_data(text,uuid) from public,anon,authenticated;
grant execute on function public.export_data(text,uuid) to authenticated;
