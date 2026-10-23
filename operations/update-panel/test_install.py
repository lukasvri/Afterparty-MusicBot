import importlib.util
from pathlib import Path
import tempfile
import unittest
from update_panel import integrate_html
from install import install, patch_server

HERE = Path(__file__).parent
BASE = '<html><head><meta name="csrf" content="{{csrf}}"></head><body><div id="operations-panel"></div><script src="/original.js"></script></body></html>'


class InstallTests(unittest.TestCase):
    def test_repeated_installs_keep_one_panel_and_original_app(self):
        first, assets = integrate_html(BASE, HERE)
        second, again = integrate_html(first, HERE)
        self.assertEqual(first, second)
        self.assertEqual(assets, again)
        self.assertEqual(second.count('id="afterparty-beta-panel"'), 1)
        self.assertIn('/original.js', second)
        self.assertIn('{{csrf}}', second)
        self.assertIn("import {viewState", ''.join(assets.values()))

    def test_old_nested_panel_and_assets_are_replaced(self):
        old = BASE.replace('</body>', '<section id="afterparty-beta-panel"><section>Old content</section></section><script type="module" src="/afterparty-update/_astro/afterparty-channel.123.js"></script></body>')
        page, _ = integrate_html(old, HERE)
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
            install(root, apply=True)
            spec = importlib.util.spec_from_file_location('installed_update_panel', root/'update_panel.py')
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            for asset in (root/'web-dist/_astro').iterdir():
                asset.unlink()
            # A future build can replace the HTML and asset directory.
            page = module.render_index(BASE, root/'web-dist')
            self.assertEqual(page.count('id="afterparty-beta-panel"'), 1)
            self.assertIn('/original.js', page)
            self.assertEqual(len(list((root/'web-dist/_astro').iterdir())), 3)
            self.assertEqual(module.render_index(page, root/'web-dist'), page)

    def test_dry_run_does_not_write_files(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            (root/'web-dist/_astro').mkdir(parents=True)
            (root/'web-dist/index.html').write_text(BASE)
            (root/'server.py').write_text("def index():\n            page = page_path.read_text(encoding='utf-8').replace('{{csrf}}', token)\n")
            (root/'beta_adapter.py').write_text('# synthetic existing adapter')
            before = {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
            install(root)
            self.assertEqual(before, {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()})


if __name__ == '__main__':
    unittest.main()
