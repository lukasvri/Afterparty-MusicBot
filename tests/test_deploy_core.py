import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('deploy_core', Path(__file__).resolve().parents[1] / 'scripts/deploy-core.py')
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


def database(path, value='original'):
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)')
        db.execute('INSERT OR REPLACE INTO kv VALUES (?,?)', ('state', value))


def value(path):
    with sqlite3.connect(path) as db:
        return db.execute("SELECT value FROM kv WHERE key='state'").fetchone()[0]


class Files(unittest.TestCase):
    def test_image_change_preserves_private_configuration(self):
        original = 'services:\n  core:\n    image: old:1\n    env_file: /private/.env\n    volumes:\n      - /private/data:/data\n'
        changed = deploy.image_config(original, 'core:git-123')
        self.assertEqual(changed.replace('core:git-123', 'old:1'), original)
        for invalid in ['services: {}', original + '    image: other:2\n']:
            with self.assertRaises(deploy.DeployError):
                deploy.image_config(invalid, 'new:1')
        with self.assertRaises(deploy.DeployError):
            deploy.image_config(original, 'bad\nimage')

    def test_atomic_write_is_private_and_replaces_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            p = Path(temporary) / 'config'
            deploy.atomic_write(p, 'first')
            deploy.atomic_write(p, 'second')
            self.assertEqual(p.read_text(), 'second')
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)

    def test_full_backup_restores_guild_database_and_preserves_failed_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            p = Path(temporary); data = p / 'data'
            database(data / 'core.sqlite')
            database(data / 'guilds' / '100000000000000001' / 'core.sqlite', 'guild')
            (data / 'other.json').write_text('{"local":true}')
            archive = p / 'data.tar.gz'
            deploy.backup_data(data, archive)
            database(data / 'core.sqlite', 'failed migration')
            (data / 'other.json').unlink()
            quarantine = deploy.restore_data(data, archive)
            self.assertEqual(value(data / 'core.sqlite'), 'original')
            self.assertEqual(value(data / 'guilds' / '100000000000000001' / 'core.sqlite'), 'guild')
            self.assertTrue((data / 'other.json').exists())
            self.assertEqual(value(quarantine / 'core.sqlite'), 'failed migration')

    def test_corrupt_database_and_symlinks_are_rejected_before_backup(self):
        with tempfile.TemporaryDirectory() as temporary:
            p=Path(temporary);data=p/'data';data.mkdir()
            (data/'core.sqlite').write_text('not SQLite')
            with self.assertRaises(sqlite3.DatabaseError):
                deploy.backup_data(data,p/'backup.tar.gz')
            (data/'core.sqlite').unlink();database(data/'core.sqlite')
            (data/'link').symlink_to('/etc/passwd')
            with self.assertRaises(deploy.DeployError):
                deploy.backup_data(data,p/'backup.tar.gz')

    def test_archive_paths_and_links_cannot_escape(self):
        with tempfile.TemporaryDirectory() as temporary:
            for name, kind in [('../escaped', tarfile.REGTYPE),('/absolute',tarfile.REGTYPE),('link',tarfile.SYMTYPE)]:
                buffer=io.BytesIO()
                with tarfile.open(fileobj=buffer,mode='w') as out:
                    item=tarfile.TarInfo(name);item.type=kind;item.linkname='/etc/passwd';out.addfile(item)
                buffer.seek(0)
                with tarfile.open(fileobj=buffer) as saved, self.assertRaises(deploy.DeployError):
                    deploy.extract_archive(saved,Path(temporary)/'out')


class Fake(deploy.Deployer):
    def __init__(self, root):
        config={k:str(root/k) for k in ['repo','compose_file','data_dir','state_dir','backup_dir']}
        for key in ['repo','data_dir','state_dir','backup_dir']:
            Path(config[key]).mkdir()
        Path(config['compose_file']).write_text('services:\n  core:\n    image: core:old\n')
        super().__init__(config)
        self.old_config=self.compose_file.read_text();self.old_image='sha256:old';self.new_image='core:new';self.new_image_id='sha256:new'
        self.target='a'*40;self.model={'services':{'core':{'env_file':[]}}}
        self.running=True;self.live_image=self.old_image;self.fail_health=False;self.change_queue=False;self.events=[];self.calls=[]
        database(self.data/'core.sqlite')

    def emit(self, phase):
        self.events.append(phase)

    def git(self, *args):
        return ''

    def probe(self):
        return [{'scope':'synthetic','ready':True,'playing':False,'buffering':False,'connected':False,'entries':'changed' if self.change_queue and self.live_image==self.new_image_id else 'same','count':1}]

    def inspect(self):
        return {'State':{'Running':self.running},'Image':self.live_image}

    def command(self, args, **kwargs):
        self.calls.append(args)
        if 'stop' in args:self.running=False
        if 'up' in args:
            self.running=True
            if 'core:new' in self.compose_file.read_text():
                self.live_image=self.new_image_id;database(self.data/'core.sqlite','candidate migration')
            else:self.live_image=self.old_image
        return ''

    def wait_ready(self):
        if self.fail_health and self.live_image==self.new_image_id:
            raise deploy.DeployError('candidate health failed')


