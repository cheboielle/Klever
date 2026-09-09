-- OS permission can be removed independently of the login session.
create function public.unregister_device_token(p_installation uuid) returns void language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(false,false);begin
 delete from public.device_tokens where installation_id=p_installation and tenant_id=tid and user_id=auth.uid();
end$$;
revoke execute on function public.unregister_device_token(uuid) from public,anon,authenticated;
grant execute on function public.unregister_device_token(uuid) to authenticated;
