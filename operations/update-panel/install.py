#!/usr/bin/env python3
"""Install the private channel panel without starting jobs or restarting services."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import shutil
from update_panel import integrate_html


def patch_server(text):
    marker = "            page = page_path.read_text(encoding='utf-8').replace('{{csrf}}', token)"
    if 'from update_panel import render_index' in text:
        return text
    if text.count(marker) != 1:
        raise ValueError('Unsupported server template. No changes were installed.')
    return text.replace(marker,
        "            from update_panel import render_index\n"
        "            page = render_index(page_path.read_text(encoding='utf-8'), UI_ROOT).replace('{{csrf}}', token)")



def patch_runner(text):
    start = text.find('def github(path):')
    end = text.find('\ndef git(*args):', start)
    if start < 0 or end < 0:
        raise ValueError('Unsupported beta runner GitHub check. No changes were installed.')
    wrapper = """def github(path):
 from github_checks import github_json, GithubCheckError
 try:return github_json(path)
 except GithubCheckError as error:
  failure=BuildError(str(error));failure.retry_after=getattr(error,'retry_after',None);raise failure from None
"""
    text = text[:start] + wrapper + text[end:]
    text = text.replace("s={'stage':'checking','ready':False,'running':False,'message':", "s={**s,'stage':'checking','operation':'check','ready':False,'running':False,'message':")
    text = text.replace("s.update(stage='validate',running=True,ready=False,", "s.update(stage='validate',operation='publish',running=True,ready=False,")
    text = text.replace("error=message,message=message);save(s)", "error=message,message=message,retry_after=getattr(e,'retry_after',None));save(s)")
    return text


def install(directory, *, apply=False):
    source = Path(__file__).resolve().parent
    directory = directory.resolve()
    index = directory / 'web-dist/index.html'
    server = directory / 'server.py'
    adapter = directory / 'beta_adapter.py'
    if not all(p.is_file() for p in (index, server, adapter)):
        raise ValueError('An existing authenticated operations panel and beta adapter are required.')
    page, assets = integrate_html(index.read_text(), source)
    runner = directory.parent / 'site-runner/beta_update.py'
    runner_text = patch_runner(runner.read_text()) if runner.is_file() else None
    if runner_text is not None:
        compile(runner_text, str(runner), 'exec')
    original = server.read_bytes()
    newline = '\r\n' if b'\r\n' in original else '\n'
    patched = patch_server(original.decode().replace('\r\n', '\n')).replace('\n', newline).encode()
    compile(patched.decode(), str(server), 'exec')
    if not apply:
        return 'Validated existing panel. Pass --apply to install. No jobs will be started.'
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = directory / ('backup-version-selector-' + stamp)
    backup.mkdir(mode=0o700)
    for target in (index, server, adapter, directory / 'update_panel.py'):
        if target.exists():
            shutil.copy2(target, backup / target.name)
    if runner_text is not None:
        shutil.copy2(runner, backup / 'beta_update.py')
        if (runner.parent / 'github_checks.py').exists():
            shutil.copy2(runner.parent / 'github_checks.py', backup / 'github_checks.py')
    if (directory / 'channel-ui-source').exists():
        shutil.copytree(directory / 'channel-ui-source', backup / 'channel-ui-source')
    maintained = directory / 'channel-ui-source'
    maintained.mkdir(exist_ok=True)
    for name in ('channel.js', 'model.mjs', 'channel.css', 'panel.html', 'README.md'):
        shutil.copy2(source / name, maintained / name)
    for name, content in assets.items():
        (directory / 'web-dist/_astro' / name).write_text(content)
    shutil.copy2(source / 'update_panel.py', directory / 'update_panel.py')
    shutil.copy2(source / 'beta_adapter.py', adapter)
    if runner_text is not None:
        shutil.copy2(source / 'github_checks.py', runner.parent / 'github_checks.py')
        runner.write_text(runner_text)
    server.write_bytes(patched)
    temporary = index.with_suffix('.new')
    temporary.write_text(page)
    temporary.replace(index)
    return 'Installed reviewed channel source with a private backup. Restart only the panel web service to load Python changes. No deployment was started.'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--panel-dir', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(install(args.panel_dir, apply=args.apply))
