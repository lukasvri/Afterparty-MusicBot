"""Read verified, commit-addressed CI builds. No build or deployment fallback."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import urllib.error
import urllib.request
from urllib.parse import urlsplit

REPOSITORY = 'lukasvri/Afterparty-MusicBot'
WORKFLOW = '.github/workflows/core.yml'
ASSETS = {'release.json', 'core-image.tar.gz', 'website.tar.gz'}
MAX_JSON = 2 * 1024 * 1024
MAX_ASSET = 2 * 1024 * 1024 * 1024


class ReleaseError(RuntimeError):
    pass


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def sha(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{40}', value):
        raise ReleaseError('Invalid release commit')
    return value


def safe_members(archive, limit=8 * 1024**3):
    members, seen, size = [], set(), 0
    for item in archive:
        path = PurePosixPath(item.name)
        key = str(path)
        if (path.is_absolute() or '..' in path.parts or key in seen or
                not (item.isfile() or item.isdir()) or len(members) >= 20000):
            raise ReleaseError('Unsafe or duplicated archive entry')
        seen.add(key)
        size += item.size
        if size > limit:
            raise ReleaseError('Archive exceeds expanded size limit')
        members.append(item)
    return members


def read_member(archive, name, maximum=MAX_JSON):
    item = archive.getmember(name)
    if not item.isfile() or item.size > maximum:
        raise ReleaseError('Invalid archive metadata')
    with archive.extractfile(item) as stream:
        return stream.read()


class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        parsed = urlsplit(newurl)
        if parsed.scheme != 'https' or parsed.hostname not in (
                'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'):
            raise ReleaseError('Unexpected artifact redirect')
        return super().redirect_request(request, fp, code, message, headers, newurl)


class Client:
    def __init__(self, repository=REPOSITORY):
        if repository != REPOSITORY:
            raise ReleaseError('Only the canonical repository is trusted')
        self.repository = repository
        self.api = 'https://api.github.com/repos/' + repository

    def response(self, url):
        return urllib.request.build_opener(Redirects()).open(
            urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json',
                'User-Agent': 'Afterparty-tested-builds', 'X-GitHub-Api-Version': '2022-11-28'}), timeout=45)

    def get(self, path):
        try:
            with self.response(self.api + path) as response:
                raw = response.read(MAX_JSON + 1)
            if len(raw) > MAX_JSON:
                raise ReleaseError('GitHub metadata exceeds limit')
            return json.loads(raw)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise ReleaseError('No tested GitHub build is available for this commit') from None
            raise ReleaseError('GitHub metadata is unavailable (HTTP ' + str(error.code) + ')') from None
        except (OSError, ValueError):
            raise ReleaseError('GitHub metadata could not be verified') from None

    def assets(self, commit):
        commit = sha(commit)
        release = self.get('/releases/tags/build-' + commit)
        if (release.get('draft') is not False or release.get('tag_name') != 'build-' + commit or
                release.get('target_commitish') != commit or
                release.get('author', {}).get('login') != 'github-actions[bot]'):
            raise ReleaseError('Release is not bound to the exact commit')
        tag = self.get('/git/ref/tags/build-' + commit).get('object', {})
        if tag.get('type') != 'commit' or tag.get('sha') != commit:
            raise ReleaseError('Build tag does not point to the exact commit')
        assets = release.get('assets', [])
        if {a.get('name') for a in assets} != ASSETS or len(assets) != len(ASSETS):
            raise ReleaseError('Release has missing or duplicate assets')
        result = {}
        for asset in assets:
            name = asset['name']
            expected = 'https://github.com/' + self.repository + '/releases/download/build-' + commit + '/' + name
            maximum = MAX_JSON if name == 'release.json' else MAX_ASSET
            if (asset.get('state') != 'uploaded' or asset.get('browser_download_url') != expected or
                    asset.get('uploader', {}).get('login') != 'github-actions[bot]' or
                    type(asset.get('size')) is not int or not 0 < asset['size'] <= maximum or
                    not re.fullmatch(r'sha256:[0-9a-f]{64}', asset.get('digest') or '')):
                raise ReleaseError('Invalid release asset metadata')
            result[name] = asset
        return result

    def download(self, asset, destination):
        destination = Path(destination)
        temporary = destination.with_suffix(destination.suffix + '.partial')
        try:
            size, hasher = 0, hashlib.sha256()
            with self.response(asset['browser_download_url']) as response, temporary.open('wb') as output:
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > asset['size']:
                        raise ReleaseError('Artifact exceeds declared size')
                    hasher.update(chunk)
                    output.write(chunk)
            if size != asset['size'] or 'sha256:' + hasher.hexdigest() != asset['digest']:
                raise ReleaseError('Artifact size or checksum differs')
            temporary.chmod(0o600)
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)

    def describe(self, commit, directory):
        commit = sha(commit)
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        assets = self.assets(commit)
        self.download(assets['release.json'], directory / 'release.json')
        manifest = json.loads((directory / 'release.json').read_text())
        if (manifest.get('schema') != 1 or manifest.get('repository') != self.repository or
                manifest.get('commit') != commit or manifest.get('platform') != 'linux/amd64'):
            raise ReleaseError('Release manifest identity or platform differs')
        run_id, attempt = manifest.get('run_id'), manifest.get('run_attempt')
        if type(run_id) is not int or run_id <= 0 or type(attempt) is not int or attempt <= 0:
            raise ReleaseError('Missing workflow provenance')
        run = self.get('/actions/runs/' + str(run_id))
        if (run.get('head_sha') != commit or run.get('head_branch') != 'main' or
                run.get('event') != 'push' or run.get('path') != WORKFLOW or
                run.get('status') != 'completed' or run.get('conclusion') != 'success'):
            raise ReleaseError('Exact main commit has not passed the release workflow')
        jobs = self.get('/actions/runs/' + str(run_id) + '/attempts/' + str(attempt) + '/jobs?per_page=100')
        rows = jobs.get('jobs', [])
        if jobs.get('total_count') != len(rows) or len({j.get('name') for j in rows}) != len(rows):
            raise ReleaseError('Incomplete or ambiguous workflow job coverage')
        indexed = {j.get('name'): j for j in rows}
        for name in ('deployer', 'core', 'website', 'release'):
            if indexed.get(name, {}).get('conclusion') != 'success':
                raise ReleaseError('Required CI job did not succeed: ' + name)
        for name in ('core-image.tar.gz', 'website.tar.gz'):
            recorded = manifest.get('files', {}).get(name, {})
            asset = assets[name]
            if recorded != {'sha256': asset['digest'][7:], 'size': asset['size']}:
                raise ReleaseError('Manifest and GitHub asset checksums differ')
        expected_tag = 'gutta-krutt-core:git-' + commit
        if (manifest.get('image_tag') != expected_tag or
                not re.fullmatch(r'sha256:[0-9a-f]{64}', manifest.get('image_id') or '')):
            raise ReleaseError('Invalid production image identity')
        return manifest, assets

    def fetch(self, commit, directory):
        directory = Path(directory)
        manifest, assets = self.describe(commit, directory)
        total = sum(a['size'] for a in assets.values())
        if shutil.disk_usage(directory).free < total + 512 * 1024 * 1024:
            raise ReleaseError('Insufficient disk space for verified artifacts')
        for name in ('core-image.tar.gz', 'website.tar.gz'):
            target = directory / name
            if not (target.is_file() and target.stat().st_size == assets[name]['size'] and
                    digest(target) == assets[name]['digest'][7:]):
                self.download(assets[name], target)
        validate_image(directory / 'core-image.tar.gz', manifest)
        validate_website(directory / 'website.tar.gz')
        return manifest


def validate_image(path, manifest):
    with tarfile.open(path, 'r:gz') as archive:
        safe_members(archive)
        images = json.loads(read_member(archive, 'manifest.json'))
        if len(images) != 1 or images[0].get('RepoTags') != [manifest['image_tag']]:
            raise ReleaseError('Image archive contains unexpected tags or images')
        config_raw = read_member(archive, images[0]['Config'])
        config = json.loads(config_raw)
        if ('sha256:' + hashlib.sha256(config_raw).hexdigest() != manifest['image_id'] or
                config.get('os') != 'linux' or config.get('architecture') != 'amd64' or
                config.get('config', {}).get('Labels', {}).get('org.opencontainers.image.revision') != manifest['commit'] or
                config.get('config', {}).get('User') not in ('node', '1000', '1000:1000')):
            raise ReleaseError('Image digest, source revision, platform or user differs')


def validate_website(path):
    with tarfile.open(path, 'r:gz') as archive:
        members = safe_members(archive, 512 * 1024 * 1024)
        for item in members:
            parts = PurePosixPath(item.name).parts
            if not parts or parts[0] != 'dist' or any(x in ('node_modules', '.git') or
                    x.startswith(('.env', '.dev.vars')) or x == 'hosting.local.json' or
                    re.search(r'\.(?:sqlite|db)(?:-|$)', x) for x in parts):
                raise ReleaseError('Unexpected or private website artifact entry')
        config = json.loads(read_member(archive, 'dist/server/wrangler.json'))
        main = PurePosixPath('dist/server') / config.get('main', '')
        if not config.get('main') or main.is_absolute() or '..' in main.parts:
            raise ReleaseError('Worker entry escapes the built artifact')
        names = {m.name for m in members if m.isfile()}
        if str(main) not in names:
            raise ReleaseError('Built Worker entry is missing')
        hosting = json.loads(read_member(archive, 'dist/.openai/hosting.json'))
        if hosting != {'d1': 'DB', 'r2': None}:
            raise ReleaseError('CI artifact must contain the public binding template only')


def install_website(path, destination, project_id):
    """Reuse compiled bytes; bind only deployment identity, never rebuild code."""
    validate_website(path)
    destination = Path(destination)
    manifest = destination / '.openai/hosting.json'
    source = json.loads(manifest.read_text())
    if {k:v for k,v in source.items() if k != 'project_id'} != {'d1':'DB','r2':None}:
        raise ReleaseError('Source binding template differs from the tested build')
    if (destination / 'dist').exists():
        raise ReleaseError('Expected an empty build destination')
    with tarfile.open(path, 'r:gz') as archive:
        for member in safe_members(archive, 512 * 1024 * 1024):
            target = destination / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as incoming, target.open('wb') as output:
                    shutil.copyfileobj(incoming, output)
                target.chmod(member.mode & 0o777)
    source['project_id'] = project_id
    content = json.dumps(source, indent=2) + '\n'
    manifest.write_text(content)
    (destination / 'dist/.openai/hosting.json').write_text(content)


def verify_website_directory(path, destination, project_id):
    validate_website(path)
    destination=Path(destination)
    expected=set()
    with tarfile.open(path,'r:gz') as archive:
        for member in safe_members(archive,512*1024*1024):
            if not member.isfile():
                continue
            expected.add(member.name)
            target=destination/member.name
            if target.is_symlink() or not target.is_file():
                raise ReleaseError('Prepared website entry is missing or linked')
            with archive.extractfile(member) as stream:
                if member.name=='dist/.openai/hosting.json':
                    wanted=json.load(stream)
                    wanted['project_id']=project_id
                    if json.loads(target.read_text())!=wanted:
                        raise ReleaseError('Prepared deployment identity differs')
                elif hashlib.file_digest(stream,'sha256').hexdigest()!=digest(target):
                    raise ReleaseError('Compiled website bytes changed after CI')
    actual=set()
    for target in (destination/'dist').rglob('*'):
        if target.is_symlink():
            raise ReleaseError('Prepared website contains a symlink')
        if target.is_file():
            actual.add(target.relative_to(destination).as_posix())
    if actual!=expected:
        raise ReleaseError('Prepared website has unexpected files')
