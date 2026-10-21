#!/usr/bin/env python3
"""Install a pinned host-local deployer and wrapper; never enables network access."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import sys


def main():
    if sys.version_info < (3, 11):
        raise SystemExit('Python 3.11+ is required.')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True,type=Path)
    parser.add_argument('--bin-dir',type=Path,default=Path.home()/'.local/bin')
    args=parser.parse_args()
    os.umask(0o077)
    config=args.config.resolve()
    settings=json.loads(config.read_text())
    repo=Path(settings['repo']).resolve()
    state=Path(settings['state_dir']).resolve()
    if config.is_relative_to(repo) or state.is_relative_to(repo):
        raise SystemExit('Configuration and deployment state must be outside Git.')
    if config.stat().st_uid != os.getuid() or config.stat().st_mode & 0o077:
        raise SystemExit('Deployment configuration must be owned by this user with mode 600.')
    state.mkdir(parents=True,exist_ok=True,mode=0o700)
    installed=state/'deploy-core.py'
    for name in ['deploy-core.py','release_artifacts.py','runtime_limits.py']:
        destination=state/name
        shutil.copyfile(Path(__file__).with_name(name),destination)
        destination.chmod(0o600)
    args.bin_dir.mkdir(parents=True,exist_ok=True)
    wrapper=args.bin_dir/'deploy-core'
    wrapper.write_text('#!/bin/sh\nexec '+shlex.quote(sys.executable)+' '+shlex.quote(str(installed))+' --config '+shlex.quote(str(config))+' "$@"\n')
    wrapper.chmod(0o700)
    print('Installed:',wrapper)
    print('The deployer is pinned locally. Reinstall it explicitly after reviewing deployer changes.')


if __name__=='__main__':main()
