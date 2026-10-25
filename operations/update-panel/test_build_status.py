import unittest
from build_status import blocked_build

COMMIT = 'a' * 40

class Client:
    def __init__(self, **values):
        self.run = dict(id=1, head_sha=COMMIT, head_branch='main', event='push',
                        path='.github/workflows/core.yml', head_repository={'full_name':'lukasvri/Afterparty-MusicBot'}, **values)
    def get(self, path):
        assert path.startswith('/actions/workflows/core.yml/runs?')
        return {'workflow_runs':[self.run]}

class BuildStatus(unittest.TestCase):
    def test_pending_failed_and_successful_runs_remain_blocked(self):
        for status, conclusion, expected in [('in_progress',None,'pending'),('completed','failure','failed'),('completed','success','unverified')]:
            result=blocked_build(Client(status=status,conclusion=conclusion),COMMIT)
            self.assertFalse(result['ready'])
            self.assertEqual(result['state'],expected)
            self.assertEqual(result['run_url'],'https://github.com/lukasvri/Afterparty-MusicBot/actions/runs/1')
    def test_foreign_or_missing_provenance_cannot_claim_ci_result(self):
        for key, value in [('head_sha','b'*40),('event','pull_request'),('head_branch','beta'),('head_repository',{'full_name':'other/repo'}),('path','foreign.yml')]:
            client=Client(status='completed',conclusion='success');client.run[key]=value
            result=blocked_build(client,COMMIT);self.assertEqual(result['state'],'missing');self.assertFalse(result['ready'])
    def test_invalid_commit_and_raw_errors_are_never_exposed(self):
        class Broken:
            def get(self,path): raise RuntimeError('private token')
        for commit in [COMMIT,None,'bad']:
            result=blocked_build(Broken(),commit)
            self.assertFalse(result['ready']);self.assertNotIn('private',str(result))

class InstallDiagnostic(unittest.TestCase):
    def test_features_patch_is_idempotent_and_rejects_unknown_code(self):
        from install import patch_features
        fallback="                    build = {'ready': False, 'message': 'Det testede GitHub-bygget er ikke klart eller kunne ikke verifiseres. Oppdatering er blokkert til bygget er godkjent.'}"
        patched=patch_features(fallback)
        self.assertEqual(patch_features(patched),patched)
        self.assertIn('blocked_build(self.release_client(), commit)',patched)
        with self.assertRaises(ValueError): patch_features('unknown')

if __name__ == '__main__': unittest.main()
