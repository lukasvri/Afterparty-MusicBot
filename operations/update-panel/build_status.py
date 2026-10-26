"""Read-only diagnostics. CI success never substitutes for signed release verification."""
import re

REPOSITORY = 'lukasvri/Afterparty-MusicBot'
DEFAULT = 'Det signerte GitHub-bygget kunne ikke bekreftes. Publisering er fortsatt blokkert.'


def blocked_build(client, commit):
    result = {'ready': False, 'state': 'unverified', 'message': DEFAULT}
    if not isinstance(commit, str) or not re.fullmatch('[a-f0-9]{40}', commit):
        return result
    try:
        response = client.get('/actions/workflows/core.yml/runs?branch=main&event=push&head_sha=' + commit + '&per_page=10')
        runs = [run for run in response.get('workflow_runs', []) if isinstance(run, dict)
                and run.get('head_sha') == commit and run.get('head_branch') == 'main'
                and run.get('event') == 'push' and run.get('path') == '.github/workflows/core.yml'
                and run.get('head_repository', {}).get('full_name') == REPOSITORY
                and type(run.get('id')) is int and run['id'] > 0]
        if not runs:
            return dict(result, state='missing', message='Ingen GitHub-kjøring for denne main-versjonen er bekreftet. Publisering er blokkert.')
        run = max(runs, key=lambda item: item['id'])
        result.update(run_id=run['id'], run_url='https://github.com/' + REPOSITORY + '/actions/runs/' + str(run['id']))
        if run.get('status') in ('queued', 'in_progress', 'waiting', 'pending', 'requested'):
            result.update(state='pending', message='GitHub-testene eller releasebygget pågår. Ingen publisering er startet. Vent til kjøringen er godkjent.')
        elif run.get('status') == 'completed' and run.get('conclusion') != 'success':
            result.update(state='failed', message='GitHub-kjøringen for denne kildeversjonen feilet eller ble avbrutt. Ingen publisering er startet.')
        elif run.get('status') == 'completed' and run.get('conclusion') == 'success':
            result['message'] = 'GitHub-kjøringen besto, men det signerte releasebygget kunne ikke verifiseres. Publisering er fortsatt blokkert.'
    except Exception:
        pass  # Never expose API errors, credentials or arbitrary response fields.
    return result
