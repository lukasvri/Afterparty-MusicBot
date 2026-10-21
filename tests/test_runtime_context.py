"""The runtime guard must never leak commands to an unrelated Docker daemon."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('runtime_context_fixture',
    Path(__file__).parents[1] / 'scripts/runtime_limits.py')
limits = importlib.util.module_from_spec(spec)
spec.loader.exec_module(limits)


def container(running=False):
    return {'Id': 'probe-id', 'Image': 'image-id', 'RestartCount': 0,
            'State': {'StartedAt': 'fixture', 'Running': running, 'ExitCode': 0, 'OOMKilled': False},
            'HostConfig': {'Memory': 256 * limits.MIB, 'MemorySwap': 256 * limits.MIB,
                           'NanoCpus': 500000000, 'CpusetCpus': '2',
                           'NetworkMode': 'none', 'ReadonlyRootfs': True}}


class DockerContext(unittest.TestCase):
    def test_session_wrapper_accepts_only_its_configured_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            for context in ('default', 'rootless'):
                with self.subTest(context=context):
                    config = {'state_dir': tmp, 'docker_context': context}
                    session = limits.RuntimeSession(config)
                    session.path = Path(tmp) / 'probe-config.json'
                    prefix = ['docker', '--context', context]
                    inspect = prefix + ['image', 'inspect', 'image']
                    self.assertEqual(session.wrap(inspect), inspect)
                    archive = Path(tmp) / 'release-cache' / 'a' / 'core-image.tar.gz'
                    load = prefix + ['load', '--input', str(archive)]
                    self.assertEqual(session.wrap(load), load)
                    self.assertIn('--probe', session.wrap(prefix + ['run', '--rm']))
                    for wrong in (['docker', 'image', 'inspect', 'image'],
                                  ['docker', '--context', 'other', 'image', 'inspect', 'image'],
                                  prefix + ['stop', 'production']):
                        with self.assertRaises(RuntimeError):
                            session.wrap(wrong)

    def test_default_remains_compatible_when_no_context_is_configured(self):
        session = limits.RuntimeSession({})
        command = ['docker', '--context', 'default', 'image', 'inspect', 'image']
        self.assertEqual(session.wrap(command), command)
        with self.assertRaises(RuntimeError):
            session.wrap(['docker', '--context', 'rootless', 'image', 'inspect', 'image'])

    def test_protected_inspections_use_the_configured_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            compose = Path(tmp) / 'compose.yml'
            compose.write_text('fixture')
            config = {'compose_file': str(compose), 'docker_context': 'rootless',
                      'container': 'core', 'protected_containers': ['activity']}
            with patch.object(limits.subprocess, 'run', return_value=
                              subprocess.CompletedProcess([], 0, json.dumps([container()]))) as run:
                snapshot = limits.protected(config)
            self.assertEqual(set(snapshot), {'core', 'activity', 'compose'})
            self.assertEqual([call.args[0] for call in run.call_args_list], [
                ['docker', '--context', 'rootless', 'inspect', 'core'],
                ['docker', '--context', 'rootless', 'inspect', 'activity']])

    def test_probe_creation_inspection_start_and_cleanup_share_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            for context in ('default', 'rootless'):
                with self.subTest(context=context):
                    config = Path(tmp) / 'probe-config.json'
                    config.write_text(json.dumps({'directory': tmp, 'run_id': 'fixture',
                                                  'cpu': 2, 'docker_context': context}))
                    args = ['run', '--rm', '--network', 'none', '--read-only', '--cpus=0.5',
                            '--memory=256m', '--memory-swap=256m', '--pids-limit=64',
                            '--entrypoint', 'node', 'gutta-krutt-core:git-' + 'a' * 40,
                            '--input-type=module', '-e', 'console.log("fixture")']
                    def fake_run(command, **kwargs):
                        self.assertEqual(command[:3], ['docker', '--context', context])
                        output = 'probe-id' if command[3] == 'create' else json.dumps([container(True)])
                        return subprocess.CompletedProcess(command, 0, output)
                    with patch.object(limits, 'available_mib', return_value=2048), \
                            patch.object(limits.subprocess, 'run', side_effect=fake_run) as run:
                        self.assertEqual(limits.probe(config, args), 0)
                    operations = [call.args[0][3] for call in run.call_args_list]
                    for operation in ('create', 'inspect', 'start', 'stop', 'rm'):
                        self.assertIn(operation, operations)

    def test_session_persists_context_for_the_probe_subprocess(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = {'state_dir': tmp, 'docker_context': 'rootless'}
            with patch.object(limits, 'available_mib', return_value=2048), \
                    patch.object(limits, 'ready', return_value=True), \
                    patch.object(limits, 'protected', return_value={'fixture': True}), \
                    patch.object(limits.threading, 'Thread'):
                with limits.RuntimeSession(config) as session:
                    self.assertEqual(json.loads(session.path.read_text())['docker_context'], 'rootless')

    def test_guard_inspection_and_abort_cleanup_keep_the_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = limits.RuntimeSession({'state_dir': tmp, 'docker_context': 'rootless'})
            session.run_id = 'fixture'
            session.directory = Path(tmp)
            session.cpu = 2
            session.minimum = 2048
            session.finished = Mock()
            session.finished.wait.side_effect = [False, True]
            def fake_run(command, **kwargs):
                self.assertEqual(command[:3], ['docker', '--context', 'rootless'])
                output = 'probe-id' if command[3] == 'ps' else json.dumps([container()])
                return subprocess.CompletedProcess(command, 0, output)
            with patch.object(limits, 'available_mib', return_value=2048), \
                    patch.object(limits.subprocess, 'run', side_effect=fake_run) as run:
                session.watch()
                session.abort('fixture stop')
            self.assertTrue(session.failed.is_set())
            self.assertEqual([call.args[0][3] for call in run.call_args_list],
                             ['ps', 'inspect', 'ps', 'stop'])
