create table public.service_corrections (
  id uuid primary key,
  tenant_id uuid not null,
  history_id uuid not null,
  asset_id uuid not null,
  actor_id uuid not null,
  action text not null check(action in ('replace','void')),
  reason text not null check(length(trim(reason)) between 1 and 2000),
  baseline_reading numeric(12,2),
  baseline_date date,
  meter_unit text not null check(meter_unit in ('hours','km')),
  server_time timestamptz not null default now(),
  foreign key(tenant_id,history_id) references public.service_history(tenant_id,id),
  foreign key(tenant_id,asset_id) references public.assets(tenant_id,id),
  foreign key(tenant_id,actor_id) references public.memberships(tenant_id,user_id)
);
create index service_corrections_history on public.service_corrections(tenant_id,history_id,server_time desc);
alter table public.service_corrections enable row level security;
create policy service_correction_read on public.service_corrections for select to authenticated using(
  private.can_asset(asset_id) and (private.is_admin() or exists(select 1 from public.service_history h where h.id=history_id and h.submitted_by=auth.uid())));
revoke all on public.service_corrections from anon,authenticated;
grant select on public.service_corrections to authenticated;

create function public.correct_service(p_id uuid,p_history uuid,p_action text,p_reason text,p_baseline_reading numeric,p_baseline_date date,p_settings_revision integer,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true); h public.service_history; a public.assets; s public.asset_service_settings; existing public.service_corrections; schedule jsonb; today date;
begin
  select * into h from public.service_history where id=p_history and tenant_id=tid;
  if not found then raise exception 'Service record unavailable' using errcode='42501'; end if;
  select * into a from public.assets where id=h.asset_id and tenant_id=tid for update;
  select * into existing from public.service_corrections where id=p_id;
  if found then
    if existing.tenant_id<>tid or existing.actor_id<>auth.uid() or existing.history_id<>p_history or existing.action<>p_action or existing.reason<>trim(p_reason) or existing.baseline_reading is distinct from p_baseline_reading or existing.baseline_date is distinct from p_baseline_date then raise exception 'Submission ID already used'; end if;
    return jsonb_build_object('status','accepted','duplicate',true);
  end if;
  if p_action is null or p_action not in ('replace','void') or length(trim(coalesce(p_reason,'')))=0 then raise exception 'Choose a correction and enter its reason'; end if;
  if p_confirmed is not true then return jsonb_build_object('status','confirmation_required'); end if;
  select value into schedule from jsonb_array_elements(public.list_asset_services(a.id)) where value->>'id'=h.service_id::text;
  if schedule is null then raise exception 'Re-enable this service schedule before correcting its baseline'; end if;
  if (schedule->>'unit_mismatch')::boolean then raise exception 'Update the service interval for the current meter unit first'; end if;
  select * into s from public.asset_service_settings where tenant_id=tid and asset_id=a.id and service_id=h.service_id for update;
  if p_settings_revision is null or coalesce(s.revision,0)<>p_settings_revision then return jsonb_build_object('status','conflict'); end if;
  select (now() at time zone timezone)::date into today from public.tenants where id=tid;
  if p_baseline_reading is not null and (p_baseline_reading<0 or p_baseline_reading>a.current_hours or p_baseline_reading::text in ('NaN','Infinity','-Infinity') or p_baseline_reading<>round(p_baseline_reading,2)) then raise exception 'Use a baseline between zero and the current asset reading'; end if;
  if p_baseline_date>today or p_baseline_date<'1900-01-01'::date then raise exception 'Use a valid baseline date that is not in the future'; end if;
  -- Admin explicitly confirms the baseline to use; a void never invents a prior service.
  insert into public.service_corrections(id,tenant_id,history_id,asset_id,actor_id,action,reason,baseline_reading,baseline_date,meter_unit)
  values(p_id,tid,h.id,a.id,auth.uid(),p_action,trim(p_reason),p_baseline_reading,p_baseline_date,a.meter_unit);
  insert into public.asset_service_settings(tenant_id,asset_id,service_id,baseline_reading,baseline_date,baseline_kind)
  values(tid,a.id,h.service_id,case when schedule->'config'->>'mode'<>'calendar' then p_baseline_reading end,
    case when schedule->'config'->>'mode'<>'meter' then p_baseline_date end,case when p_action='void' then 'starting_point' else 'last_service' end)
  on conflict(tenant_id,asset_id,service_id) do update set baseline_reading=excluded.baseline_reading,baseline_date=excluded.baseline_date,baseline_kind=excluded.baseline_kind,revision=asset_service_settings.revision+1;
  return jsonb_build_object('status','accepted','duplicate',false);
end $$;
revoke execute on function public.correct_service(uuid,uuid,text,text,numeric,date,integer,boolean) from public,anon,authenticated;
grant execute on function public.correct_service(uuid,uuid,text,text,numeric,date,integer,boolean) to authenticated;

create or replace function public.list_service_history(p_asset uuid,p_service uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tid uuid:=private.require_access(false,false); admin boolean:=private.is_admin();
begin
  if not private.can_asset(p_asset) then raise exception 'Asset unavailable' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'state',h.state,'server_time',h.server_time,'capture_time',u.capture_time,
    'reading',u.reading,'meter_unit',u.meter_unit,'performer_name',u.performer_name,'snapshot',u.snapshot,'object_path',u.object_path,
    'cost',case when admin then d.cost end,'mechanic_notes',case when admin then d.mechanic_notes end,
    'corrections',coalesce((select jsonb_agg(jsonb_build_object('action',c.action,'reason',c.reason,'baseline_reading',c.baseline_reading,'baseline_date',c.baseline_date,'meter_unit',c.meter_unit,'server_time',c.server_time) order by c.server_time desc,c.id)
      from public.service_corrections c where c.tenant_id=tid and c.history_id=h.id),'[]'::jsonb)) order by h.server_time desc)
    from public.service_history h join public.service_uploads u on u.id=h.id
    left join public.service_admin_details d on d.tenant_id=h.tenant_id and d.history_id=h.id
    where h.tenant_id=tid and h.asset_id=p_asset and h.service_id=p_service and (admin or h.submitted_by=auth.uid())),'[]'::jsonb);
end $$;
