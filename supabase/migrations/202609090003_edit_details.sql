-- Admin corrections preserve original meter records and invalidate stale readings.
alter table public.memberships add column phone text not null default '' check(length(phone)<=40);

create function public.save_staff_details(p_user uuid,p_name text,p_phone text) returns void
language plpgsql security definer set search_path='' as $$
declare tid uuid := private.require_access(true);
begin
  if length(trim(coalesce(p_name,''))) not between 1 and 120 then raise exception 'Enter a name (up to 120 characters)'; end if;
  if length(coalesce(p_phone,''))>40 then raise exception 'Phone number must be 40 characters or fewer'; end if;
  update public.memberships set name=trim(p_name),phone=trim(coalesce(p_phone,'')) where tenant_id=tid and user_id=p_user;
  if not found then raise exception 'Staff unavailable' using errcode='42501'; end if;
end $$;

create function public.edit_asset(p_asset uuid,p_name text,p_type uuid,p_serial text,
  p_meter_unit text,p_reading numeric,p_expected_revision integer,p_reason text default null,p_confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid := private.require_access(true); a public.assets;
begin
  select * into a from public.assets where id=p_asset and tenant_id=tid for update;
  if not found then raise exception 'Asset unavailable' using errcode='42501'; end if;
  if p_meter_unit is null or p_meter_unit not in ('hours','km') then raise exception 'Choose hours or kilometres'; end if;
  if p_expected_revision is null or p_expected_revision<>a.meter_revision then
    return jsonb_build_object('status','conflict');
  end if;
  if p_meter_unit<>a.meter_unit then
    if p_reading is null or p_reading<0 or p_reading::text in ('NaN','Infinity','-Infinity') or p_reading<>round(p_reading,2) then raise exception 'Enter the current reading in the new unit (up to two decimal places)'; end if;
    if length(trim(coalesce(p_reason,'')))=0 then raise exception 'Explain the meter unit correction'; end if;
    if p_confirmed is not true then return jsonb_build_object('status','confirmation_required'); end if;
    insert into public.asset_history(tenant_id,asset_id,actor_id,kind,reason,details)
    values(tid,p_asset,auth.uid(),'meter_unit_correction',trim(p_reason),jsonb_build_object(
      'previous_unit',a.meter_unit,'previous_reading',a.current_hours,'meter_unit',p_meter_unit,'reading',p_reading));
    update public.assets set meter_unit=p_meter_unit,current_hours=p_reading,meter_revision=meter_revision+1,updated_at=now() where id=p_asset;
  end if;
  -- Descriptive edits never change a meter reading on their own.
  perform public.save_asset(p_name,p_type,p_serial,0,p_asset);
  return jsonb_build_object('status','accepted');
end $$;

revoke execute on function public.save_staff_details(uuid,text,text),public.edit_asset(uuid,text,uuid,text,text,numeric,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.save_staff_details(uuid,text,text),public.edit_asset(uuid,text,uuid,text,text,numeric,integer,text,boolean) to authenticated;

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
    if not exists(select 1 from public.hour_logs where id=p_correction_of and asset_id=p_asset and tenant_id=tid and meter_unit=a.meter_unit) then raise exception 'Correction target unavailable in this meter unit'; end if;
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


