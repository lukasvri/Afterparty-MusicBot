import importlib.util
from pathlib import Path
import unittest

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


if __name__ == '__main__':
    unittest.main()
