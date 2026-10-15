import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backup_core', Path(__file__).resolve().parents[1] / 'scripts/backup-core.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class OnlineBackup(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data = self.root / 'data'
        self.data.mkdir()
        self.output = self.root / 'backups'
        self.config = {'data_dir': str(self.data), 'backup_dir': str(self.output)}

    def database(self, path, text):
        path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(path)
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE example(value TEXT)')
        db.execute('INSERT INTO example VALUES(?)', (text,))
        db.commit()
        self.addCleanup(db.close)
        return db

    def test_live_wal_guilds_configs_and_verified_restore(self):
        live = self.database(self.data / 'core.sqlite', 'owner WAL record')
        self.database(self.data / 'guilds/100000000000000001/core.sqlite', 'isolated guild')
        (self.data / 'settings.json').write_text('{"enabled":true}')
        env = self.root / '.env'
        env.write_text('SYNTHETIC_TOKEN=private')
        self.config['config_files'] = {'environment': str(env)}
        result = backup.create_backup(self.config)
        archive = self.output / result['archive']
        self.assertEqual(result['databases'], 2)
        self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
        self.assertEqual(backup.verify_archive(archive)['databases'], 2)
        self.assertEqual(live.execute('SELECT value FROM example').fetchone()[0], 'owner WAL record')
        with tarfile.open(archive) as saved:
            names = saved.getnames()
            self.assertFalse(any(n.endswith(('-wal', '-shm')) for n in names))
            self.assertEqual(saved.extractfile('config/environment').read(), b'SYNTHETIC_TOKEN=private')
            with tempfile.NamedTemporaryFile() as restored:
                restored.write(saved.extractfile('data/core.sqlite').read()); restored.flush()
                with sqlite3.connect(restored.name) as db:
                    self.assertEqual(db.execute('SELECT value FROM example').fetchone()[0], 'owner WAL record')

    def test_corruption_does_not_replace_last_success(self):
        db = self.database(self.data / 'core.sqlite', 'good')
        good = backup.create_backup(self.config)
        db.close()
        (self.data / 'core.sqlite').write_text('corrupted')
        with self.assertRaises(sqlite3.DatabaseError):
            backup.create_backup(self.config)
        self.assertEqual(json.loads((self.output / 'latest.json').read_text()), good)
        self.assertFalse(list(self.output.glob('*.partial')))

    def test_data_links_and_nested_backup_destination_are_rejected(self):
        self.database(self.data / 'core.sqlite', 'good')
        (self.data / 'outside').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):
            backup.create_backup(self.config)
        (self.data / 'outside').unlink()
        self.config['backup_dir'] = str(self.data / 'backups')
        with self.assertRaises(ValueError):
            backup.create_backup(self.config)

    def test_verification_rejects_changed_bytes_and_traversal(self):
        self.database(self.data / 'core.sqlite', 'good')
        result = backup.create_backup(self.config)
        archive = self.output / result['archive']
        changed = self.root / 'changed.tar.gz'
        with tarfile.open(archive) as old, tarfile.open(changed, 'w:gz') as new:
            for item in old:
                content = old.extractfile(item).read()
                if item.name == 'data/core.sqlite':
                    content = b'x' * len(content)
                new.addfile(item, io.BytesIO(content))
        with self.assertRaises(ValueError):
            backup.verify_archive(changed)
        with tarfile.open(changed, 'w:gz') as saved:
            item = tarfile.TarInfo('../escaped'); item.size = 1
            saved.addfile(item, io.BytesIO(b'x'))
        with self.assertRaises(ValueError):
            backup.verify_archive(changed)

    def test_overlapping_backups_are_rejected(self):
        import fcntl
        self.database(self.data / 'core.sqlite', 'good')
        self.output.mkdir(mode=0o700)
        with (self.output / '.backup.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                backup.create_backup(self.config)


if __name__ == '__main__':
    unittest.main()
