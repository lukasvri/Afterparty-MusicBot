"""Package CI outputs and publish commit-addressed build assets, never production."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tarfile
import urllib.error
import urllib.request

from release_artifacts import REPOSITORY, ASSETS, digest, sha, validate_image, validate_website, verify_provenance


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def core(directory, commit):
    commit = sha(commit)
    tag = 'gutta-krutt-core:git-' + commit
    subprocess.run(['docker','build','--target','final','--label',
                    'org.opencontainers.image.revision='+commit,'-t',tag,'services/core'],check=True)
    image = json.loads(run('docker','image','inspect',tag))[0]
    # Never start the bot or connect to Discord. Check only runtime readability/imports.
    smoke = """import {readdirSync,readFileSync} from 'node:fs';
if(process.getuid()===0)throw Error('Runtime must be unprivileged');
function check(d){for(const e of readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;if(e.isDirectory())check(p);else if(e.isFile())readFileSync(p);}}
check('/app/src');await import('/app/src/data-import.ts');"""
    subprocess.run(['docker','run','--rm','--network','none','--read-only','--cpus=1',
                    '--memory=256m','--memory-swap=256m','--pids-limit=64','--entrypoint',
                    'node',tag,'--input-type=module','-e',smoke],check=True)
    raw = directory / 'core-image.tar'
    subprocess.run(['docker','save','-o',str(raw),tag],check=True)
    import gzip
    import shutil
    with raw.open('rb') as source, (directory/'core-image.tar.gz').open('wb') as output:
        with gzip.GzipFile(fileobj=output, mode='wb', mtime=0) as compressed:
            shutil.copyfileobj(source,compressed)
    raw.unlink()
    metadata = {'commit':commit,'image_tag':tag,'image_id':image['Id'],'platform':'linux/amd64'}
    validate_image(directory/'core-image.tar.gz',metadata)
    (directory/'core.json').write_text(json.dumps(metadata)+'\n')


def website(directory):
    # This is the exact output of the website job's single successful build.
    with tarfile.open(directory/'website.tar.gz','w:gz') as output:
        output.add('dist',arcname='dist')
    validate_website(directory/'website.tar.gz')


def api(path, token, body=None, content_type='application/json', method=None):
    data = json.dumps(body).encode() if isinstance(body,dict) else body
    url = path if path.startswith('https://uploads.github.com/') else 'https://api.github.com/repos/'+REPOSITORY+path
    request = urllib.request.Request(url,data=data,method=method,
        headers={'Accept':'application/vnd.github+json','Content-Type':content_type,
                 'Authorization':'Bearer '+token,'User-Agent':'Afterparty-CI',
                 'X-GitHub-Api-Version':'2022-11-28'})
    with urllib.request.urlopen(request,timeout=180) as response:
        return json.load(response)


def prepare(directory, commit):
    commit = sha(commit)
    if (os.environ.get('GITHUB_REPOSITORY') != REPOSITORY or
            os.environ.get('GITHUB_EVENT_NAME') != 'push' or
            os.environ.get('GITHUB_REF') != 'refs/heads/main' or
            os.environ.get('GITHUB_SHA') != commit):
        raise RuntimeError('Build publication is restricted to the canonical main push')
    metadata = json.loads((directory/'core.json').read_text())
    if metadata['commit'] != commit:
        raise RuntimeError('Core build commit differs')
    validate_image(directory/'core-image.tar.gz',metadata)
    validate_website(directory/'website.tar.gz')
    manifest = {**metadata,'schema':1,'repository':REPOSITORY,
                'version':json.loads(Path('package.json').read_text())['version'],
                'run_id':int(os.environ['GITHUB_RUN_ID']),
                'run_attempt':int(os.environ['GITHUB_RUN_ATTEMPT']),
                'files':{name:{'sha256':digest(directory/name),'size':(directory/name).stat().st_size}
                         for name in ['core-image.tar.gz','website.tar.gz']}}
    (directory/'release.json').write_text(json.dumps(manifest,indent=2)+'\n')


def publish(directory, commit):
    # Recreate and compare the manifest so publication cannot change signed bytes.
    signed_manifest = (directory / 'release.json').read_bytes()
    prepare(directory, commit)
    if (directory / 'release.json').read_bytes() != signed_manifest:
        raise RuntimeError('Release manifest changed after signing')
    manifest = json.loads(signed_manifest)
    assets = {name: {'digest': 'sha256:' + digest(directory/name)} for name in ASSETS}
    verify_provenance(directory, commit, int(os.environ['GITHUB_RUN_ID']),
                      int(os.environ['GITHUB_RUN_ATTEMPT']), assets)
    token = os.environ['GH_TOKEN']  # Supplied only to this CI job by GitHub.
    tag = 'build-'+commit
    try:
        previous = api('/releases/tags/'+tag,token)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        previous = None
    if previous:
        raise RuntimeError('An existing build release requires manual review; never adopt or overwrite it')
    release = api('/releases',token,{'tag_name':tag,'target_commitish':commit,
                  'name':'Tested build '+commit[:12],'draft':True,'prerelease':True,
                  'make_latest':'false','body':'CI build assets only. No production deployment.\nWorkflow run: https://github.com/'+REPOSITORY+'/actions/runs/'+str(manifest['run_id'])})
    # Streaming HTTP prevents a large Docker archive from being buffered in RAM.
    import http.client
    from urllib.parse import urlsplit, quote
    upload = release['upload_url'].split('{',1)[0]
    for name in sorted(ASSETS):
        url = urlsplit(upload+'?name='+quote(name))
        if url.hostname != 'uploads.github.com' or url.scheme != 'https':
            raise RuntimeError('Unexpected GitHub upload endpoint')
        target = directory/name
        connection = http.client.HTTPSConnection(url.hostname,timeout=180)
        connection.putrequest('POST',url.path+'?'+url.query)
        connection.putheader('Authorization','Bearer '+token)
        connection.putheader('Content-Type','application/octet-stream')
        connection.putheader('Content-Length',str(target.stat().st_size))
        connection.putheader('User-Agent','Afterparty-CI')
        connection.endheaders()
        with target.open('rb') as stream:
            while chunk:=stream.read(1024*1024):
                connection.send(chunk)
        response=connection.getresponse()
        data=json.loads(response.read())
        connection.close()
        if response.status != 201 or data.get('digest') != 'sha256:'+digest(target):
            raise RuntimeError('GitHub did not confirm the uploaded asset checksum')
    api('/releases/'+str(release['id']),token,{'draft':False,'make_latest':'false'},method='PATCH')


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('operation',choices=['core','website','prepare','publish'])
    parser.add_argument('--directory',type=Path,default=Path('release-assets'))
    parser.add_argument('--commit',default=os.environ.get('GITHUB_SHA'))
    args=parser.parse_args()
    args.directory.mkdir(parents=True,exist_ok=True)
    if args.operation=='core':
        core(args.directory,args.commit)
    elif args.operation=='website':
        website(args.directory)
    elif args.operation=='prepare':
        prepare(args.directory,args.commit)
    else:
        publish(args.directory,args.commit)
