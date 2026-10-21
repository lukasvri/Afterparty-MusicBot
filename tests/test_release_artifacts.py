import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SCRIPTS=Path(__file__).parents[1]/'scripts'


def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    result=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


artifacts=module('artifacts_fixture',SCRIPTS/'release_artifacts.py')
deployer=module('artifact_deployer_fixture',SCRIPTS/'deploy-core.py')
limits=module('runtime_limits_fixture',SCRIPTS/'runtime_limits.py')
COMMIT='a'*40
TAG='gutta-krutt-core:git-'+COMMIT


def archive(path,files,extra=None):
    with tarfile.open(path,'w:gz') as output:
        for name,data in files.items():
            raw=data.encode() if isinstance(data,str) else data
            member=tarfile.TarInfo(name)
            member.size=len(raw)
            member.mode=0o644
            output.addfile(member,io.BytesIO(raw))
        if extra:
            output.addfile(extra)


class Bundle(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        config=json.dumps({'os':'linux','architecture':'amd64','config':{'User':'node','Labels':{'org.opencontainers.image.revision':COMMIT}}}).encode()
        image_id='sha256:'+hashlib.sha256(config).hexdigest()
        self.manifest={'schema':1,'repository':artifacts.REPOSITORY,'commit':COMMIT,
            'platform':'linux/amd64','version':'2.4.0-alpha.4','run_id':123,'run_attempt':1,
            'image_tag':TAG,'image_id':image_id}
        archive(self.root/'core-image.tar.gz',{'manifest.json':json.dumps([{'RepoTags':[TAG],'Config':'config.json','Layers':[]}]),'config.json':config})
        self.website={'dist/server/wrangler.json':json.dumps({'main':'index.js'}),
                      'dist/server/index.js':'export default {fetch(){return new Response("fixture")}}',
                      'dist/client/index.css':'body{}',
                      'dist/.openai/hosting.json':json.dumps({'d1':'DB','r2':None})}
        archive(self.root/'website.tar.gz',self.website)
        self.manifest['files']={n:{'sha256':artifacts.digest(self.root/n),'size':(self.root/n).stat().st_size}
                               for n in ('core-image.tar.gz','website.tar.gz')}
        (self.root/'release.json').write_text(json.dumps(self.manifest))
        (self.root/'provenance.json').write_text('{"synthetic_bundle":true}')
        self.assets={n:{'name':n,'state':'uploaded','uploader':{'login':'github-actions[bot]'},'digest':'sha256:'+artifacts.digest(self.root/n),
                       'size':(self.root/n).stat().st_size,'browser_download_url':
                       'https://github.com/'+artifacts.REPOSITORY+'/releases/download/build-'+COMMIT+'/'+n}
                     for n in artifacts.ASSETS}
        self.release={'draft':False,'tag_name':'build-'+COMMIT,'target_commitish':COMMIT,'author':{'login':'github-actions[bot]'},'assets':list(self.assets.values())}
        self.run={'head_sha':COMMIT,'head_branch':'main','event':'push','path':artifacts.WORKFLOW,
                  'status':'completed','conclusion':'success'}
        self.jobs={'total_count':4,'jobs':[{'name':n,'conclusion':'success'} for n in ('core','website','deployer','release')]}
        owner=self
        class Client(artifacts.Client):
            def get(self,path):
                if path.startswith('/releases/'):
                    return owner.release
                if path.startswith('/git/'):
                    return {'object':{'type':'commit','sha':COMMIT}}
                return owner.jobs if '/jobs?' in path else owner.run
            def response(self,url):
                return io.BytesIO((owner.root/url.rsplit('/',1)[-1]).read_bytes())
        self.proof=[{'verificationResult':{'signature':{'certificate':{
            'subjectAlternativeName':'https://github.com/'+artifacts.REPOSITORY+'/'+artifacts.WORKFLOW+'@refs/heads/main',
            'sourceRepositoryURI':'https://github.com/'+artifacts.REPOSITORY,
            'sourceRepositoryRef':'refs/heads/main','sourceRepositoryDigest':COMMIT,
            'buildSignerDigest':COMMIT,'buildTrigger':'push','runnerEnvironment':'github-hosted',
            'runInvocationURI':'https://github.com/'+artifacts.REPOSITORY+'/actions/runs/123/attempts/1'}},
            'statement':{'predicateType':'https://slsa.dev/provenance/v1',
                'subject':[{'name':n,'digest':{'sha256':self.assets[n]['digest'][7:]}} for n in sorted(artifacts.SIGNED_ASSETS)]}}}]
        self.verify_code=0
        self.verifier=self.enterContext(patch.object(artifacts.subprocess,'run',side_effect=lambda *a,**kw:
            SimpleNamespace(returncode=self.verify_code,stdout=json.dumps(self.proof))))
        self.enterContext(patch.object(artifacts.shutil,'which',return_value='/reviewed/gh'))
        self.client=Client()
        self.destination=self.root/'download'

    def test_valid_bundle_checks_exact_ci_and_downloads_both_outputs(self):
        result=self.client.fetch(COMMIT,self.destination)
        self.assertEqual(result['image_id'],self.manifest['image_id'])
        self.assertEqual(artifacts.digest(self.destination/'website.tar.gz'),self.manifest['files']['website.tar.gz']['sha256'])

    def test_ref_qualified_workflow_paths_accept_only_trusted_main(self):
        for path in (artifacts.WORKFLOW, artifacts.WORKFLOW+'@main', artifacts.WORKFLOW+'@refs/heads/main'):
            self.run['path']=path
            self.client.describe(COMMIT,self.destination)
        for path in (artifacts.WORKFLOW+'@feature',artifacts.WORKFLOW+'@refs/pull/98/merge',
                     'other.yml@main',artifacts.WORKFLOW+'@main@evil'):
            self.run['path']=path
            with self.assertRaises(artifacts.ReleaseError):
                self.client.describe(COMMIT,self.destination)

    def test_signed_asset_digests_and_certificate_bind_the_exact_run(self):
        self.client.fetch(COMMIT,self.destination)
        args,kwargs=self.verifier.call_args
        command=args[0]
        for flag,value in (('--source-ref','refs/heads/main'),('--source-digest',COMMIT),
                           ('--signer-digest',COMMIT),('--cert-identity','https://github.com/'+artifacts.REPOSITORY+'/'+artifacts.WORKFLOW+'@refs/heads/main')):
            self.assertEqual(command[command.index(flag)+1],value)
        self.assertIn('--bundle',command)
        self.assertIn('--deny-self-hosted-runners',command)
        self.assertNotIn('GH_TOKEN',kwargs['env'])
        self.assertNotIn('GITHUB_TOKEN',kwargs['env'])
        original=json.loads(json.dumps(self.proof))
        for change in ({'sourceRepositoryRef':'refs/heads/feature'},
                       {'subjectAlternativeName':'https://github.com/other/workflow@refs/heads/main'},
                       {'sourceRepositoryDigest':'b'*40},{'buildSignerDigest':'b'*40},
                       {'runInvocationURI':'https://github.com/'+artifacts.REPOSITORY+'/actions/runs/999/attempts/1'},
                       {'runInvocationURI':'https://github.com/'+artifacts.REPOSITORY+'/actions/runs/123/attempts/2'},
                       {'buildTrigger':'pull_request'},{'runnerEnvironment':'self-hosted'}):
            self.proof=json.loads(json.dumps(original))
            self.proof[0]['verificationResult']['signature']['certificate'].update(change)
            with self.assertRaises(artifacts.ReleaseError):
                self.client.fetch(COMMIT,self.destination)
        self.proof=original
        self.proof[0]['verificationResult']['statement']['subject'][0]['digest']={'sha256':'0'*64}
        with self.assertRaises(artifacts.ReleaseError):
            self.client.describe(COMMIT,self.destination)

    def test_forged_unsigned_missing_or_failed_proof_never_downloads_an_image(self):
        self.verify_code=1
        with self.assertRaises(artifacts.ReleaseError):
            self.client.fetch(COMMIT,self.destination)
        self.assertFalse((self.destination/'core-image.tar.gz').exists())
        self.verify_code=0
        self.proof=[]
        with self.assertRaises(artifacts.ReleaseError):
            self.client.describe(COMMIT,self.destination)
        with patch.object(artifacts.shutil,'which',return_value=None),patch.object(Path,'is_file',return_value=False):
            with self.assertRaisesRegex(artifacts.ReleaseError,'verifier first'):
                self.client.describe(COMMIT,self.destination)
        self.release['assets']=[a for a in self.release['assets'] if a['name']!='provenance.json']
        with self.assertRaises(artifacts.ReleaseError):
            self.client.describe(COMMIT,self.destination)

    def test_no_release_never_falls_back_to_source_build(self):
        with patch.object(self.client,'get',side_effect=artifacts.ReleaseError('No build')):
            with self.assertRaises(artifacts.ReleaseError):
                self.client.fetch(COMMIT,self.destination)
        self.assertFalse((self.destination/'core-image.tar.gz').exists())

    def test_pending_failed_pr_wrong_commit_and_other_workflow_are_rejected(self):
        original=dict(self.run)
        for change in ({'status':'in_progress'},{'conclusion':'failure'},{'event':'pull_request'},
                       {'head_sha':'b'*40},{'head_branch':'other'},{'path':'untrusted.yml'}):
            self.run={**original,**change}
            with self.assertRaises(artifacts.ReleaseError):
                self.client.describe(COMMIT,self.destination)

    def test_missing_skipped_duplicate_and_truncated_job_results_fail_closed(self):
        original=json.loads(json.dumps(self.jobs))
        for jobs in ({'total_count':5,'jobs':original['jobs']},
                     {'total_count':4,'jobs':[{'name':'core','conclusion':'success'}]*4},
                     {'total_count':4,'jobs':[{**j,'conclusion':'skipped'} if j['name']=='website' else j for j in original['jobs']]}):
            self.jobs=jobs
            with self.assertRaises(artifacts.ReleaseError):
                self.client.describe(COMMIT,self.destination)

    def test_release_target_and_duplicate_assets_cannot_substitute_a_build(self):
        self.release['target_commitish']='b'*40
        with self.assertRaises(artifacts.ReleaseError):
            self.client.assets(COMMIT)
        self.release['target_commitish']=COMMIT
        self.release['assets'].append(self.release['assets'][0])
        with self.assertRaises(artifacts.ReleaseError):
            self.client.assets(COMMIT)

    def test_digest_mismatch_or_corrupt_cache_cannot_be_reused(self):
        self.client.fetch(COMMIT,self.destination)
        target=self.destination/'website.tar.gz'
        target.write_bytes(b'corrupt')
        self.client.fetch(COMMIT,self.destination)
        self.assertEqual(artifacts.digest(target),self.manifest['files']['website.tar.gz']['sha256'])
        self.assets['core-image.tar.gz']['digest']='sha256:'+'0'*64
        with self.assertRaises(artifacts.ReleaseError):
            self.client.fetch(COMMIT,self.destination)

    def test_foreign_download_origin_and_unknown_digest_are_rejected(self):
        for change in ({'browser_download_url':'https://example.test/payload'},{'digest':None},
                       {'uploader':{'login':'unverified-writer'}}):
            original=dict(self.assets['release.json'])
            self.assets['release.json'].update(change)
            with self.assertRaises(artifacts.ReleaseError):
                self.client.assets(COMMIT)
            self.assets['release.json'].update(original)

    def test_extra_image_tag_wrong_user_and_wrong_image_id_are_rejected(self):
        manifest={**self.manifest,'image_id':'sha256:'+'0'*64}
        with self.assertRaises(artifacts.ReleaseError):
            artifacts.validate_image(self.root/'core-image.tar.gz',manifest)
        manifest={**self.manifest,'image_tag':'production:latest'}
        with self.assertRaises(artifacts.ReleaseError):
            artifacts.validate_image(self.root/'core-image.tar.gz',manifest)

    def test_website_traversal_symlink_private_paths_and_worker_escape_are_rejected(self):
        for extra in ({'../escaped':'bad'},{'dist/.env':'secret'},{'dist/node_modules/private':'bad'},
                      {'dist/server/wrangler.json':json.dumps({'main':'../../outside.js'})}):
            archive(self.root/'bad.tar.gz',{**self.website,**extra})
            with self.assertRaises(artifacts.ReleaseError):
                artifacts.validate_website(self.root/'bad.tar.gz')
        link=tarfile.TarInfo('dist/link')
        link.type=tarfile.SYMTYPE
        link.linkname='/etc'
        archive(self.root/'bad.tar.gz',self.website,extra=link)
        with self.assertRaises(artifacts.ReleaseError):
            artifacts.validate_website(self.root/'bad.tar.gz')

    def test_identity_binding_does_not_rebuild_or_modify_compiled_bytes(self):
        destination=self.root/'site'
        (destination/'.openai').mkdir(parents=True)
        (destination/'.openai/hosting.json').write_text(json.dumps({'d1':'DB','r2':None}))
        artifacts.install_website(self.root/'website.tar.gz',destination,'synthetic-project')
        self.assertEqual((destination/'dist/server/index.js').read_text(),self.website['dist/server/index.js'])
        artifacts.verify_website_directory(self.root/'website.tar.gz',destination,'synthetic-project')
        (destination/'dist/server/index.js').write_text('modified after CI')
        with self.assertRaises(artifacts.ReleaseError):
            artifacts.verify_website_directory(self.root/'website.tar.gz',destination,'synthetic-project')
        self.assertEqual(json.loads((destination/'dist/.openai/hosting.json').read_text())['project_id'],'synthetic-project')
        with self.assertRaises(artifacts.ReleaseError):
            artifacts.install_website(self.root/'website.tar.gz',destination,'synthetic-project')

    def test_consumer_imports_and_probes_instead_of_building_or_testing_source(self):
        state=self.root/'state'
        state.mkdir()
        source=self.root/'source'
        source.mkdir()
        (source/'package.json').write_text(json.dumps({'version':self.manifest['version']}))
        dep=deployer.Deployer({k:str(state) for k in ('repo','compose_file','data_dir','state_dir','backup_dir')})
        dep.target=COMMIT
        (state/'release-cache'/COMMIT).mkdir(parents=True)
        events=[]
        dep.emit=lambda message:events.append(message)
        calls=[]
        def command(args,**kwargs):
            calls.append(args)
            return self.manifest['image_id'] if 'inspect' in args else ''
        class Context:
            def wrap(self,args):
                return args
        with patch.object(deployer,'validation_resources',return_value=contextlib.nullcontext(Context())), patch.object(dep,'command',side_effect=command), patch.object(artifacts.Client,'fetch',return_value={**self.manifest,'verified_image_ids':[self.manifest['image_id']]}), patch.object(artifacts,'digest',return_value='fixture'):
            # The deployer imports its sibling module, so substitute the module loader.
            class Loader:
                def create_module(self,spec):
                    return None
                def exec_module(self,result):
                    result.Client=artifacts.Client
                    result.digest=artifacts.digest
            with patch.object(importlib.util,'spec_from_file_location',return_value=importlib.util.spec_from_loader('fixture',Loader())):
                dep.validate(source)
        flat=json.dumps(calls)
        self.assertIn('"load"',flat)
        self.assertIn('"run"',flat)
        self.assertNotIn('"build"',flat)
        self.assertNotIn('npm',flat)
        self.assertEqual(dep.new_image_id,self.manifest['image_id'])


class RuntimePolicy(unittest.TestCase):
    def test_low_memory_never_starts_docker(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(limits,'available_mib',return_value=1000), patch.object(limits,'docker',side_effect=AssertionError('Docker started')):
            with self.assertRaisesRegex(RuntimeError,'1024 MiB required'):
                with limits.RuntimeSession({'state_dir':tmp}):
                    pass

    def test_production_mutations_and_foreign_archive_load_are_forbidden(self):
        with tempfile.TemporaryDirectory() as tmp:
            session=limits.RuntimeSession({'state_dir':tmp})
            for command in (['stop','gutta-krutt-core'],['compose','up','-d'],['image','rm','production'],['load','--input','/tmp/untrusted.tar']):
                with self.assertRaises(RuntimeError):
                    session.wrap(['docker','--context','default',*command])


class CIProducer(unittest.TestCase):
    def setUp(self):
        self.fixture=Bundle('test_valid_bundle_checks_exact_ci_and_downloads_both_outputs')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        with patch.dict(sys.modules,{'release_artifacts':artifacts}):
            self.producer=module('ci_producer_fixture',SCRIPTS/'build_release.py')

    def test_pr_and_fork_can_never_publish_release_assets(self):
        for values in ({'GITHUB_REPOSITORY':artifacts.REPOSITORY,'GITHUB_EVENT_NAME':'pull_request',
                        'GITHUB_REF':'refs/pull/1/merge','GITHUB_SHA':COMMIT},
                       {'GITHUB_REPOSITORY':'example/fork','GITHUB_EVENT_NAME':'push',
                        'GITHUB_REF':'refs/heads/main','GITHUB_SHA':COMMIT}):
            with patch.dict(os.environ,values,clear=True),patch.object(self.producer,'api') as api:
                with self.assertRaises(RuntimeError):
                    self.producer.publish(self.fixture.root,COMMIT)
                api.assert_not_called()

    @contextlib.contextmanager
    def prepared_main_release(self):
        root=self.fixture.root
        metadata={key:self.fixture.manifest[key] for key in ('commit','image_tag','image_id','platform')}
        (root/'core.json').write_text(json.dumps(metadata))
        values={'GITHUB_REPOSITORY':artifacts.REPOSITORY,'GITHUB_EVENT_NAME':'push',
                'GITHUB_REF':'refs/heads/main','GITHUB_SHA':COMMIT,
                'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','GH_TOKEN':'synthetic-ci-token'}
        with patch.dict(os.environ,values,clear=True):
            self.producer.prepare(root,COMMIT)
            yield root

    def test_signed_release_uploads_exact_assets_before_becoming_public(self):
        import urllib.parse
        events=[]
        uploads={}
        owner=self
        def verify(directory,commit,run_id,attempt,assets):
            owner.assertEqual((commit,run_id,attempt),(COMMIT,123,1))
            owner.assertEqual(set(assets),artifacts.ASSETS)
            events.append('verified')
        def api(path,token,body=None,**kwargs):
            owner.assertEqual(token,'synthetic-ci-token')
            if path.startswith('/releases/tags/'):
                owner.assertEqual(events,['verified'])
                raise self.producer.urllib.error.HTTPError(path,404,'not found',{},None)
            if path=='/releases':
                owner.assertEqual(body['target_commitish'],COMMIT)
                owner.assertTrue(body['draft'])
                owner.assertIn('/actions/runs/123',body['body'])
                events.append('draft')
                return {'id':456,'upload_url':'https://uploads.github.com/repos/example/releases/456/assets{?name,label}'}
            owner.assertEqual(path,'/releases/456')
            owner.assertEqual(kwargs,{'method':'PATCH'})
            owner.assertEqual(body,{'draft':False,'make_latest':'false'})
            owner.assertEqual(set(uploads),artifacts.ASSETS)
            events.append('published')
        class Connection:
            def __init__(self,hostname,timeout):
                owner.assertEqual(hostname,'uploads.github.com')
                self.content=bytearray()
                self.headers={}
            def putrequest(self,method,path):
                owner.assertEqual(method,'POST')
                self.name=urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)['name'][0]
            def putheader(self,name,value):
                self.headers[name]=value
            def endheaders(self):
                owner.assertEqual(self.headers['Authorization'],'Bearer synthetic-ci-token')
            def send(self,chunk):
                self.content.extend(chunk)
            def getresponse(self):
                owner.assertEqual(int(self.headers['Content-Length']),len(self.content))
                uploads[self.name]=bytes(self.content)
                events.append('upload:'+self.name)
                return SimpleNamespace(status=201,read=lambda:json.dumps(
                    {'digest':'sha256:'+hashlib.sha256(self.content).hexdigest()}).encode())
            def close(self):
                pass
        with self.prepared_main_release() as root:
            signed_manifest=(root/'release.json').read_bytes()
            with patch.object(self.producer,'verify_provenance',side_effect=verify), \
                    patch.object(self.producer,'api',side_effect=api), \
                    patch('http.client.HTTPSConnection',Connection):
                self.producer.publish(root,COMMIT)
            self.assertEqual((root/'release.json').read_bytes(),signed_manifest)
            self.assertEqual(uploads,{name:(root/name).read_bytes() for name in artifacts.ASSETS})
        self.assertEqual(events,['verified','draft',
                                *['upload:'+name for name in sorted(artifacts.ASSETS)],'published'])

    def test_existing_release_is_never_adopted_overwritten_or_republished(self):
        with self.prepared_main_release() as root:
            for existing in ({'draft':False,'target_commitish':COMMIT},
                             {'draft':True,'target_commitish':COMMIT},
                             {'draft':False,'target_commitish':'b'*40}):
                with self.subTest(existing=existing), \
                        patch.object(self.producer,'verify_provenance') as verify, \
                        patch.object(self.producer,'api',return_value=existing) as api, \
                        patch('http.client.HTTPSConnection') as upload:
                    with self.assertRaisesRegex(RuntimeError,'never adopt or overwrite'):
                        self.producer.publish(root,COMMIT)
                    verify.assert_called_once()
                    api.assert_called_once_with('/releases/tags/build-'+COMMIT,'synthetic-ci-token')
                    upload.assert_not_called()

    def test_core_is_built_once_and_that_exact_final_image_is_saved(self):
        import gzip
        output=self.fixture.root/'producer'
        output.mkdir()
        def command(args,**kwargs):
            if args[:2]==['docker','save']:
                with gzip.open(self.fixture.root/'core-image.tar.gz','rb') as stream:
                    Path(args[args.index('-o')+1]).write_bytes(stream.read())
        with patch.object(self.producer.subprocess,'run',side_effect=command) as calls,patch.object(self.producer,'run',return_value=json.dumps([{'Id':self.fixture.manifest['image_id']}])):
            self.producer.core(output,COMMIT)
        builds=[call.args[0] for call in calls.call_args_list if call.args[0][:2]==['docker','build']]
        self.assertEqual(len(builds),1)
        self.assertIn('final',builds[0])
        metadata=json.loads((output/'core.json').read_text())
        artifacts.validate_image(output/'core-image.tar.gz',metadata)


if __name__=='__main__':
    unittest.main()
