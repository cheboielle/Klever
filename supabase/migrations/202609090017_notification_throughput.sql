-- Urgent events precede routine reminders; cancelled candidates do not consume a delivery slot.
create or replace function public.claim_notifications(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.notification_outbox;result jsonb:='[]';lease uuid;email text;tokens jsonb;
begin
 for job in select n.* from public.notification_outbox n where n.status in ('pending','sending','awaiting_receipt') and n.next_attempt_at<=now() and (n.lease_until is null or n.lease_until<now()) order by (n.event_type='urgent_issue') desc,n.created_at,n.id limit 50 for update skip locked loop
  if not exists(select 1 from public.memberships m join public.tenants t on t.id=m.tenant_id where m.user_id=job.recipient_id and m.tenant_id=job.tenant_id and m.is_active and t.write_until>now() and (job.payload->>'asset_id' is null or m.role='admin' or t.owner_user_id=m.user_id or exists(select 1 from public.asset_assignments aa where aa.asset_id=(job.payload->>'asset_id')::uuid and aa.user_id=m.user_id and aa.tenant_id=m.tenant_id)) and (job.event_type<>'urgent_issue' or m.role='admin' or t.owner_user_id=m.user_id)) then
   update public.notification_outbox set status='cancelled',last_error='Recipient inactive or workspace read-only' where id=job.id;continue;
  end if;
  select u.email into email from auth.users u where u.id=job.recipient_id;
  select coalesce(jsonb_agg(jsonb_build_object('installation_id',d.installation_id,'token',d.token)),'[]'::jsonb) into tokens from public.device_tokens d join auth.sessions s on s.id=d.session_id where d.user_id=job.recipient_id and d.tenant_id=job.tenant_id;
  lease:=gen_random_uuid();
  update public.notification_outbox set status='sending',lease_id=lease,lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=job.id;
  result:=result||jsonb_build_array(to_jsonb(job)||jsonb_build_object('lease_id',lease,'email',email,'devices',tokens));
  exit when jsonb_array_length(result)>=greatest(1,least(p_limit,50));
 end loop;
 return result;
end $$;
