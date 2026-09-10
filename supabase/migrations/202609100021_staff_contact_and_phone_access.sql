-- Owner-requested simplification: the phone's screen lock protects its saved session.
-- Keep the old setting/RPC argument for installed clients; it cannot re-enable app lock.
update public.tenants set app_lock=false where app_lock;
create or replace function public.save_business_settings(p_name text,p_timezone text,p_lock boolean,p_currency text,p_revision integer) returns boolean language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true);begin
 if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Choose a valid business timezone';end if;
 update public.tenants set name=btrim(p_name),timezone=p_timezone,app_lock=false,reporting_currency=p_currency where id=tid and settings_revision=p_revision;return found;end$$;

alter table public.memberships add column contact_email text not null default '' check(length(contact_email)<=254);
alter table public.memberships add column job_title text not null default '' check(length(job_title)<=120);
-- Contact details are deliberately independent of Auth sign-in credentials.
create function public.save_staff_details(p_user uuid,p_name text,p_phone text,p_contact_email text,p_job_title text) returns void
language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true); email text:=btrim(coalesce(p_contact_email,'')); title text:=btrim(coalesce(p_job_title,''));
begin
 if length(email)>254 or (email<>'' and email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Enter a valid contact email';end if;
 if length(title)>120 then raise exception 'Job title must be 120 characters or fewer';end if;
 perform public.save_staff_details(p_user,p_name,p_phone);
 update public.memberships set contact_email=email,job_title=title where tenant_id=tid and user_id=p_user;
end $$;
revoke execute on function public.save_staff_details(uuid,text,text,text,text) from public,anon;
grant execute on function public.save_staff_details(uuid,text,text,text,text) to authenticated;
