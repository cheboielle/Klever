-- Correct the current counter without fabricating a service or deleting an original reading.
alter table public.asset_history add constraint asset_history_tenant_id_id_key unique(tenant_id,id);
alter table public.hour_logs add column correction_of_setup uuid;
alter table public.hour_logs add constraint logs_setup_same_tenant foreign key(tenant_id,correction_of_setup) references public.asset_history(tenant_id,id);
alter table public.hour_logs add constraint one_correction_origin check(correction_of is null or correction_of_setup is null);
create function public.correct_asset_reading(p_id uuid,p_asset uuid,p_value numeric,p_expected_revision integer,p_capture_time timestamptz,p_reason text,p_confirmed boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true);a public.assets;previous public.hour_logs;origin uuid;reading_origin uuid;
begin
 select * into a from public.assets where id=p_asset and tenant_id=tid for update;
 if not found or a.archived then raise exception 'Asset unavailable' using errcode='42501';end if;
 select * into previous from public.hour_logs where id=p_id;
 if found then
  if previous.logged_by=auth.uid() and previous.asset_id=p_asset and previous.value=p_value and previous.capture_time=p_capture_time and previous.reason=btrim(p_reason) and (previous.correction_of is not null or previous.correction_of_setup is not null) then return jsonb_build_object('status','accepted','duplicate',true,'revision',previous.revision);end if;
  raise exception 'Submission ID already used';
 end if;
 if p_value is null or p_value<0 or p_value::text in ('NaN','Infinity','-Infinity') or p_value<>round(p_value,2) or p_capture_time is null then raise exception 'Enter a valid reading with up to two decimal places';end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Enter a correction reason (up to 1000 characters)';end if;
 if p_confirmed is not true then return jsonb_build_object('status','confirmation_required');end if;
 if p_expected_revision is null or p_expected_revision<>a.meter_revision then return jsonb_build_object('status','conflict','current_hours',a.current_hours);end if;
 select id into reading_origin from public.hour_logs where tenant_id=tid and asset_id=p_asset and revision=a.meter_revision and meter_unit=a.meter_unit;
 if reading_origin is not null then return public.log_hours(p_id,p_asset,p_value,p_expected_revision,p_capture_time,true,reading_origin,btrim(p_reason));end if;
 select id into origin from public.asset_history where tenant_id=tid and asset_id=p_asset and
  (kind='meter_unit_correction' and details->>'meter_unit'=a.meter_unit and (details->>'reading')::numeric=a.current_hours or kind='created' and coalesce(details->>'meter_unit','hours')=a.meter_unit and (details->>'initial_hours')::numeric=a.current_hours)
  order by server_time desc,id desc limit 1;
 if origin is null then raise exception 'The original setup record is unavailable; ask your administrator to review this asset';end if;
 insert into public.hour_logs(id,tenant_id,asset_id,logged_by,value,delta,revision,capture_time,reason,meter_unit,correction_of_setup)
 values(p_id,tid,p_asset,auth.uid(),p_value,p_value-a.current_hours,a.meter_revision+1,p_capture_time,btrim(p_reason),a.meter_unit,origin);
 update public.assets set current_hours=p_value,meter_revision=meter_revision+1,updated_at=now() where id=p_asset;
 return jsonb_build_object('status','accepted','duplicate',false,'revision',a.meter_revision+1);
end$$;
revoke all on function public.correct_asset_reading(uuid,uuid,numeric,integer,timestamptz,text,boolean) from public,anon,authenticated;
grant execute on function public.correct_asset_reading(uuid,uuid,numeric,integer,timestamptz,text,boolean) to authenticated;

create or replace function public.export_data(p_kind text,p_asset uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tid uuid:=private.require_access(true,false);result jsonb;begin
 if p_asset is not null and not exists(select 1 from public.assets where id=p_asset and tenant_id=tid) then raise exception 'Asset unavailable' using errcode='42501';end if;
 if p_kind='assets' then
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'serial',a.serial,'type',t.name,'status',a.status,'meter_unit',a.meter_unit,'current_reading',a.current_hours,'archived',a.archived) order by a.name,a.id),'[]') into result from public.assets a join public.asset_types t on t.id=a.asset_type_id where a.tenant_id=tid and (p_asset is null or a.id=p_asset);
 elsif p_kind='logs' then
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'asset',a.name,'reading',h.value,'unit',h.meter_unit,'delta',h.delta,'performer',m.name,'capture_time',h.capture_time,'server_time',h.server_time,'correction_of',h.correction_of,'correction_of_setup',h.correction_of_setup,'reason',h.reason) order by h.server_time,h.id),'[]') into result from public.hour_logs h join public.assets a on a.id=h.asset_id join public.memberships m on m.user_id=h.logged_by where h.tenant_id=tid and (p_asset is null or h.asset_id=p_asset);
 elsif p_kind='services' then
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'asset',u.asset_name,'serial',u.asset_serial,'service',u.snapshot->>'name','instructions',u.snapshot,'reading',u.reading,'unit',u.meter_unit,'performer',u.performer_name,'capture_time',u.capture_time,'server_time',h.server_time,'state',h.state,'photo_path',u.object_path,'cost',ad.cost,'currency',ad.currency,'mechanic_notes',ad.mechanic_notes,'corrections',coalesce((select jsonb_agg(jsonb_build_object('action',c.action,'reason',c.reason,'reading',c.baseline_reading,'unit',c.meter_unit,'date',c.baseline_date,'server_time',c.server_time) order by c.server_time,c.id) from public.service_corrections c where c.history_id=h.id),'[]')) order by u.capture_time,h.id),'[]') into result from public.service_history h join public.service_uploads u on u.id=h.id left join public.service_admin_details ad on ad.history_id=h.id where h.tenant_id=tid and (p_asset is null or h.asset_id=p_asset);
 elsif p_kind='tasks' then
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'asset',t.asset_name,'task',t.snapshot->>'name','instructions',t.snapshot,'checked_ids',t.checked_ids,'notes',t.notes,'performer',t.performer_name,'capture_time',t.capture_time,'server_time',t.server_time,'due_date',t.due_date,'effective_completion',not exists(select 1 from public.task_corrections c where c.completion_id=t.id),'photo_path',t.object_path,'corrections',coalesce((select jsonb_agg(jsonb_build_object('reason',c.reason,'server_time',c.server_time) order by c.server_time,c.id) from public.task_corrections c where c.completion_id=t.id),'[]')) order by t.capture_time,t.id),'[]') into result from public.task_submissions t where t.tenant_id=tid and exists(select 1 from public.task_completions cc where cc.id=t.id) and (p_asset is null or t.asset_id=p_asset);
 else raise exception 'Choose assets, logs, services or tasks';end if;
 return jsonb_build_object('kind',p_kind,'business',(select name from public.tenants where id=tid),'timezone',(select timezone from public.tenants where id=tid),'generated_at',now(),'asset',(select jsonb_build_object('name',name,'serial',serial,'meter_unit',meter_unit,'current_reading',current_hours) from public.assets where id=p_asset and tenant_id=tid),'rows',result);
end$$;
revoke execute on function public.export_data(text,uuid) from public,anon,authenticated;
grant execute on function public.export_data(text,uuid) to authenticated;
