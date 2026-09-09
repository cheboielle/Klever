create table public.issues (
 id uuid primary key,tenant_id uuid not null,asset_id uuid not null,reported_by uuid not null,
 urgency text not null check(urgency in ('Minor','Attention','Urgent')),description text not null check(length(btrim(description)) between 1 and 10000),
 capture_time timestamptz not null,server_time timestamptz not null default now(),asset_name text not null,performer_name text not null,
 unique(tenant_id,id),foreign key(tenant_id,asset_id) references public.assets(tenant_id,id),foreign key(tenant_id,reported_by) references public.memberships(tenant_id,user_id)
);
create index issues_asset on public.issues(tenant_id,asset_id,server_time desc);
create table public.issue_resolutions (
 id uuid primary key,tenant_id uuid not null,issue_id uuid not null,resolved_by uuid not null,notes text not null check(length(btrim(notes)) between 1 and 10000),server_time timestamptz not null default now(),
 foreign key(tenant_id,issue_id) references public.issues(tenant_id,id),foreign key(tenant_id,resolved_by) references public.memberships(tenant_id,user_id)
);
create table public.notification_outbox (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,source_id uuid not null,event_type text not null,recipient_id uuid not null,
 channel text not null check(channel in ('push','email')),payload jsonb not null,status text not null default 'pending',attempts integer not null default 0,next_attempt_at timestamptz not null default now(),created_at timestamptz not null default now(),
 unique(source_id,event_type,recipient_id,channel),foreign key(tenant_id,recipient_id) references public.memberships(tenant_id,user_id)
);
create table public.compliance_items (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,asset_id uuid not null,label text not null check(length(btrim(label)) between 1 and 120),due_date date not null,lead_days integer[] not null default '{30,7}',notify_assigned boolean not null default false,archived boolean not null default false,revision integer not null default 1,
 foreign key(tenant_id,asset_id) references public.assets(tenant_id,id)
);
create index compliance_due on public.compliance_items(tenant_id,due_date) where not archived;
alter table public.issues enable row level security;
alter table public.issue_resolutions enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.compliance_items enable row level security;
create policy issues_read on public.issues for select to authenticated using(private.can_asset(asset_id) and (private.is_admin() or reported_by=auth.uid()));
create policy resolutions_read on public.issue_resolutions for select to authenticated using(exists(select 1 from public.issues i where i.id=issue_id and private.can_asset(i.asset_id) and (private.is_admin() or i.reported_by=auth.uid())));
create policy outbox_read on public.notification_outbox for select to authenticated using(tenant_id=private.current_tenant() and private.is_admin());
create policy compliance_read on public.compliance_items for select to authenticated using(private.can_asset(asset_id));
revoke all on public.issues,public.issue_resolutions,public.notification_outbox,public.compliance_items from anon,authenticated;
grant select on public.issues,public.issue_resolutions,public.notification_outbox,public.compliance_items to authenticated;
create function public.report_issue(p_id uuid,p_asset uuid,p_urgency text,p_description text,p_capture_time timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access();a public.assets;old public.issues;
begin
 if not private.can_asset(p_asset) then raise exception 'Asset unavailable' using errcode='42501';end if;
 select * into a from public.assets where id=p_asset for update;
 select * into old from public.issues where id=p_id;
 if found then
  if old.reported_by<>auth.uid() or old.asset_id<>p_asset or old.urgency is distinct from p_urgency or old.description is distinct from btrim(p_description) or old.capture_time is distinct from p_capture_time then raise exception 'Submission ID already used';end if;
  return jsonb_build_object('status','reported','duplicate',true);
 end if;
 if a.archived then raise exception 'Asset is archived';end if;
 if p_capture_time is null or not isfinite(p_capture_time) then raise exception 'Capture time is required';end if;
 if p_urgency is null or p_urgency not in ('Minor','Attention','Urgent') or coalesce(length(btrim(p_description)),0) not between 1 and 10000 then raise exception 'Choose urgency and describe the issue';end if;
 insert into public.issues(id,tenant_id,asset_id,reported_by,urgency,description,capture_time,asset_name,performer_name) values(p_id,tid,a.id,auth.uid(),p_urgency,btrim(p_description),p_capture_time,a.name,(select name from public.memberships where user_id=auth.uid()));
 if p_urgency='Urgent' then
  insert into public.notification_outbox(tenant_id,source_id,event_type,recipient_id,channel,payload)
   select tid,p_id,'urgent_issue',m.user_id,channel,jsonb_build_object('asset_id',a.id,'asset_name',a.name,'description',btrim(p_description)) from public.memberships m cross join unnest(array['push','email']) channel
   where m.tenant_id=tid and m.is_active and (m.role='admin' or m.user_id=(select owner_user_id from public.tenants where id=tid)) on conflict do nothing;
 end if;
 return jsonb_build_object('status','reported','duplicate',false);
end $$;
create function public.resolve_issue(p_id uuid,p_issue uuid,p_notes text) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true);issue public.issues;old public.issue_resolutions;
begin
 select * into issue from public.issues where id=p_issue and tenant_id=tid for update;
 if not found then raise exception 'Issue unavailable' using errcode='42501';end if;
 select * into old from public.issue_resolutions where id=p_id;
 if found then
  if old.issue_id<>p_issue or old.resolved_by<>auth.uid() or old.notes is distinct from btrim(p_notes) then raise exception 'Resolution ID already used';end if;
  return jsonb_build_object('status','resolved','duplicate',true);
 end if;
 if coalesce(length(btrim(p_notes)),0) not between 1 and 10000 then raise exception 'Describe how the issue was resolved';end if;
 insert into public.issue_resolutions(id,tenant_id,issue_id,resolved_by,notes) values(p_id,tid,p_issue,auth.uid(),btrim(p_notes));
 return jsonb_build_object('status','resolved','duplicate',false);
