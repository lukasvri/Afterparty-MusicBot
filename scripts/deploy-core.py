#!/usr/bin/env python3
"""Host-local Core deployment. Configuration and production data never enter tests."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from datetime import datetime, timezone


class DeployError(RuntimeError):
    pass


def atomic_write(path, text):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def image_config(text, image):
    if not re.fullmatch(r'[a-zA-Z0-9_./:@-]+', image):
        raise DeployError('Invalid image reference.')
    matches = list(re.finditer(r'(?m)^(\s+)image:[^\n]*$', text))
    if len(matches) != 1:
        raise DeployError('Private Compose must contain exactly one explicit image line.')
    return re.sub(r'(?m)^(\s+)image:[^\n]*$', lambda m: m[1] + 'image: ' + image, text)


def extract_archive(archive, destination):
    # Python 3.11 in the audio image predates tarfile's extraction filters.
    # Both source snapshots and backups accept only files and directories.
    destination = Path(destination).resolve()
    for member in archive:
        relative = Path(member.name)
        if relative.is_absolute() or '..' in relative.parts or not (member.isfile() or member.isdir()):
            raise DeployError('Unsafe archive member.')
        target = destination / relative
        if not target.resolve().is_relative_to(destination):
            raise DeployError('Archive member escapes its destination.')
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True)
            target.chmod(member.mode & 0o777)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, target.open('wb') as output:
                shutil.copyfileobj(source, output)
            target.chmod(member.mode & 0o777)


def check_databases(directory):
    files = list(Path(directory).rglob('*.sqlite'))
    if not files:
        raise DeployError('No SQLite database found in production data.')
    for path in files:
        with contextlib.closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
            if db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                raise DeployError('SQLite integrity check failed. Data remains local.')
    return len(files)


def backup_data(directory, archive):
    directory, archive = Path(directory), Path(archive)
    if any(p.is_symlink() for p in directory.rglob('*')):
        raise DeployError('Production data contains symlinks; refusing an ambiguous backup.')
    check_databases(directory)
    with tarfile.open(archive, 'w:gz') as output:
        output.add(directory, arcname='data')
    # Read every member back, including data/guilds and any recovery files.
    with tarfile.open(archive, 'r:gz') as saved:
        members = [m for m in saved if m.isfile()]
        if not members:
            raise DeployError('Empty data backup.')
        for member in members:
            source = directory.parent / member.name if directory.name == 'data' else directory / Path(member.name).relative_to('data')
            with saved.extractfile(member) as stream, source.open('rb') as original:
                if hashlib.file_digest(stream, 'sha256').digest() != hashlib.file_digest(original, 'sha256').digest():
                    raise DeployError('Backup verification failed.')
    os.chmod(archive, 0o600)


def restore_data(directory, archive):
    directory = Path(directory)
    with tempfile.TemporaryDirectory(prefix='.core-restore-', dir=directory.parent) as temporary:
        with tarfile.open(archive, 'r:gz') as saved:
            extract_archive(saved, temporary)
        restored = Path(temporary) / 'data'
        check_databases(restored)
        quarantine = directory.with_name(directory.name + '.failed-' + str(time.time_ns()))
        directory.rename(quarantine)
        try:
            restored.rename(directory)
        except BaseException:
            quarantine.rename(directory)
            raise
    return quarantine


# Only reduced state leaves the container. The bridge key stays in its environment.
PROBE = r"""
import {readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=process.env.DATA_DIR??'/data', hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ids=[process.env.DISCORD_GUILD_ID,...(existsSync(root+'/guilds')?readdirSync(root+'/guilds').filter(x=>/^[0-9]{14,22}$/.test(x)):[])];
const scopes=[];
for(const id of [...new Set(ids)]){
 const r=await fetch('http://127.0.0.1:3990/v1/state?all=1&guildId='+encodeURIComponent(id),{headers:{Authorization:'Bearer '+process.env.PUBLIC_SITE_ADMIN_KEY},signal:AbortSignal.timeout(5000)});
 if(r.status===404)continue;
 if(!r.ok)throw Error('State check failed: '+r.status);
 const {state:s}=await r.json();
 const tracks=[s.current,...s.queue].filter(Boolean), seen=new Set();
 const entries=tracks.filter(t=>{const id=t.entryId??t.id;if(seen.has(id))return false;seen.add(id);return true}).map(t=>[t.entryId??t.id,t.id,!!t.concert]);
 scopes.push({scope:hash(id),ready:s.ready,playing:s.playing,buffering:s.buffering,connected:s.connected,current:s.current?hash([s.current.entryId??s.current.id,s.current.id]):null,entries:hash(entries),count:entries.length});
}
console.log(JSON.stringify(scopes.sort((a,b)=>a.scope.localeCompare(b.scope))));
"""
HEALTH = "const r=await fetch('http://127.0.0.1:3990/health',{signal:AbortSignal.timeout(4000)});const d=await r.json();if(!r.ok||!d.ready)process.exit(1);"

# Only opaque server/track hashes and command IDs cross the container boundary.
# The journal is written before sending commands, including commands whose reply
# might be lost. The jobs API makes those commands idempotent and recoverable.
PLAYBACK_CONTROL = r"""
import {readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const input=__PLAYBACK_INPUT__, hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const base='http://127.0.0.1:3990';
const headers={Authorization:'Bearer '+process.env.PUBLIC_SITE_ADMIN_KEY,'Content-Type':'application/json'};
const api=async(path,body)=>{
 const r=await fetch(base+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});
 if(r.status===404)return null;
 if(!r.ok)throw Error('Playback request failed: '+r.status);
 return r.json();
};
const sleep=()=>new Promise(r=>setTimeout(r,100));
async function control(){
 const root=process.env.DATA_DIR??'/data';
 const ids=[process.env.DISCORD_GUILD_ID,...(existsSync(root+'/guilds')?readdirSync(root+'/guilds').filter(x=>/^[0-9]{14,22}$/.test(x)):[])];
 const guildId=ids.find(x=>hash(x)===input.scope);
 if(!guildId)return 'skipped';
 const query='?guildId='+encodeURIComponent(guildId);
 const state=async()=>(await api('/v1/state'+query+'&all=1'))?.state;
 const same=s=>s?.connected&&s.current&&hash([s.current.entryId??s.current.id,s.current.id])===input.current;
 const s=await state();
 if(input.action==='pause'){
  if(!same(s))throw Error('Track or connection changed before automatic pause.');
  if(!s.playing&&!s.buffering)return 'skipped';
 }else{
  if(!same(s))return 'skipped';
  const {command:pause}=await api('/v1/jobs'+query+'&id='+input.pause_id)??{};
  if(!pause||pause.status==='failed')return 'skipped';
  if(pause.status!=='done')throw Error('Automatic pause has no confirmed result.');
  const {commands=[]}=await api('/v1/jobs'+query)??{};
  const transport=new Set(['pause','resume','skip','next','seek','forward','rewind','replay','unskip','jump','stop','leave','clear']);
  const latest=commands.find(x=>transport.has(x.payload?.action)&&x.status!=='failed');
  if(!latest||![input.pause_id,input.resume_id].includes(latest.id))return 'skipped';
  if(s.playing)return 'already';
 }
 if(!s.ready)throw Error('Core is not ready for playback control.');
 const id=input.action==='pause'?input.pause_id:input.resume_id;
 if(!await api('/v1/command',{id,guildId,action:input.action,scope:'admin'}))throw Error('Playback command endpoint is unavailable.');
 const deadline=Date.now()+20000;
 while(Date.now()<deadline){
  const {command}=await api('/v1/jobs'+query+'&id='+id)??{};
  if(command?.status==='failed'||command?.status==='unknown')throw Error('Playback command did not complete.');
  if(command?.status==='done'){
   const after=await state();
   if(!same(after)){
    if(input.action==='resume')return 'skipped';
    throw Error('Track changed during automatic pause.');
   }
   if(input.action==='pause'&&!after.playing&&!after.buffering)return 'paused';
   if(input.action==='resume'&&after.playing)return 'resumed';
  }
  await sleep();
 }
 throw Error('Playback control timed out.');
}
console.log(JSON.stringify({status:await control()}));
"""


def validation_resources(config):
    import importlib.util
    path = Path(__file__).with_name('runtime_limits.py')
    spec = importlib.util.spec_from_file_location('afterparty_resource_limits', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.RuntimeSession(config)


class Deployer:
    def __init__(self, config):
        self.config = config
        self.repo = Path(config['repo']).resolve()
        self.compose_file = Path(config['compose_file']).resolve()
        self.data = Path(config['data_dir']).resolve()
        self.state = Path(config['state_dir']).resolve()
        self.backups = Path(config['backup_dir']).resolve()
        self.container = config.get('container', 'gutta-krutt-core')
        self.docker = ['docker', '--context', config.get('docker_context', 'default')]
        self.compose = self.docker + ['compose', '--project-directory', str(self.repo / 'services/core'), '-f', str(self.compose_file)]
        self.logfile = None
        self.phase = 'preflight'
        self.target = None

    def command(self, args, *, capture=False, input=None, timeout=1800, cwd=None):
        # Never echo command arguments, environment or private Compose output.
        resources = getattr(self, '_validation_resources', None)
        if resources is not None:
            args = resources.wrap(args)
        result = subprocess.run(args, cwd=cwd or self.repo, input=input, text=True,
                                stdout=subprocess.PIPE if capture else self.logfile,
                                stderr=self.logfile, timeout=timeout)
        if result.returncode:
            raise DeployError('A command failed during ' + self.phase + '. See the local deployment log.')
        return result.stdout.strip() if capture else ''

    def git(self, *args):
        return self.command(['git', *args], capture=True)

    def emit(self, phase):
        self.phase = phase
        message = datetime.now(timezone.utc).isoformat(timespec='seconds') + ' ' + phase
        if self.logfile:
            self.logfile.write(message + '\n')
            self.logfile.flush()
        atomic_write(self.state / 'last-run.json', json.dumps({'phase': phase, 'commit': self.target, 'time': time.time()}, indent=2) + '\n')
        try:
            print(message, flush=True)
        except (BrokenPipeError, OSError):
            pass

    def inspect(self):
        return json.loads(self.command(self.docker + ['inspect', self.container], capture=True))[0]

    def probe(self):
        return json.loads(self.command(self.docker + ['exec', '-i', self.container, 'node', '--input-type=module'], input=PROBE, capture=True, timeout=40))

    @property
    def playback_journal(self):
        return self.state / 'playback-resume.json'

    def playback_command(self, entry, action):
        script = PLAYBACK_CONTROL.replace('__PLAYBACK_INPUT__', json.dumps({**entry, 'action': action}))
        result = json.loads(self.command(self.docker + ['exec', '-i', self.container, 'node', '--input-type=module'],
                                         input=script, capture=True, timeout=60))
        status = result.get('status')
        if status not in (['paused', 'skipped'] if action == 'pause' else ['resumed', 'already', 'skipped']):
            raise DeployError('Unexpected automatic playback result; keep the local playback journal.')
        return status

    def pause_playback(self):
        scopes = self.probe()
        if not scopes or not all(s['ready'] for s in scopes):
            raise DeployError('Core is not ready. Deployment was not started.')
        entries = []
        for scope in scopes:
            if not (scope['playing'] or scope['buffering']):
                continue
            if not scope.get('current') or not scope['connected']:
                raise DeployError('Playback is changing; retry once Core has a current track and connection.')
            entries.append({'scope': scope['scope'], 'current': scope['current'],
                            'pause_id': str(uuid.uuid4()), 'resume_id': str(uuid.uuid4())})
        if not entries:
            return
        if self.playback_journal.exists():
            raise DeployError('Restore the pending playback journal before another deployment.')
        atomic_write(self.playback_journal, json.dumps(entries) + '\n')
        self.emit('automatically pausing active playback on ' + str(len(entries)) + ' server(s)')
        for entry in entries[:]:
            if self.playback_command(entry, 'pause') == 'skipped':
                entries.remove(entry)
                atomic_write(self.playback_journal, json.dumps(entries) + '\n')

    def resume_playback(self):
        if not self.playback_journal.exists():
            return
        entries = json.loads(self.playback_journal.read_text())
        if entries:
            info = self.inspect()
            if not info['State']['Running'] or info['State'].get('Health', {}).get('Status') != 'healthy':
                raise DeployError('Playback recovery is pending until Core is healthy. Keep playback-resume.json and retry.')
            self.emit('restoring only playback paused by this deployment')
        failures = []
        for entry in entries[:]:
            try:
                status = self.playback_command(entry, 'resume')
            except Exception:
                failures.append(entry['scope'])
                continue
            entries.remove(entry)
            atomic_write(self.playback_journal, json.dumps(entries) + '\n')
            if status == 'skipped':
                self.emit('playback changed or disconnected; leaving that server unchanged')
        if failures:
            raise DeployError('Automatic playback recovery failed on ' + str(len(failures)) + ' server(s). Keep playback-resume.json and retry; the bot may already be updated.')
        self.playback_journal.unlink()

    @contextlib.contextmanager
    def paused_playback(self):
        try:
            self.pause_playback()
            yield
        except BaseException as error:
            try:
                self.resume_playback()
            except Exception as recovery:
                raise DeployError(str(error) + ' Playback recovery is also pending: ' + str(recovery)) from recovery
            raise
        else:
            self.resume_playback()

    def idle(self):
        scopes = self.probe()
        if not scopes or not all(s['ready'] for s in scopes):
            raise DeployError('Core is not ready. Deployment was not started.')
        if any(s['playing'] or s['buffering'] for s in scopes):
            raise DeployError('Playback restarted after automatic pause. Retry the update; Core was not stopped.')
        return scopes

    def quiet(self):
        scopes = self.idle()
        if any(s.get('connected', True) or s.get('count', 1) for s in scopes):
            raise DeployError('Automatic update waits for no voice connections and empty queues.')
        return scopes

    def preflight(self):
        for path in [self.compose_file, self.data, self.state, self.backups]:
            if path.is_relative_to(self.repo):
                raise DeployError('Private configuration, data, state and backups must be outside the Git checkout.')
        if self.backups.is_relative_to(self.data) or self.state.is_relative_to(self.data):
            raise DeployError('Deployment state and backups must be outside production data.')
        if self.data.stat().st_uid != os.getuid():
            raise DeployError('The deployment user must own the production data directory.')
        info = self.inspect()
        if not info['State']['Running'] or info['State'].get('Health', {}).get('Status') != 'healthy':
            raise DeployError('The existing Core container must be healthy before a normal update.')
        mounts = [m for m in info['Mounts'] if m['Destination'] == '/data']
        if len(mounts) != 1 or mounts[0]['Type'] != 'bind' or Path(mounts[0]['Source']).resolve() != self.data:
            raise DeployError('Configured data directory does not match the running /data binding.')
        model = json.loads(self.command(self.compose + ['config', '--no-env-resolution', '--format', 'json'], capture=True))
        core = model['services']['core']
        if core.get('container_name') != self.container or len(model['services']) != 1:
            raise DeployError('Expected a private Compose file containing only the Core service.')
        configured = [m for m in core.get('volumes', []) if m['target'] == '/data']
        if len(configured) != 1 or configured[0]['type'] != 'bind' or Path(configured[0]['source']).resolve() != self.data:
            raise DeployError('Private Compose would change the production data binding.')
        for entry in core.get('env_file', []):
            path = Path(entry['path'] if isinstance(entry, dict) else entry).resolve()
            if not path.is_file() or path.is_relative_to(self.repo):
                raise DeployError('Keep real environment files outside the checkout.')
        self.model = model
        self.old_image = info['Image']
        self.old_config = self.compose_file.read_text()
        image_config(self.old_config, self.old_image)
        data_size = sum(p.stat().st_size for p in self.data.rglob('*') if p.is_file())
        for path in [self.state, self.backups, self.data.parent]:
            if shutil.disk_usage(path).free < max(512 * 1024 * 1024, 3 * data_size):
                raise DeployError('Not enough free space for a verified backup and safe recovery.')

    def snapshot(self, directory):
        self.git('fetch', 'origin', 'main')
        self.target = self.git('rev-parse', 'origin/main')
        # The worktree may contain ongoing work on any branch. Only the recorded
        # production commit constrains updates; never merge into the worktree.
        current_file = self.state / 'current.json'
        if current_file.exists():
            current = json.loads(current_file.read_text())
            self.git('merge-base', '--is-ancestor', current['commit'], self.target)
        archive = directory / 'source.tar'
        self.command(['git', 'archive', self.target, '-o', str(archive)])
        source = directory / 'source'
        source.mkdir()
        with tarfile.open(archive) as contents:
            extract_archive(contents, source)
        # A tracked local file is not an acceptable candidate, even if Git contains it.
        for p in source.rglob('*'):
            if p.is_symlink():
                raise DeployError('Candidate contains symlinks; review the source before deployment.')
            if p.is_file() and (p.name in ['compose.local.yml', 'hosting.local.json'] or
                ((p.name.startswith('.env') or p.name.startswith('.dev.vars')) and not p.name.endswith('.example')) or
                re.search(r'\.(sqlite|db)(-|$)', p.name)):
                raise DeployError('Candidate contains a private configuration or database file.')
        return source

    def validate(self, source):
        # The same bounded validation path is used before any normal switch and by --check.
        with validation_resources(self.config) as resources:
            self._validation_resources = resources
            try:
                self._validate_candidate(source)
            finally:
                self._validation_resources = None

    def _validate_candidate(self, source):
        import importlib.util
        spec = importlib.util.spec_from_file_location('afterparty_release_artifacts', Path(__file__).with_name('release_artifacts.py'))
        artifacts = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(artifacts)
        self.emit('checking GitHub-tested release')
        cache = self.state / 'release-cache' / self.target
        manifest = artifacts.Client().fetch(self.target, cache)
        if manifest['version'] != json.loads((source / 'package.json').read_text())['version']:
            raise DeployError('Tested build version differs from canonical source.')
        self.new_image = manifest['image_tag']
        self.emit('loading tested image from GitHub')
        self.command(self.docker + ['load', '--input', str(cache / 'core-image.tar.gz')])
        self.new_image_id = self.command(self.docker + ['image', 'inspect', '--format', '{{.Id}}', self.new_image], capture=True)
        if self.new_image_id not in manifest['verified_image_ids']:
            raise DeployError('Imported image ID differs from the tested GitHub image.')
        self.emit('checking production image without starting Core')
        self.validate_runtime_image()
        proof = json.dumps({
            'commit': self.target, 'run_id': manifest['run_id'], 'run_attempt': manifest['run_attempt'],
            'image_id': self.new_image_id, 'release_image_id': manifest['image_id'], 'manifest_sha256': artifacts.digest(cache / 'release.json'),
            'website_sha256': manifest['files']['website.tar.gz']['sha256'],
            'verified_at': time.time(), 'mode': 'github-tested-build',
            'provenance_verified': True, 'provenance_sha256': artifacts.digest(cache / 'provenance.json')
        }, indent=2) + '\n'
        atomic_write(cache / 'verified.json', proof)
        atomic_write(self.state / 'ci-build.json', proof)

    def validate_runtime_image(self):
        # Build-stage tests run as root. The final image must also work as its
        # unprivileged runtime user, including when local source modes differ.
        script = """import {readdirSync,readFileSync} from 'node:fs';
if(process.getuid()===0)throw Error('Core must run without root.');
function check(dir){for(const item of readdirSync(dir,{withFileTypes:true})){const path=dir+'/'+item.name;if(item.isDirectory())check(path);else if(item.isFile())readFileSync(path);}}
check('/app/src');await import('/app/src/data-import.ts');
console.log('Unprivileged runtime source and imports verified.');"""
        self.command(self.docker + ['run', '--rm', '--network', 'none', '--read-only',
                     '--cpus=0.5', '--memory=256m', '--memory-swap=256m', '--pids-limit=64', '--entrypoint',
                     'node', self.new_image, '--input-type=module', '-e', script], timeout=30)

    def wait_ready(self):
        deadline = time.monotonic() + self.config.get('health_timeout_seconds', 150)
        consecutive = 0
        while time.monotonic() < deadline:
            try:
                self.command(self.docker + ['exec', self.container, 'node', '-e', HEALTH], timeout=10)
                info = self.inspect()
                if not info['State']['Running'] or info.get('RestartCount', 0):
                    raise DeployError('Core restarted during its health check.')
                consecutive += 1
                if consecutive >= 3 and info['State'].get('Health', {}).get('Status') == 'healthy':
                    return
            except (DeployError, subprocess.TimeoutExpired):
                consecutive = 0
            time.sleep(2)
        raise DeployError('Core did not become healthy within the deployment timeout.')

    def save_backup(self, backup):
        atomic_write(backup / 'compose.previous.yml', self.old_config)
        atomic_write(backup / 'image-id.txt', self.old_image + '\n')
        for index, entry in enumerate(self.model['services']['core'].get('env_file', [])):
            path = Path(entry['path'] if isinstance(entry, dict) else entry)
            shutil.copyfile(path, backup / ('environment-' + str(index)))
            os.chmod(backup / ('environment-' + str(index)), 0o600)
        backup_data(self.data, backup / 'data.tar.gz')

    def switch(self):
        if self.compose_file.read_text() != self.old_config or self.inspect()['Image'] != self.old_image:
            raise DeployError('Production configuration or image changed during validation. Nothing was stopped.')
        if getattr(self, 'idle_only', False):
            self.quiet()
            self.switch_paused()
            self.emit('deployment succeeded')
            return
        with self.paused_playback():
            self.switch_paused()
        self.emit('deployment succeeded')

    def switch_paused(self):
        # Recheck after lengthy tests, before any interruption.
        if getattr(self, 'idle_only', False):
            self.quiet()
        before = self.idle()
        if self.compose_file.read_text() != self.old_config or self.inspect()['Image'] != self.old_image:
            raise DeployError('Production configuration or image changed during validation. Nothing was stopped.')
        backup = self.backups / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + self.target[:12])
        backup.mkdir(mode=0o700)
        atomic_write(backup / 'state.before.json', json.dumps(before) + '\n')
        self.command(self.docker + ['tag', self.old_image, 'gutta-krutt-core:rollback-' + backup.name.lower()])
        stopped, complete_backup, candidate_started = False, False, False
        try:
            self.emit('stopping Core and backing up all production data')
            if getattr(self, 'idle_only', False):
                self.quiet()
            stopped = True
            self.command(self.compose + ['stop', 'core'], timeout=90)
            if self.inspect()['State']['Running']:
                raise DeployError('Core did not stop; refusing an inconsistent backup.')
            self.save_backup(backup)
            complete_backup = True
            atomic_write(self.compose_file, image_config(self.old_config, self.new_image))
            self.emit('starting the tested image')
            candidate_started = True
            self.command(self.compose + ['up', '-d', '--no-build', 'core'], timeout=120)
            self.wait_ready()
            after = self.probe()
            if [(s['scope'], s['entries']) for s in before] != [(s['scope'], s['entries']) for s in after]:
                raise DeployError('Recovered queue state differs from the state before deployment.')
            if self.inspect()['Image'] != self.new_image_id:
                raise DeployError('The running container is not the tested image.')
            check_databases(self.data)
            atomic_write(backup / 'state.after.json', json.dumps(after) + '\n')
            atomic_write(self.state / 'current.json', json.dumps({'commit': self.target, 'image': self.new_image_id, 'backup': str(backup), 'time': time.time()}, indent=2) + '\n')
        except BaseException:
            if stopped:
                self.emit('deployment failed; recovering the previous image')
                if candidate_started:
                    self.command(self.compose + ['stop', 'core'], timeout=90)
                    if self.inspect()['State']['Running']:
                        raise DeployError('Rollback stopped: candidate is still running. Keep the backup and inspect locally.')
                    if complete_backup:
                        quarantine = restore_data(self.data, backup / 'data.tar.gz')
                        atomic_write(backup / 'quarantine.txt', str(quarantine) + '\n')
                # Pin the exact previous image even if its old tag was changed.
                atomic_write(self.compose_file, image_config(self.old_config, self.old_image))
                self.command(self.compose + ['up', '-d', '--no-build', 'core'], timeout=120)
                self.wait_ready()
                self.emit('previous image restored; deployment failed')
            raise

    def run(self, check=False, redeploy=False):
        if getattr(self, 'idle_only', False):
            if self.playback_journal.exists():
                raise DeployError('Automatic update waits for manual playback recovery.')
            self.quiet()
        if check and self.playback_journal.exists():
            raise DeployError('Playback recovery is pending. Run a normal deployment to restore it; --check never changes playback.')
        if not check and not getattr(self, 'idle_only', False):
            self.resume_playback()
        self.preflight()
        with tempfile.TemporaryDirectory(prefix='candidate-', dir=self.state) as temporary:
            self.emit('fetching main and exporting source without local secrets')
            source = self.snapshot(Path(temporary))
            current_file = self.state / 'current.json'
            if current_file.exists() and not check and not redeploy:
                current = json.loads(current_file.read_text())
                if current.get('commit') == self.target and current.get('image') == self.old_image:
                    self.emit('already running this commit; no restart needed')
                    return
            self.validate(source)
            if check:
                self.emit('validation succeeded; production unchanged')
            else:
                self.switch()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Verify and import the exact tested GitHub build, run an isolated runtime probe, and never update production.')
    mode.add_argument('--status', action='store_true', help='Show local deployment records without making changes.')
    parser.add_argument('--redeploy', action='store_true', help='Also deploy if this commit is already recorded as running.')
    parser.add_argument('--idle-only', action='store_true', help='Refuse active playback, voice connections, queues and pending recovery. Never pause or resume playback.')
    args = parser.parse_args()
    os.umask(0o077)
    config = json.loads(args.config.read_text())
    deploy = Deployer(config)
    deploy.idle_only = args.idle_only
    for path in [deploy.state, deploy.backups]:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.status:
        for name in ['current.json', 'last-run.json']:
            path = deploy.state / name
            print(name + ': ' + (path.read_text().strip() if path.exists() else 'not recorded'))
        return 0
    with (deploy.state / 'deploy.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Another deployment is already running.', file=sys.stderr)
            return 1
        # Keep recovery running if the SSH connection disappears. Child output is
        # written locally, never to a pipe connected to the remote terminal.
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
        def terminate(_signal, _frame):
            raise DeployError('Deployment interrupted; recovering if needed.')
        signal.signal(signal.SIGTERM, terminate)
        log = deploy.state / ('deploy-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.log')
        with log.open('w', buffering=1) as deploy.logfile:
            try:
                deploy.run(check=args.check, redeploy=args.redeploy)
            except Exception as error:
                deploy.emit('failed: ' + str(error))
                print('Details are in the local log: ' + str(log), file=sys.stderr)
                return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
