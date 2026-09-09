-- Small tenant rules and server-side occurrences. No client may run the scheduler.
create table public.notification_rules (
 tenant_id uuid not null references public.tenants(id),kind text not null check(kind in ('hour_log','task_due','service_due','compliance','issue_reported','reassignment')),
 enabled boolean not null default true,recipients text not null check(recipients in ('admin','assigned','both')),channel text not null check(channel in ('push','email','both')),
 local_time time not null default '08:00',weekdays integer[] not null default '{1,2,3,4,5,6,7}',revision integer not null default 1,
 primary key(tenant_id,kind),check(cardinality(weekdays) between 1 and 7 and weekdays <@ array[1,2,3,4,5,6,7])
);
alter table public.notification_rules enable row level security;
create policy rules_read on public.notification_rules for select to authenticated using(tenant_id=private.current_tenant() and private.is_admin());
revoke all on public.notification_rules from anon,authenticated;
grant select on public.notification_rules to authenticated;
create function private.seed_notification_rules(p_tenant uuid) returns void language sql set search_path='' as $$
 insert into public.notification_rules(tenant_id,kind,recipients,channel,local_time)
 select p_tenant,kind,case when kind in ('hour_log','task_due','reassignment') then 'assigned' when kind in ('compliance','issue_reported') then 'admin' else 'both' end,'push',case when kind='hour_log' then '17:00'::time else '08:00'::time end
 from unnest(array['hour_log','task_due','service_due','compliance','issue_reported','reassignment']) kind on conflict do nothing;
$$;
select private.seed_notification_rules(id) from public.tenants;
create function private.seed_business_notifications() returns trigger language plpgsql security definer set search_path='' as $$begin perform private.seed_notification_rules(new.id);return new;end$$;
create trigger business_notifications after insert on public.tenants for each row execute function private.seed_business_notifications();
create function public.notification_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tid uuid:=private.require_access(true,false);begin
 return jsonb_build_object('timezone',(select timezone from public.tenants where id=tid),'rules',(select jsonb_agg(to_jsonb(r) order by kind) from public.notification_rules r where tenant_id=tid));end$$;
create function public.save_notification_rule(p_kind text,p_enabled boolean,p_recipients text,p_channel text,p_time time,p_weekdays integer[],p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true);begin
 update public.notification_rules set enabled=p_enabled,recipients=p_recipients,channel=p_channel,local_time=p_time,weekdays=p_weekdays,revision=revision+1 where tenant_id=tid and kind=p_kind and revision=p_revision;
 if not found then return '{"status":"conflict"}'::jsonb;end if;return '{"status":"accepted"}'::jsonb;end$$;
create function public.save_business_timezone(p_timezone text,p_previous text) returns boolean language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true);begin
 if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Choose a valid business timezone';end if;
 update public.tenants set timezone=p_timezone where id=tid and timezone=p_previous;return found;end$$;
revoke execute on function public.notification_settings(),public.save_notification_rule(text,boolean,text,text,time,integer[],integer),public.save_business_timezone(text,text) from public,anon,authenticated;
grant execute on function public.notification_settings(),public.save_notification_rule(text,boolean,text,text,time,integer[],integer),public.save_business_timezone(text,text) to authenticated;

