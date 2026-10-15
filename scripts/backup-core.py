#!/usr/bin/env python3
"""Online, verified Core backups. Configuration and archives stay on the host."""
import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import tarfile
import tempfile
import time
import uuid


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def atomic_json(path, value):
    temporary = path.with_name(path.name + '.tmp-' + uuid.uuid4().hex)
    try:
        with temporary.open('x') as stream:
            os.chmod(temporary, 0o600)
            json.dump(value, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def snapshot_database(source, destination):
    deadline = time.monotonic() + 60

    def progress(*_):
        if time.monotonic() > deadline:
            raise TimeoutError('Database snapshot exceeded its deadline.')

    with contextlib.closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=5)) as live:
        with contextlib.closing(sqlite3.connect(destination)) as saved:
            live.backup(saved, pages=256, progress=progress, sleep=0.01)
            if saved.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                raise ValueError('Database snapshot did not pass integrity checks.')
    os.chmod(destination, 0o600)


def snapshot_tree(source, destination):
    files = sorted(source.rglob('*'))
    if not files or not (source / 'core.sqlite').is_file():
        raise ValueError('The complete Core data directory must contain core.sqlite.')
    for path in files:
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise ValueError('Data must contain regular files and directories, without links.')
    databases = 0
    for path in files:
        relative = path.relative_to(source)
        target = destination / relative
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True, mode=0o700)
            continue
        if path.name.endswith(('-wal', '-shm', '-journal')):
            continue
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if path.suffix.lower() in ('.sqlite', '.sqlite3', '.db'):
            snapshot_database(path.resolve(), target)
            databases += 1
        else:
            shutil.copyfile(path, target)
            os.chmod(target, 0o600)
    # Never silently omit a guild added while files were being enumerated.
    before = {p.relative_to(source) for p in files if p.suffix.lower() in ('.sqlite', '.sqlite3', '.db')}
    after = {p.relative_to(source) for p in source.rglob('*') if p.suffix.lower() in ('.sqlite', '.sqlite3', '.db')}
    if before != after:
        raise ValueError('Database membership changed during backup; retry with the new guild set.')
    return databases


def verify_archive(archive):
    with tempfile.TemporaryDirectory(prefix='afterparty-restore-check-') as temporary:
        root = Path(temporary)
        seen = set()
        with tarfile.open(archive, 'r:gz') as saved:
            for member in saved:
                parts = PurePosixPath(member.name)
                if parts.is_absolute() or '..' in parts.parts or member.name in seen:
                    raise ValueError('Unsafe or duplicate backup entry.')
                seen.add(member.name)
                if not member.isfile():
                    raise ValueError('Only regular files are accepted in backups.')
                target = root.joinpath(*parts.parts)
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with saved.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                os.chmod(target, 0o600)
        manifest = json.loads((root / 'manifest.json').read_text())
        expected = manifest['files']
        if set(expected) != seen - {'manifest.json'}:
            raise ValueError('Archive membership differs from its manifest.')
        databases = 0
        for name, checksum in expected.items():
            path = root / name
            if digest(path) != checksum:
                raise ValueError('A backup file failed its checksum.')
            if name.startswith('data/') and path.suffix.lower() in ('.sqlite', '.sqlite3', '.db'):
                with contextlib.closing(sqlite3.connect(path)) as db:
                    if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                        raise ValueError('A restored database failed its integrity check.')
                databases += 1
        if databases != manifest['databases'] or databases < 1:
            raise ValueError('The restored database count is incorrect.')
        return {'databases': databases, 'files': len(expected)}


def create_backup(config):
    source = Path(config['data_dir']).resolve()
    output = Path(config['backup_dir']).resolve()
    if output == source or output.is_relative_to(source):
        raise ValueError('Backups must be outside the production data directory.')
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    if output.stat().st_mode & 0o077:
        raise ValueError('The backup directory must be private (mode 700).')
    with (output / '.backup.lock').open('a') as lock:
        os.chmod(output / '.backup.lock', 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        started = time.monotonic()
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        final = output / ('afterparty-' + stamp + '-' + uuid.uuid4().hex[:8] + '.tar.gz')
        partial = final.with_suffix('.partial')
        try:
            with tempfile.TemporaryDirectory(prefix='.snapshot-', dir=output) as temporary:
                stage = Path(temporary)
                databases = snapshot_tree(source, stage / 'data')
                for label, name in config.get('config_files', {}).items():
                    if not label or '/' in label or '\\' in label or label in ('.', '..'):
                        raise ValueError('Configuration labels must be simple filenames.')
                    target = stage / 'config' / label
                    target.parent.mkdir(mode=0o700, exist_ok=True)
                    shutil.copyfile(Path(name).resolve(), target)
                    os.chmod(target, 0o600)
                manifest = {'format': 1, 'created_at': datetime.now(timezone.utc).isoformat(),
                            'databases': databases, 'files': {p.relative_to(stage).as_posix(): digest(p)
                            for p in sorted(stage.rglob('*')) if p.is_file()}}
                atomic_json(stage / 'manifest.json', manifest)
                with partial.open('xb') as stream:
                    os.chmod(partial, 0o600)
                    with tarfile.open(fileobj=stream, mode='w:gz') as saved:
                        for path in sorted(stage.rglob('*')):
                            if path.is_file():
                                info = saved.gettarinfo(str(path), path.relative_to(stage).as_posix())
                                info.mode = 0o600
                                info.uid = info.gid = 0
                                info.uname = info.gname = ''
                                with path.open('rb') as data:
                                    saved.addfile(info, data)
                    stream.flush()
                    os.fsync(stream.fileno())
                checked = verify_archive(partial)
                partial.replace(final)
                result = {'archive': final.name, 'created_at': manifest['created_at'],
                          'sha256': digest(final), 'size_bytes': final.stat().st_size,
                          'duration_seconds': round(time.monotonic() - started, 3), **checked}
                atomic_json(output / 'latest.json', result)
                return result
        finally:
            partial.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--config', type=Path)
    group.add_argument('--verify', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        result = verify_archive(args.verify) if args.verify else create_backup(json.loads(args.config.read_text()))
        print(json.dumps({'status': 'verified', **result}))
    except Exception as error:
        raise SystemExit('Backup failed: ' + type(error).__name__ + '. Inspect the local configuration and data; no credentials were printed.')


if __name__ == '__main__':
    main()
