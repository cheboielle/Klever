-- Keep submitted evidence discoverable after schedule removal or asset type changes.
create function public.list_past_asset_services(p_asset uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tid uuid:=private.require_access(false,false); admin boolean:=private.is_admin(); active_services jsonb;
begin
  if not private.can_asset(p_asset) then raise exception 'Asset unavailable' using errcode='42501'; end if;
  active_services:=public.list_asset_services(p_asset);
  return coalesce((select jsonb_agg(jsonb_build_object('id',service_id,'config',snapshot) order by snapshot->>'name',service_id)
    from (select distinct on (h.service_id) h.service_id,u.snapshot
      from public.service_history h join public.service_uploads u on u.id=h.id and u.tenant_id=h.tenant_id
      where h.tenant_id=tid and h.asset_id=p_asset and (admin or h.submitted_by=auth.uid())
        and not exists(select 1 from jsonb_array_elements(active_services) a where a->>'id'=h.service_id::text)
      order by h.service_id,h.server_time desc,h.id desc) retained),'[]'::jsonb);
end $$;
revoke execute on function public.list_past_asset_services(uuid) from public,anon,authenticated;
grant execute on function public.list_past_asset_services(uuid) to authenticated;
