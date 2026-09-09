create table public.service_uploads (
  id uuid primary key,
  tenant_id uuid not null,
  asset_id uuid not null,
  service_id uuid not null,
  submitted_by uuid not null,
  capture_time timestamptz not null,
  reading numeric(12,2) not null,
  meter_unit text not null,
  snapshot jsonb not null,
  performer_name text not null,
  asset_name text not null,
  asset_serial text not null,
  settings_revision integer not null,
  object_path text not null unique,
  created_at timestamptz not null default now(),
  unique(tenant_id,id),
  foreign key(tenant_id,asset_id) references public.assets(tenant_id,id),
  foreign key(tenant_id,service_id) references public.service_types(tenant_id,id),
  foreign key(tenant_id,submitted_by) references public.memberships(tenant_id,user_id)
);
create index service_uploads_asset on public.service_uploads(tenant_id,asset_id);
create table public.service_history (
  id uuid primary key,
  tenant_id uuid not null,
  asset_id uuid not null,
  service_id uuid not null,
  submitted_by uuid not null,
  state text not null check(state in ('applied','pending_correction')),
  server_time timestamptz not null default now(),
  unique(tenant_id,id),
  foreign key(tenant_id,id) references public.service_uploads(tenant_id,id),
  foreign key(tenant_id,asset_id) references public.assets(tenant_id,id),
  foreign key(tenant_id,service_id) references public.service_types(tenant_id,id),
  foreign key(tenant_id,submitted_by) references public.memberships(tenant_id,user_id)
);
create index service_history_asset on public.service_history(tenant_id,asset_id,server_time desc);
create table public.service_admin_details (
  tenant_id uuid not null,
  history_id uuid not null,
  cost numeric(12,2),
  mechanic_notes text not null default '',
  primary key(tenant_id,history_id),
  foreign key(tenant_id,history_id) references public.service_history(tenant_id,id),
  check(cost>=0 and cost::text not in ('NaN','Infinity','-Infinity'))
);
alter table public.service_uploads enable row level security;
alter table public.service_history enable row level security;
alter table public.service_admin_details enable row level security;
create policy service_uploads_read on public.service_uploads for select to authenticated using(private.can_asset(asset_id) and (submitted_by=auth.uid() or private.is_admin()));
create policy service_history_read on public.service_history for select to authenticated using(private.can_asset(asset_id) and (submitted_by=auth.uid() or private.is_admin()));
create policy service_admin_read on public.service_admin_details for select to authenticated using(tenant_id=private.current_tenant() and private.is_admin());
revoke all on public.service_uploads,public.service_history,public.service_admin_details from anon,authenticated;
grant select on public.service_uploads,public.service_history,public.service_admin_details to authenticated;

create function public.prepare_service_photo(p_id uuid,p_asset uuid,p_service uuid,p_reading numeric,p_capture_time timestamptz,p_snapshot jsonb,p_settings_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(); a public.assets; current_schedule jsonb; existing public.service_uploads; snapshot jsonb:=private.service_config(p_snapshot); path text;
begin
  if not private.can_asset(p_asset) then raise exception 'Asset unavailable' using errcode='42501'; end if;
  select * into a from public.assets where id=p_asset and tenant_id=tid for update;
  if a.archived then raise exception 'Asset is archived'; end if;
  select * into existing from public.service_uploads where id=p_id;
  if found then
    if existing.submitted_by<>auth.uid() or existing.asset_id<>p_asset or existing.service_id<>p_service or existing.reading<>p_reading or existing.capture_time<>p_capture_time or existing.snapshot<>snapshot then raise exception 'Submission ID already used'; end if;
    return jsonb_build_object('path',existing.object_path,'already_completed',exists(select 1 from public.service_history where id=p_id));
  end if;
  select value into current_schedule from jsonb_array_elements(public.list_asset_services(a.id)) where value->>'id'=p_service::text;
  if current_schedule is null then raise exception 'Service unavailable'; end if;
  if p_settings_revision is null then raise exception 'Reopen the service before completing it'; end if;
  if p_reading is null or p_reading<0 or p_reading>a.current_hours or p_reading::text in ('NaN','Infinity','-Infinity') or p_reading<>round(p_reading,2) then raise exception 'Log the current meter reading first, then enter a service reading no higher than it'; end if;
  if snapshot->>'meter_unit'<>a.meter_unit then raise exception 'The asset meter unit changed. Reopen the service'; end if;
  if p_capture_time is null or not isfinite(p_capture_time) then raise exception 'A capture time is required'; end if;
  path:=tid::text||'/'||p_id::text||'.jpg';
  insert into public.service_uploads(id,tenant_id,asset_id,service_id,submitted_by,capture_time,reading,meter_unit,snapshot,performer_name,asset_name,asset_serial,settings_revision,object_path)
  values(p_id,tid,a.id,p_service,auth.uid(),p_capture_time,p_reading,a.meter_unit,snapshot,(select name from public.memberships where user_id=auth.uid()),a.name,a.serial,p_settings_revision,path);
  return jsonb_build_object('path',path,'already_completed',false);
end $$;

create function private.can_upload_service_photo(p_path text) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.service_uploads u join public.tenants t on t.id=u.tenant_id
    where u.object_path=p_path and u.submitted_by=auth.uid() and private.can_asset(u.asset_id) and t.write_until>now()
    and not exists(select 1 from public.service_history h where h.id=u.id))
