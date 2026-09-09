create table public.tasks (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), asset_id uuid,
 config jsonb not null, anchor_date date not null, next_due date not null, occurrence_id uuid not null default gen_random_uuid(),
 revision integer not null default 1, archived boolean not null default false,
 unique(tenant_id,id), foreign key(tenant_id,asset_id) references public.assets(tenant_id,id)
);
create index tasks_due on public.tasks(tenant_id,next_due) where not archived;
-- Each technician has an independent occurrence only for individually completed business tasks.
create table public.task_person_state (
 tenant_id uuid not null, task_id uuid not null, user_id uuid not null, next_due date not null,
 occurrence_id uuid not null default gen_random_uuid(), anchor_date date not null,
 primary key(task_id,user_id), foreign key(tenant_id,task_id) references public.tasks(tenant_id,id),
 foreign key(tenant_id,user_id) references public.memberships(tenant_id,user_id)
);
alter table public.task_person_state enable row level security;
revoke all on public.task_person_state from anon,authenticated;
grant select on public.task_person_state to authenticated;
create table public.task_submissions (
 id uuid primary key, tenant_id uuid not null, task_id uuid not null, occurrence_id uuid not null, due_date date not null,
 submitted_by uuid not null, capture_time timestamptz not null, server_time timestamptz not null default now(),
 snapshot jsonb not null, checked_ids jsonb not null, notes text not null, object_path text unique,
 performer_name text not null, asset_name text, asset_serial text, asset_id uuid,
 foreign key(tenant_id,asset_id) references public.assets(tenant_id,id),
 unique(tenant_id,id), foreign key(tenant_id,task_id) references public.tasks(tenant_id,id),
 foreign key(tenant_id,submitted_by) references public.memberships(tenant_id,user_id)
);
create table public.task_completions (
 id uuid primary key, tenant_id uuid not null, task_id uuid not null, occurrence_id uuid not null,
 server_time timestamptz not null default now(), unique(task_id,occurrence_id), unique(tenant_id,id),
 foreign key(tenant_id,id) references public.task_submissions(tenant_id,id),
 foreign key(tenant_id,task_id) references public.tasks(tenant_id,id)
);
create function private.can_task(p_task uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.tasks where id=p_task and tenant_id=private.current_tenant() and (asset_id is null or private.can_asset(asset_id)))
$$;
create function private.task_config(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare item jsonb; seen text[]:='{}'; cadence text:=p->>'cadence'; days integer;
begin
 if p is null or jsonb_typeof(p)<>'object' or coalesce(length(btrim(p->>'name')),0) not between 1 and 200 or length(coalesce(p->>'instructions',''))>10000 then raise exception 'Enter a task name and valid instructions'; end if;
 if coalesce(p->>'completion_mode','shared') not in ('shared','individual') then raise exception 'Choose how this task is completed'; end if;
 if cadence is null or cadence not in ('daily','weekly','fortnightly','monthly','custom') then raise exception 'Choose a recurrence'; end if;
 days:=case cadence when 'daily' then 1 when 'weekly' then 7 when 'fortnightly' then 14 when 'custom' then (p->>'days')::integer end;
 if cadence='custom' and (days is null or days not between 1 and 36500) then raise exception 'Enter a positive number of days'; end if;
 if jsonb_typeof(p->'checklist') is distinct from 'array' or jsonb_array_length(p->'checklist')>100 then raise exception 'Enter a checklist with at most 100 items'; end if;
 for item in select value from jsonb_array_elements(p->'checklist') loop
  if jsonb_typeof(item)<>'object' or coalesce(length(item->>'id'),0) not between 1 and 100 or coalesce(length(btrim(item->>'label')),0) not between 1 and 500 or item->>'id'=any(seen) then raise exception 'Each checklist item needs a unique ID and label'; end if;
  seen:=array_append(seen,item->>'id');
 end loop;
 return jsonb_build_object('completion_mode',coalesce(p->>'completion_mode','shared'),'name',btrim(p->>'name'),'instructions',coalesce(p->>'instructions',''),'cadence',cadence,'days',days,'checklist',p->'checklist','photo_required',coalesce((p->>'photo_required')::boolean,false),'notes_required',coalesce((p->>'notes_required')::boolean,false));
end $$;
create function private.next_task_date(anchor date, after_date date, cadence text, days integer) returns date language plpgsql immutable set search_path='' as $$
declare offset_months integer; month_start date; candidate date;
begin
 if anchor>after_date then return anchor; end if;
 if cadence<>'monthly' then return anchor+((after_date-anchor)/days+1)*days; end if;
 offset_months:=(extract(year from after_date)::integer-extract(year from anchor)::integer)*12+extract(month from after_date)::integer-extract(month from anchor)::integer;
 loop
  month_start:=(date_trunc('month',anchor)+make_interval(months=>offset_months))::date;
  candidate:=month_start+least(extract(day from anchor)::integer,extract(day from month_start+interval '1 month - 1 day')::integer)-1;
  if candidate>after_date then return candidate; end if;
  offset_months:=offset_months+1;
 end loop;
end $$;
create function public.save_task(p_id uuid,p_asset uuid,p_config jsonb,p_due date,p_revision integer,p_archived boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true); old public.tasks; cfg jsonb:=private.task_config(p_config); result uuid;
begin
 if p_due is null or not isfinite(p_due) then raise exception 'Enter a valid due date'; end if;
 if p_asset is not null and not private.can_asset(p_asset) then raise exception 'Asset unavailable' using errcode='42501'; end if;
 if p_asset is not null and cfg->>'completion_mode'='individual' then raise exception 'Individual completion is for business tasks. Asset tasks need one completion'; end if;
 if p_id is null then
  insert into public.tasks(tenant_id,asset_id,config,anchor_date,next_due) values(tid,p_asset,cfg,p_due,p_due) returning id into result;
 else
  select * into old from public.tasks where id=p_id and tenant_id=tid for update;
  if not found then raise exception 'Task unavailable' using errcode='42501'; end if;
  if old.revision is distinct from p_revision then return jsonb_build_object('status','conflict'); end if;
  -- A changed due date begins a new occurrence. Ordinary instruction edits keep it.
  update public.tasks set asset_id=p_asset, config=cfg, anchor_date=case when p_due<>old.next_due or cfg->>'cadence'<>old.config->>'cadence' or cfg->'days'<>old.config->'days' then p_due else old.anchor_date end,
   occurrence_id=case when p_due<>old.next_due or cfg->>'completion_mode'<>old.config->>'completion_mode' or p_asset is distinct from old.asset_id then gen_random_uuid() else occurrence_id end,next_due=p_due,archived=p_archived,revision=revision+1 where id=p_id;
  result:=p_id;
 end if;
 if cfg->>'completion_mode'='individual' then
  insert into public.task_person_state(tenant_id,task_id,user_id,next_due,anchor_date)
   select tid,result,user_id,p_due,p_due from public.memberships where tenant_id=tid and role='technician' and is_active on conflict do nothing;
  if p_id is not null and (p_due<>old.next_due or cfg->>'completion_mode'<>old.config->>'completion_mode' or cfg->>'cadence'<>old.config->>'cadence' or cfg->'days'<>old.config->'days') then
   update public.task_person_state set next_due=p_due,anchor_date=p_due,occurrence_id=gen_random_uuid() where task_id=result;
  end if;
 end if;
 return jsonb_build_object('status','saved','id',result);
end $$;
create function public.list_tasks(p_asset uuid default null,p_archived boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tid uuid:=private.require_access(false,false); today date;
begin
 select (now() at time zone timezone)::date into today from public.tenants where id=tid;
 if p_asset is not null and not private.can_asset(p_asset) then raise exception 'Asset unavailable' using errcode='42501'; end if;
 return jsonb_build_object('today',today,'items',coalesce((select jsonb_agg(
  to_jsonb(t)||jsonb_build_object('schedule_due',t.next_due,'today',today,
   'next_due',case when t.config->>'completion_mode'='individual' then coalesce(mine.next_due,team.earliest,t.next_due) else t.next_due end,
   'due',case when t.config->>'completion_mode'='individual' then coalesce(mine.next_due,team.earliest,t.next_due)<=today else t.next_due<=today end,
   'occurrence_id',case when t.config->>'completion_mode'='individual' then mine.occurrence_id else t.occurrence_id end,
   'can_complete',t.config->>'completion_mode'='shared' or mine.user_id is not null,
   'participants',case when private.is_admin() and t.config->>'completion_mode'='individual' then coalesce(team.people,'[]'::jsonb) else '[]'::jsonb end)
  order by t.next_due,t.config->>'name')
 from public.tasks t
 left join public.task_person_state mine on mine.task_id=t.id and mine.user_id=auth.uid() and exists(select 1 from public.memberships where user_id=auth.uid() and role='technician' and is_active)
 left join lateral (select min(ps.next_due) earliest,jsonb_agg(jsonb_build_object('user_id',ps.user_id,'name',m.name,'next_due',ps.next_due,'due',ps.next_due<=today) order by m.name) people from public.task_person_state ps join public.memberships m on m.user_id=ps.user_id and m.is_active and m.role='technician' where ps.task_id=t.id) team on true
 where t.tenant_id=tid and t.asset_id is not distinct from p_asset and t.archived=p_archived and private.can_task(t.id)),'[]'::jsonb));
end $$;
create function public.prepare_task(p_id uuid,p_task uuid,p_occurrence uuid,p_revision integer,p_snapshot jsonb,p_checked jsonb,p_notes text,p_capture_time timestamptz,p_photo boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(); t public.tasks; u public.task_submissions; cfg jsonb:=private.task_config(p_snapshot); path text; item jsonb; person public.task_person_state; occurrence uuid; due_date date;
begin
 if not private.can_task(p_task) then raise exception 'Task unavailable' using errcode='42501'; end if;
 select * into t from public.tasks where id=p_task for update;
 select * into u from public.task_submissions where id=p_id;
 if found then
  if u.submitted_by<>auth.uid() or u.task_id<>p_task or u.occurrence_id<>p_occurrence or u.snapshot<>cfg or u.checked_ids is distinct from p_checked or u.notes is distinct from p_notes or u.capture_time is distinct from p_capture_time or (u.object_path is not null) is distinct from p_photo then raise exception 'Submission ID already used'; end if;
  return jsonb_build_object('status',case when exists(select 1 from public.task_completions where id=p_id) then 'completed' else 'prepared' end,'path',u.object_path);
 end if;
 if t.config->>'completion_mode'='individual' then
  select ps.* into person from public.task_person_state ps join public.memberships m on m.user_id=ps.user_id and m.is_active and m.role='technician' where ps.task_id=t.id and ps.user_id=auth.uid();
  if not found then raise exception 'Each technician completes their own task' using errcode='42501'; end if;
  occurrence:=person.occurrence_id;due_date:=person.next_due;
 else occurrence:=t.occurrence_id;due_date:=t.next_due;end if;
 if exists(select 1 from public.task_completions where task_id=t.id and occurrence_id=p_occurrence and (t.config->>'completion_mode'='shared' or exists(select 1 from public.task_submissions where id=task_completions.id and submitted_by=auth.uid()))) then return jsonb_build_object('status','already_completed'); end if;
 if t.archived or occurrence is distinct from p_occurrence or cfg->>'completion_mode'<>t.config->>'completion_mode' then raise exception 'This task schedule changed. Reopen the task'; end if;
 if p_revision is null or p_revision<1 or p_revision>t.revision or (p_revision=t.revision and cfg<>t.config) then raise exception 'Reopen the task before completing it'; end if;
 if p_capture_time is null or not isfinite(p_capture_time) then raise exception 'Capture time is required'; end if;
 if p_notes is null or length(p_notes)>10000 or ((cfg->>'notes_required')::boolean and btrim(p_notes)='') then raise exception 'Add the required task notes'; end if;
 if p_photo is null or ((cfg->>'photo_required')::boolean and not p_photo) then raise exception 'Add the required task photo'; end if;
 if jsonb_typeof(p_checked) is distinct from 'array' or jsonb_array_length(p_checked)<>jsonb_array_length(cfg->'checklist') then raise exception 'Check every checklist item'; end if;
 for item in select value from jsonb_array_elements(cfg->'checklist') loop
  if not p_checked @> jsonb_build_array(item->>'id') then raise exception 'Check every checklist item'; end if;
 end loop;
 if p_photo then path:=tid::text||'/task-'||p_id::text||'.jpg'; end if;
 insert into public.task_submissions(id,tenant_id,task_id,occurrence_id,due_date,submitted_by,capture_time,snapshot,checked_ids,notes,object_path,performer_name,asset_name,asset_serial,asset_id)
 values(p_id,tid,t.id,occurrence,due_date,auth.uid(),p_capture_time,cfg,p_checked,p_notes,path,(select name from public.memberships where user_id=auth.uid()),(select name from public.assets where id=t.asset_id),(select serial from public.assets where id=t.asset_id),t.asset_id);
 return jsonb_build_object('status','prepared','path',path);
end $$;
create function private.can_upload_task_photo(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.task_submissions u join public.tenants t on t.id=u.tenant_id where u.object_path=p_path and u.submitted_by=auth.uid() and private.can_task(u.task_id) and (u.asset_id is null or private.can_asset(u.asset_id)) and t.write_until>now() and not exists(select 1 from public.task_completions c where c.id=u.id))
$$;
create policy task_photo_insert on storage.objects for insert to authenticated with check(bucket_id='evidence' and private.can_upload_task_photo(name));
create function public.complete_task(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(); u public.task_submissions; t public.tasks; today date; next_date date; person public.task_person_state; occurrence uuid; due_date date; anchor date;
begin
 select * into u from public.task_submissions where id=p_id and tenant_id=tid and submitted_by=auth.uid();
 if not found or (not private.can_task(u.task_id) or (u.asset_id is not null and not private.can_asset(u.asset_id))) then raise exception 'Task submission unavailable' using errcode='42501'; end if;
 select * into t from public.tasks where id=u.task_id for update;
 if exists(select 1 from public.task_completions where id=p_id) then return jsonb_build_object('status','completed','duplicate',true); end if;
 if exists(select 1 from public.task_completions where task_id=t.id and occurrence_id=u.occurrence_id) then return jsonb_build_object('status','already_completed'); end if;
 if t.config->>'completion_mode'='individual' then
  select ps.* into person from public.task_person_state ps join public.memberships m on m.user_id=ps.user_id and m.is_active and m.role='technician' where ps.task_id=t.id and ps.user_id=auth.uid();
  if not found then raise exception 'Each technician completes their own task' using errcode='42501'; end if;
  occurrence:=person.occurrence_id;due_date:=person.next_due;anchor:=person.anchor_date;
 else occurrence:=t.occurrence_id;due_date:=t.next_due;anchor:=t.anchor_date;end if;
 if t.archived or occurrence<>u.occurrence_id or u.snapshot->>'completion_mode'<>t.config->>'completion_mode' then raise exception 'This task schedule changed. Reopen the task'; end if;
 if u.object_path is not null and not exists(select 1 from storage.objects where bucket_id='evidence' and name=u.object_path and (metadata->>'size')::bigint>0 and metadata->>'mimetype'='image/jpeg') then raise exception 'The task photo has not finished uploading. Retry the upload'; end if;
 select (now() at time zone timezone)::date into today from public.tenants where id=tid;
 next_date:=private.next_task_date(anchor,greatest(today,due_date),t.config->>'cadence',(t.config->>'days')::integer);
 insert into public.task_completions(id,tenant_id,task_id,occurrence_id) values(u.id,tid,t.id,u.occurrence_id);
 if t.config->>'completion_mode'='individual' then
  update public.task_person_state set next_due=next_date,occurrence_id=gen_random_uuid() where task_id=t.id and user_id=auth.uid();
  update public.tasks set revision=revision+1 where id=t.id;
 else update public.tasks set next_due=next_date,occurrence_id=gen_random_uuid(),revision=revision+1 where id=t.id;end if;
 return jsonb_build_object('status','completed','duplicate',false,'next_due',next_date);
end $$;
create function public.list_task_history(p_task uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_access(false,false);
 if not private.can_task(p_task) then raise exception 'Task unavailable' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(u)||jsonb_build_object('received_at',c.server_time) order by c.server_time desc) from public.task_completions c join public.task_submissions u on u.id=c.id where c.task_id=p_task and (u.asset_id is null or private.can_asset(u.asset_id)) and (private.is_admin() or u.submitted_by=auth.uid())),'[]'::jsonb);
end $$;
create function public.authorize_task_photo(p_id uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare path text;
begin
 perform private.require_access(false,false);
 select u.object_path into path from public.task_submissions u join public.task_completions c on c.id=u.id where u.id=p_id and private.can_task(u.task_id) and (u.asset_id is null or private.can_asset(u.asset_id)) and (private.is_admin() or u.submitted_by=auth.uid());
 if path is null then raise exception 'Photo unavailable' using errcode='42501'; end if;
 return path;
end $$;
alter table public.tasks enable row level security;
alter table public.task_submissions enable row level security;
alter table public.task_completions enable row level security;
create policy tasks_read on public.tasks for select to authenticated using(private.can_task(id));
create policy task_submissions_read on public.task_submissions for select to authenticated using(private.can_task(task_id) and (asset_id is null or private.can_asset(asset_id)) and (submitted_by=auth.uid() or private.is_admin()));
create policy task_completions_read on public.task_completions for select to authenticated using(private.can_task(task_id) and (private.is_admin() or exists(select 1 from public.task_submissions u where u.id=task_completions.id and u.submitted_by=auth.uid())));
revoke all on public.tasks,public.task_submissions,public.task_completions from anon,authenticated;
grant select on public.tasks,public.task_submissions,public.task_completions to authenticated;
revoke execute on function private.can_task(uuid),private.task_config(jsonb),private.next_task_date(date,date,text,integer),private.can_upload_task_photo(text) from public,anon,authenticated;
grant execute on function private.can_task(uuid),private.can_upload_task_photo(text) to authenticated;
revoke execute on function public.save_task(uuid,uuid,jsonb,date,integer,boolean),public.list_tasks(uuid,boolean),public.prepare_task(uuid,uuid,uuid,integer,jsonb,jsonb,text,timestamptz,boolean),public.complete_task(uuid),public.list_task_history(uuid),public.authorize_task_photo(uuid) from public,anon,authenticated;
grant execute on function public.save_task(uuid,uuid,jsonb,date,integer,boolean),public.list_tasks(uuid,boolean),public.prepare_task(uuid,uuid,uuid,integer,jsonb,jsonb,text,timestamptz,boolean),public.complete_task(uuid),public.list_task_history(uuid),public.authorize_task_photo(uuid) to authenticated;
create table public.task_corrections (
 id uuid primary key, tenant_id uuid not null, completion_id uuid not null, actor_id uuid not null,
 reason text not null, next_due date not null, server_time timestamptz not null default now(),
 unique(tenant_id,id), unique(completion_id),
 foreign key(tenant_id,completion_id) references public.task_completions(tenant_id,id),
 foreign key(tenant_id,actor_id) references public.memberships(tenant_id,user_id)
);
alter table public.task_corrections enable row level security;
create policy task_corrections_read on public.task_corrections for select to authenticated using(exists(select 1 from public.task_submissions u where u.id=completion_id and private.can_task(u.task_id) and (u.asset_id is null or private.can_asset(u.asset_id)) and (private.is_admin() or u.submitted_by=auth.uid())));
revoke all on public.task_corrections from anon,authenticated;
grant select on public.task_corrections to authenticated;
create function public.void_task_completion(p_id uuid,p_completion uuid,p_reason text,p_next_due date,p_revision integer,p_confirmed boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true); u public.task_submissions; t public.tasks; old public.task_corrections;
begin
 select s.* into u from public.task_submissions s join public.task_completions c on c.id=s.id where s.id=p_completion and s.tenant_id=tid;
 if not found then raise exception 'Task completion unavailable' using errcode='42501'; end if;
 select * into t from public.tasks where id=u.task_id for update;
 select * into old from public.task_corrections where id=p_id;
 if found then
  if old.tenant_id<>tid or old.completion_id<>p_completion or old.actor_id<>auth.uid() or old.reason is distinct from btrim(p_reason) or old.next_due is distinct from p_next_due then raise exception 'Correction ID already used'; end if;
  return jsonb_build_object('status','saved','duplicate',true);
 end if;
 if p_confirmed is distinct from true or coalesce(length(btrim(p_reason)),0) not between 1 and 2000 or p_next_due is null or not isfinite(p_next_due) then raise exception 'Enter a reason and confirm the next due date'; end if;
 if t.revision is distinct from p_revision then return jsonb_build_object('status','conflict'); end if;
 if exists(select 1 from public.task_corrections where completion_id=p_completion) then raise exception 'This completion has already been voided'; end if;
 insert into public.task_corrections(id,tenant_id,completion_id,actor_id,reason,next_due) values(p_id,tid,p_completion,auth.uid(),btrim(p_reason),p_next_due);
 -- Voiding old evidence after switching completion mode must not reset the new mode's schedule.
 if t.config->>'completion_mode'=u.snapshot->>'completion_mode' then
  if t.config->>'completion_mode'='individual' then
   update public.task_person_state set next_due=p_next_due,anchor_date=case when p_next_due<>next_due then p_next_due else anchor_date end,occurrence_id=gen_random_uuid() where task_id=t.id and user_id=u.submitted_by;
  else update public.tasks set next_due=p_next_due,anchor_date=case when p_next_due<>next_due then p_next_due else anchor_date end,occurrence_id=gen_random_uuid() where id=t.id;end if;
 end if;
 update public.tasks set revision=revision+1 where id=t.id;
 return jsonb_build_object('status','saved','duplicate',false);
end $$;
create or replace function public.list_task_history(p_task uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_access(false,false);
 if not private.can_task(p_task) then raise exception 'Task unavailable' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(u)||jsonb_build_object('received_at',c.server_time,'correction',case when v.id is null then null else to_jsonb(v) end) order by c.server_time desc) from public.task_completions c join public.task_submissions u on u.id=c.id left join public.task_corrections v on v.completion_id=c.id where c.task_id=p_task and (u.asset_id is null or private.can_asset(u.asset_id)) and (private.is_admin() or u.submitted_by=auth.uid())),'[]'::jsonb);
end $$;
revoke execute on function public.void_task_completion(uuid,uuid,text,date,integer,boolean) from public,anon,authenticated;
grant execute on function public.void_task_completion(uuid,uuid,text,date,integer,boolean) to authenticated;

create policy task_person_read on public.task_person_state for select to authenticated using(private.can_task(task_id) and (private.is_admin() or user_id=auth.uid()));
-- New and reactivated technicians join current individual business tasks automatically.
create function private.enrol_staff_tasks() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.is_active and new.role='technician' then
  insert into public.task_person_state(tenant_id,task_id,user_id,next_due,anchor_date)
   select new.tenant_id,id,new.user_id,next_due,anchor_date from public.tasks where tenant_id=new.tenant_id and config->>'completion_mode'='individual' on conflict do nothing;
 end if;
 return new;
end $$;
create trigger enrol_staff_tasks after insert or update of is_active,role on public.memberships for each row execute function private.enrol_staff_tasks();
revoke execute on function private.enrol_staff_tasks() from public,anon,authenticated;
