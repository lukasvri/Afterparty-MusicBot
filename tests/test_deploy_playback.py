import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from test_deploy_core import Fake, deploy, value


class Playing(Fake):
    def __init__(self, root):
        super().__init__(root)
        self.scopes = [dict(scope=str(i), ready=True, connected=True, current='track-' + str(i),
                            playing=i == 1, buffering=i == 3, entries='same', count=1)
                       for i in [1, 2, 3]]
        self.controls = []
        self.confirmed = set()
        self.fail_pause = None
        self.fail_resume = set()

    def probe(self):
        return [{**s, 'entries': 'changed' if self.change_queue and self.live_image == self.new_image_id else 'same'}
                for s in self.scopes]

    def playback_command(self, entry, action):
        self.controls.append((action, entry['scope']))
        s = next(s for s in self.scopes if s['scope'] == entry['scope'])
        if action == 'pause':
            self.confirmed.add(entry['pause_id'])
            s.update(playing=False, buffering=False)
            if entry['scope'] == self.fail_pause:
                raise deploy.DeployError('pause reply lost')
            return 'paused'
        if entry['scope'] in self.fail_resume:
            raise deploy.DeployError('resume unavailable')
        if entry['pause_id'] not in self.confirmed or s['current'] != entry['current'] or not s['connected']:
            return 'skipped'
        s['playing'] = True
        return 'resumed'


