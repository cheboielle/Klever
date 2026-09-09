-- Stage A: all client mutations are scoped transactions. No client-chosen tenant IDs.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  owner_user_id uuid not null references auth.users(id),
  timezone text not null default 'Pacific/Auckland',
  app_lock boolean not null default false,
  seat_limit integer not null default 3 check (seat_limit > 0),
  write_until timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.memberships (
  user_id uuid primary key references auth.users(id),
  tenant_id uuid not null references public.tenants(id),
  name text not null check (length(trim(name)) between 1 and 120),
  role text not null default 'technician' check (role in ('admin','technician')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(tenant_id,user_id)
);
create index memberships_tenant on public.memberships(tenant_id,is_active);

create table public.asset_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null check (length(trim(name)) between 1 and 80),
  unique(tenant_id,id), unique(tenant_id,name)
);
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  asset_type_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 120),
  serial text not null default '',
  status text not null default 'Active' check (status in ('Active','Out of Service','Workshop','Other')),
  current_hours numeric(12,2) not null default 0 check (current_hours >= 0 and current_hours::text not in ('NaN','Infinity','-Infinity')),
  meter_revision integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,id),
  foreign key (tenant_id,asset_type_id) references public.asset_types(tenant_id,id)
);
create index assets_tenant_name on public.assets(tenant_id,name);
create table public.asset_assignments (
  tenant_id uuid not null,
  asset_id uuid not null,
  user_id uuid not null,
  primary key(tenant_id,asset_id,user_id),
  foreign key(tenant_id,asset_id) references public.assets(tenant_id,id),
  foreign key(tenant_id,user_id) references public.memberships(tenant_id,user_id)
);
create index assignments_user on public.asset_assignments(tenant_id,user_id,asset_id);
create table public.asset_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  asset_id uuid not null,
  actor_id uuid not null,
  kind text not null,
  reason text,
  details jsonb not null default '{}',
  server_time timestamptz not null default now(),
  foreign key(tenant_id,asset_id) references public.assets(tenant_id,id),
  foreign key(tenant_id,actor_id) references public.memberships(tenant_id,user_id)
);
create index asset_history_asset on public.asset_history(tenant_id,asset_id,server_time desc);
create table public.hour_logs (
  id uuid primary key,
  tenant_id uuid not null,
  asset_id uuid not null,
  logged_by uuid not null,
  value numeric(12,2) not null check(value >= 0),
  delta numeric(12,2) not null,
  revision integer not null,
  capture_time timestamptz not null,
  server_time timestamptz not null default now(),
  correction_of uuid,
  reason text,
  unique(tenant_id,id), unique(tenant_id,asset_id,revision),
  foreign key(tenant_id,asset_id) references public.assets(tenant_id,id),
  foreign key(tenant_id,logged_by) references public.memberships(tenant_id,user_id),
  foreign key(tenant_id,correction_of) references public.hour_logs(tenant_id,id),
  check (correction_of is null or length(trim(reason)) > 0)
);
create index hour_logs_asset on public.hour_logs(tenant_id,asset_id,revision desc);

-- Session validity is checked live. Supabase Auth owns sessions and refresh tokens.
create function private.current_tenant() returns uuid language sql stable security definer set search_path='' as $$
  select m.tenant_id from public.memberships m
  where m.user_id=auth.uid() and m.is_active
  and exists(select 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=m.user_id)
$$;
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.memberships m join public.tenants t on t.id=m.tenant_id
    where m.user_id=auth.uid() and m.tenant_id=private.current_tenant()
    and (m.role='admin' or t.owner_user_id=m.user_id))
$$;
create function private.can_asset(p_asset uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.assets a where a.id=p_asset and a.tenant_id=private.current_tenant()
    and (private.is_admin() or exists(select 1 from public.asset_assignments x
      where x.tenant_id=a.tenant_id and x.asset_id=a.id and x.user_id=auth.uid())))
