-- Mutable asset/profile pictures use fresh object IDs; accepted service/task evidence is untouched.
create table public.profile_photo_uploads (
 id uuid primary key,tenant_id uuid not null,asset_id uuid,user_id uuid,uploaded_by uuid not null,
 object_path text not null unique,created_at timestamptz not null default now(),finalized boolean not null default false,
 check((asset_id is null)<>(user_id is null)),unique(tenant_id,id),
 foreign key(tenant_id,asset_id) references public.assets(tenant_id,id),
 foreign key(tenant_id,user_id) references public.memberships(tenant_id,user_id),
 foreign key(tenant_id,uploaded_by) references public.memberships(tenant_id,user_id)
);
create table public.profile_photos (
 tenant_id uuid not null,kind text not null check(kind in ('asset','member')),target_id uuid not null,
 upload_id uuid,revision integer not null default 1,updated_by uuid not null,updated_at timestamptz not null default now(),
 primary key(kind,target_id),foreign key(tenant_id,upload_id) references public.profile_photo_uploads(tenant_id,id),
 foreign key(tenant_id,updated_by) references public.memberships(tenant_id,user_id)
);
create function private.can_profile(p_kind text,p_target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when p_kind='asset' then private.can_asset(p_target) when p_kind='member' then exists(select 1 from public.memberships where user_id=p_target and tenant_id=private.current_tenant() and (private.is_admin() or user_id=auth.uid())) else false end
$$;
create function private.lock_profile(p_kind text,p_target uuid,p_tid uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_kind='asset' then perform 1 from public.assets where id=p_target and tenant_id=p_tid for update;
 elsif p_kind='member' then perform 1 from public.memberships where user_id=p_target and tenant_id=p_tid for update;
 else raise exception 'Choose an asset or team member';end if;
 if not found then raise exception 'Record unavailable' using errcode='42501';end if;
end $$;
create function public.get_profile_photo(p_kind text,p_target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare photo public.profile_photos;
begin
 perform private.require_access(false,false);
 if not private.can_profile(p_kind,p_target) then raise exception 'Record unavailable' using errcode='42501';end if;
 select * into photo from public.profile_photos where kind=p_kind and target_id=p_target;
 return jsonb_build_object('id',photo.upload_id,'revision',coalesce(photo.revision,0));
end $$;
create function public.prepare_profile_photo(p_id uuid,p_kind text,p_target uuid) returns text language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true); old public.profile_photo_uploads; path text;
begin
 perform private.lock_profile(p_kind,p_target,tid);
 select * into old from public.profile_photo_uploads where id=p_id;
 if found then
  if old.tenant_id<>tid or old.uploaded_by<>auth.uid() or old.asset_id is distinct from (case when p_kind='asset' then p_target end) or old.user_id is distinct from (case when p_kind='member' then p_target end) then raise exception 'Photo ID already used';end if;
  return old.object_path;
 end if;
 path:=tid::text||'/profile-'||p_id::text||'.jpg';
 insert into public.profile_photo_uploads(id,tenant_id,asset_id,user_id,uploaded_by,object_path) values(p_id,tid,case when p_kind='asset' then p_target end,case when p_kind='member' then p_target end,auth.uid(),path);
 return path;
end $$;
create function private.can_upload_profile_photo(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_admin() and exists(select 1 from public.profile_photo_uploads u join public.tenants t on t.id=u.tenant_id where u.object_path=p_path and u.tenant_id=private.current_tenant() and u.uploaded_by=auth.uid() and not u.finalized and t.write_until>now())
$$;
create policy profile_photo_insert on storage.objects for insert to authenticated with check(bucket_id='evidence' and private.can_upload_profile_photo(name));
create function public.save_profile_photo(p_kind text,p_target uuid,p_upload uuid,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true); current_photo public.profile_photos; u public.profile_photo_uploads;
begin
 perform private.lock_profile(p_kind,p_target,tid);
 select * into current_photo from public.profile_photos where kind=p_kind and target_id=p_target;
 if current_photo.upload_id is not distinct from p_upload then return jsonb_build_object('status','saved','revision',coalesce(current_photo.revision,0));end if;
 if coalesce(current_photo.revision,0) is distinct from p_revision then return jsonb_build_object('status','conflict');end if;
 if p_upload is not null then
  select * into u from public.profile_photo_uploads where id=p_upload and tenant_id=tid and uploaded_by=auth.uid();
  if not found or u.asset_id is distinct from (case when p_kind='asset' then p_target end) or u.user_id is distinct from (case when p_kind='member' then p_target end) or u.finalized then raise exception 'Photo unavailable' using errcode='42501';end if;
  if not exists(select 1 from storage.objects where bucket_id='evidence' and name=u.object_path and (metadata->>'size')::bigint>0 and metadata->>'mimetype'='image/jpeg') then raise exception 'The photo has not finished uploading. Retry the upload';end if;
  update public.profile_photo_uploads set finalized=true where id=p_upload;
 end if;
 insert into public.profile_photos(tenant_id,kind,target_id,upload_id,revision,updated_by) values(tid,p_kind,p_target,p_upload,1,auth.uid())
 on conflict(kind,target_id) do update set upload_id=excluded.upload_id,revision=profile_photos.revision+1,updated_by=auth.uid(),updated_at=now();
 if p_kind='asset' then insert into public.asset_history(tenant_id,asset_id,actor_id,kind,details) values(tid,p_target,auth.uid(),'photo_changed',jsonb_build_object('previous_photo',current_photo.upload_id,'photo',p_upload));end if;
 return jsonb_build_object('status','saved','revision',coalesce(current_photo.revision,0)+1);
end $$;
create function public.authorize_profile_photo(p_id uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare path text;
begin
 perform private.require_access(false,false);
 select u.object_path into path from public.profile_photos p join public.profile_photo_uploads u on u.id=p.upload_id where p.upload_id=p_id and private.can_profile(p.kind,p.target_id);
 if path is null then raise exception 'Photo unavailable' using errcode='42501';end if;
 return path;
end $$;
alter table public.profile_photo_uploads enable row level security;
alter table public.profile_photos enable row level security;
create policy profile_photos_read on public.profile_photos for select to authenticated using(private.can_profile(kind,target_id));
create policy profile_uploads_read on public.profile_photo_uploads for select to authenticated using(tenant_id=private.current_tenant() and private.is_admin());
revoke all on public.profile_photos,public.profile_photo_uploads from anon,authenticated;
grant select on public.profile_photos,public.profile_photo_uploads to authenticated;
revoke execute on function private.can_profile(text,uuid),private.lock_profile(text,uuid,uuid),private.can_upload_profile_photo(text) from public,anon,authenticated;
grant execute on function private.can_profile(text,uuid),private.can_upload_profile_photo(text) to authenticated;
revoke execute on function public.get_profile_photo(text,uuid),public.prepare_profile_photo(uuid,text,uuid),public.save_profile_photo(text,uuid,uuid,integer),public.authorize_profile_photo(uuid) from public,anon,authenticated;
grant execute on function public.get_profile_photo(text,uuid),public.prepare_profile_photo(uuid,text,uuid),public.save_profile_photo(text,uuid,uuid,integer),public.authorize_profile_photo(uuid) to authenticated;
