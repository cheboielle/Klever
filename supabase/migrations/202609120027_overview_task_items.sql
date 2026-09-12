create or replace function public.workspace_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tid uuid:=private.require_access(false,false); a public.assets; t public.tenants; rule public.notification_rules; rows jsonb:='[]';today date;
begin
 select * into t from public.tenants where id=tid;today:=(now() at time zone t.timezone)::date;
 select * into rule from public.notification_rules where tenant_id=tid and kind='hour_log';
 for a in select * from public.assets where tenant_id=tid and not archived and private.can_asset(id) order by name loop
  rows:=rows||jsonb_build_array(jsonb_build_object('id',a.id,'services',public.list_asset_services(a.id),'tasks',(public.list_tasks(a.id,false)->'items'),'open_issues',(select count(*) from jsonb_array_elements(public.list_asset_issues(a.id)) i where jsonb_array_length(i->'resolutions')=0),'reading_due',coalesce(rule.enabled and private.reminder_time_due(now(),t.timezone,rule.local_time,rule.weekdays),false) and not exists(select 1 from public.hour_logs where asset_id=a.id and (capture_time at time zone t.timezone)::date=today)));
 end loop;
 return jsonb_build_object('assets',rows,'tasks',(public.list_tasks(null,false)->'items'),'as_of',now());
end $$;
revoke execute on function public.workspace_overview() from public,anon,authenticated;
grant execute on function public.workspace_overview() to authenticated;
