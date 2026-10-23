import io
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
