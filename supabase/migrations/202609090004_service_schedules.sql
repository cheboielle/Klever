create table public.service_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  asset_id uuid,
  asset_type_id uuid,
  config jsonb not null,
  revision integer not null default 1,
  unique(tenant_id,id),
  check((asset_id is null)<>(asset_type_id is null)),
  foreign key(tenant_id,asset_id) references public.assets(tenant_id,id),
  foreign key(tenant_id,asset_type_id) references public.asset_types(tenant_id,id)
);
create index service_types_asset on public.service_types(tenant_id,asset_id);
create index service_types_type on public.service_types(tenant_id,asset_type_id);
create table public.asset_service_settings (
  tenant_id uuid not null,
  asset_id uuid not null,
  service_id uuid not null,
  override_config jsonb,
  baseline_reading numeric(12,2),
  baseline_date date,
  baseline_kind text not null default 'unknown' check(baseline_kind in ('unknown','last_service','starting_point')),
  archived boolean not null default false,
  revision integer not null default 1,
  primary key(tenant_id,asset_id,service_id),
  foreign key(tenant_id,asset_id) references public.assets(tenant_id,id),
  foreign key(tenant_id,service_id) references public.service_types(tenant_id,id),
  check(baseline_reading>=0 and baseline_reading::text not in ('NaN','Infinity','-Infinity'))
);
alter table public.service_types enable row level security;
alter table public.asset_service_settings enable row level security;
create policy service_types_read on public.service_types for select to authenticated using(
  tenant_id=private.current_tenant() and (private.is_admin() or
  (asset_id is not null and private.can_asset(asset_id)) or
  exists(select 1 from public.assets a where a.tenant_id=service_types.tenant_id and a.asset_type_id=service_types.asset_type_id and private.can_asset(a.id)))
);
create policy asset_service_read on public.asset_service_settings for select to authenticated using(private.can_asset(asset_id));
revoke all on public.service_types,public.asset_service_settings from anon,authenticated;
grant select on public.service_types,public.asset_service_settings to authenticated;

create function private.service_config(p_config jsonb) returns jsonb language plpgsql set search_path='' as $$
declare name text:=trim(p_config->>'name'); instructions text:=coalesce(p_config->>'instructions',''); mode text:=p_config->>'mode'; unit text:=p_config->>'meter_unit'; reading numeric; days integer;
begin
  if name is null or length(name) not between 1 and 120 then raise exception 'Enter a service name (up to 120 characters)'; end if;
  if length(instructions)>10000 then raise exception 'Instructions are too long'; end if;
  if mode is null or mode not in ('meter','calendar','both') then raise exception 'Choose a service interval mode'; end if;
  if unit is null or unit not in ('hours','km') then raise exception 'Choose a meter unit'; end if;
  if mode<>'calendar' then
    reading:=(p_config->>'interval_reading')::numeric;
    if reading is null or reading<=0 or reading>9999999999 or reading::text in ('NaN','Infinity','-Infinity') or reading<>round(reading,2) then raise exception 'Enter a positive meter interval (up to two decimal places)'; end if;
  end if;
  if mode<>'meter' then
    if (p_config->>'interval_days')::numeric<>trunc((p_config->>'interval_days')::numeric) then raise exception 'Use whole calendar days'; end if;
    days:=(p_config->>'interval_days')::integer;
    if days is null or days<1 or days>36500 then raise exception 'Enter an interval of 1 to 36500 days'; end if;
  end if;
  return jsonb_build_object('name',name,'instructions',instructions,'mode',mode,'meter_unit',unit,'interval_reading',reading,'interval_days',days);
end $$;

