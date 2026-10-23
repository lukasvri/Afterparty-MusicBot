import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from beta_adapter import BetaUpdater, BetaBlocked

COMMIT = 'a' * 40


class StatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.adapter = BetaUpdater(self.base)
        self.adapter.root.mkdir()
        self.active = patch.object(self.adapter, '_service_active', return_value=False)
        self.active.start()
        self.addCleanup(self.active.stop)
        self.state = dict(stage='ready', ready=True, running=False, commit=COMMIT,
                          current_commit=COMMIT, confirmation_id='b'*64, checked_at=time.time(), available=False)
        self.save('state.json', self.state)

    def save(self, name, value):
        (self.adapter.root / name).write_text(json.dumps(value))

    def test_same_version_is_not_ready_and_cannot_start(self):
        status = self.adapter.status()
        self.assertFalse(status['ready'])
        self.assertIn('allerede på nett', status['message'])
        with self.assertRaises(BetaBlocked), patch('beta_adapter.subprocess.run') as run:
            self.adapter.start(dict(commit=COMMIT, confirmation_id='b'*64, confirm=True))
        run.assert_not_called()
        self.assertFalse((self.adapter.root/'request.json').exists())

    def test_check_preserves_last_completed_job(self):
        self.save('current.json', {'status':'succeeded', 'commit':COMMIT, 'account_id':'private'})
        status = self.adapter.status()
        self.assertEqual(status['progress_kind'], 'last')
        self.assertTrue(all(s['status']=='done' for s in status['steps']))
        self.assertNotIn('private', json.dumps(status))

    def test_frontend_job_does_not_mark_unfinished_steps_done(self):
        self.state.update(running=True, stage='cloudflare', available=True)
        self.save('state.json', self.state)
        self.save('rollback.json', {'active_worker':'afterparty-web-beta', 'completed_builds':{'afterparty-staging':{'status':'succeeded'}}})
        status = self.adapter.status()
        self.assertEqual([s['status'] for s in status['steps']], ['done','done','running','pending','pending'])
        self.assertNotIn('afterparty-staging', json.dumps(status))

    def test_old_success_does_not_complete_new_validation(self):
        self.state.update(running=True, stage='validate', available=True)
        self.save('state.json', self.state)
        self.save('rollback.json', {'completed_builds':{'afterparty-staging':{'status':'succeeded'}}})
        self.assertEqual([s['status'] for s in self.adapter.status()['steps']], ['running','pending','pending','pending','pending'])

    def test_rate_limit_prevents_another_background_check(self):
        self.state['retry_after'] = time.time() + 300
        self.save('state.json', self.state)
        with patch('beta_adapter.subprocess.run') as run:
            self.assertFalse(self.adapter.request_check())
        run.assert_not_called()

    def test_failed_check_keeps_last_deployment_and_completed_progress(self):
        self.state.update(stage='failed', operation='check', current_commit=None, commit=None)
        self.save('state.json', self.state)
        self.save('current.json', {'status':'succeeded', 'commit':COMMIT, 'time':1000})
        status = self.adapter.status()
        self.assertEqual(status['last_deployment_commit'], COMMIT)
        self.assertEqual(status['progress_kind'], 'last')
        self.assertTrue(all(s['status']=='done' for s in status['steps']))

    def test_stale_error_is_removed_after_successful_check(self):
        self.state['error'] = 'old error'
        self.save('state.json', self.state)
        self.assertNotIn('error', self.adapter.status())
        self.state['stage'] = 'failed'
        self.save('state.json', self.state)
        self.assertEqual(self.adapter.status()['error'], 'old error')


if __name__ == '__main__':
    unittest.main()
