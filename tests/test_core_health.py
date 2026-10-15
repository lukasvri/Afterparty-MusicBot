import importlib.util
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('core_health', Path(__file__).resolve().parents[1] / 'scripts/core-health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class HealthAssessment(unittest.TestCase):
    def healthy(self):
        return dict(running=True, ready=True, health='healthy', available_memory_bytes=2 * 1024**3,
                    free_disk_bytes=20 * 1024**3, backup_present=True, backup_age_hours=2,
                    linger=True, read_only_root=True)

    def test_healthy_host_and_recent_backup(self):
        self.assertEqual(health.assess(self.healthy())['status'], 'ok')

    def test_stale_backup_blocks_readiness(self):
        data = self.healthy(); data['backup_age_hours'] = 40
        self.assertEqual(health.assess(data)['status'], 'error')

    def test_unhealthy_core_and_oom_are_reported(self):
        data = self.healthy(); data.update(ready=False, oom_killed=True)
        result = health.assess(data)
        self.assertEqual(result['status'], 'error')
        self.assertEqual(sum(c['status'] == 'error' for c in result['checks']), 2)

    def test_maintenance_defers_runtime_checks(self):
        data = self.healthy(); data.update(maintenance=True, ready=False, health='starting', read_only_root=False)
        self.assertEqual(health.assess(data)['status'], 'ok')

    def test_stopped_container_is_reported_without_starting_it(self):
        data = self.healthy(); data.update(running=False, ready=False)
        result = health.assess(data)
        self.assertEqual(result['status'], 'warning')
        self.assertIn('No automatic start', result['checks'][0]['message'])

    def test_memory_and_latency_warn_before_exhaustion(self):
        data = self.healthy(); data.update(available_memory_bytes=100 * 1024**2, event_loop_p95_ms=40)
        self.assertEqual(health.assess(data)['status'], 'warning')
        data['free_disk_bytes'] = 1024**3
        self.assertEqual(health.assess(data)['status'], 'error')


class BackupIntegrity(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.archive = self.root / 'backup.tar.gz'
        self.archive.write_bytes(b'verified backup contents')
        self.latest = {
            'archive': self.archive.name,
            'size_bytes': self.archive.stat().st_size,
            'sha256': hashlib.sha256(self.archive.read_bytes()).hexdigest(),
            'created_at': datetime.now(timezone.utc).isoformat(),
            'databases': 1,
        }

    def collect(self):
        (self.root / 'latest.json').write_text(json.dumps(self.latest))
        info = [{'State': {'Running': True, 'Health': {'Status': 'healthy'}},
                 'HostConfig': {'ReadonlyRootfs': True}}]
        with patch.object(health, 'command', side_effect=[json.dumps(info), '{"ready":true}', 'yes']):
            return health.collect({'state_dir': str(self.root), 'data_dir': str(self.root)}, self.root)

    def assert_backup(self, expected):
        data = self.collect()
        self.assertEqual(data['backup_present'], expected)
        check = next(check for check in health.assess(data)['checks'] if check['name'] == 'backup')
        self.assertEqual(check['status'], 'ok' if expected else 'error')

    def test_matching_digest_and_size_approve_recent_backup(self):
        self.assert_backup(True)

    def test_same_size_corruption_blocks_readiness(self):
        original = self.archive.read_bytes()
        self.archive.write_bytes(bytes([original[0] ^ 1]) + original[1:])
        self.assertEqual(self.archive.stat().st_size, self.latest['size_bytes'])
        self.assert_backup(False)

    def test_truncated_archive_blocks_readiness(self):
        self.archive.write_bytes(b'truncated')
        self.assert_backup(False)

    def test_missing_archive_blocks_readiness(self):
        self.archive.unlink()
        self.assert_backup(False)

    def test_missing_digest_blocks_readiness(self):
        del self.latest['sha256']
        self.assert_backup(False)

    def test_unreadable_archive_blocks_readiness(self):
        with patch.object(health.hashlib, 'file_digest', side_effect=PermissionError('unreadable archive')):
            self.assert_backup(False)


class VoiceCapacity(unittest.TestCase):
    def test_probe_counts_connected_playing_paused_and_idle_sessions(self):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'Node.js is required to test the Core health probe')
        states = [
            {'connected': True, 'playing': True, 'paused': False, 'current': {'id': 'synthetic'}},
            {'connected': True, 'playing': False, 'paused': True, 'current': {'id': 'synthetic'}},
            {'connected': True, 'playing': False, 'paused': False, 'current': None},
            {'connected': False, 'playing': True, 'paused': False, 'current': None},
        ]
        stub = """
const states = STATES;
globalThis.fetch = async (url, options) => {
  if (options.headers.Authorization !== 'Bearer synthetic-health-key') throw Error('Unexpected credentials');
  const request = new URL(url);
  if (request.origin !== 'http://127.0.0.1:3990') throw Error('Unexpected origin');
  let data;
  if (request.pathname === '/v1/application') data = {guilds:states.map((_, id) => ({id:String(id)}))};
  else if (request.pathname === '/v1/admin') data = {bot:{ready:true}, performance:{}};
  else if (request.pathname === '/v1/state') data = {state:states[Number(request.searchParams.get('guildId'))]};
  else throw Error('Unexpected endpoint');
  return {ok:true, json:async () => data};
};
""".replace('STATES', json.dumps(states))
        result = subprocess.run([node, '--input-type=module'], input=stub + health.PROBE,
                                text=True, capture_output=True, timeout=10,
                                env={'PATH': os.environ['PATH'], 'PUBLIC_SITE_ADMIN_KEY': 'synthetic-health-key',
                                     'MAX_ACTIVE_VOICE_SESSIONS': '8'})
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report['active_voice_sessions'], 3)
        self.assertEqual(report['guilds'], 4)
        self.assertEqual(report['voice_limit'], 8)
        self.assertTrue(report['ready'])


if __name__ == '__main__':
    unittest.main()
