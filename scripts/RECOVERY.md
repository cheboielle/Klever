# Recovery operations

Status: media-copy tooling is implemented. Daily offsite scheduling and a combined database/media restore have **not** been completed. A local copy on the development computer is not the release backup service.

## Photo bytes

Use Node 22.13+ with `KLEVER_BACKUP_PROJECT` and `KLEVER_ADMIN_KEY` supplied through the operator's secure environment. The latter must be a server credential; never commit it, pass it on a command line, or use it in either app.

```
node scripts/media-backup.mjs backup <new-private-directory>
node scripts/media-backup.mjs verify <existing-private-directory>
```

The directory's parent must exist. The destination must be private and excluded from source control. Development copies belong under ignored `tmp/`; production copies need the approved backup destination and retention policy. Each run requires a new directory and never overwrites an earlier copy.

The backup copies every evidence-bucket object, including retained superseded profile pictures. A manifest preserves Storage names, object IDs, update times, sizes and SHA-256 file checksums. It is marked complete only after every download, a second unchanged inventory, and verification of all local bytes. A failed run may leave an incomplete directory without `manifest.json`; do not treat that directory as a backup. If uploads occurred during the copy, retry into a new directory. Never remove the last verified copy while retrying.

Before a recovery, run verification again. Missing or changed bytes fail verification. Checksums detect accidental corruption; they are not an independent cryptographic signature. The tool does not modify the source bucket, restore data, or prove database recovery.

## Combined recovery release gate

Follow the [official Supabase database backup/restore procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) for roles, schema, data and migration history. Preserve the project's custom Auth/Storage policies and triggers from the migrations as well. Supabase [database backups exclude Storage bytes](https://supabase.com/docs/guides/platform/backups).

Pair the database backup with a verified media copy. During a controlled restore rehearsal, use a separate approved project, keep notification delivery and reminder scans disabled, and restore account/tenant records plus the original evidence paths. Resolve Storage metadata/file restoration using the documented provider procedure; do not simply assume that restoring `storage.objects` restores files. Revoke restored sessions before users resume access. Restore provider secrets separately through secure configuration.

Reconcile database counts and every referenced service, task and current profile photo against restored bytes, including honest missing legacy evidence. Then run tenant/role/session isolation checks and generate a maintenance PDF through an ordinary test admin. Record exact source/target IDs, backup timestamps and reconciliation results in BUILD_STATUS.md. Keep real email/push and commercial billing disabled in the rehearsal project.

The computer currently lacks Docker/pg_dump and an approved separate recovery project/offsite destination. Those gates remain open; no daily recovery guarantee or successful combined restore is claimed.
