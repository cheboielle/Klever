-- Invitations authorize a future membership; Supabase Auth proves email ownership.
-- An invitation id is not a login token. No passwords or bearer links are stored here.
create table public.staff_invitations (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 email text not null check(length(email)<=254 and email=lower(btrim(email))),
 name text not null check(length(btrim(name)) between 1 and 120),
 phone text not null default '' check(length(phone)<=40),
 job_title text not null default '' check(length(job_title)<=120),
 invited_by uuid not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 cancelled_at timestamptz,
 accepted_at timestamptz,
 accepted_by uuid references auth.users(id),
 foreign key(tenant_id,invited_by) references public.memberships(tenant_id,user_id),
 check ((accepted_at is null)=(accepted_by is null)),
 check (accepted_at is null or cancelled_at is null)
);
create unique index staff_invitation_pending_email on public.staff_invitations(tenant_id,email)
 where accepted_at is null and cancelled_at is null;
alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from anon,authenticated;
grant select on public.staff_invitations to authenticated;
create policy invitation_admin_read on public.staff_invitations for select to authenticated
 using(tenant_id=private.current_tenant() and private.is_admin());

create function public.create_staff_invitation(p_id uuid,p_email text,p_name text,p_phone text default '',p_job_title text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true); e text:=lower(btrim(coalesce(p_email,''))); inv public.staff_invitations;
begin
 if p_id is null or length(e)>254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid invitation email';end if;
 if length(btrim(coalesce(p_name,''))) not between 1 and 120 or length(coalesce(p_phone,''))>40 or length(coalesce(p_job_title,''))>120 then raise exception 'Check the name, phone and job title';end if;
 -- Use the same tenant lock as provisioning, reactivation and acceptance.
 perform 1 from public.tenants where id=tid for update;
 perform private.require_access(true);
 select * into inv from public.staff_invitations where id=p_id;
 if found then
  if inv.tenant_id<>tid or inv.email<>e then raise exception 'Invitation unavailable' using errcode='42501';end if;
  return jsonb_build_object('id',inv.id,'expires_at',inv.expires_at,'status',case when inv.accepted_at is not null then 'accepted' when inv.cancelled_at is not null then 'cancelled' when inv.expires_at<=now() then 'expired' else 'pending' end);
 end if;
 if exists(select 1 from auth.users u join public.memberships m on m.user_id=u.id where lower(u.email)=e) then raise exception 'This email already has business access. Existing staff should be managed from Team.';end if;
 update public.staff_invitations set cancelled_at=now() where tenant_id=tid and email=e and accepted_at is null and cancelled_at is null and expires_at<=now();
 select * into inv from public.staff_invitations where tenant_id=tid and email=e and accepted_at is null and cancelled_at is null;
 if not found then
  insert into public.staff_invitations(id,tenant_id,email,name,phone,job_title,invited_by)
  values(p_id,tid,e,btrim(p_name),btrim(coalesce(p_phone,'')),btrim(coalesce(p_job_title,'')),auth.uid()) returning * into inv;
 end if;
 return jsonb_build_object('id',inv.id,'expires_at',inv.expires_at,'status','pending');
end $$;

create function public.cancel_staff_invitation(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true,false);begin
 perform 1 from public.tenants where id=tid for update;
 perform private.require_access(true,false);
 update public.staff_invitations set cancelled_at=coalesce(cancelled_at,now()) where id=p_id and tenant_id=tid and accepted_at is null;
 if not found then raise exception 'Pending invitation unavailable' using errcode='42501';end if;
end $$;

-- Unlike ordinary business RPCs, these are available before membership exists.
create function private.verified_invitation_email() returns text
language plpgsql stable security definer set search_path='' as $$
declare e text;begin
 if not exists(select 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid()) then raise exception 'Sign in again' using errcode='42501';end if;
 select lower(email) into e from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if e is null then raise exception 'Confirm your email before joining' using errcode='42501';end if;
 return e;
end $$;
create function public.my_staff_invitations() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e text:=private.verified_invitation_email();begin
 if exists(select 1 from public.memberships where user_id=auth.uid()) then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'business_name',t.name,'name',i.name,'phone',i.phone,'job_title',i.job_title,'email',i.email,'expires_at',i.expires_at) order by i.created_at)
 from public.staff_invitations i join public.tenants t on t.id=i.tenant_id join public.memberships m on m.tenant_id=i.tenant_id and m.user_id=i.invited_by
 where i.email=e and i.accepted_at is null and i.cancelled_at is null and i.expires_at>now() and m.is_active and (m.role='admin' or t.owner_user_id=m.user_id)),'[]'::jsonb);
end $$;
create function public.accept_staff_invitation(p_id uuid,p_name text,p_phone text default '',p_job_title text default '') returns void
language plpgsql security definer set search_path='' as $$
declare e text:=private.verified_invitation_email(); inv public.staff_invitations; t public.tenants;
begin
 if length(btrim(coalesce(p_name,''))) not between 1 and 120 or length(coalesce(p_phone,''))>40 or length(coalesce(p_job_title,''))>120 then raise exception 'Check your name, phone and job title';end if;
 select * into inv from public.staff_invitations where id=p_id and email=e;
 if not found then raise exception 'Invitation unavailable' using errcode='42501';end if;
 select * into t from public.tenants where id=inv.tenant_id for update;
 select * into inv from public.staff_invitations where id=p_id for update;
 if inv.accepted_at is not null or inv.cancelled_at is not null or inv.expires_at<=now() then raise exception 'This invitation has expired or is no longer available';end if;
 if not exists(select 1 from public.memberships where tenant_id=t.id and user_id=inv.invited_by and is_active and (role='admin' or user_id=t.owner_user_id)) then raise exception 'Invitation unavailable' using errcode='42501';end if;
 if t.write_until<=now() then raise exception 'This business is read-only';end if;
 if exists(select 1 from public.memberships where user_id=auth.uid()) then raise exception 'You already have business access. Contact your administrator.';end if;
 if (select count(*) from public.memberships where tenant_id=t.id and is_active)>=t.seat_limit then raise exception 'Staff limit reached. Ask your administrator to make space before joining.';end if;
 insert into public.memberships(user_id,tenant_id,name,phone,contact_email,job_title,role)
 values(auth.uid(),t.id,btrim(p_name),btrim(coalesce(p_phone,'')),e,btrim(coalesce(p_job_title,'')),'technician');
 update public.staff_invitations set accepted_at=now(),accepted_by=auth.uid() where id=p_id;
end $$;
revoke execute on function private.verified_invitation_email(),public.create_staff_invitation(uuid,text,text,text,text),public.cancel_staff_invitation(uuid),public.my_staff_invitations(),public.accept_staff_invitation(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.create_staff_invitation(uuid,text,text,text,text),public.cancel_staff_invitation(uuid),public.my_staff_invitations(),public.accept_staff_invitation(uuid,text,text,text) to authenticated;
