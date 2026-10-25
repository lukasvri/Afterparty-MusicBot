import importlib.util
import json
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest
from update_panel import integrate_html, build_assets, SOURCE_FILES
from install import install, patch_server

HERE = Path(__file__).parent
BASE = '<html><head><meta name="csrf" content="{{csrf}}"></head><body><div id="operations-panel"></div><script src="/original.js"></script></body></html>'


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.assets_dir = Path(self.directory.name)
        # Synthetic compiler output: Python-only validation must never require Node.
        script = 'document.documentElement.dataset.syntheticPanel = "ready";'
        css = (HERE / 'channel.css').read_text()
        script_name = 'update-channel.' + sha256(script.encode()).hexdigest()[:12] + '.js'
        css_name = 'update-channel.' + sha256(css.encode()).hexdigest()[:12] + '.css'
        assets = {script_name: script, css_name: css}
        self.manifest = {'version': 1, 'script': script_name, 'css': css_name,
            'sources': {name: sha256((HERE / name).read_bytes()).hexdigest() for name in SOURCE_FILES},
            'assets': {name: sha256(content.encode()).hexdigest() for name, content in assets.items()}}
        for name, content in assets.items():
            (self.assets_dir / name).write_text(content)
        self.write_manifest()

    def write_manifest(self):
        (self.assets_dir / 'manifest.json').write_text(json.dumps(self.manifest))

    def test_repeated_installs_keep_one_panel_and_original_app(self):
        first, assets = integrate_html(BASE, HERE, self.assets_dir)
        second, again = integrate_html(first, HERE, self.assets_dir)
        self.assertEqual(first, second)
        self.assertEqual(assets, again)
        self.assertEqual(second.count('id="afterparty-beta-panel"'), 1)
        self.assertIn('/original.js', second)
        self.assertIn('{{csrf}}', second)
        self.assertIn("syntheticPanel", ''.join(assets.values()))

    def test_old_nested_panel_and_assets_are_replaced(self):
        old = BASE.replace('</body>', '<section id="afterparty-beta-panel"><section>Old content</section></section><script type="module" src="/afterparty-update/_astro/afterparty-channel.123.js"></script></body>')
        page, _ = integrate_html(old, HERE, self.assets_dir)
        self.assertNotIn('Old content', page)
        self.assertNotIn('afterparty-channel.123', page)
        self.assertEqual(page.count('id="afterparty-beta-panel"'), 1)

    def test_unsupported_base_fails_closed(self):
        with self.assertRaises(ValueError):
            integrate_html('<html><head></head><body>Different app</body></html>', HERE)

    def test_server_patch_is_idempotent_and_preserves_csrf(self):
        text = "            page = page_path.read_text(encoding='utf-8').replace('{{csrf}}', token)"
        patched = patch_server(text)
        self.assertEqual(patched, patch_server(patched))
        self.assertIn(".replace('{{csrf}}', token)", patched)
        with self.assertRaises(ValueError):
            patch_server('Unrecognized server')

    def test_real_install_restores_assets_after_base_rebuild(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            (root/'web-dist/_astro').mkdir(parents=True)
            (root/'web-dist/index.html').write_text(BASE)
            (root/'server.py').write_text("def index():\n            page = page_path.read_text(encoding='utf-8').replace('{{csrf}}', token)\n")
            (root/'beta_adapter.py').write_text('# synthetic existing adapter')
            old_asset = root/'web-dist/_astro/update-channel.000000000000.js'
            old_asset.write_text('// retained for existing clients')
            install(root, apply=True, assets_dir=self.assets_dir)
            self.assertEqual(old_asset.read_text(), '// retained for existing clients')
            spec = importlib.util.spec_from_file_location('installed_update_panel', root/'update_panel.py')
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            for asset in (root/'web-dist/_astro').iterdir():
                asset.unlink()
            # A future build can replace the HTML and asset directory.
            page = module.render_index(BASE, root/'web-dist')
            self.assertEqual(page.count('id="afterparty-beta-panel"'), 1)
            self.assertIn('/original.js', page)
            self.assertEqual(len(list((root/'web-dist/_astro').iterdir())), 2)
            self.assertEqual(module.render_index(page, root/'web-dist'), page)

    def test_dry_run_does_not_write_files(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            (root/'web-dist/_astro').mkdir(parents=True)
            (root/'web-dist/index.html').write_text(BASE)
            (root/'server.py').write_text("def index():\n            page = page_path.read_text(encoding='utf-8').replace('{{csrf}}', token)\n")
            (root/'beta_adapter.py').write_text('# synthetic existing adapter')
            before = {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
            install(root, assets_dir=self.assets_dir)
            self.assertEqual(before, {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()})


    def test_compiled_assets_must_match_source_and_content(self):
        self.manifest['sources']['channel.ts'] = '0' * 64
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'match the reviewed source'):
            integrate_html(BASE, HERE, self.assets_dir)
        self.manifest['sources']['channel.ts'] = sha256((HERE / 'channel.ts').read_bytes()).hexdigest()
        self.write_manifest()
        (self.assets_dir / self.manifest['script']).write_text('tampered')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            integrate_html(BASE, HERE, self.assets_dir)

    def test_asset_paths_and_symlinks_fail_closed(self):
        script = self.assets_dir / self.manifest['script']
        script.unlink()
        script.symlink_to(HERE / 'channel.ts')
        with self.assertRaisesRegex(ValueError, 'unsafe'):
            integrate_html(BASE, HERE, self.assets_dir)
        self.manifest['script'] = '../outside.js'
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            integrate_html(BASE, HERE, self.assets_dir)

    def test_invalid_compiled_assets_do_not_modify_panel(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            (root/'web-dist/_astro').mkdir(parents=True)
            (root/'web-dist/index.html').write_text(BASE)
            (root/'server.py').write_text('existing server untouched')
            (root/'beta_adapter.py').write_text('existing adapter untouched')
            before = {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
            (self.assets_dir / self.manifest['script']).write_text('tampered')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                install(root, apply=True, assets_dir=self.assets_dir)
            self.assertEqual(before, {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()})
            self.assertFalse(any(root.glob('backup-*')))

    def test_typescript_source_requires_precompiled_assets(self):
        with self.assertRaisesRegex(ValueError, 'Precompiled'):
            integrate_html(BASE, HERE)

    def test_legacy_installed_source_keeps_working(self):
        source = self.assets_dir / 'legacy'
        source.mkdir()
        (source / 'model.mjs').write_text('export const stages = [];')
        (source / 'channel.js').write_text("import {stages} from './model.mjs';")
        (source / 'channel.css').write_text('section { color: black; }')
        (source / 'panel.html').write_text('<section id="afterparty-beta-panel">Legacy</section>')
        page, assets = integrate_html(BASE, source)
        self.assertIn('Legacy', page)
        self.assertEqual(len(assets), 3)
        self.assertNotIn("'./model.mjs'", ''.join(assets.values()))
        self.assertEqual(build_assets(source)[0], assets)

if __name__ == '__main__':
    unittest.main()
