"""Staging sessions must fail closed and leave cleanup to the host manager."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('staging_session',
    Path(__file__).parents[1] / 'scripts/staging-session.py')
session = importlib.util.module_from_spec(spec)
spec.loader.exec_module(session)


class StagingSession(unittest.TestCase):
    def invocation(self, running=False, restart='no', identifier='a' * 64):
        result = subprocess.CompletedProcess([], 0,
            ' '.join(json.dumps(value) for value in (identifier, running, restart)))
        with patch.object(session.shutil, 'which', side_effect=lambda name: '/usr/bin/' + name), \
                patch.object(session.subprocess, 'run', return_value=result) as run:
            invocation = session.session_command('afterparty-staging-core', 5, ['/usr/bin/true'])
            self.assertEqual(run.call_count, 1, 'Preparation must only inspect, never start a container')
            self.assertIn('--format', run.call_args.args[0])
            self.assertNotIn('.Config.Env', run.call_args.args[0])
            return invocation

    def test_host_manager_owns_start_timeout_and_cleanup(self):
        invocation = self.invocation()
        self.assertIn('--property=RuntimeMaxSec=300', invocation)
        self.assertIn('--property=Type=exec', invocation)
        self.assertIn('--property=Restart=no', invocation)
        self.assertIn('--property=ExecStartPre=/usr/bin/docker --context default start ' + 'a' * 64, invocation)
        self.assertIn('--property=ExecStopPost=/usr/bin/docker --context default stop --time 30 ' + 'a' * 64, invocation)
        self.assertEqual(invocation[-2:], ['--', '/usr/bin/true'])
        self.assertIn('--wait', invocation)
        self.assertIn('--collect', invocation)

    def test_unit_name_rejects_overlapping_sessions(self):
        invocation = self.invocation()
        self.assertIn('--unit=afterparty-staging-test-afterparty-staging-core', invocation)
        self.assertFalse(any('replace' in argument for argument in invocation))

    def test_active_or_automatically_restarting_staging_is_rejected(self):
        for running, restart in [(True, 'no'), (False, 'always'), (False, 'unless-stopped')]:
            with self.subTest(running=running, restart=restart), self.assertRaises(ValueError):
                self.invocation(running, restart)

    def test_container_identity_cannot_inject_a_service_command(self):
        with self.assertRaises(ValueError):
            self.invocation(identifier='a; stop production')

    def test_production_and_other_containers_are_never_inspected(self):
        with patch.object(session.subprocess, 'run') as run:
            for name in ['gutta-krutt-core', 'production', 'afterparty-staging-core;id', '--help']:
                with self.subTest(name=name), self.assertRaises(ValueError):
                    session.session_command(name, 5, ['true'])
            run.assert_not_called()

    def test_limit_and_foreground_command_required(self):
        for minutes, command in [(0, ['true']), (61, ['true']), (5, [])]:
            with self.subTest(minutes=minutes, command=command), self.assertRaises(ValueError):
                session.session_command('afterparty-staging-core', minutes, command)

    def test_missing_manager_has_no_unmanaged_fallback(self):
        with patch.object(session.shutil, 'which', return_value=None), \
                patch.object(session.subprocess, 'run') as run, self.assertRaises(ValueError):
            session.session_command('afterparty-staging-core', 5, ['true'])
        run.assert_not_called()

    def test_inspection_error_propagates_before_start(self):
        with patch.object(session.shutil, 'which', side_effect=lambda name: '/usr/bin/' + name), \
                patch.object(session.subprocess, 'run', side_effect=subprocess.TimeoutExpired('docker', 15)), \
                self.assertRaises(subprocess.TimeoutExpired):
            session.session_command('afterparty-staging-core', 5, ['true'])
