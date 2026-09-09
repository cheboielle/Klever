from pathlib import Path
import subprocess,os,secrets,json,hashlib,argparse,importlib.util
parser=argparse.ArgumentParser(description="Restore and reconcile a database/media copy in a new password-protected local-only test database. Does not restore hosted provider services or grants.")
parser.add_argument('--tools',required=True,type=Path)
parser.add_argument('--archive',required=True,type=Path)
parser.add_argument('--media',required=True,type=Path)
parser.add_argument('--directory',required=True,type=Path)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1];bin=args.tools.resolve();work=args.directory.resolve()
spec=importlib.util.spec_from_file_location('database_backup',root/'scripts/database-backup.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
db_manifest=module.verify(args.archive.resolve(),bin)
media_manifest=json.loads((args.media.resolve()/'manifest.json').read_text(encoding='utf-8'))
if media_manifest.get('project')!=db_manifest.get('project'):raise SystemExit('Database and media backups belong to different projects')
media_check=subprocess.run(['node',str(root/'scripts/media-backup.mjs'),'verify',str(args.media.resolve())],capture_output=True,text=True)
if media_check.returncode:raise SystemExit('Media backup verification failed')
work.mkdir(exist_ok=False)
password=secrets.token_urlsafe(36);pw=work/'init-password';pw.write_text(password,encoding='utf-8')
env=os.environ.copy();env.update(PGHOST='127.0.0.1',PGPORT='55439',PGUSER='postgres',PGDATABASE='postgres',PGPASSWORD=password,PGCONNECT_TIMEOUT='10')
flags=subprocess.CREATE_NO_WINDOW
started=False
try:
 init=subprocess.run([str(bin/'initdb.exe'),'-D',str(work/'data'),'-U','postgres','--auth=scram-sha-256','--pwfile='+str(pw),'--encoding=UTF8','--locale=C'],capture_output=True,text=True,creationflags=flags)
 pw.unlink(missing_ok=True)
 if init.returncode:raise RuntimeError('Local database initialization failed')
 started=True
 start=subprocess.run([str(bin/'pg_ctl.exe'),'-D',str(work/'data'),'-l',str(work/'server.log'),'-o','-h 127.0.0.1 -p 55439','-w','start'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags,timeout=60)
 if start.returncode:raise RuntimeError('Local restore database failed to start')
 started=True
 def sql(query):
  r=subprocess.run([str(bin/'psql.exe'),'-X','-v','ON_ERROR_STOP=1','-At','-c',query],env=env,capture_output=True,text=True,creationflags=flags)
  if r.returncode:
   (work/'restore-error.txt').write_text(r.stderr,encoding='utf-8');raise RuntimeError('Local SQL failed; private diagnostic written')
  return r.stdout.strip()
 sql('drop schema public; create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin; create role supabase_auth_admin; create role supabase_storage_admin; create role dashboard_user; create role authenticator; create role supabase_functions_admin; create schema extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions;')
 restore=subprocess.run([str(bin/'pg_restore.exe'),'--no-owner','--no-privileges','--exit-on-error','--dbname=postgres',str(args.archive.resolve()/'database.dump')],env=env,capture_output=True,text=True,creationflags=flags)
 if restore.returncode:
  (work/'restore-error.txt').write_text(restore.stderr,encoding='utf-8');raise RuntimeError('Restore did not finish; private diagnostic written')
 counts=sql("select json_build_object('tenants',(select count(*) from public.tenants),'assets',(select count(*) from public.assets),'users',(select count(*) from auth.users),'services',(select count(*) from public.service_history),'tasks',(select count(*) from public.task_completions),'photos',(select count(*) from storage.objects where bucket_id='evidence'))")
 (work/'counts.json').write_text(counts,encoding='utf-8');print('Restored database counts: '+counts)
 paths=json.loads(sql("select coalesce(json_agg(name),'[]') from (select name from storage.objects where bucket_id='evidence' union select u.object_path from public.service_history h join public.service_uploads u on u.id=h.id union select u.object_path from public.task_completions c join public.task_submissions u on u.id=c.id where u.object_path is not null union select u.object_path from public.profile_photos p join public.profile_photo_uploads u on u.id=p.upload_id) refs"))
 manifest=media_manifest;files={f['name']:f for f in manifest['objects']}
 for path in paths:
  if path not in files:raise RuntimeError('Restored metadata has no matching photo backup')
  file=files[path];data=(args.media.resolve()/'objects'/file['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=file['sha256']:raise RuntimeError('Restored photo byte checksum failed')
 (work/'result.json').write_text(json.dumps({'database_sha256':db_manifest['sha256'],'project':db_manifest['project'],'photo_paths_verified':len(paths),'counts':json.loads(counts),'scope':'Local schema/data restore without hosted grants or provider endpoints'},indent=2),encoding='utf-8')
 print('Every restored Storage object and submitted/current photo reference matched verified local photo bytes.')
 print('Local archive restore only: provider endpoints, policies and offsite scheduling still require separate acceptance.')
finally:
 pw.unlink(missing_ok=True)
 if started:subprocess.run([str(bin/'pg_ctl.exe'),'-D',str(work/'data'),'-m','fast','-w','stop'],capture_output=True,text=True,creationflags=flags)