-- Stable occurrence keys give each daily/event notification one logical identity.
alter table public.notification_outbox add column occurrence_key text;
create unique index notification_occurrence on public.notification_outbox(tenant_id,event_type,occurrence_key,recipient_id,channel) where occurrence_key is not null;
create function private.enqueue_reminder(p_tenant uuid,p_kind text,p_source uuid,p_key text,p_asset uuid,p_message text,p_person uuid default null,p_admin boolean default false,p_assigned boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare rule public.notification_rules;person record;channels text[];has_assigned boolean;begin
 select * into rule from public.notification_rules where tenant_id=p_tenant and kind=p_kind and enabled;
 if not found or not exists(select 1 from public.tenants where id=p_tenant and write_until>now()) then return;end if;
 select exists(select 1 from public.memberships m where m.tenant_id=p_tenant and m.is_active and m.role='technician' and (p_person=m.user_id or (p_person is null and (p_asset is null or exists(select 1 from public.asset_assignments aa where aa.asset_id=p_asset and aa.user_id=m.user_id))))) into has_assigned;
 channels:=case rule.channel when 'both' then array['push','email'] else array[rule.channel] end;
 for person in select m.* from public.memberships m join public.tenants t on t.id=m.tenant_id where m.tenant_id=p_tenant and m.is_active and (
 ((m.role='admin' or m.user_id=t.owner_user_id) and (rule.recipients in ('admin','both') or p_admin or not has_assigned)) or
 (m.role='technician' and (rule.recipients in ('assigned','both') or p_assigned) and (p_person=m.user_id or (p_person is null and (p_asset is null or exists(select 1 from public.asset_assignments aa where aa.asset_id=p_asset and aa.user_id=m.user_id)))))
 ) loop
 insert into public.notification_outbox(tenant_id,source_id,event_type,occurrence_key,recipient_id,channel,payload)
 select p_tenant,md5(p_tenant::text||p_kind||p_key)::uuid,p_kind,p_key,person.user_id,ch,jsonb_build_object('asset_id',p_asset,'record_id',p_source,'message',p_message)
 from unnest(channels) ch on conflict do nothing;
 end loop;end$$;
-- Event notifications run in the same transaction as their source change.
create function private.notify_issue() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.urgency<>'Urgent' then perform private.enqueue_reminder(new.tenant_id,'issue_reported',new.id,new.id::text,new.asset_id,new.urgency||' issue: '||new.asset_name||'. '||new.description);end if;return new;end$$;
create trigger issue_notification after insert on public.issues for each row execute function private.notify_issue();
create function private.notify_assignment() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.assets;begin
 select * into a from public.assets where id=coalesce(new.asset_id,old.asset_id);
 -- Removal goes to admins, since the former technician no longer has asset access.
 perform private.enqueue_reminder(a.tenant_id,'reassignment',a.id,gen_random_uuid()::text,a.id,case when tg_op='DELETE' then 'An assignment was removed from ' else 'An assignment was added to ' end||a.name,case when tg_op='INSERT' then new.user_id else null end,tg_op='DELETE');return coalesce(new,old);end$$;
create trigger assignment_notification after insert or delete on public.asset_assignments for each row execute function private.notify_assignment();

create table private.service_notification_state(tenant_id uuid not null,asset_id uuid not null,service_id uuid not null,is_due boolean not null,last_notice date,cycle uuid not null default gen_random_uuid(),primary key(asset_id,service_id),foreign key(tenant_id,asset_id) references public.assets(tenant_id,id));
-- Comparison with wall-clock time naturally fires at the first valid minute after a DST gap;
-- daily keys suppress the repeated hour when daylight saving ends.
create function private.reminder_time_due(p_now timestamptz,p_zone text,p_time time,p_days integer[]) returns boolean language sql stable set search_path='' as $$
 select (p_now at time zone p_zone)::time>=p_time and extract(isodow from p_now at time zone p_zone)::integer=any(p_days)
$$;
create function public.schedule_notifications(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare tenant public.tenants;rule public.notification_rules;a record;task record;svc record;c record;today date;local_stamp timestamp;due boolean;prior private.service_notification_state;created integer:=0;before_count bigint;begin
 -- Serialize scans; occurrence uniqueness is still the final retry guard.
 if not pg_try_advisory_xact_lock(7130913) then return 0;end if;
 select count(*) into before_count from public.notification_outbox;
 for tenant in select * from public.tenants where write_until>now() loop
 today:=(p_now at time zone tenant.timezone)::date;
 for rule in select * from public.notification_rules where tenant_id=tenant.id and enabled and kind in ('hour_log','task_due','service_due','compliance') loop
 due:=private.reminder_time_due(p_now,tenant.timezone,rule.local_time,rule.weekdays);
 if rule.kind='hour_log' and due then
 for a in select * from public.assets where tenant_id=tenant.id and not archived loop
 if not exists(select 1 from public.hour_logs h where h.asset_id=a.id and (h.capture_time at time zone tenant.timezone)::date=today) then
 perform private.enqueue_reminder(tenant.id,rule.kind,a.id,a.id::text||':'||today,a.id,'Record the current '||case a.meter_unit when 'km' then 'kilometres' else 'hours' end||' for '||a.name||'.');end if;end loop;
 elsif rule.kind='compliance' and due then
 for c in select ci.*,aa.name from public.compliance_items ci join public.assets aa on aa.id=ci.asset_id where ci.tenant_id=tenant.id and not ci.archived and not aa.archived and ci.due_date-today=any(ci.lead_days) loop
 perform private.enqueue_reminder(tenant.id,rule.kind,c.id,c.id::text||':'||c.due_date||':'||today,c.asset_id,c.label||' for '||c.name||' expires on '||c.due_date||'.',null,false,c.notify_assigned);end loop;
 elsif rule.kind='task_due' then
 for task in
 select t.id,t.asset_id,t.config,t.next_due,null::uuid as person,t.occurrence_id from public.tasks t where t.tenant_id=tenant.id and not t.archived and coalesce(t.config->>'completion_mode','shared')='shared' and (t.asset_id is null or exists(select 1 from public.assets aa where aa.id=t.asset_id and not aa.archived))
 union all select t.id,null,t.config,ps.next_due,ps.user_id,ps.occurrence_id from public.tasks t join public.task_person_state ps on ps.task_id=t.id join public.memberships m on m.user_id=ps.user_id where t.tenant_id=tenant.id and not t.archived and t.config->>'completion_mode'='individual' and m.is_active
 loop
 if task.next_due<=today and (due or (task.next_due<today and (p_now at time zone tenant.timezone)::time>=rule.local_time)) then
 perform private.enqueue_reminder(tenant.id,rule.kind,task.id,task.occurrence_id::text||':'||today,task.asset_id,(task.config->>'name')||case when task.next_due<today then ' is overdue.' else ' is due today.' end,task.person,today-task.next_due>=7);end if;end loop;
 elsif rule.kind='service_due' then
 for svc in
 select aa.id asset_id,aa.name,d.id service_id,coalesce(s.override_config,d.config) config,
 coalesce((coalesce(s.override_config,d.config)->>'mode'<>'calendar' and coalesce(s.override_config,d.config)->>'meter_unit'=aa.meter_unit and aa.current_hours>=s.baseline_reading+(coalesce(s.override_config,d.config)->>'interval_reading')::numeric),false)
 or coalesce((coalesce(s.override_config,d.config)->>'mode'<>'meter' and today>=s.baseline_date+(coalesce(s.override_config,d.config)->>'interval_days')::integer),false) is_due
 from public.assets aa join public.service_types d on d.tenant_id=aa.tenant_id and (d.asset_id=aa.id or d.asset_type_id=aa.asset_type_id) left join public.asset_service_settings s on s.asset_id=aa.id and s.service_id=d.id
 where aa.tenant_id=tenant.id and not aa.archived and not coalesce(s.archived,false)
 loop
 select * into prior from private.service_notification_state where asset_id=svc.asset_id and service_id=svc.service_id;
 if not found then insert into private.service_notification_state(tenant_id,asset_id,service_id,is_due) values(tenant.id,svc.asset_id,svc.service_id,false) returning * into prior;end if;
 if svc.is_due and not prior.is_due then
 update private.service_notification_state set is_due=true,last_notice=today,cycle=gen_random_uuid() where asset_id=svc.asset_id and service_id=svc.service_id returning * into prior;
 perform private.enqueue_reminder(tenant.id,rule.kind,svc.service_id,prior.cycle::text||':crossing',svc.asset_id,(svc.config->>'name')||' is due for '||svc.name||'.');
 elsif svc.is_due and due and prior.last_notice is distinct from today then
 update private.service_notification_state set last_notice=today where asset_id=svc.asset_id and service_id=svc.service_id;
 perform private.enqueue_reminder(tenant.id,rule.kind,svc.service_id,svc.asset_id::text||':'||svc.service_id||':'||today,svc.asset_id,(svc.config->>'name')||' remains due for '||svc.name||'.');
 elsif not svc.is_due then update private.service_notification_state set is_due=false where asset_id=svc.asset_id and service_id=svc.service_id;end if;end loop;
 end if;end loop;end loop;
 select count(*)-before_count into created from public.notification_outbox;return created;end$$;
revoke execute on function public.schedule_notifications(timestamptz) from public,anon,authenticated;
grant execute on function public.schedule_notifications(timestamptz) to service_role;
revoke execute on function private.seed_notification_rules(uuid),private.seed_business_notifications(),private.enqueue_reminder(uuid,text,uuid,text,uuid,text,uuid,boolean,boolean),private.notify_issue(),private.notify_assignment(),private.reminder_time_due(timestamptz,text,time,integer[]) from public,anon,authenticated;

create or replace function public.claim_notifications(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.notification_outbox;result jsonb:='[]';lease uuid;email text;tokens jsonb;
begin
 for job in select n.* from public.notification_outbox n where n.status in ('pending','sending','awaiting_receipt') and n.next_attempt_at<=now() and (n.lease_until is null or n.lease_until<now()) order by n.created_at limit greatest(1,least(p_limit,50)) for update skip locked loop
  if not exists(select 1 from public.memberships m join public.tenants t on t.id=m.tenant_id where m.user_id=job.recipient_id and m.tenant_id=job.tenant_id and m.is_active and t.write_until>now() and (job.payload->>'asset_id' is null or m.role='admin' or t.owner_user_id=m.user_id or exists(select 1 from public.asset_assignments aa where aa.asset_id=(job.payload->>'asset_id')::uuid and aa.user_id=m.user_id and aa.tenant_id=m.tenant_id)) and (job.event_type<>'urgent_issue' or m.role='admin' or t.owner_user_id=m.user_id)) then
   update public.notification_outbox set status='cancelled',last_error='Recipient inactive or workspace read-only' where id=job.id;continue;
  end if;
  select u.email into email from auth.users u where u.id=job.recipient_id;
  select coalesce(jsonb_agg(jsonb_build_object('installation_id',d.installation_id,'token',d.token)),'[]'::jsonb) into tokens from public.device_tokens d join auth.sessions s on s.id=d.session_id where d.user_id=job.recipient_id and d.tenant_id=job.tenant_id;
  lease:=gen_random_uuid();
  update public.notification_outbox set status='sending',lease_id=lease,lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=job.id;
  result:=result||jsonb_build_array(to_jsonb(job)||jsonb_build_object('lease_id',lease,'email',email,'devices',tokens));
 end loop;
 return result;
end $$;
