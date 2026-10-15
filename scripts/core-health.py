#!/usr/bin/env python3
"""Host-local health report. Never starts, stops or restarts a container."""
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import time


PROBE = r"""
const headers={Authorization:'Bearer '+process.env.PUBLIC_SITE_ADMIN_KEY};
const api=async path=>{const r=await fetch('http://127.0.0.1:3990'+path,{headers,signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Core health request failed');return r.json();};
const app=await api('/v1/application'),admin=await api('/v1/admin');
let active=0;
for(const g of app.guilds??[]){const {state}=await api('/v1/state?all=1&guildId='+encodeURIComponent(g.id));if(state.playing)active++;}
console.log(JSON.stringify({ready:admin.bot?.ready===true,guilds:app.guilds?.length??0,active_voice_sessions:active,
cpu_percent:admin.performance?.cpuPercent,rss_bytes:admin.performance?.rssBytes,event_loop_p95_ms:admin.performance?.eventLoopP95Ms,
voice_limit:Number(process.env.MAX_ACTIVE_VOICE_SESSIONS??8)}));
"""


def command(args, input=None):
    result = subprocess.run(args, input=input, text=True, capture_output=True, timeout=25)
    if result.returncode:
        raise RuntimeError('Local operational check failed.')
    return result.stdout.strip()


def assess(data):
    checks = []

    def add(name, status, message):
        checks.append({'name': name, 'status': status, 'message': message})

    if data.get('maintenance'):
        add('deployment', 'ok', 'A deployment holds the lock; runtime checks are deferred.')
    elif data.get('running') is False:
        add('container', 'warning', 'Core is stopped. No automatic start is performed.')
    elif not data.get('ready') or data.get('health') != 'healthy':
        add('container', 'error', 'Core or its Discord connection is not ready.')
    else:
        add('container', 'ok', 'Core and Discord are ready.')
    if data.get('oom_killed'):
        add('memory', 'error', 'Docker recorded an out-of-memory termination.')
    if data.get('event_loop_p95_ms', 0) > 25:
        add('latency', 'warning', 'Recent event-loop delay exceeds 25 ms.')
    if data.get('available_memory_bytes', 0) < 512 * 1024**2:
        add('host_memory', 'warning', 'Less than 512 MiB of host memory is available.')
    if data.get('free_disk_bytes', 0) < 5 * 1024**3:
        add('disk', 'error', 'Less than 5 GiB of working disk space remains.')
    if data.get('backup_age_hours', float('inf')) > 36 or not data.get('backup_present'):
        add('backup', 'error', 'No complete verified backup from the last 36 hours is available.')
    else:
        add('backup', 'ok', 'A recent verified backup is present.')
    if not data.get('linger'):
        add('scheduled_jobs', 'warning', 'User services may stop at logout; enable linger on the host.')
    if not data.get('maintenance') and not data.get('read_only_root'):
        add('container_filesystem', 'warning', 'The container root filesystem is writable.')
    status = 'error' if any(c['status'] == 'error' for c in checks) else 'warning' if any(c['status'] == 'warning' for c in checks) else 'ok'
    return {'status': status, 'checks': checks}


def collect(config, backup_dir):
    docker = ['docker', '--context', config.get('docker_context', 'default')]
    name = config.get('container', 'gutta-krutt-core')
    result = {}
    lock_path = Path(config['state_dir']) / 'deploy.lock'
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            result['maintenance'] = True
        if not result.get('maintenance'):
            info = json.loads(command(docker + ['inspect', name]))[0]
            result.update(running=info['State']['Running'],
                          health=info['State'].get('Health', {}).get('Status', 'unknown'),
                          oom_killed=info['State'].get('OOMKilled', False),
                          restarts=info.get('RestartCount', 0),
                          read_only_root=info['HostConfig'].get('ReadonlyRootfs', False))
            if result['running']:
                try:
                    result.update(json.loads(command(docker + ['exec', '-i', name, 'node', '--input-type=module'], PROBE)))
                except (RuntimeError, subprocess.TimeoutExpired, ValueError):
                    result['ready'] = False
    memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    result['available_memory_bytes'] = int(memory['MemAvailable'].split()[0]) * 1024
    result['free_disk_bytes'] = shutil.disk_usage(config['data_dir']).free
    result['linger'] = command(['loginctl', 'show-user', str(os.getuid()), '-p', 'Linger', '--value']) == 'yes'
    try:
        latest = json.loads((backup_dir / 'latest.json').read_text())
        archive = backup_dir / Path(latest['archive']).name
        result['backup_present'] = archive.is_file() and archive.stat().st_size == latest['size_bytes']
        result['backup_age_hours'] = round((time.time() - datetime.fromisoformat(latest['created_at']).timestamp()) / 3600, 2)
        result['backup_databases'] = latest['databases']
    except (OSError, ValueError, KeyError):
        result['backup_present'] = False
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--backup-dir', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        data = collect(json.loads(args.config.read_text()), args.backup_dir)
        report = {'checked_at': datetime.now(timezone.utc).isoformat(), **assess(data), 'metrics': data}
    except Exception:
        report = {'checked_at': datetime.now(timezone.utc).isoformat(), 'status': 'error',
                  'checks': [{'name': 'probe', 'status': 'error', 'message': 'The local health probe failed. Inspect Docker and the private configuration.'}]}
    if args.output:
        temporary = args.output.with_suffix('.tmp')
        with temporary.open('w') as stream:
            os.chmod(temporary, 0o600)
            json.dump(report, stream, indent=2)
            stream.write('\n')
        temporary.replace(args.output)
    print(json.dumps(report))
    return {'ok': 0, 'warning': 1, 'error': 2}[report['status']]


if __name__ == '__main__':
    raise SystemExit(main())