$$;
create function private.require_access(p_admin boolean default false,p_write boolean default true) returns uuid
language plpgsql security definer set search_path='' as $$
declare tid uuid := private.current_tenant();
begin
  if tid is null then raise exception 'Access denied' using errcode='42501'; end if;
  if p_admin and not private.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
  if p_write and not exists(select 1 from public.tenants where id=tid and write_until>now()) then
    raise exception 'This business is read-only' using errcode='42501';
  end if;
  return tid;
end $$;

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.asset_types enable row level security;
alter table public.assets enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.asset_history enable row level security;
alter table public.hour_logs enable row level security;

create policy tenant_read on public.tenants for select to authenticated using(id=private.current_tenant() and private.is_admin());
create policy membership_read on public.memberships for select to authenticated using(tenant_id=private.current_tenant() and (private.is_admin() or user_id=auth.uid()));
create policy type_read on public.asset_types for select to authenticated using(tenant_id=private.current_tenant());
create policy asset_read on public.assets for select to authenticated using(private.can_asset(id));
create policy assignment_read on public.asset_assignments for select to authenticated using(tenant_id=private.current_tenant() and (private.is_admin() or user_id=auth.uid()));
create policy history_read on public.asset_history for select to authenticated using(tenant_id=private.current_tenant() and private.is_admin());
create policy hours_read on public.hour_logs for select to authenticated using(private.can_asset(asset_id) and (private.is_admin() or logged_by=auth.uid()));

-- Use a deferred invariant so provisioning/transfer can update both sides atomically.
create function private.check_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.tenants t where not exists(select 1 from public.memberships m
    where m.user_id=t.owner_user_id and m.tenant_id=t.id and m.is_active and m.role='admin')) then
    raise exception 'Every business must have one active owner';
  end if;
  return null;
end $$;
create constraint trigger tenant_owner_check after insert or update on public.tenants deferrable initially deferred for each row execute function private.check_owner();
create constraint trigger membership_owner_check after insert or update or delete on public.memberships deferrable initially deferred for each row execute function private.check_owner();

create function public.access_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
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
    'can_write',t.write_until>now(),'access_ends_at',t.write_until,'app_lock',t.app_lock);
end $$;

