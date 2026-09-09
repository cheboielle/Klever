# Recovery operations

Status: database and media-copy tooling plus a local schema/data restore with photo reconciliation are implemented and tested. Daily offsite scheduling and a full hosted Supabase recovery rehearsal remain outstanding. A local copy on the development computer is not the release backup service.

## Photo bytes

Use Node 22.13+ with `KLEVER_BACKUP_PROJECT` and `KLEVER_ADMIN_KEY` supplied through the operator's secure environment. The latter must be a server credential; never commit it, pass it on a command line, or use it in either app.

```
node scripts/media-backup.mjs backup <new-private-directory>
node scripts/media-backup.mjs verify <existing-private-directory>
```

The directory's parent must exist. The destination must be private and excluded from source control. Development copies belong under ignored `tmp/`; production copies need the approved backup destination and retention policy. Each run requires a new directory and never overwrites an earlier copy.

The backup copies every evidence-bucket object, including retained superseded profile pictures. A manifest preserves Storage names, object IDs, update times, sizes and SHA-256 file checksums. It is marked complete only after every download, a second unchanged inventory, and verification of all local bytes. A failed run may leave an incomplete directory without `manifest.json`; do not treat that directory as a backup. If uploads occurred during the copy, retry into a new directory. Never remove the last verified copy while retrying.

Before a recovery, run verification again. Missing or changed bytes fail verification. Checksums detect accidental corruption; they are not an independent cryptographic signature. The tool does not modify the source bucket, restore data, or prove database recovery.

## Database archive and local rehearsal

On Windows, install portable PostgreSQL 17 tools from the [official PostgreSQL Windows download page](https://www.postgresql.org/download/windows/) and its linked EDB archive. The development server uses PostgreSQL 17.6; the tested portable tools are 17.11. No Windows service is installed. Keep tool binaries and database copies outside source control.

With Python 3, pnpm and the authorized Supabase CLI login available, run from the project workspace:

```
python scripts/database-backup.py backup <new-private-directory> --tools <postgres-bin-directory> --project <expected-project-ref>
python scripts/database-backup.py verify <backup-directory> --tools <postgres-bin-directory>
python scripts/rehearse-local-restore.py --tools <postgres-bin-directory> --archive <database-backup-directory> --media <media-backup-directory> --directory <new-private-rehearsal-directory>
```

The backup checks the linked project matches the explicit reference. It parses only connection settings from the CLI's dry-run plan, without executing that shell text, logging credentials or resetting passwords. It invokes pg_dump with the authorized postgres role, then verifies the custom archive and records its checksum. Incomplete directories without a manifest are not successful backups.

The archive includes public/private application schemas, Auth/Storage records and application migration history. Managed Auth/Storage migration tables are excluded. Provider configuration, cluster role definitions/passwords, extension setup, Edge Function secrets and photo bytes remain separate. This is not a one-command replacement for the hosted provider restoration procedure below.

The local rehearsal verifies both copies and their matching project IDs before starting a password-protected PostgreSQL process bound only to 127.0.0.1:55439. It uses a new local data directory, supplies expected fixture roles/extensions, restores schema/data without hosted owner/grant replication, reconciles every stored and submitted/current photo path against backed-up bytes, and stops the process afterward. It writes aggregate counts and a result record in the private rehearsal directory. Do not use that local database as an application deployment or claim it proves provider Auth/Storage endpoints or production grants.

Verification for the operator code:

```
python -m unittest discover -s tests -p test_database_backup.py
pnpm test
```

## Combined recovery release gate

Follow the [official Supabase database backup/restore procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) for roles, schema, data and migration history. Preserve the project's custom Auth/Storage policies and triggers from the migrations as well. Supabase [database backups exclude Storage bytes](https://supabase.com/docs/guides/platform/backups).

Pair the database backup with a verified media copy. During a controlled restore rehearsal, use a separate approved project, keep notification delivery and reminder scans disabled, and restore account/tenant records plus the original evidence paths. Resolve Storage metadata/file restoration using the documented provider procedure; do not simply assume that restoring `storage.objects` restores files. Revoke restored sessions before users resume access. Restore provider secrets separately through secure configuration.

Reconcile database counts and every referenced service, task and current profile photo against restored bytes, including honest missing legacy evidence. Then run tenant/role/session isolation checks and generate a maintenance PDF through an ordinary test admin. Record exact source/target IDs, backup timestamps and reconciliation results in BUILD_STATUS.md. Keep real email/push and commercial billing disabled in the rehearsal project.

Portable pg_dump/pg_restore tools now exist locally under ignored tmp/postgresql-tools/pgsql/bin. An approved separate hosted recovery project and offsite destination are still needed. The local restore demonstrated matching aggregate records and photo bytes; full hosted permissions/provider recovery and daily scheduling remain open release gates.
