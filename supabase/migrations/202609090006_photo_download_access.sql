-- Direct Storage downloads can be served from per-token CDN cache after revocation.
-- Stream evidence through a POST endpoint after a fresh database access check.
drop policy service_photo_read on storage.objects;
create function public.authorize_service_photo(p_id uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare path text;
begin
  perform private.require_access(false,false);
  select object_path into path from public.service_uploads where id=p_id;
  if path is null or not private.can_read_service_photo(path) then raise exception 'Photo unavailable' using errcode='42501'; end if;
  return path;
end $$;
revoke execute on function public.authorize_service_photo(uuid) from public,anon,authenticated;
grant execute on function public.authorize_service_photo(uuid) to authenticated;