class Lifecycle(unittest.TestCase):
    def test_success_backs_up_before_start_and_records_tested_image(self):
        with tempfile.TemporaryDirectory() as temporary:
            d=Fake(Path(temporary));d.switch()
            state=json.loads((d.state/'current.json').read_text())
            self.assertEqual(state['image'],d.new_image_id)
            with tarfile.open(Path(state['backup'])/'data.tar.gz') as saved:
                self.assertIn('data/core.sqlite',saved.getnames())
            self.assertTrue(d.running);self.assertEqual(d.live_image,d.new_image_id)

    def test_failed_health_restores_exact_old_image_and_pre_migration_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            d=Fake(Path(temporary));d.fail_health=True
            with self.assertRaisesRegex(deploy.DeployError,'candidate health'):
                d.switch()
            self.assertTrue(d.running);self.assertEqual(d.live_image,d.old_image)
            self.assertEqual(value(d.data/'core.sqlite'),'original')
            self.assertIn('image: sha256:old',d.compose_file.read_text())
            self.assertFalse((d.state/'current.json').exists())
            self.assertTrue(list(d.data.parent.glob('data_dir.failed-*')))

    def test_queue_mismatch_rolls_back(self):
        with tempfile.TemporaryDirectory() as temporary:
            d=Fake(Path(temporary));d.change_queue=True
            with self.assertRaisesRegex(deploy.DeployError,'queue state differs'):
                d.switch()
            self.assertEqual(d.live_image,d.old_image)
            self.assertEqual(value(d.data/'core.sqlite'),'original')

    def test_backup_failure_restarts_old_image_without_replacing_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            d=Fake(Path(temporary))
            with patch.object(d,'save_backup',side_effect=deploy.DeployError('backup failed')):
                with self.assertRaisesRegex(deploy.DeployError,'backup failed'):
                    d.switch()
            self.assertTrue(d.running);self.assertEqual(value(d.data/'core.sqlite'),'original')
            self.assertEqual(d.live_image,d.old_image)

    def test_playing_or_buffering_prevents_stopping(self):
        with tempfile.TemporaryDirectory() as temporary:
            d=Fake(Path(temporary))
            for field in ['playing','buffering']:
                with patch.object(d,'probe',return_value=[{'ready':True,'playing':False,'buffering':False,field:True}]):
                    with self.assertRaisesRegex(deploy.DeployError,'Pause playback'):
                        d.switch()
            self.assertFalse(d.calls)

    def test_configuration_change_during_tests_aborts_before_stop(self):
        with tempfile.TemporaryDirectory() as temporary:
            d=Fake(Path(temporary));d.compose_file.write_text(d.old_config+'# changed locally\n')
            with self.assertRaisesRegex(deploy.DeployError,'changed during validation'):d.switch()
            self.assertFalse(d.calls)

    def test_failed_validation_never_stops_production(self):
        with tempfile.TemporaryDirectory() as temporary:
            d=Fake(Path(temporary))
            with patch.object(d,'preflight'),patch.object(d,'snapshot',return_value=d.repo),patch.object(d,'validate',side_effect=deploy.DeployError('tests failed')):
                with self.assertRaisesRegex(deploy.DeployError,'tests failed'):d.run()
            self.assertFalse(d.calls)

    def test_check_mode_never_switches_production(self):
        with tempfile.TemporaryDirectory() as temporary:
            d=Fake(Path(temporary))
            with patch.object(d,'preflight'),patch.object(d,'snapshot',return_value=d.repo),patch.object(d,'validate'),patch.object(d,'switch') as switch:
                d.run(check=True);switch.assert_not_called()

    def test_lock_rejects_simultaneous_deployment_before_docker(self):
        with tempfile.TemporaryDirectory() as temporary:
            d=Fake(Path(temporary));config=Path(temporary)/'config.json';config.write_text(json.dumps(d.config))
            with (d.state/'deploy.lock').open('a') as lock:
                deploy.fcntl.flock(lock,deploy.fcntl.LOCK_EX)
                result=subprocess.run([sys.executable,SPEC.origin,'--config',str(config)],capture_output=True,text=True)
            self.assertEqual(result.returncode,1);self.assertIn('already running',result.stderr)


if __name__=='__main__':unittest.main()
