#!/usr/bin/env python3
"""Run an explicit staging test with host-managed, time-bounded cleanup."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess


def session_command(container, minutes, command):
    if not re.fullmatch(r'afterparty-staging-[a-z0-9-]{1,40}', container) and container != 'afterparty-activity-test-core':
        raise ValueError('Only explicitly named Afterparty staging containers are allowed.')
    if not 1 <= minutes <= 60 or not command:
        raise ValueError('Choose a 1-60 minute limit and a foreground test command.')
    docker = shutil.which('docker')
    runner = shutil.which('systemd-run')
    if not docker or not runner or not re.fullmatch(r'/[A-Za-z0-9_./-]+', docker):
        raise ValueError('A Linux host with Docker and user systemd is required.')
    # Read only selected fields. Never read or print container environment/secrets.
    result = subprocess.run(
        [docker, '--context', 'default', 'inspect', '--format',
         '{{json .Id}} {{json .State.Running}} {{json .HostConfig.RestartPolicy.Name}}', container],
        check=True, capture_output=True, text=True, timeout=15)
    identifier, running, restart = result.stdout.strip().split()
    identifier, running, restart = json.loads(identifier), json.loads(running), json.loads(restart)
    if not re.fullmatch(r'[a-f0-9]{64}', identifier) or running or restart != 'no':
        raise ValueError('Staging must already exist, be stopped and have restart policy "no".')
    # One fixed unit per container rejects overlapping sessions. Pin its immutable
    # ID so replacing/renaming the container cannot target a different service.
    prefix = docker + ' --context default '
    return [runner, '--user', '--unit=afterparty-staging-test-' + container,
            '--collect', '--wait', '--pipe', '--working-directory=' + str(Path.cwd()),
            '--property=Type=exec', '--property=Restart=no',
            '--property=RuntimeMaxSec=' + str(minutes * 60),
            '--property=TimeoutStartSec=30', '--property=TimeoutStopSec=45',
            '--property=ExecStartPre=' + prefix + 'start ' + identifier,
            '--property=ExecStopPost=' + prefix + 'stop --time 30 ' + identifier,
            '--', *command]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', required=True)
    parser.add_argument('--minutes', type=int, default=30)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    try:
        invocation = session_command(args.container, args.minutes, command)
        return subprocess.run(invocation, check=False).returncode
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        # Do not echo subprocess output or the test command, which may contain
        # private host information. No unmanaged docker-start fallback is safe.
        parser.exit(1, 'Staging session failed: ' + (str(error) if isinstance(error, ValueError) else type(error).__name__) + '\n')


if __name__ == '__main__':
    raise SystemExit(main())