-- All due states use the business calendar and effective per-asset configuration.
create function public.list_asset_services(p_asset uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tid uuid:=private.require_access(false,false); a public.assets; today date;
begin
  if not private.can_asset(p_asset) then raise exception 'Asset unavailable' using errcode='42501'; end if;
  select * into a from public.assets where id=p_asset and tenant_id=tid;
  select (now() at time zone timezone)::date into today from public.tenants where id=tid;
  return coalesce((
    with effective as (
      select d.id,d.asset_type_id,d.revision as definition_revision,coalesce(s.revision,0) as settings_revision,
        coalesce(s.override_config,d.config) as config,s.baseline_reading,s.baseline_date,
        coalesce(s.baseline_kind,'unknown') as baseline_kind,s.override_config is not null as has_override
      from public.service_types d left join public.asset_service_settings s on s.tenant_id=d.tenant_id and s.service_id=d.id and s.asset_id=a.id
      where d.tenant_id=tid and (d.asset_id=a.id or d.asset_type_id=a.asset_type_id) and not coalesce(s.archived,false)
    ), due_values as (
      select *,config->>'mode'<>'calendar' and config->>'meter_unit'<>a.meter_unit as unit_mismatch,
        case when config->>'mode'<>'calendar' and config->>'meter_unit'=a.meter_unit then baseline_reading+(config->>'interval_reading')::numeric end as next_reading,
        case when config->>'mode'<>'meter' then baseline_date+(config->>'interval_days')::integer end as next_date
      from effective
    ) select jsonb_agg(jsonb_build_object(
      'id',id,'type_default',asset_type_id is not null,'has_override',has_override,'config',config,
      'definition_revision',definition_revision,'settings_revision',settings_revision,
      'baseline_reading',baseline_reading,'baseline_date',baseline_date,'baseline_kind',baseline_kind,
      'unit_mismatch',unit_mismatch,'next_reading',next_reading,'next_date',next_date,'today',today,
      'remaining',next_reading-a.current_hours,
      'missing_baseline',(config->>'mode'<>'calendar' and next_reading is null) or (config->>'mode'<>'meter' and next_date is null),
      'due',coalesce(a.current_hours>=next_reading,false) or coalesce(today>=next_date,false)
    ) order by config->>'name',id) from due_values
  ),'[]'::jsonb);
end $$;

create function public.save_service_schedule(p_asset uuid,p_config jsonb,p_scope text,
  p_baseline_reading numeric default null,p_baseline_date date default null,p_baseline_kind text default 'unknown',
  p_service uuid default null,p_definition_revision integer default 0,p_settings_revision integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true); a public.assets; d public.service_types; s public.asset_service_settings;
  v_config jsonb:=private.service_config(p_config); sid uuid; config_override jsonb; today date;
begin
  select * into a from public.assets where id=p_asset and tenant_id=tid for update;
  if not found then raise exception 'Asset unavailable' using errcode='42501'; end if;
  if p_scope is null or p_scope not in ('asset','type') then raise exception 'Choose this asset or its asset type'; end if;
  if p_baseline_kind is null or p_baseline_kind not in ('unknown','last_service','starting_point') then raise exception 'Choose a baseline source'; end if;
  if v_config->>'meter_unit'<>a.meter_unit then raise exception 'Use the current asset meter unit'; end if;
  select (now() at time zone timezone)::date into today from public.tenants where id=tid;
  if p_baseline_kind='unknown' then p_baseline_reading:=null;p_baseline_date:=null; end if;
  if v_config->>'mode'='calendar' then p_baseline_reading:=null; end if;
  if v_config->>'mode'='meter' then p_baseline_date:=null; end if;
  if p_baseline_reading is not null and (p_baseline_reading<0 or p_baseline_reading>a.current_hours or p_baseline_reading::text in ('NaN','Infinity','-Infinity') or p_baseline_reading<>round(p_baseline_reading,2)) then raise exception 'Last-service reading must be between zero and the current reading (up to two decimal places)'; end if;
  if p_baseline_date>today or p_baseline_date<'1900-01-01'::date then raise exception 'Use a valid last-service date that is not in the future'; end if;
  if p_service is null then
    insert into public.service_types(tenant_id,asset_id,asset_type_id,config)
    values(tid,case when p_scope='asset' then a.id end,case when p_scope='type' then a.asset_type_id end,v_config) returning id into sid;
  else
    select * into d from public.service_types where id=p_service and tenant_id=tid and (asset_id=a.id or asset_type_id=a.asset_type_id) for update;
    if not found then raise exception 'Service unavailable' using errcode='42501'; end if;
    select * into s from public.asset_service_settings where tenant_id=tid and asset_id=a.id and service_id=d.id for update;
    if p_definition_revision is null or p_settings_revision is null or d.revision<>p_definition_revision or coalesce(s.revision,0)<>p_settings_revision then return jsonb_build_object('status','conflict'); end if;
    sid:=d.id;
    if d.asset_type_id is not null and p_scope='asset' then
      config_override:=v_config;
    else
      update public.service_types set config=v_config,revision=revision+1,
        asset_id=case when p_scope='asset' then a.id end,asset_type_id=case when p_scope='type' then a.asset_type_id end where id=sid;
    end if;
  end if;
  insert into public.asset_service_settings(tenant_id,asset_id,service_id,override_config,baseline_reading,baseline_date,baseline_kind)
  values(tid,a.id,sid,config_override,p_baseline_reading,p_baseline_date,p_baseline_kind)
  on conflict(tenant_id,asset_id,service_id) do update set override_config=excluded.override_config,baseline_reading=excluded.baseline_reading,
    baseline_date=excluded.baseline_date,baseline_kind=excluded.baseline_kind,archived=false,revision=asset_service_settings.revision+1;
  insert into public.asset_history(tenant_id,asset_id,actor_id,kind,details) values(tid,a.id,auth.uid(),'service_schedule',jsonb_build_object(
    'service_id',sid,'scope',p_scope,'config',v_config,'baseline_reading',p_baseline_reading,'baseline_date',p_baseline_date,'baseline_kind',p_baseline_kind));
  return jsonb_build_object('status','accepted','id',sid);
end $$;

create function public.archive_asset_service(p_asset uuid,p_service uuid) returns void language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true); a public.assets;
begin
  select * into a from public.assets where id=p_asset and tenant_id=tid for update;
  if not found or not exists(select 1 from public.service_types where id=p_service and tenant_id=tid and (asset_id=a.id or asset_type_id=a.asset_type_id)) then raise exception 'Service unavailable' using errcode='42501'; end if;
  insert into public.asset_service_settings(tenant_id,asset_id,service_id,archived) values(tid,p_asset,p_service,true)
  on conflict(tenant_id,asset_id,service_id) do update set archived=true,revision=asset_service_settings.revision+1;
  insert into public.asset_history(tenant_id,asset_id,actor_id,kind,details) values(tid,p_asset,auth.uid(),'service_archived',jsonb_build_object('service_id',p_service));
end $$;

create function private.invalidate_service_meter() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.meter_unit<>new.meter_unit then
    update public.asset_service_settings set baseline_reading=null,revision=revision+1 where asset_id=new.id and tenant_id=new.tenant_id;
  end if;
  return new;
end $$;
create trigger service_meter_changed after update of meter_unit on public.assets for each row execute function private.invalidate_service_meter();
revoke execute on function private.service_config(jsonb),private.invalidate_service_meter() from public,anon,authenticated;
revoke execute on function public.list_asset_services(uuid),public.save_service_schedule(uuid,jsonb,text,numeric,date,text,uuid,integer,integer),public.archive_asset_service(uuid,uuid) from public,anon,authenticated;
grant execute on function public.list_asset_services(uuid),public.save_service_schedule(uuid,jsonb,text,numeric,date,text,uuid,integer,integer),public.archive_asset_service(uuid,uuid) to authenticated;
