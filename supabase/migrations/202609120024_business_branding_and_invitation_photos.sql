-- Shared business branding and optional photos for pending staff invitations.
alter table public.staff_invitations add constraint staff_invitations_tenant_id_id_key unique(tenant_id,id);
alter table public.profile_photo_uploads add column business_id uuid references public.tenants(id), add column invitation_id uuid;
alter table public.profile_photo_uploads add foreign key(tenant_id,invitation_id) references public.staff_invitations(tenant_id,id);
alter table public.profile_photo_uploads drop constraint profile_photo_uploads_check;
alter table public.profile_photo_uploads add check(num_nonnulls(asset_id,user_id,business_id,invitation_id)=1), add check(business_id is null or business_id=tenant_id);
alter table public.profile_photos drop constraint profile_photos_kind_check;
alter table public.profile_photos add check(kind in ('asset','member','business','invitation'));
create or replace function private.can_profile(p_kind text,p_target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when p_kind='asset' then private.can_asset(p_target)
 when p_kind='member' then exists(select 1 from public.memberships where user_id=p_target and tenant_id=private.current_tenant() and (private.is_admin() or user_id=auth.uid()))
 when p_kind='business' then p_target=private.current_tenant()
 when p_kind='invitation' then private.is_admin() and exists(select 1 from public.staff_invitations where id=p_target and tenant_id=private.current_tenant() and accepted_at is null and cancelled_at is null and expires_at>now()) else false end
$$;
create or replace function private.lock_profile(p_kind text,p_target uuid,p_tid uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_kind='asset' then perform 1 from public.assets where id=p_target and tenant_id=p_tid for update;
 elsif p_kind='member' then perform 1 from public.memberships where user_id=p_target and tenant_id=p_tid for update;
 elsif p_kind='business' then perform 1 from public.tenants where id=p_target and id=p_tid for update;
 elsif p_kind='invitation' then
  perform 1 from public.tenants where id=p_tid for update;
  perform 1 from public.staff_invitations where id=p_target and tenant_id=p_tid and accepted_at is null and cancelled_at is null and expires_at>now() for update;
 else raise exception 'Record unavailable';end if;
 if not found then raise exception 'Record unavailable' using errcode='42501';end if;
end $$;
create or replace function public.prepare_profile_photo(p_id uuid,p_kind text,p_target uuid) returns text language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true); old public.profile_photo_uploads; path text;
begin
 perform private.lock_profile(p_kind,p_target,tid);
 select * into old from public.profile_photo_uploads where id=p_id;
 if found then
  if old.tenant_id<>tid or old.uploaded_by<>auth.uid() or old.asset_id is distinct from (case when p_kind='asset' then p_target end) or old.user_id is distinct from (case when p_kind='member' then p_target end) or old.business_id is distinct from (case when p_kind='business' then p_target end) or old.invitation_id is distinct from (case when p_kind='invitation' then p_target end) then raise exception 'Photo ID already used';end if;
  return old.object_path;
 end if;
 path:=tid::text||'/profile-'||p_id::text||'.jpg';
 insert into public.profile_photo_uploads(id,tenant_id,asset_id,user_id,business_id,invitation_id,uploaded_by,object_path) values(p_id,tid,case when p_kind='asset' then p_target end,case when p_kind='member' then p_target end,case when p_kind='business' then p_target end,case when p_kind='invitation' then p_target end,auth.uid(),path);
 return path;
end $$;
create or replace function public.save_profile_photo(p_kind text,p_target uuid,p_upload uuid,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true); current_photo public.profile_photos; u public.profile_photo_uploads;
begin
 perform private.lock_profile(p_kind,p_target,tid);
 select * into current_photo from public.profile_photos where kind=p_kind and target_id=p_target;
 if current_photo.upload_id is not distinct from p_upload then return jsonb_build_object('status','saved','revision',coalesce(current_photo.revision,0));end if;
 if coalesce(current_photo.revision,0) is distinct from p_revision then return jsonb_build_object('status','conflict');end if;
 if p_upload is not null then
  select * into u from public.profile_photo_uploads where id=p_upload and tenant_id=tid and uploaded_by=auth.uid();
  if not found or u.asset_id is distinct from (case when p_kind='asset' then p_target end) or u.user_id is distinct from (case when p_kind='member' then p_target end) or u.business_id is distinct from (case when p_kind='business' then p_target end) or u.invitation_id is distinct from (case when p_kind='invitation' then p_target end) or u.finalized then raise exception 'Photo unavailable' using errcode='42501';end if;
  if not exists(select 1 from storage.objects where bucket_id='evidence' and name=u.object_path and (metadata->>'size')::bigint>0 and metadata->>'mimetype'='image/jpeg') then raise exception 'The photo has not finished uploading. Retry the upload';end if;
  update public.profile_photo_uploads set finalized=true where id=p_upload;
 end if;
 insert into public.profile_photos(tenant_id,kind,target_id,upload_id,revision,updated_by) values(tid,p_kind,p_target,p_upload,1,auth.uid())
 on conflict(kind,target_id) do update set upload_id=excluded.upload_id,revision=profile_photos.revision+1,updated_by=auth.uid(),updated_at=now();
 if p_kind='asset' then insert into public.asset_history(tenant_id,asset_id,actor_id,kind,details) values(tid,p_target,auth.uid(),'photo_changed',jsonb_build_object('previous_photo',current_photo.upload_id,'photo',p_upload));end if;
 return jsonb_build_object('status','saved','revision',coalesce(current_photo.revision,0)+1);
end $$;

-- Transfer the optional invitation picture only after verified account acceptance.
create function private.accept_invitation_photo() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.accepted_at is null and new.accepted_at is not null then
  update public.profile_photo_uploads set user_id=new.accepted_by,invitation_id=null where invitation_id=new.id and tenant_id=new.tenant_id;
  update public.profile_photos set kind='member',target_id=new.accepted_by where kind='invitation' and target_id=new.id and tenant_id=new.tenant_id;
 end if;
 return new;
end $$;
create trigger accept_invitation_photo after update on public.staff_invitations for each row execute function private.accept_invitation_photo();
revoke execute on function private.accept_invitation_photo() from public,anon,authenticated;

alter table public.tenants add column brand_theme text not null default 'forest' check(brand_theme in ('forest','ocean','slate','plum','terracotta'));
alter table public.tenants add column brand_revision integer not null default 0;
create function public.business_branding() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tid uuid:=private.require_access(false,false);begin
 return (select jsonb_build_object('tenant_id',id,'theme',brand_theme,'revision',brand_revision) from public.tenants where id=tid);
end $$;
create function public.save_business_branding(p_theme text,p_revision integer) returns boolean language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true);begin
 if p_theme is null or p_theme not in ('forest','ocean','slate','plum','terracotta') then raise exception 'Choose a colour theme';end if;
 update public.tenants set brand_theme=p_theme,brand_revision=brand_revision+1 where id=tid and brand_revision=p_revision;
 return found;
end $$;
revoke execute on function public.business_branding(),public.save_business_branding(text,integer) from public,anon,authenticated;
grant execute on function public.business_branding(),public.save_business_branding(text,integer) to authenticated;
