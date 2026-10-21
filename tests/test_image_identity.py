"""Bind Docker's classic and containerd IDs to the same signed archive."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('identity_fixtures',Path(__file__).with_name('test_release_artifacts.py'))
fixtures=importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
artifacts=fixtures.artifacts


class Identity(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.Bundle('test_valid_bundle_checks_exact_ci_and_downloads_both_outputs')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.config=json.dumps({'os':'linux','architecture':'amd64','config':{
            'User':'node','Labels':{'org.opencontainers.image.revision':fixtures.COMMIT}}}).encode()
        self.config_id='sha256:'+hashlib.sha256(self.config).hexdigest()
        self.config_path='blobs/sha256/'+self.config_id[7:]
        layer=b'synthetic layer'
        self.layer_id='sha256:'+hashlib.sha256(layer).hexdigest()
        self.layer_path='blobs/sha256/'+self.layer_id[7:]
        self.oci={'schemaVersion':2,'mediaType':'application/vnd.oci.image.manifest.v1+json',
                  'config':{'mediaType':'application/vnd.oci.image.config.v1+json','digest':self.config_id,'size':len(self.config)},
                  'layers':[{'digest':self.layer_id,'size':len(layer),'mediaType':'application/vnd.oci.image.layer.v1.tar'}]}
        raw=json.dumps(self.oci).encode()
        self.oci_id='sha256:'+hashlib.sha256(raw).hexdigest()
        self.oci_path='blobs/sha256/'+self.oci_id[7:]
        self.index={'schemaVersion':2,'mediaType':'application/vnd.oci.image.index.v1+json',
                    'manifests':[{'mediaType':self.oci['mediaType'],'digest':self.oci_id,'size':len(raw)}]}
        self.files={'manifest.json':json.dumps([{'RepoTags':[fixtures.TAG],'Config':self.config_path,'Layers':[self.layer_path]}]),
                    'oci-layout':json.dumps({'imageLayoutVersion':'1.0.0'}),
                    'index.json':json.dumps(self.index),self.oci_path:raw,self.config_path:self.config,self.layer_path:layer}
        self.path=self.fixture.root/'identity.tar.gz'
        self.manifest={**self.fixture.manifest,'image_id':self.config_id}

    def write(self):
        fixtures.archive(self.path,self.files)

    def test_classic_config_manifest_and_index_ids_are_proven_equivalent(self):
        self.write()
        expected={self.config_id,self.oci_id,'sha256:'+hashlib.sha256(self.files['index.json'].encode()).hexdigest()}
        for ci_id in expected:
            with self.subTest(ci_id=ci_id):
                self.assertEqual(artifacts.validate_image(self.path,{**self.manifest,'image_id':ci_id}),expected)
        self.assertNotIn('sha256:'+'f'*64,expected)
        with self.assertRaises(artifacts.ReleaseError):
            artifacts.validate_image(self.path,{**self.manifest,'image_id':'sha256:'+'f'*64})

    def test_legacy_save_keeps_its_config_identity(self):
        values=artifacts.validate_image(self.fixture.root/'core-image.tar.gz',self.fixture.manifest)
        self.assertEqual(values,{self.fixture.manifest['image_id']})

    def test_changed_manifest_bytes_or_descriptor_size_cannot_authorize_a_local_id(self):
        self.files[self.oci_path]=json.dumps({**self.oci,'annotations':{'changed':'after hashing'}})
        self.write()
        with self.assertRaises(artifacts.ReleaseError):artifacts.validate_image(self.path,self.manifest)
        self.files[self.oci_path]=json.dumps(self.oci).encode()
        self.index['manifests'][0]['size']+=1
        self.files['index.json']=json.dumps(self.index)
        self.write()
        with self.assertRaises(artifacts.ReleaseError):artifacts.validate_image(self.path,self.manifest)

    def test_self_consistent_manifest_pointing_to_another_config_or_layer_is_rejected(self):
        for change in ({'config':{**self.oci['config'],'digest':'sha256:'+'f'*64}},
                       {'layers':[{**self.oci['layers'][0],'digest':'sha256:'+'e'*64}]},
                       {'layers':[]}):
            raw=json.dumps({**self.oci,**change}).encode()
            value='sha256:'+hashlib.sha256(raw).hexdigest()
            self.files['blobs/sha256/'+value[7:]]=raw
            self.files['index.json']=json.dumps({**self.index,'manifests':[
                {**self.index['manifests'][0],'digest':value,'size':len(raw)}]})
            self.write()
            with self.assertRaises(artifacts.ReleaseError):artifacts.validate_image(self.path,self.manifest)

    def test_ambiguous_multi_image_index_is_rejected(self):
        self.index['manifests']*=2
        self.files['index.json']=json.dumps(self.index)
        self.write()
        with self.assertRaises(artifacts.ReleaseError):artifacts.validate_image(self.path,self.manifest)

    def test_deployer_uses_the_derived_local_id_and_records_both_identities(self):
        root=self.fixture.root/'deploy';root.mkdir()
        source=root/'source';source.mkdir();(source/'package.json').write_text(json.dumps({'version':self.manifest['version']}))
        cache=root/'release-cache'/fixtures.COMMIT;cache.mkdir(parents=True)
        dep=fixtures.deployer.Deployer({k:str(root) for k in ('repo','compose_file','data_dir','state_dir','backup_dir')})
        dep.target=fixtures.COMMIT;dep.emit=lambda *a:None
        events=[]
        dep.command=lambda args,**kw:(events.append(args) or self.oci_id) if 'inspect' in args else events.append(args)
        verified={**self.manifest,'verified_image_ids':[self.config_id,self.oci_id]}
        class Loader:
            def create_module(self,spec):return None
            def exec_module(self,module):
                class Client:
                    def fetch(self,*args):return verified
                module.Client=Client;module.digest=lambda *a:'verified-digest'
        with patch.object(importlib.util,'spec_from_file_location',return_value=importlib.util.spec_from_loader('identity-client',Loader())):
            dep._validate_candidate(source)
        proof=json.loads((cache/'verified.json').read_text())
        self.assertEqual(proof['image_id'],self.oci_id)
        self.assertEqual(proof['release_image_id'],self.config_id)
        self.assertTrue(any('run' in args for args in events))
        dep.command=lambda args,**kw:'sha256:'+'f'*64
        with patch.object(importlib.util,'spec_from_file_location',return_value=importlib.util.spec_from_loader('identity-client',Loader())):
            with self.assertRaises(fixtures.deployer.DeployError):dep._validate_candidate(source)


if __name__=='__main__':unittest.main()
