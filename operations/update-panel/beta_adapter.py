"""Fixed beta-only control surface. No caller-supplied targets or commands."""
from contextlib import ExitStack, contextmanager
import fcntl
import hmac
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import time


class BetaBlocked(RuntimeError):
    pass


def atomic_json(path, value):
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.request-')
    try:
        with os.fdopen(fd, 'w') as file:
            json.dump(value, file)
            file.flush()
            os.fsync(file.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


class BetaUpdater:
    def __init__(self, base):
        self.base = Path(base)
        self.root = self.base / 'beta-update'
        self.script = self.base / 'site-runner/beta_update.py'
        self.mutex = threading.Lock()
        self.checking = False

    def _read(self, name):
        try:
            result = json.loads((self.root / name).read_text())
            return result if isinstance(result, dict) else {}
        except (OSError, ValueError):
            return {}

    def _service_active(self):
        try:
            result = subprocess.run(['/usr/bin/systemctl', '--user', 'show', '--property=ActiveState',
                                     '--value', 'afterparty-beta-update.service'],
                                    capture_output=True, text=True, timeout=5, check=True)
            return result.stdout.strip() not in ('inactive', 'failed')
        except Exception:
            raise BetaBlocked('Kunne ikke kontrollere betajobben.') from None

    def _pending(self, state):
        # Even an old or incomplete request requires coordinator recovery.
        return (self.root / 'request.json').exists()

    @contextmanager
    def _locks(self):
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        with ExitStack() as stack:
            for path in (self.base / 'deploy-all.lock', self.root / 'beta.lock'):
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
                file = stack.enter_context(os.fdopen(fd, 'a'))
                try:
                    fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise BetaBlocked('En oppdateringsjobb kjører allerede.') from None
            yield

    def status(self):
        state = self._read('state.json')
        # Only a small public schema crosses the HTTP boundary.
        fields = ('checked_at', 'commit', 'confirmation_id', 'ready', 'running', 'message',
                  'steps', 'deployed_commit', 'health', 'stage', 'updated_at', 'error', 'version',
                  'available', 'current_commit')
        result = {key: state[key] for key in fields if key in state}
        result.update(environment='Beta', site_url='https://ap.beta.openworks.no',
                      branch='beta-svelte-3', checking=self.checking)
        result['running'] = bool(state.get('running') or self._pending(state) or self._service_active())
        checked = state.get('checked_at', 0)
        result['ready'] = bool(state.get('ready') is True and isinstance(checked, (int, float))
                               and 0 <= time.time() - checked < 1800 and not result['running'])
        result['ready'] = result['ready'] and state.get('available') is not False
        failed = state.get('stage') in ('failed', 'blocked')
        if not failed:
            result.pop('error', None)
        current = self._read('current.json')
        previous = self._read('rollback.json')
        recorded = (current.get('status') == 'succeeded'
                    and isinstance(current.get('commit'), str)
                    and re.fullmatch('[a-f0-9]{40}', current['commit']))
        live = result['running']
        phase = state.get('stage')
        worker = previous.get('active_worker')
        completed = previous.get('completed_builds', {}) if phase in ('cloudflare', 'verify', 'done') else {}
        labels = [('validate', 'Kontroller kilde og GitHub-tester'),
                  ('api', 'Bygg og publiser betaens API'),
                  ('frontend', 'Bygg og publiser betaens frontend'),
                  ('verify', 'Kontroller betasiden og forbindelsen'),
                  ('done', 'Lagre kontrollert resultat')]
        result['progress_kind'] = 'current' if live or failed else 'last' if recorded else 'none'
        steps = []
        for name, label in labels:
            status = 'pending'
            if not live and not failed and recorded:
                status = 'done'
            elif name == 'validate':
                status = 'running' if live and phase == 'validate' else 'done' if phase in ('cloudflare', 'verify', 'done') else 'failed' if failed else 'pending'
            elif name in ('api', 'frontend'):
                target = 'afterparty-staging' if name == 'api' else 'afterparty-web-beta'
                if isinstance(completed, dict) and completed.get(target, {}).get('status') == 'succeeded':
                    status = 'done'
                elif phase == 'cloudflare' and worker == target:
                    status = 'running' if live else 'failed' if failed else 'pending'
            elif name == 'verify' and phase in ('verify', 'done'):
                status = 'running' if live and phase == 'verify' else 'done'
            elif name == 'done' and phase == 'done':
                status = 'done'
            steps.append({'name': name, 'label': label, 'status': status})
        result['steps'] = steps
        if not live and not failed and state.get('available') is False and result.get('current_commit') == result.get('commit'):
            result['message'] = 'Siste kontrollerte betaversjon er allerede på nett. Ingen oppdatering er nødvendig.'
        return result

    def request_check(self):
        with self.mutex, self._locks():
            if self.checking or self.status()['running']:
                return False
            self.checking = True
            def check():
                try:
                    subprocess.run(['/usr/bin/python3', str(self.script), '--check'],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=240, check=False)
                finally:
                    self.checking = False
            threading.Thread(target=check, daemon=True).start()
            return True

    def start(self, body):
        if (not isinstance(body, dict) or set(body) != {'commit', 'confirmation_id', 'confirm'}
                or body.get('confirm') is not True
                or not isinstance(body.get('commit'), str)
                or not re.fullmatch('[0-9a-f]{40}', body['commit'])
                or not isinstance(body.get('confirmation_id'), str)
                or not re.fullmatch('[0-9a-f]{64}', body['confirmation_id'])):
            raise ValueError('Ugyldig betabekreftelse.')
        with self.mutex:
            with self._locks():
                state = self.status()
                if self.checking or not state['ready']:
                    raise BetaBlocked('Sjekk betaoppdateringen på nytt før du bekrefter.')
                if (not hmac.compare_digest(body['commit'], str(state.get('commit', '')))
                        or not hmac.compare_digest(body['confirmation_id'], str(state.get('confirmation_id', '')))):
                    raise BetaBlocked('Versjonen har endret seg. Sjekk og bekreft beta på nytt.')
                request = self.root / 'request.json'
                atomic_json(request, {'commit': body['commit'], 'confirmation_id': body['confirmation_id'],
                                      'confirmed_at': time.time()})
            # Pending request prevents competing dispatch. Release cross-process
            # locks before systemd starts the runner that must acquire them.
            try:
                subprocess.run(['/usr/bin/systemctl', '--user', 'start', '--no-block',
                                'afterparty-beta-update.service'], stdin=subprocess.DEVNULL,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               check=True, timeout=10)
            except Exception:
                # A timeout may mean systemd accepted the job. Keep the durable
                # request until the coordinator resolves this uncertain state.
                raise BetaBlocked('Betajobben kunne ikke bekreftes startet. Kontroller status før nytt forsøk.') from None
            return True
