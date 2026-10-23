"""Bounded, public GitHub checks with safe operational error messages."""
import json
import time
import urllib.error
import urllib.request


class GithubCheckError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise GithubCheckError('GitHub-kontrollen ble omdirigert. Prøv igjen senere.')


def github_json(path, *, opener=None):
    if not isinstance(path, str) or not path.startswith('/') or path.startswith('//') or any(c in path for c in ('\r', '\n', '#')):
        raise GithubCheckError('Ugyldig GitHub-kontroll.')
    request = urllib.request.Request(
        'https://api.github.com/repos/lukasvri/Afterparty-MusicBot' + path,
        headers={'User-Agent':'Afterparty-Beta-Updater/1', 'Accept':'application/vnd.github+json'})
    try:
        with (opener or urllib.request.build_opener(NoRedirect())).open(request, timeout=20) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise GithubCheckError('GitHub-svaret er for stort.')
        return json.loads(raw)
    except urllib.error.HTTPError as error:
        if error.code == 429 or (error.code == 403 and error.headers.get('X-RateLimit-Remaining') == '0'):
            try:
                reset = float(error.headers.get('X-RateLimit-Reset', 0))
                retry_at = min(time.time() + 7200, max(time.time() + 60, reset))
                minutes = min(120, max(1, int((retry_at - time.time()) / 60) + 1))
            except (TypeError, ValueError):
                minutes = 5
                retry_at = time.time() + 300
            failure = GithubCheckError(f'GitHubs grense for statuskontroller er nådd. Prøv igjen om omtrent {minutes} minutter. Ingen oppdatering er startet.')
            failure.retry_after = retry_at
            raise failure from None
        raise GithubCheckError(f'GitHub-kontrollen svarte HTTP {error.code}. Ingen oppdatering er startet.') from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise GithubCheckError('GitHub-kontrollen kunne ikke fullføres. Prøv igjen senere. Ingen oppdatering er startet.') from None
