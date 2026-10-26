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

    def test_ready_preserves_history_without_completing_new_job(self):
        self.save('current.json', {'status':'succeeded', 'commit':COMMIT, 'account_id':'private'})
        status = self.adapter.status()
        self.assertEqual(status['progress_kind'], 'none')
        self.assertTrue(all(s['status']=='pending' for s in status['steps']))
        self.assertNotIn('private', json.dumps(status))

    def test_frontend_job_does_not_mark_unfinished_steps_done(self):
        self.state.update(running=True, stage='cloudflare', available=True)
        self.save('state.json', self.state)
        self.save('rollback.json', {'commit':COMMIT, 'started_at':time.time(), 'active_worker':'afterparty-web-beta', 'completed_builds':{'afterparty-staging':{'status':'succeeded'}}})
        status = self.adapter.status()
        self.assertEqual([s['status'] for s in status['steps']], ['done','done','running','pending','pending'])
        self.assertNotIn('afterparty-staging', json.dumps(status))

    def test_api_publish_and_failed_frontend_show_current_partial_evidence(self):
        job = {'commit':COMMIT, 'started_at':time.time(),
               'active_worker':'afterparty-staging'}
        self.save('rollback.json', job)
        self.state.update(running=True, stage='cloudflare', operation='publish')
        self.save('state.json', self.state)
        self.assertEqual([s['status'] for s in self.adapter.status()['steps']],
                         ['done', 'running', 'pending', 'pending', 'pending'])
        job.update(active_worker='afterparty-web-beta', completed_builds={
                   'afterparty-staging':{'status':'succeeded'}})
        self.save('rollback.json', job)
        self.state.update(running=False, stage='failed')
        self.save('state.json', self.state)
        self.assertEqual([s['status'] for s in self.adapter.status()['steps']],
                         ['done', 'done', 'failed', 'pending', 'pending'])

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

    def test_failed_check_keeps_history_without_completing_new_job(self):
        self.state.update(stage='failed', operation='check', current_commit=None, commit=None)
        self.save('state.json', self.state)
        self.save('current.json', {'status':'succeeded', 'commit':COMMIT, 'time':1000})
        status = self.adapter.status()
        self.assertEqual(status['last_deployment_commit'], COMMIT)
        self.assertEqual(status['progress_kind'], 'none')
        self.assertTrue(all(s['status']=='pending' for s in status['steps']))

    def test_idle_check_and_pending_dispatch_ignore_old_success_and_builds(self):
        self.save('current.json', {'status':'succeeded', 'commit':COMMIT, 'time':1000})
        self.save('rollback.json', {'commit':COMMIT, 'started_at':1000,
                  'active_worker':'afterparty-web-beta', 'completed_builds':{
                  'afterparty-staging':{'status':'succeeded'},
                  'afterparty-web-beta':{'status':'succeeded'}}})
        for phase in ('idle', 'ready', 'checking'):
            with self.subTest(phase=phase):
                self.state.update(stage=phase)
                self.save('state.json', self.state)
                status = self.adapter.status()
                self.assertEqual(status['progress_kind'], 'none')
                self.assertEqual(status['last_deployment_at'], 1000)
                self.assertTrue(all(step['status'] == 'pending' for step in status['steps']))
        self.save('request.json', {'commit':COMMIT})
        self.assertTrue(self.adapter.status()['running'])
        self.assertTrue(all(step['status'] == 'pending' for step in self.adapter.status()['steps']))

    def test_completed_publish_resets_when_new_check_starts(self):
        self.state.update(stage='done', operation='publish')
        self.save('state.json', self.state)
        self.assertEqual(self.adapter.status()['progress_kind'], 'completed')
        self.assertTrue(all(step['status'] == 'done' for step in self.adapter.status()['steps']))
        self.adapter.checking = True
        self.assertTrue(all(step['status'] == 'pending' for step in self.adapter.status()['steps']))
        self.adapter.checking = False
        self.state.update(stage='checking', operation='check')
        self.save('state.json', self.state)
        self.assertTrue(all(step['status'] == 'pending' for step in self.adapter.status()['steps']))

    def test_verify_and_publish_failure_preserve_only_current_job_receipts(self):
        self.save('rollback.json', {'commit':COMMIT, 'started_at':time.time(),
                  'active_worker':'afterparty-web-beta', 'completed_builds':{
                  'afterparty-staging':{'status':'succeeded'},
                  'afterparty-web-beta':{'status':'succeeded'}}})
        self.state.update(stage='verify', operation='publish', running=True)
        self.save('state.json', self.state)
        self.assertEqual([s['status'] for s in self.adapter.status()['steps']],
                         ['done', 'done', 'done', 'running', 'pending'])
        self.state.update(stage='failed', running=False)
        self.save('state.json', self.state)
        self.assertEqual([s['status'] for s in self.adapter.status()['steps']],
                         ['done', 'done', 'done', 'pending', 'pending'])
        self.save('rollback.json', {'commit':COMMIT, 'started_at':1000,
                  'completed_builds':{'afterparty-staging':{'status':'succeeded'}}})
        self.assertTrue(all(step['status'] == 'pending' for step in self.adapter.status()['steps']))

    def test_stale_error_is_removed_after_successful_check(self):
        self.state['error'] = 'old error'
        self.save('state.json', self.state)
        self.assertNotIn('error', self.adapter.status())
        self.state['stage'] = 'failed'
        self.save('state.json', self.state)
        self.assertEqual(self.adapter.status()['error'], 'old error')


if __name__ == '__main__':
    unittest.main()
