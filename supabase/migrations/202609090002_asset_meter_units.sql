-- Owner requested hours OR kilometres per asset on 9 September 2026.
-- Existing numeric column/RPC names are retained for compatibility; meter_unit
-- defines their unit. Never convert or relabel existing readings.
alter table public.assets add column meter_unit text not null default 'hours' check(meter_unit in ('hours','km'));
alter table public.hour_logs add column meter_unit text not null default 'hours' check(meter_unit in ('hours','km'));
drop function public.save_asset(text,uuid,text,numeric,uuid);
create function public.save_asset(p_name text,p_type uuid,p_serial text default '',p_initial_hours numeric default 0,p_id uuid default null,p_meter_unit text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare tid uuid := private.require_access(true); result uuid;
begin
  if p_meter_unit is not null and p_meter_unit not in ('hours','km') then raise exception 'Choose hours or kilometres'; end if;
  if p_id is not null and p_meter_unit is not null and exists(select 1 from public.assets where id=p_id and tenant_id=tid and meter_unit<>p_meter_unit) then raise exception 'An existing asset cannot change meter units; its readings must retain their original unit'; end if;
  if p_id is null then
    insert into public.assets(tenant_id,name,asset_type_id,serial,current_hours,meter_unit)
    values(tid,trim(p_name),p_type,p_serial,p_initial_hours,coalesce(p_meter_unit,'hours')) returning id into result;
  else
    update public.assets set name=trim(p_name),asset_type_id=p_type,serial=p_serial,updated_at=now()
    where id=p_id and tenant_id=tid returning id into result;
    if result is null then raise exception 'Asset unavailable' using errcode='42501'; end if;
  end if;
  insert into public.asset_history(tenant_id,asset_id,actor_id,kind,details)
    values(tid,result,auth.uid(),case when p_id is null then 'created' else 'edited' end,
    jsonb_build_object('name',p_name,'serial',p_serial,'type',p_type,'meter_unit',(select meter_unit from public.assets where id=result),'initial_hours',case when p_id is null then p_initial_hours else null end));
  return result;
end $$;
create or replace function public.log_hours(p_id uuid,p_asset uuid,p_value numeric,p_expected_revision integer,p_capture_time timestamptz,
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
  if p_value is null or p_value<0 or p_value::text in ('NaN','Infinity','-Infinity') or p_value<>round(p_value,2) or p_capture_time is null or p_expected_revision is null then raise exception 'Valid reading, revision and capture time required (up to two decimal places)'; end if;
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
  if p_correction_of is null and not p_confirmed and delta>(case when a.meter_unit='km' then greatest(1000,extract(epoch from (now()-coalesce(prior_time,a.created_at)))/3600*120) else greatest(24,extract(epoch from (now()-coalesce(prior_time,a.created_at)))/3600*2) end) then
    return jsonb_build_object('status','confirmation_required','delta',delta);
  end if;
  insert into public.hour_logs(id,tenant_id,asset_id,logged_by,value,delta,revision,capture_time,correction_of,reason,meter_unit)
    values(p_id,tid,p_asset,auth.uid(),p_value,delta,a.meter_revision+1,p_capture_time,p_correction_of,p_reason,a.meter_unit);
  update public.assets set current_hours=p_value,meter_revision=a.meter_revision+1,updated_at=now() where id=p_asset;
  return jsonb_build_object('status','accepted','revision',a.meter_revision+1,'duplicate',false);
end $$;


revoke execute on function public.save_asset(text,uuid,text,numeric,uuid,text) from public,anon,authenticated;
grant execute on function public.save_asset(text,uuid,text,numeric,uuid,text) to authenticated;

