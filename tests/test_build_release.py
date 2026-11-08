import http.client
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import call, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import build_release


class BuildUpload(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.target = Path(directory) / 'website.tar.gz'
        self.target.write_bytes(b'archive')
        self.digest = 'sha256:' + build_release.digest(self.target)
        self.asset = {'id': 12, 'name': self.target.name, 'state': 'uploaded',
                      'size': self.target.stat().st_size, 'digest': self.digest}
        self.release = {'id': 7, 'draft': True, 'tag_name': 'build-' + 'a' * 40,
                        'target_commitish': 'a' * 40, 'assets': [],
                        'upload_url': 'https://uploads.github.com/repos/example/repo/releases/7/assets{?name,label}'}
        self.send = self.enterContext(patch.object(build_release, 'send_asset'))
        self.api = self.enterContext(patch.object(build_release, 'api'))
        self.sleep = self.enterContext(patch.object(build_release.time, 'sleep'))

    def upload(self):
        build_release.upload_asset(self.release, 'fixture-token', self.target, self.digest)

    def test_lost_response_recovers_the_uploaded_asset(self):
        self.send.side_effect = http.client.RemoteDisconnected()
        self.api.return_value = {**self.release, 'assets': [self.asset]}
        self.upload()
        self.api.assert_called_once_with('/releases/7', 'fixture-token')
        self.send.assert_called_once()

    def test_missing_asset_is_retried_after_lost_response(self):
        self.send.side_effect = [http.client.RemoteDisconnected(), (201, self.asset)]
        self.api.return_value = self.release
        self.upload()
        self.assertEqual(self.send.call_count, 2)
        self.sleep.assert_called_once_with(1)

    def test_only_an_empty_starter_in_this_draft_is_removed(self):
        self.send.side_effect = [(502, None), (201, self.asset)]
        starter = {**self.asset, 'state': 'starter', 'size': 0, 'digest': None}
        self.api.side_effect = [{**self.release, 'assets': [starter]}, None]
        self.upload()
        self.assertEqual(self.api.call_args_list, [
            call('/releases/7', 'fixture-token'),
            call('/releases/assets/12', 'fixture-token', method='DELETE'),
        ])

    def test_mismatched_upload_is_left_for_manual_review(self):
        self.send.side_effect = http.client.RemoteDisconnected()
        self.api.return_value = {**self.release, 'assets': [{**self.asset, 'digest': 'different'}]}
        with self.assertRaisesRegex(RuntimeError, 'unexpected asset'):
            self.upload()
        self.api.assert_called_once_with('/releases/7', 'fixture-token')
        self.send.assert_called_once()

    def test_published_release_is_never_modified_on_retry(self):
        self.send.return_value = (502, None)
        self.api.return_value = {**self.release, 'draft': False}
        with self.assertRaisesRegex(RuntimeError, 'draft changed'):
            self.upload()
        self.api.assert_called_once_with('/releases/7', 'fixture-token')
        self.send.assert_called_once()

    def test_retries_are_bounded(self):
        self.send.return_value = (503, None)
        self.api.return_value = self.release
        with self.assertRaisesRegex(RuntimeError, 'Could not confirm upload'):
            self.upload()
        self.assertEqual(self.send.call_count, 3)
        self.assertEqual(self.sleep.call_args_list, [call(1), call(2)])