end $$;
create function public.list_asset_issues(p_asset uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_access(false,false);
 if not private.can_asset(p_asset) then raise exception 'Asset unavailable' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('resolutions',coalesce((select jsonb_agg(to_jsonb(r) order by r.server_time) from public.issue_resolutions r where r.issue_id=i.id),'[]'::jsonb)) order by i.server_time desc) from public.issues i where i.asset_id=p_asset and (private.is_admin() or i.reported_by=auth.uid())),'[]'::jsonb);
end $$;
create function public.save_compliance(p_id uuid,p_asset uuid,p_label text,p_due date,p_lead_days integer[],p_notify_assigned boolean,p_revision integer,p_archived boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true);old public.compliance_items;result uuid;
begin
 if not private.can_asset(p_asset) then raise exception 'Asset unavailable' using errcode='42501';end if;
 if coalesce(length(btrim(p_label)),0) not between 1 and 120 or p_due is null or not isfinite(p_due) then raise exception 'Enter a name and valid compliance date';end if;
 if p_lead_days is null or cardinality(p_lead_days)>20 or exists(select 1 from unnest(p_lead_days) n where n is null or n<0 or n>3650) then raise exception 'Reminder days must be between 0 and 3650, with up to 20 reminders';end if;
 if p_notify_assigned is null or p_archived is null then raise exception 'Choose reminder recipients';end if;
 if p_id is null then
  insert into public.compliance_items(tenant_id,asset_id,label,due_date,lead_days,notify_assigned) values(tid,p_asset,btrim(p_label),p_due,array(select distinct n from unnest(p_lead_days) n order by n desc),p_notify_assigned) returning id into result;
 else
  select * into old from public.compliance_items where id=p_id and asset_id=p_asset and tenant_id=tid for update;
  if not found then raise exception 'Compliance item unavailable' using errcode='42501';end if;
  if old.revision is distinct from p_revision then return jsonb_build_object('status','conflict');end if;
  update public.compliance_items set label=btrim(p_label),due_date=p_due,lead_days=array(select distinct n from unnest(p_lead_days) n order by n desc),notify_assigned=p_notify_assigned,archived=p_archived,revision=revision+1 where id=p_id;result:=p_id;
 end if;
 insert into public.asset_history(tenant_id,asset_id,actor_id,kind,details) values(tid,p_asset,auth.uid(),'compliance_changed',jsonb_build_object('id',result,'previous',to_jsonb(old),'label',btrim(p_label),'due_date',p_due,'lead_days',p_lead_days,'notify_assigned',p_notify_assigned,'archived',p_archived));
 return jsonb_build_object('status','saved','id',result);
end $$;
create function public.list_compliance(p_asset uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tid uuid:=private.require_access(false,false);today date;
begin
 if not private.can_asset(p_asset) then raise exception 'Asset unavailable' using errcode='42501';end if;
 select (now() at time zone timezone)::date into today from public.tenants where id=tid;
 return coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('days_remaining',c.due_date-today) order by c.due_date) from public.compliance_items c where c.asset_id=p_asset),'[]'::jsonb);
end $$;
revoke execute on function public.report_issue(uuid,uuid,text,text,timestamptz),public.resolve_issue(uuid,uuid,text),public.list_asset_issues(uuid),public.save_compliance(uuid,uuid,text,date,integer[],boolean,integer,boolean),public.list_compliance(uuid) from public,anon,authenticated;
grant execute on function public.report_issue(uuid,uuid,text,text,timestamptz),public.resolve_issue(uuid,uuid,text),public.list_asset_issues(uuid),public.save_compliance(uuid,uuid,text,date,integer[],boolean,integer,boolean),public.list_compliance(uuid) to authenticated;
