import io
import os
from types import SimpleNamespace
import unittest
from email.message import Message
from unittest.mock import Mock, MagicMock, patch
from urllib.error import HTTPError
from github_checks import github_json, GithubCheckError
from install import patch_runner


class GithubTests(unittest.TestCase):
    def test_quota_error_is_sanitized_and_has_retry_guidance(self):
        headers = Message()
        headers['X-RateLimit-Remaining'] = '0'
        headers['X-RateLimit-Reset'] = '1600'
        error = HTTPError('https://example.invalid',403,'Sensitive raw details',headers,io.BytesIO(b'private IP'))
        opener = Mock()
        opener.open.side_effect = error
        with patch('github_checks.time.time',return_value=1000), self.assertRaises(GithubCheckError) as caught:
            github_json('/actions/runs',opener=opener)
        self.assertIn('11 minutter',str(caught.exception))
        self.assertNotIn('Sensitive',str(caught.exception))
        self.assertNotIn('private',str(caught.exception))

    def test_public_response_is_bounded_and_uses_fixed_repository(self):
        opener = Mock()
        opener.open.return_value = MagicMock()
        response = opener.open.return_value.__enter__.return_value
        response.read.return_value = b'{"ok":true}'
        self.assertEqual(github_json('/actions/runs',opener=opener),{'ok':True})
        self.assertEqual(opener.open.call_args.args[0].full_url,'https://api.github.com/repos/lukasvri/Afterparty-MusicBot/actions/runs')
        response.read.return_value = b'x' * (2*1024*1024+1)
        with self.assertRaises(GithubCheckError):
            github_json('/actions/runs',opener=opener)

    def test_invalid_path_is_rejected_without_a_request(self):
        for path in ('https://example.invalid','//example.invalid','/actions\nInjected'):
            with self.assertRaises(GithubCheckError):
                github_json(path)

    def test_runner_patch_is_idempotent_and_preserves_check_context(self):
        source = "def github(path):\n return {}\n\ndef git(*args):\n pass\ns={'stage':'checking','ready':False,'running':False,'message':'checking'}\ns.update(stage='validate',running=True,ready=False,message='checking')\n"
        patched = patch_runner(source)
        self.assertEqual(patched,patch_runner(patched))
        self.assertIn("s={**s,'stage':'checking','operation':'check'",patched)
        self.assertIn("operation='publish'",patched)


class RunnerAncestryTests(unittest.TestCase):
    SOURCE = """def github(path):
 return {}

def git(*args):
 r=subprocess.run(['git',*args],cwd=REPO,capture_output=True,text=True,timeout=60,env={**os.environ,'GIT_TERMINAL_PROMPT':'0'})
 if r.returncode:raise BuildError('Betaens GitHub-kilde kunne ikke bekreftes.')
 return r.stdout.strip()

def select():
 if git('remote','get-url','origin') not in ['https://github.com/lukasvri/Afterparty-MusicBot.git','https://github.com/lukasvri/Afterparty-MusicBot']:raise BuildError('Feil beta-repository.')
 git('fetch','--no-tags','origin',BRANCH,'main')
 commit=git('rev-parse','origin/'+BRANCH)
 git('merge-base','--is-ancestor','origin/main',commit)
 return commit
"""

    def runner(self, responses):
        process = Mock()
        process.run.side_effect = [SimpleNamespace(returncode=code, stdout=output, stderr='private raw details')
                                   for code, output in responses]
        scope = dict(subprocess=process, os=os, REPO='/synthetic/repository',
                     BRANCH='beta-svelte-3', BuildError=RuntimeError)
        patched = patch_runner(self.SOURCE)
        self.assertEqual(patched, patch_runner(patched))
        exec(compile(patched, '<synthetic-runner>', 'exec'), scope)
        return scope, process

    def test_outdated_branch_blocks_with_safe_actionable_message(self):
        scope, process = self.runner([(1, '')])
        with self.assertRaisesRegex(RuntimeError, 'Betagrenen inneholder ikke siste main') as caught:
            scope['git']('merge-base','--is-ancestor','origin/main','a' * 40)
        self.assertNotIn('private', str(caught.exception))
        self.assertEqual(process.run.call_args.args[0],
                         ['git','merge-base','--is-ancestor','origin/main','a' * 40])

    def test_other_git_failures_keep_generic_message(self):
        for code, args in [(2, ('merge-base','--is-ancestor','origin/main','a'*40)),
                           (1, ('fetch','--no-tags','origin','beta-svelte-3','main')),
                           (1, ('merge-base','--is-ancestor','other/main','a'*40))]:
            scope, _ = self.runner([(code, '')])
            with self.assertRaisesRegex(RuntimeError, '^Betaens GitHub-kilde kunne ikke bekreftes.$'):
                scope['git'](*args)

    def test_success_keeps_origin_fetch_and_exact_ancestry_gate(self):
        commit = 'a' * 40
        scope, process = self.runner([(0, 'https://github.com/lukasvri/Afterparty-MusicBot.git'),
                                      (0, ''), (0, commit), (0, '')])
        self.assertEqual(scope['select'](), commit)
        self.assertEqual([call.args[0] for call in process.run.call_args_list], [
            ['git','remote','get-url','origin'],
            ['git','fetch','--no-tags','origin','beta-svelte-3','main'],
            ['git','rev-parse','origin/beta-svelte-3'],
            ['git','merge-base','--is-ancestor','origin/main',commit]])

    def test_unapproved_origin_is_still_rejected_before_fetch(self):
        scope, process = self.runner([(0, 'https://example.invalid/repository')])
        with self.assertRaisesRegex(RuntimeError, 'Feil beta-repository'):
            scope['select']()
        self.assertEqual(process.run.call_count, 1)

    def test_unknown_git_wrapper_is_rejected(self):
        source = self.SOURCE.replace(" if r.returncode:raise BuildError('Betaens GitHub-kilde kunne ikke bekreftes.')", " if r.returncode:raise RuntimeError('different wrapper')")
        with self.assertRaisesRegex(ValueError, 'Unsupported beta runner Git check'):
            patch_runner(source)

class AdminRetryPatch(unittest.TestCase):
    def test_known_model_patch_is_idempotent_and_rejects_unknown_source(self):
        from install import patch_admin_retry
        source = 'import { projectProgress } from "./model.mjs";\n  const failed =\n    !busy && state.failed;\n    message: upToDate\n'
        result = patch_admin_retry(source)
        self.assertEqual(patch_admin_retry(result), result)
        self.assertIn('canRetryProduction(state, now)', result)
        self.assertIn('!busy && !recovered &&', result)
        with self.assertRaises(ValueError): patch_admin_retry('unknown')