$$;
create function private.can_read_service_photo(p_path text) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.service_uploads u join public.service_history h on h.id=u.id
    where u.object_path=p_path and private.can_asset(u.asset_id) and (u.submitted_by=auth.uid() or private.is_admin()))
$$;
create policy service_photo_insert on storage.objects for insert to authenticated with check(bucket_id='evidence' and private.can_upload_service_photo(name));
create policy service_photo_read on storage.objects for select to authenticated using(bucket_id='evidence' and private.can_read_service_photo(name));

create function public.complete_service(p_id uuid,p_cost numeric default null,p_mechanic_notes text default '') returns jsonb
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
  if private.is_admin() then insert into public.service_admin_details(tenant_id,history_id,cost,mechanic_notes) values(tid,u.id,p_cost,coalesce(p_mechanic_notes,'')); end if;
  if state='applied' then
    insert into public.asset_service_settings(tenant_id,asset_id,service_id,baseline_reading,baseline_date,baseline_kind)
    values(tid,a.id,u.service_id,case when current_schedule->'config'->>'mode'<>'calendar' then u.reading end,
      case when current_schedule->'config'->>'mode'<>'meter' then service_date end,'last_service')
    on conflict(tenant_id,asset_id,service_id) do update set baseline_reading=excluded.baseline_reading,baseline_date=excluded.baseline_date,baseline_kind='last_service',revision=asset_service_settings.revision+1;
  end if;
  return jsonb_build_object('status',state,'duplicate',false);
end $$;

revoke execute on function private.can_upload_service_photo(text),private.can_read_service_photo(text) from public,anon,authenticated;
grant execute on function private.can_upload_service_photo(text),private.can_read_service_photo(text) to authenticated;
revoke execute on function public.prepare_service_photo(uuid,uuid,uuid,numeric,timestamptz,jsonb,integer),public.complete_service(uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.prepare_service_photo(uuid,uuid,uuid,numeric,timestamptz,jsonb,integer),public.complete_service(uuid,numeric,text) to authenticated;

create function public.list_service_history(p_asset uuid,p_service uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tid uuid:=private.require_access(false,false); admin boolean:=private.is_admin();
begin
  if not private.can_asset(p_asset) then raise exception 'Asset unavailable' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'state',h.state,'server_time',h.server_time,'capture_time',u.capture_time,
    'reading',u.reading,'meter_unit',u.meter_unit,'performer_name',u.performer_name,'snapshot',u.snapshot,'object_path',u.object_path,
    'cost',case when admin then d.cost end,'mechanic_notes',case when admin then d.mechanic_notes end) order by h.server_time desc)
    from public.service_history h join public.service_uploads u on u.id=h.id
    left join public.service_admin_details d on d.tenant_id=h.tenant_id and d.history_id=h.id
    where h.tenant_id=tid and h.asset_id=p_asset and h.service_id=p_service and (admin or h.submitted_by=auth.uid())),'[]'::jsonb);
end $$;
revoke execute on function public.list_service_history(uuid,uuid) from public,anon,authenticated;
grant execute on function public.list_service_history(uuid,uuid) to authenticated;
