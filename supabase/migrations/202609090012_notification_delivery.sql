create table public.device_tokens (
 installation_id uuid primary key,tenant_id uuid not null,user_id uuid not null,session_id uuid not null references auth.sessions(id) on delete cascade,
 token text not null unique,platform text not null check(platform in ('ios','android')),registered_at timestamptz not null default now(),
 foreign key(tenant_id,user_id) references public.memberships(tenant_id,user_id)
);
alter table public.device_tokens enable row level security;
create policy device_tokens_read on public.device_tokens for select to authenticated using(tenant_id=private.current_tenant() and user_id=auth.uid());
revoke all on public.device_tokens from anon,authenticated;
grant select on public.device_tokens to authenticated;
create function public.register_device_token(p_installation uuid,p_token text,p_platform text) returns void language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(false,false);
begin
 if p_token is null or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' or length(p_token)>256 or p_platform not in ('ios','android') then raise exception 'Invalid phone notification token';end if;
 delete from public.device_tokens where token=p_token and installation_id<>p_installation;
 insert into public.device_tokens(installation_id,tenant_id,user_id,session_id,token,platform) values(p_installation,tid,auth.uid(),(auth.jwt()->>'session_id')::uuid,p_token,p_platform)
 on conflict(installation_id) do update set tenant_id=excluded.tenant_id,user_id=excluded.user_id,session_id=excluded.session_id,token=excluded.token,platform=excluded.platform,registered_at=now();
end $$;
revoke execute on function public.register_device_token(uuid,text,text) from public,anon,authenticated;
grant execute on function public.register_device_token(uuid,text,text) to authenticated;
alter table public.notification_outbox add column lease_id uuid;
alter table public.notification_outbox add column lease_until timestamptz;
alter table public.notification_outbox add column delivery_state jsonb not null default '{}';
alter table public.notification_outbox add column last_error text;
alter table public.notification_outbox add constraint notification_status check(status in ('pending','sending','awaiting_receipt','sent','failed','cancelled'));
create index notification_work on public.notification_outbox(next_attempt_at) where status in ('pending','sending','awaiting_receipt');
create function public.claim_notifications(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.notification_outbox;result jsonb:='[]';lease uuid;email text;tokens jsonb;
begin
 for job in select n.* from public.notification_outbox n where n.status in ('pending','sending','awaiting_receipt') and n.next_attempt_at<=now() and (n.lease_until is null or n.lease_until<now()) order by n.created_at limit greatest(1,least(p_limit,50)) for update skip locked loop
  if not exists(select 1 from public.memberships m join public.tenants t on t.id=m.tenant_id where m.user_id=job.recipient_id and m.tenant_id=job.tenant_id and m.is_active and t.write_until>now() and (job.event_type<>'urgent_issue' or m.role='admin' or t.owner_user_id=m.user_id)) then
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
create function public.finish_notification(p_id uuid,p_lease uuid,p_status text,p_delivery_state jsonb,p_error text default null,p_invalid_tokens text[] default '{}') returns boolean language plpgsql security definer set search_path='' as $$
declare job public.notification_outbox;
begin
 select * into job from public.notification_outbox where id=p_id for update;
 if not found or job.lease_id is distinct from p_lease or job.status<>'sending' then return false;end if;
 if p_status is null or p_status not in ('pending','awaiting_receipt','sent','failed') or p_delivery_state is null or jsonb_typeof(p_delivery_state)<>'object' then raise exception 'Invalid delivery outcome';end if;
 delete from public.device_tokens where user_id=job.recipient_id and tenant_id=job.tenant_id and token=any(p_invalid_tokens);
 update public.notification_outbox set status=case when p_status='pending' and attempts>=10 then 'failed' else p_status end,
  delivery_state=p_delivery_state,last_error=left(p_error,1000),lease_id=null,lease_until=null,
  next_attempt_at=now()+case when p_status='awaiting_receipt' then interval '15 minutes' else make_interval(secs=>least(3600,30*power(2,least(job.attempts,7))::integer)) end where id=job.id;
 return true;
end $$;
revoke execute on function public.claim_notifications(integer),public.finish_notification(uuid,uuid,text,jsonb,text,text[]) from public,anon,authenticated;
grant execute on function public.claim_notifications(integer),public.finish_notification(uuid,uuid,text,jsonb,text,text[]) to service_role;