create function public.save_asset_type(p_name text,p_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare tid uuid := private.require_access(true); result uuid;
begin
  if p_id is null then
    insert into public.asset_types(tenant_id,name) values(tid,trim(p_name)) returning id into result;
  else
    update public.asset_types set name=trim(p_name) where id=p_id and tenant_id=tid returning id into result;
    if result is null then raise exception 'Asset type unavailable' using errcode='42501'; end if;
  end if;
  return result;
end $$;
create function public.save_asset(p_name text,p_type uuid,p_serial text default '',p_initial_hours numeric default 0,p_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare tid uuid := private.require_access(true); result uuid;
begin
  if p_id is null then
    insert into public.assets(tenant_id,name,asset_type_id,serial,current_hours)
    values(tid,trim(p_name),p_type,p_serial,p_initial_hours) returning id into result;
  else
    update public.assets set name=trim(p_name),asset_type_id=p_type,serial=p_serial,updated_at=now()
    where id=p_id and tenant_id=tid returning id into result;
    if result is null then raise exception 'Asset unavailable' using errcode='42501'; end if;
  end if;
  insert into public.asset_history(tenant_id,asset_id,actor_id,kind,details)
    values(tid,result,auth.uid(),case when p_id is null then 'created' else 'edited' end,
    jsonb_build_object('name',p_name,'serial',p_serial,'type',p_type,'initial_hours',case when p_id is null then p_initial_hours else null end));
  return result;
end $$;
create function public.set_asset_status(p_asset uuid,p_status text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare tid uuid := private.require_access(true); old_status text;
begin
  if length(trim(coalesce(p_reason,'')))=0 then raise exception 'A reason is required'; end if;
  select status into old_status from public.assets where id=p_asset and tenant_id=tid for update;
  if not found then raise exception 'Asset unavailable' using errcode='42501'; end if;
  update public.assets set status=p_status,updated_at=now() where id=p_asset;
  insert into public.asset_history(tenant_id,asset_id,actor_id,kind,reason,details)
  values(tid,p_asset,auth.uid(),'status',p_reason,jsonb_build_object('from',old_status,'to',p_status));
end $$;
create function public.assign_asset(p_asset uuid,p_user uuid,p_assigned boolean) returns void language plpgsql security definer set search_path='' as $$
declare tid uuid := private.require_access(true);
begin
  if not exists(select 1 from public.assets where id=p_asset and tenant_id=tid) or
    not exists(select 1 from public.memberships where user_id=p_user and tenant_id=tid and (is_active or not p_assigned)) then
    raise exception 'Asset or staff unavailable' using errcode='42501';
  end if;
  if p_assigned then insert into public.asset_assignments values(tid,p_asset,p_user) on conflict do nothing;
  else delete from public.asset_assignments where tenant_id=tid and asset_id=p_asset and user_id=p_user; end if;
  insert into public.asset_history(tenant_id,asset_id,actor_id,kind,details)
    values(tid,p_asset,auth.uid(),'assignment',jsonb_build_object('user_id',p_user,'assigned',p_assigned));
end $$;

create function public.log_hours(p_id uuid,p_asset uuid,p_value numeric,p_expected_revision integer,p_capture_time timestamptz,
  p_confirmed boolean default false,p_correction_of uuid default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid := private.require_access(); a public.assets; previous public.hour_logs; prior_time timestamptz; delta numeric;
begin
  if not private.can_asset(p_asset) then raise exception 'Asset unavailable' using errcode='42501'; end if;
  select * into a from public.assets where id=p_asset and tenant_id=tid for update;
  if a.archived then raise exception 'Asset is archived'; end if;
  select * into previous from public.hour_logs where id=p_id;
  if found then
    if previous.logged_by=auth.uid() and previous.asset_id=p_asset and previous.value=p_value
      and previous.capture_time=p_capture_time and previous.correction_of is not distinct from p_correction_of then
      return jsonb_build_object('status','accepted','revision',previous.revision,'duplicate',true);
    end if;
    raise exception 'Submission ID already used' using errcode='23505';
  end if;
  if p_value is null or p_value<0 or p_value::text in ('NaN','Infinity','-Infinity') or p_value<>round(p_value,2) or p_capture_time is null or p_expected_revision is null then raise exception 'Valid hours, revision and capture time required (up to two decimal places)'; end if;
  if p_expected_revision<>a.meter_revision then return jsonb_build_object('status','conflict','current_hours',a.current_hours); end if;
  if p_correction_of is not null then
    if not private.is_admin() then raise exception 'Only admins correct readings' using errcode='42501'; end if;
    if length(trim(coalesce(p_reason,'')))=0 then raise exception 'Correction reason required'; end if;
    if not exists(select 1 from public.hour_logs where id=p_correction_of and asset_id=p_asset and tenant_id=tid) then raise exception 'Correction target unavailable'; end if;
    if not p_confirmed then return jsonb_build_object('status','confirmation_required'); end if;
  elsif p_value<a.current_hours then
    return jsonb_build_object('status','conflict','current_hours',a.current_hours);
  end if;
  delta := p_value-a.current_hours;
  select max(server_time) into prior_time from public.hour_logs where asset_id=p_asset and tenant_id=tid;
  if p_correction_of is null and not p_confirmed and delta>greatest(24,extract(epoch from (now()-coalesce(prior_time,a.created_at)))/3600*2) then
    return jsonb_build_object('status','confirmation_required','delta',delta);
  end if;
  insert into public.hour_logs(id,tenant_id,asset_id,logged_by,value,delta,revision,capture_time,correction_of,reason)
    values(p_id,tid,p_asset,auth.uid(),p_value,delta,a.meter_revision+1,p_capture_time,p_correction_of,p_reason);
  update public.assets set current_hours=p_value,meter_revision=a.meter_revision+1,updated_at=now() where id=p_asset;
  return jsonb_build_object('status','accepted','revision',a.meter_revision+1,'duplicate',false);
end $$;

create function public.manage_staff(p_user uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare tid uuid := private.require_access(true,false); t public.tenants; target public.memberships;
begin
  select * into t from public.tenants where id=tid for update;
  select * into target from public.memberships where user_id=p_user and tenant_id=tid for update;
  if not found then raise exception 'Staff unavailable' using errcode='42501'; end if;
  if p_action not in ('deactivate','activate','sign_out','promote','demote','transfer') then raise exception 'Unknown action'; end if;
  if p_action not in ('deactivate','sign_out') then perform private.require_access(true,true); end if;
  if p_user=t.owner_user_id and p_action<>'sign_out' then raise exception 'Transfer ownership before changing the owner'; end if;
  if p_action in ('promote','demote','transfer') and t.owner_user_id<>auth.uid() then raise exception 'Owner access required' using errcode='42501'; end if;
  if p_action='activate' then
    if not target.is_active and (select count(*) from public.memberships where tenant_id=tid and is_active)>=t.seat_limit then raise exception 'Staff limit reached'; end if;
    update public.memberships set is_active=true where user_id=p_user;
  elsif p_action='deactivate' then
    update public.memberships set is_active=false where user_id=p_user;
  elsif p_action='promote' then update public.memberships set role='admin' where user_id=p_user;
  elsif p_action='demote' then update public.memberships set role='technician' where user_id=p_user;
  elsif p_action='transfer' then
    if not target.is_active then raise exception 'New owner must be active'; end if;
    update public.memberships set role='admin' where user_id=p_user;
    update public.tenants set owner_user_id=p_user where id=tid;
  end if;
  if p_action in ('deactivate','sign_out','demote') then
    -- Supabase refresh_tokens reference auth.sessions with ON DELETE CASCADE.
    -- Verify this managed Auth relationship in the hosted rollout check.
    delete from auth.sessions where user_id=p_user;
  end if;
end $$;

-- Private bootstrap; never available to a phone or public signup.
create function public.provision_business(p_owner uuid,p_name text,p_owner_name text,p_write_until timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare tid uuid;
begin
  insert into public.tenants(name,owner_user_id,write_until) values(p_name,p_owner,p_write_until) returning id into tid;
  insert into public.memberships(user_id,tenant_id,name,role) values(p_owner,tid,p_owner_name,'admin');
  return tid;
end $$;
create function public.provision_staff(p_tenant uuid,p_user uuid,p_name text) returns void
language plpgsql security definer set search_path='' as $$
declare seats integer;
begin
  select seat_limit into seats from public.tenants where id=p_tenant for update;
  if not found then raise exception 'Business unavailable'; end if;
  if (select count(*) from public.memberships where tenant_id=p_tenant and is_active)>=seats then raise exception 'Staff limit reached'; end if;
  insert into public.memberships(user_id,tenant_id,name) values(p_user,p_tenant,p_name);
end $$;

revoke all on public.tenants,public.memberships,public.asset_types,public.assets,public.asset_assignments,public.asset_history,public.hour_logs from anon,authenticated;
grant select on public.tenants,public.memberships,public.asset_types,public.assets,public.asset_assignments,public.asset_history,public.hour_logs to authenticated;
revoke execute on all functions in schema private from public,anon,authenticated;
grant execute on function private.current_tenant(),private.is_admin(),private.can_asset(uuid) to authenticated;
revoke execute on function public.access_status(),public.save_asset_type(text,uuid),public.save_asset(text,uuid,text,numeric,uuid),public.set_asset_status(uuid,text,text),public.assign_asset(uuid,uuid,boolean),public.log_hours(uuid,uuid,numeric,integer,timestamptz,boolean,uuid,text),public.manage_staff(uuid,text),public.provision_business(uuid,text,text,timestamptz),public.provision_staff(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.access_status(),public.save_asset_type(text,uuid),public.save_asset(text,uuid,text,numeric,uuid),public.set_asset_status(uuid,text,text),public.assign_asset(uuid,uuid,boolean),public.log_hours(uuid,uuid,numeric,integer,timestamptz,boolean,uuid,text),public.manage_staff(uuid,text) to authenticated;
grant execute on function public.provision_business(uuid,text,text,timestamptz),public.provision_staff(uuid,uuid,text) to service_role;

-- Default-deny media until upload/finalization workflows are implemented.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('evidence','evidence',false,10485760,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
-- No storage policies are added in A1: neither listing nor reading/uploading is public.
