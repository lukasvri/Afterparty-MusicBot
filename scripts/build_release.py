"""Package CI outputs and publish commit-addressed build assets, never production."""
import argparse
import http.client
import json
import os
from pathlib import Path
import subprocess
import tarfile
import time
import urllib.error
import urllib.request
from urllib.parse import quote, urlsplit

from release_artifacts import REPOSITORY, ASSETS, digest, sha, validate_image, validate_website, verify_provenance


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def core(directory, commit):
    commit = sha(commit)
    tag = 'gutta-krutt-core:git-' + commit
    subprocess.run(['docker','build','--target','final','--label',
                    'org.opencontainers.image.revision='+commit,'-t',tag,'services/core'],check=True)
    package_core(directory, commit)


def probe_core(commit):
    """Verify the loaded final image without archiving it or starting the bot."""
    commit = sha(commit)
    tag = 'gutta-krutt-core:git-' + commit
    image = json.loads(run('docker','image','inspect',tag))[0]
    # Never start the bot or connect to Discord. Check only runtime readability/imports.
    smoke = """import {readdirSync,readFileSync} from 'node:fs';
if(process.getuid()===0)throw Error('Runtime must be unprivileged');
function check(d){for(const e of readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;if(e.isDirectory())check(p);else if(e.isFile())readFileSync(p);}}
check('/app/src');await import('/app/src/data-import.ts');"""
    subprocess.run(['docker','run','--rm','--network','none','--read-only','--cpus=1',
                    '--memory=256m','--memory-swap=256m','--pids-limit=64','--entrypoint',
                    'node',tag,'--input-type=module','-e',smoke],check=True)
    return {'commit':commit,'image_tag':tag,'image_id':image['Id'],'platform':'linux/amd64'}


def package_core(directory, commit):
    """Probe and save the exact loaded image, including CI's cached Buildx output."""
    metadata = probe_core(commit)
    tag = metadata['image_tag']
    raw = directory / 'core-image.tar'
    subprocess.run(['docker','save','-o',str(raw),tag],check=True)
    import gzip
    import shutil
    with raw.open('rb') as source, (directory/'core-image.tar.gz').open('wb') as output:
        # CI prioritizes packaging time; signed digests cover the resulting bytes.
        with gzip.GzipFile(fileobj=output, mode='wb', compresslevel=1, mtime=0) as compressed:
            shutil.copyfileobj(source,compressed)
    raw.unlink()
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
        return None if response.status == 204 else json.load(response)


def prepare(directory, commit):
    commit = sha(commit)
    if (os.environ.get('GITHUB_REPOSITORY') != REPOSITORY or
            os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch' or
            os.environ.get('AFTERPARTY_PUBLISH_BUILD') != 'true' or
            os.environ.get('GITHUB_REF') != 'refs/heads/main' or
            os.environ.get('GITHUB_SHA') != commit):
        raise RuntimeError('Build publication requires an explicit dispatch on canonical main')
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


def send_asset(url, token, target, size):
    # Stream large archives without reading the whole file into RAM.
    connection = http.client.HTTPSConnection(url.hostname, timeout=180)
    try:
        connection.putrequest('POST', url.path+'?'+url.query)
        connection.putheader('Authorization', 'Bearer '+token)
        connection.putheader('Content-Type', 'application/octet-stream')
        connection.putheader('Content-Length', str(size))
        connection.putheader('User-Agent', 'Afterparty-CI')
        connection.endheaders()
        with target.open('rb') as stream:
            while chunk := stream.read(1024*1024):
                connection.send(chunk)
        response = connection.getresponse()
        return response.status, json.load(response) if response.status == 201 else None
    finally:
        connection.close()


def upload_asset(release, token, target, expected_digest):
    release_path = '/releases/'+str(release['id'])
    upload = release['upload_url'].split('{', 1)[0]
    url = urlsplit(upload+'?name='+quote(target.name))
    if url.netloc != 'uploads.github.com' or url.scheme != 'https':
        raise RuntimeError('Unexpected GitHub upload endpoint')
    size = target.stat().st_size

    def matches(asset):
        return (asset.get('name') == target.name and asset.get('state') == 'uploaded'
                and asset.get('size') == size and asset.get('digest') == expected_digest)

    for attempt in range(1, 4):
        try:
            status, asset = send_asset(url, token, target, size)
        except (ConnectionError, TimeoutError, http.client.IncompleteRead):
            status = None
        if status == 201 and matches(asset):
            return
        if status not in (None, 422, 502, 503, 504):
            raise RuntimeError(f'GitHub did not confirm {target.name} (HTTP {status})')

        # The server may have stored the file before the response was lost.
        draft = api(release_path, token)
        if (draft.get('draft') is not True or draft.get('tag_name') != release['tag_name']
                or draft.get('target_commitish') != release['target_commitish']):
            raise RuntimeError('Build draft changed during upload')
        existing = [asset for asset in draft['assets'] if asset['name'] == target.name]
        if len(existing) == 1 and matches(existing[0]):
            return
        if status == 422 or attempt == 3:
            raise RuntimeError(f'Could not confirm upload of {target.name} (HTTP {status})')
        if existing:
            if len(existing) != 1 or existing[0]['state'] != 'starter' or existing[0]['size'] != 0:
                raise RuntimeError(f'Build draft has an unexpected asset named {target.name}')
            # GitHub can leave an empty starter asset after an upstream failure.
            api('/releases/assets/'+str(existing[0]['id']), token, method='DELETE')
        reason = 'connection interrupted' if status is None else f'HTTP {status}'
        print(f'Retrying upload of {target.name} after attempt {attempt} ({reason})', flush=True)
        time.sleep(attempt)


def publish(directory, commit):
    # Recreate and compare the manifest so publication cannot change signed bytes.
    signed_manifest = (directory / 'release.json').read_bytes()
    prepare(directory, commit)
    if (directory / 'release.json').read_bytes() != signed_manifest:
        raise RuntimeError('Release manifest changed after signing')
    manifest = json.loads(signed_manifest)
    assets = {name: {'digest': 'sha256:' + digest(directory/name)} for name in ASSETS}
    verify_provenance(directory, commit, int(os.environ['GITHUB_RUN_ID']),
                      int(os.environ['GITHUB_RUN_ATTEMPT']), assets, 'workflow_dispatch')
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
    for name in sorted(ASSETS):
        upload_asset(release, token, directory/name, assets[name]['digest'])
    api('/releases/'+str(release['id']),token,{'draft':False,'make_latest':'false'},method='PATCH')


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('operation',choices=['core','core-probe','core-package','website','prepare','publish'])
    parser.add_argument('--directory',type=Path,default=Path('release-assets'))
    parser.add_argument('--commit',default=os.environ.get('GITHUB_SHA'))
    args=parser.parse_args()
    if args.operation!='core-probe':
        args.directory.mkdir(parents=True,exist_ok=True)
    if args.operation=='core':
        core(args.directory,args.commit)
    elif args.operation=='core-probe':
        print(json.dumps(probe_core(args.commit)))
    elif args.operation=='core-package':
        package_core(args.directory,args.commit)
    elif args.operation=='website':
        website(args.directory)
    elif args.operation=='prepare':
        prepare(args.directory,args.commit)
    else:
        publish(args.directory,args.commit)
