"""Operator-only Windows database archive using the linked Supabase CLI connection.
Credentials stay in the child process environment; the CLI shell plan is parsed, never executed.
"""
from pathlib import Path
import argparse, hashlib, json, os, re, shlex, subprocess
from datetime import datetime, timezone


def connection_environment(plan):
    allowed = {"PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"}
    values = {}
    for line in plan.splitlines():
        if line.startswith("export PG"):
            parts = shlex.split(line)
            if len(parts) != 2 or "=" not in parts[1]:
                raise ValueError("Unexpected backup connection syntax")
            key, value = parts[1].split("=", 1)
            if key not in allowed or key in values:
                raise ValueError("Unexpected backup connection setting")
            values[key] = value
    if not all(values.get(key) for key in allowed):
        raise ValueError("Incomplete backup connection settings")
    return {**os.environ, **values, "PGSSLMODE": "require", "PGCONNECT_TIMEOUT": "20"}


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, timeout=900, **kwargs)
    if result.returncode:
        # Provider diagnostics can contain SQL/data. Do not echo them to shared logs.
        raise RuntimeError("Database backup command failed; no completed manifest was written")
    return result.stdout


def verify(directory, tools):
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("kind") != "klever-postgres-archive" or manifest.get("version") != 1:
        raise ValueError("Unsupported database archive")
    archive = directory / "database.dump"
    if archive.stat().st_size != manifest["bytes"] or hashlib.sha256(archive.read_bytes()).hexdigest() != manifest["sha256"]:
        raise ValueError("Database archive is missing or damaged")
    run([str(tools / "pg_restore.exe"), "--list", str(archive)])
    return manifest


def backup(directory, tools, project, workspace):
    if not re.fullmatch(r"[a-z]{20}", project):
        raise ValueError("An explicit Supabase project reference is required")
    if (workspace / "supabase/.temp/project-ref").read_text().strip() != project:
        raise ValueError("Linked project does not match the requested backup project")
    directory.mkdir(exist_ok=False)
    started = datetime.now(timezone.utc).isoformat()
    plan = run(["cmd", "/c", "pnpm", "dlx", "supabase@latest", "db", "dump", "--linked", "--dry-run"], cwd=workspace)
    env = connection_environment(plan)
    archive = directory / "database.dump"
    run([str(tools / "pg_dump.exe"), "--format=custom", "--role=postgres",
         "--exclude-table=auth.schema_migrations", "--exclude-table=storage.migrations",
         "--file=" + str(archive), *["--schema=" + name for name in ["public", "private", "auth", "storage", "supabase_migrations"]]], env=env)
    listing = run([str(tools / "pg_restore.exe"), "--list", str(archive)])
    (directory / "archive-list.txt").write_text(listing, encoding="utf-8")
    manifest = {"version": 1, "kind": "klever-postgres-archive", "project": project,
                "started_at": started, "completed_at": datetime.now(timezone.utc).isoformat(),
                "bytes": archive.stat().st_size, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                "scope": ["public", "private", "auth", "storage", "supabase_migrations"],
                "excludes": ["auth.schema_migrations", "storage.migrations"],
                "limitations": "Provider configuration, cluster roles, extensions, secrets, cron activation and photo bytes require separate recovery."}
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return verify(directory, tools)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["backup", "verify"])
    parser.add_argument("directory", type=Path)
    parser.add_argument("--tools", required=True, type=Path, help="Portable PostgreSQL bin directory")
    parser.add_argument("--project", default="")
    args = parser.parse_args()
    try:
        directory, tools = args.directory.resolve(), args.tools.resolve()
        manifest = backup(directory, tools, args.project, Path(__file__).resolve().parents[1]) if args.mode == "backup" else verify(directory, tools)
        print(f"Verified database archive: {manifest['bytes']} bytes. Restore and photo reconciliation are separate checks.")
    except Exception:
        raise SystemExit("Database backup/verification failed. Check the linked project, tool paths, connection and archive; no new successful backup is claimed.")
