-- Archive keeps evidence and baselines; restoration resumes the same schedules.
create function public.set_asset_archived(p_asset uuid,p_archived boolean,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true);a public.assets;
begin
 if p_archived is null or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Enter a reason for archiving or restoring this asset';end if;
 select * into a from public.assets where id=p_asset and tenant_id=tid for update;
 if not found then raise exception 'Asset unavailable' using errcode='42501';end if;
 if a.archived=p_archived then return;end if;
 update public.assets set archived=p_archived,updated_at=now() where id=p_asset;
 insert into public.asset_history(tenant_id,asset_id,actor_id,kind,reason,details) values(tid,p_asset,auth.uid(),case when p_archived then 'archived' else 'restored' end,btrim(p_reason),jsonb_build_object('archived',p_archived));
 if p_archived then update public.notification_outbox set status='cancelled',last_error='Asset archived',lease_id=null,lease_until=null where tenant_id=tid and payload->>'asset_id'=p_asset::text and status in ('pending','sending','awaiting_receipt');end if;
end$$;
revoke all on function public.set_asset_archived(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.set_asset_archived(uuid,boolean,text) to authenticated;
create or replace function private.can_asset(p_asset uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.assets a where a.id=p_asset and a.tenant_id=private.current_tenant()
 and (private.is_admin() or (not a.archived and exists(select 1 from public.asset_assignments x where x.tenant_id=a.tenant_id and x.asset_id=a.id and x.user_id=auth.uid()))))
$$;
-- Serialize new submissions against archive changes, including previously reserved photos/tasks.
create function private.require_unarchived_submission() returns trigger language plpgsql security definer set search_path='' as $$
declare asset uuid;inactive boolean;
begin
 if tg_table_name='task_completions' then select asset_id into asset from public.task_submissions where id=new.id;
 else asset:=new.asset_id;end if;
 if asset is not null then
  select archived into inactive from public.assets where id=asset for share;
  if inactive then raise exception 'Asset is archived. Restore it before adding new work';end if;
 end if;
 return new;
end$$;
revoke all on function private.require_unarchived_submission() from public,anon,authenticated;
create trigger service_upload_archive_guard before insert on public.service_uploads for each row execute function private.require_unarchived_submission();
create trigger service_history_archive_guard before insert on public.service_history for each row execute function private.require_unarchived_submission();
create trigger task_submission_archive_guard before insert on public.task_submissions for each row execute function private.require_unarchived_submission();
create trigger task_completion_archive_guard before insert on public.task_completions for each row execute function private.require_unarchived_submission();
create or replace function public.save_asset_type(p_name text,p_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true);result uuid;old_name text;
begin
 if p_id is null then insert into public.asset_types(tenant_id,name) values(tid,btrim(p_name)) returning id into result;
 else
  select name into old_name from public.asset_types where id=p_id and tenant_id=tid for update;
  if not found then raise exception 'Asset type unavailable' using errcode='42501';end if;
  update public.asset_types set name=btrim(p_name) where id=p_id returning id into result;
  if old_name is distinct from btrim(p_name) then
   insert into public.asset_history(tenant_id,asset_id,actor_id,kind,details)
   select tid,id,auth.uid(),'type_renamed',jsonb_build_object('type_id',p_id,'previous_name',old_name,'name',btrim(p_name)) from public.assets where tenant_id=tid and asset_type_id=p_id;
  end if;
 end if;
 return result;
end$$;

create or replace function public.claim_notifications(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.notification_outbox;result jsonb:='[]';lease uuid;email text;tokens jsonb;
begin
 for job in select n.* from public.notification_outbox n where n.status in ('pending','sending','awaiting_receipt') and n.next_attempt_at<=now() and (n.lease_until is null or n.lease_until<now()) order by (n.event_type='urgent_issue') desc,n.created_at,n.id limit 50 for update skip locked loop
  if not exists(select 1 from public.memberships m join public.tenants t on t.id=m.tenant_id where m.user_id=job.recipient_id and m.tenant_id=job.tenant_id and m.is_active and t.write_until>now() and (job.payload->>'asset_id' is null or exists(select 1 from public.assets active_asset where active_asset.id=(job.payload->>'asset_id')::uuid and active_asset.tenant_id=m.tenant_id and not active_asset.archived)) and (job.payload->>'asset_id' is null or m.role='admin' or t.owner_user_id=m.user_id or exists(select 1 from public.asset_assignments aa where aa.asset_id=(job.payload->>'asset_id')::uuid and aa.user_id=m.user_id and aa.tenant_id=m.tenant_id)) and (job.event_type<>'urgent_issue' or m.role='admin' or t.owner_user_id=m.user_id)) then
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
