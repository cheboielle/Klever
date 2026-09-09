import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("database_backup", Path(__file__).resolve().parents[1] / "scripts/database-backup.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class DatabaseBackupTests(unittest.TestCase):
    def test_shell_plan_is_data_and_is_not_executed(self):
        plan = "\n".join(["export PGHOST=localhost", "export PGPORT=5432", "export PGUSER=operator", "export PGPASSWORD='$(do-not-execute)'", "export PGDATABASE=postgres", "untrusted shell command"])
        with patch.object(module.subprocess, "run") as spawn:
            env = module.connection_environment(plan)
        spawn.assert_not_called()
        self.assertEqual(env["PGPASSWORD"], "$(do-not-execute)")
        self.assertEqual(env["PGSSLMODE"], "require")

    def test_missing_credentials_do_not_fall_back_to_another_connection(self):
        with patch.dict(module.os.environ, {"PGPASSWORD": "old-account-password"}):
            with self.assertRaises(ValueError):
                module.connection_environment("export PGHOST=localhost")

    def test_wrong_linked_project_never_starts_a_dump(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "supabase/.temp").mkdir(parents=True)
            (root / "supabase/.temp/project-ref").write_text("a" * 20)
            with patch.object(module.subprocess, "run") as spawn:
                with self.assertRaises(ValueError):
                    module.backup(root / "copy", root, "b" * 20, root)
            spawn.assert_not_called()
            self.assertFalse((root / "copy").exists())

    def test_damaged_archive_fails_before_restore_tool_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "database.dump").write_bytes(b"changed")
            (root / "manifest.json").write_text(json.dumps({"kind": "klever-postgres-archive", "version": 1, "bytes": 7, "sha256": "0" * 64}))
            with patch.object(module.subprocess, "run") as spawn:
                with self.assertRaises(ValueError):
                    module.verify(root, root)
            spawn.assert_not_called()
