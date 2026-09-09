-- Operator setup only. No secrets or outbound calls occur while applying this file.
-- Populate the two Vault entries and Edge Function settings before explicit activation.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create or replace function private.dispatch_notification_worker() returns bigint language plpgsql security definer set search_path='' as $$
declare project_url text;worker_secret text;request_id bigint;
begin
 select decrypted_secret into project_url from vault.decrypted_secrets where name='klever_project_url';
 select decrypted_secret into worker_secret from vault.decrypted_secrets where name='klever_notification_worker_secret';
 if project_url is null or project_url!~'^https://[a-z]{20}\.supabase\.co$' or worker_secret is null or length(worker_secret)<32 then
  raise exception 'Notification invocation is not configured';
 end if;
 select net.http_post(url:=project_url||'/functions/v1/notification-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',worker_secret),
  body:='{}'::jsonb,timeout_milliseconds:=100000) into request_id;
 return request_id;
end$$;
revoke all on function private.dispatch_notification_worker() from public,anon,authenticated,service_role;
do $$ declare job bigint;begin
 if not exists(select 1 from cron.job where jobname='klever-notification-delivery') then
  job:=cron.schedule('klever-notification-delivery','* * * * *','select private.dispatch_notification_worker();');
  perform cron.alter_job(job,active:=false);
 end if;
end$$;
commit;
select jobname,active,schedule from cron.job where jobname='klever-notification-delivery';
