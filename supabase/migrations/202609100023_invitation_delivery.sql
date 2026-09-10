-- Delivery receipts contain no Auth codes, password material or login links.
alter table public.staff_invitations
 add column delivery_status text not null default 'not_sent' check(delivery_status in ('not_sent','sending','sent','failed','unknown')),
 add column delivery_attempt uuid,
 add column delivery_started_at timestamptz,
 add column last_sent_at timestamptz;

create function public.staff_invitation_delivery_context(p_id uuid,p_attempt uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tid uuid:=private.require_access(true,p_attempt is not null); inv public.staff_invitations; business text;
begin
 select * into inv from public.staff_invitations where id=p_id and tenant_id=tid;
 if not found or inv.accepted_at is not null or inv.cancelled_at is not null or inv.expires_at<=now() then raise exception 'Pending invitation unavailable' using errcode='42501';end if;
 if not exists(select 1 from public.memberships m join public.tenants t on t.id=m.tenant_id where m.tenant_id=tid and m.user_id=inv.invited_by and m.is_active and (m.role='admin' or t.owner_user_id=m.user_id)) then raise exception 'Invitation unavailable' using errcode='42501';end if;
 if exists(select 1 from auth.users u join public.memberships m on m.user_id=u.id where lower(u.email)=inv.email) then raise exception 'This email already has business access';end if;
 if p_attempt is not null and (inv.delivery_attempt is distinct from p_attempt or inv.delivery_status<>'sending' or inv.delivery_started_at<now()-interval '2 minutes') then raise exception 'Delivery attempt unavailable';end if;
 select name into business from public.tenants where id=tid;
 return jsonb_build_object('id',inv.id,'email',inv.email,'name',inv.name,'business_name',business,'delivery_status',inv.delivery_status,'last_sent_at',inv.last_sent_at,'existing_auth',exists(select 1 from auth.users where lower(email)=inv.email));
end $$;

create function public.claim_staff_invitation_delivery(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true); inv public.staff_invitations; attempt uuid;
begin
 perform 1 from public.tenants where id=tid for update;
 perform public.staff_invitation_delivery_context(p_id);
 select * into inv from public.staff_invitations where id=p_id and tenant_id=tid for update;
 -- One in-flight attempt. A lost provider acknowledgement is shown as uncertain,
 -- then an explicit resend may generate a fresh code after this short cooldown.
 if inv.delivery_started_at>now()-interval '2 minutes' then return jsonb_build_object('status','wait');end if;
 attempt:=gen_random_uuid();
 update public.staff_invitations set delivery_attempt=attempt,delivery_started_at=now(),delivery_status='sending' where id=p_id;
 return jsonb_build_object('status','claimed','attempt',attempt);
end $$;

create function public.finish_staff_invitation_delivery(p_id uuid,p_attempt uuid,p_status text) returns boolean
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if p_status not in ('sent','failed','unknown') or p_status is null then raise exception 'Invalid delivery outcome';end if;
 update public.staff_invitations set delivery_status=p_status,last_sent_at=case when p_status='sent' then now() else last_sent_at end
 where id=p_id and delivery_attempt=p_attempt and delivery_status='sending';
 get diagnostics n=row_count;return n=1;
end $$;

revoke all on function public.staff_invitation_delivery_context(uuid,uuid),public.claim_staff_invitation_delivery(uuid),public.finish_staff_invitation_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.staff_invitation_delivery_context(uuid,uuid),public.claim_staff_invitation_delivery(uuid) to authenticated;
grant execute on function public.finish_staff_invitation_delivery(uuid,uuid,text) to service_role;
