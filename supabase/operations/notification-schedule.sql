-- Apply after migration 013. Remain inactive until provider setup and delivery testing.
begin;
create extension if not exists pg_cron with schema pg_catalog;
do $$ declare job bigint;begin
 if not exists(select 1 from cron.job where jobname='klever-reminder-scan') then
  job:=cron.schedule('klever-reminder-scan','* * * * *','select public.schedule_notifications();');
  perform cron.alter_job(job,active:=false);
 end if;
end $$;
commit;
select jobname,active,schedule from cron.job where jobname='klever-reminder-scan';