class AutomaticPlayback(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.d = Playing(Path(temp.name))

    def restored(self):
        self.assertEqual([s['playing'] for s in self.d.scopes], [True, False, True])
        self.assertFalse(self.d.playback_journal.exists())

    def test_success_resumes_only_previously_active_servers(self):
        def validate(source):
            self.assertTrue(self.d.scopes[0]['playing'])
            self.assertTrue(self.d.scopes[2]['buffering'])
            self.assertFalse(self.d.controls)
        with patch.object(self.d, 'preflight'), patch.object(self.d, 'snapshot', return_value=self.d.repo), \
             patch.object(self.d, 'validate', side_effect=validate) as checked:
            self.d.run()
            checked.assert_called_once()
        self.restored()
        self.assertEqual(self.d.controls, [('pause', '1'), ('pause', '3'), ('resume', '1'), ('resume', '3')])
        self.assertEqual(self.d.live_image, self.d.new_image_id)
        with (Path(json.loads((self.d.state / 'current.json').read_text())['backup']) / 'state.before.json').open() as f:
            self.assertTrue(all(not s['playing'] and not s['buffering'] for s in json.load(f)))

    def test_failed_health_rolls_back_data_and_resumes_previous_image(self):
        self.d.fail_health = True
        with self.assertRaisesRegex(deploy.DeployError, 'candidate health failed'):
            self.d.switch()
        self.restored()
        self.assertEqual(self.d.live_image, self.d.old_image)
        self.assertEqual(value(self.d.data / 'core.sqlite'), 'original')

    def test_backup_failure_resumes_original_without_data_restore(self):
        with patch.object(self.d, 'save_backup', side_effect=deploy.DeployError('backup failed')):
            with self.assertRaisesRegex(deploy.DeployError, 'backup failed'):
                self.d.switch()
        self.restored()
        self.assertEqual(self.d.live_image, self.d.old_image)

    def test_queue_mismatch_recovers_old_queue_and_playback(self):
        self.d.change_queue = True
        with self.assertRaisesRegex(deploy.DeployError, 'queue state differs'):
            self.d.switch()
        self.restored()
        self.assertEqual(self.d.live_image, self.d.old_image)

    def test_partial_pause_failure_recovers_even_a_lost_reply(self):
        self.d.fail_pause = '3'
        with self.assertRaisesRegex(deploy.DeployError, 'pause reply lost'):
            self.d.switch()
        self.restored()
        self.assertFalse(self.d.calls)

    def test_failed_resume_keeps_only_failed_server_for_next_run(self):
        self.d.fail_resume = {'1'}
        with self.assertRaisesRegex(deploy.DeployError, 'Automatic playback recovery failed'):
            self.d.switch()
        self.assertEqual(self.d.live_image, self.d.new_image_id)
        self.assertEqual([s['playing'] for s in self.d.scopes], [False, False, True])
        self.assertEqual([s['scope'] for s in json.loads(self.d.playback_journal.read_text())], ['1'])
        self.assertEqual(self.d.playback_journal.stat().st_mode & 0o777, 0o600)
        self.d.fail_resume.clear()
        with patch.object(self.d, 'preflight'), patch.object(self.d, 'snapshot', return_value=self.d.repo), \
             patch.object(self.d, 'validate') as validate, patch.object(self.d, 'switch') as switch:
            self.d.old_image = self.d.new_image_id
            self.d.run()
            validate.assert_not_called()
            switch.assert_not_called()
        self.restored()

    def test_pending_journal_is_recovered_without_process_memory(self):
        self.d.pause_playback()
        # New deployer instance, with only persisted intent and the running bot.
        fresh = deploy.Deployer(self.d.config)
        fresh.playback_command = self.d.playback_command
        fresh.inspect = self.d.inspect
        fresh.resume_playback()
        self.restored()

    def test_pending_recovery_never_mutates_check_mode(self):
        self.d.pause_playback()
        before = self.d.controls[:]
        with self.assertRaisesRegex(deploy.DeployError, '--check never changes playback'):
            self.d.run(check=True)
        self.assertEqual(self.d.controls, before)
        self.assertTrue(self.d.playback_journal.exists())

    def test_unhealthy_bot_keeps_journal_without_playback_commands(self):
        self.d.pause_playback()
        before = self.d.controls[:]
        self.d.running = False
        with self.assertRaisesRegex(deploy.DeployError, 'until Core is healthy'):
            self.d.resume_playback()
        self.assertEqual(self.d.controls, before)
        self.assertTrue(self.d.playback_journal.exists())

    def test_validation_failure_and_check_never_pause(self):
        for check in [False, True]:
            with self.subTest(check=check), patch.object(self.d, 'preflight'), \
                 patch.object(self.d, 'snapshot', return_value=self.d.repo), \
                 patch.object(self.d, 'validate', side_effect=deploy.DeployError('validation failed')):
                with self.assertRaisesRegex(deploy.DeployError, 'validation failed'):
                    self.d.run(check=check)
                self.assertFalse(self.d.controls)
                self.assertTrue(self.d.scopes[0]['playing'])

    def test_configuration_changed_before_pause_never_interrupts_music(self):
        self.d.compose_file.write_text(self.d.old_config + '# changed\n')
        with self.assertRaisesRegex(deploy.DeployError, 'changed during validation'):
            self.d.switch()
        self.assertFalse(self.d.controls)


def digest(value):
    return hashlib.sha256(json.dumps(value, separators=(',', ':')).encode()).hexdigest()


class PlaybackController(unittest.TestCase):
    """Run the actual container-side JavaScript against a synthetic bridge."""
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.guild = '100000000000000001'
        self.track = {'id': 'synthetic-video', 'entryId': 'synthetic-entry'}
        self.state = dict(ready=True, connected=True, current=self.track, playing=True, buffering=False)
        self.jobs = []
        self.requests = []
        self.reject_pause = False
        self.entry = dict(scope=digest(self.guild), current=digest([self.track['entryId'], self.track['id']]),
                          pause_id='11111111-1111-4111-8111-111111111111',
                          resume_id='22222222-2222-4222-8222-222222222222')
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def respond(self, data, code=200):
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())

            def do_GET(self):
                if self.headers.get('Authorization') != 'Bearer synthetic-test-key':
                    return self.respond({}, 401)
                url = urlsplit(self.path)
                query = parse_qs(url.query)
                if url.path == '/v1/state':
                    return self.respond({'state': owner.state})
                if query.get('id'):
                    job = next((j for j in owner.jobs if j['id'] == query['id'][0]), None)
                    return self.respond({'command': job})
                self.respond({'commands': list(reversed(owner.jobs))})

            def do_POST(self):
                if self.headers.get('Authorization') != 'Bearer synthetic-test-key':
                    return self.respond({}, 401)
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.requests.append(body)
                old = next((j for j in owner.jobs if j['id'] == body['id']), None)
                if not old:
                    failed = owner.reject_pause and body['action'] == 'pause'
                    owner.jobs.append({'id': body['id'], 'payload': body, 'status': 'failed' if failed else 'done'})
                    if not failed:
                        owner.state.update(playing=body['action'] == 'resume', buffering=False)
                self.respond({'id': body['id'], 'status': 'processing'})

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def run_control(self, action, entry=None):
        script = deploy.PLAYBACK_CONTROL.replace('__PLAYBACK_INPUT__', json.dumps({**(entry or self.entry), 'action': action}))
        script = script.replace("const base='http://127.0.0.1:3990';",
                                "const base='http://127.0.0.1:" + str(self.server.server_port) + "';")
        env = {**os.environ, 'DATA_DIR': str(self.root), 'DISCORD_GUILD_ID': self.guild,
               'PUBLIC_SITE_ADMIN_KEY': 'synthetic-test-key'}
        result = subprocess.run([shutil.which('node'), '--input-type=module'], input=script,
                                text=True, capture_output=True, env=env, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return json.loads(result.stdout)['status']

    def test_real_controller_round_trip_uses_authenticated_scoped_idempotent_commands(self):
        self.assertEqual(self.run_control('pause'), 'paused')
        self.assertFalse(self.state['playing'])
        self.assertEqual(self.run_control('resume'), 'resumed')
        self.assertEqual(self.run_control('resume'), 'already')
        self.assertEqual([r['action'] for r in self.requests], ['pause', 'resume'])
        self.assertTrue(all(r['guildId'] == self.guild and r['scope'] == 'admin' for r in self.requests))

    def test_manually_paused_or_idle_server_is_never_started(self):
        self.state.update(playing=False)
        self.assertEqual(self.run_control('pause'), 'skipped')
        self.assertEqual(self.run_control('resume'), 'skipped')
        self.assertFalse(self.requests)

    def test_buffering_is_paused_and_restored(self):
        self.state.update(playing=False, buffering=True)
        self.assertEqual(self.run_control('pause'), 'paused')
        self.assertEqual(self.run_control('resume'), 'resumed')

    def test_changed_track_disconnected_or_missing_scope_is_not_resumed(self):
        self.run_control('pause')
        for change in [{'current': {**self.track, 'entryId': 'different'}}, {'connected': False}]:
            with self.subTest(change=change):
                original = self.state.copy()
                self.state.update(change)
                self.assertEqual(self.run_control('resume'), 'skipped')
                self.state = original
        self.assertEqual(self.run_control('resume', {**self.entry, 'scope': digest('missing')}), 'skipped')
        self.assertEqual(len(self.requests), 1)

    def test_newer_user_pause_is_preserved_even_on_the_same_track(self):
        self.run_control('pause')
        self.jobs.append({'id': 'user-choice', 'payload': {'action': 'pause'}, 'status': 'done'})
        self.assertEqual(self.run_control('resume'), 'skipped')
        self.assertFalse(self.state['playing'])
        self.assertEqual(len(self.requests), 1)

    def test_lost_pause_reply_is_reconciled_from_persisted_job(self):
        self.state.update(playing=False)
        self.jobs.append({'id': self.entry['pause_id'], 'payload': {'action': 'pause'}, 'status': 'done'})
        self.assertEqual(self.run_control('resume'), 'resumed')

    def test_failed_pause_never_triggers_resume(self):
        self.reject_pause = True
        with self.assertRaisesRegex(RuntimeError, 'Playback command did not complete'):
            self.run_control('pause')
        self.assertEqual(self.run_control('resume'), 'skipped')
        self.assertEqual(len(self.requests), 1)


if __name__ == '__main__':
    unittest.main()
