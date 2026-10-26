"""Keep the reviewed channel UI present when the base panel is rebuilt."""
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
import re
import json


class PanelSection(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=False)
        self.text = text
        self.lines = [0]
        self.lines.extend(m.end() for m in re.finditer('\n', text))
        self.depth = 0
        self.start = None
        self.spans = []

    def absolute_position(self):
        row, column = self.getpos()
        return self.lines[row - 1] + column

    def handle_starttag(self, tag, attrs):
        if tag != 'section':
            return
        if self.depth:
            self.depth += 1
        elif dict(attrs).get('id') == 'afterparty-beta-panel':
            self.start = self.absolute_position()
            self.depth = 1

    def handle_endtag(self, tag):
        if tag == 'section' and self.depth:
            self.depth -= 1
            if not self.depth:
                self.spans.append((self.start, self.absolute_position() + len('</section>')))


SOURCE_FILES = ('channel.ts', 'model.ts', 'channel.css', 'panel.html')


def compiled_assets(source, assets_dir):
    """Validate compiler output and source freshness before installing any bytes."""
    assets_dir = Path(assets_dir)
    def read(name):
        path = assets_dir / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
            raise ValueError('Missing or unsafe compiled panel asset. Use a verified website artifact.')
        return path.read_bytes()
    try:
        manifest = json.loads(read('manifest.json'))
        if (not isinstance(manifest, dict) or set(manifest) != {'version', 'script', 'css', 'sources', 'assets'}
                or manifest['version'] != 1 or not isinstance(manifest['sources'], dict)
                or set(manifest['sources']) != set(SOURCE_FILES)):
            raise ValueError('Unsupported compiled panel manifest.')
        for name in SOURCE_FILES:
            if sha256((source / name).read_bytes()).hexdigest() != manifest['sources'][name]:
                raise ValueError('Compiled panel assets do not match the reviewed source. Use its matching website artifact.')
        script, css = manifest['script'], manifest['css']
        if (not isinstance(script, str) or not re.fullmatch(r'update-channel\.[a-f0-9]{12}\.js', script)
                or not isinstance(css, str) or not re.fullmatch(r'update-channel\.[a-f0-9]{12}\.css', css)
                or not isinstance(manifest['assets'], dict) or set(manifest['assets']) != {script, css}):
            raise ValueError('Unsupported compiled panel assets.')
        assets = {}
        for name in (script, css):
            content = read(name)
            digest = sha256(content).hexdigest()
            if manifest['assets'][name] != digest or name.split('.')[1] != digest[:12]:
                raise ValueError('Compiled panel asset checksum mismatch.')
            assets[name] = content.decode('utf-8')
        return assets, script, css
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, KeyError) as error:
        raise ValueError('Invalid compiled panel assets. Use a verified matching website artifact.') from error


def legacy_assets(source):
    model = (source / 'model.mjs').read_text()
    model_name = 'update-channel-model.' + sha256(model.encode()).hexdigest()[:12] + '.js'
    script = (source / 'channel.js').read_text().replace("'./model.mjs'", repr('./' + model_name))
    css = (source / 'channel.css').read_text()
    js_name = 'update-channel.' + sha256(script.encode()).hexdigest()[:12] + '.js'
    css_name = 'update-channel.' + sha256(css.encode()).hexdigest()[:12] + '.css'
    return {model_name: model, js_name: script, css_name: css}, js_name, css_name



def build_assets(source, assets_dir=None):
    if assets_dir is not None:
        return compiled_assets(source, assets_dir)
    if (source / 'manifest.json').is_file():
        return compiled_assets(source, source)
    # Keep rebuilding previously installed JS integrations without Node or a new release.
    if not (source / 'channel.ts').exists() and (source / 'channel.js').is_file() and (source / 'model.mjs').is_file():
        return legacy_assets(source)
    raise ValueError('Precompiled panel assets are required. Pass --assets-dir from the verified matching website artifact.')


def integrate_html(page, source, assets_dir=None):
    """Replace only our integration, preserving the original app and auth template."""
    if 'id="operations-panel"' not in page or '</body>' not in page or '</head>' not in page:
        raise ValueError('The base operations panel does not match the supported integration contract.')
    parser = PanelSection(page)
    parser.feed(page)
    if parser.depth:
        raise ValueError('The previous channel section is incomplete.')
    for start, end in reversed(parser.spans):
        while end < len(page) and page[end].isspace():
            end += 1
        page = page[:start] + page[end:]
    page = re.sub(r'<script\b[^>]*\bsrc=["\']/afterparty-update/_astro/(?:beta-panel|afterparty-channel|update-channel)\.[^"\']+\.(?:js|mjs)["\'][^>]*>\s*</script>', '', page)
    page = re.sub(r'<link\b[^>]*\bhref=["\']/afterparty-update/_astro/(?:beta-panel|afterparty-channel|update-channel)\.[^"\']+\.css["\'][^>]*>', '', page)
    assets, script, css = build_assets(source, assets_dir)
    page = page.replace('</head>', f'<link rel="stylesheet" href="/afterparty-update/_astro/{css}"></head>', 1)
    panel = (source / 'panel.html').read_text()
    page = page.replace('</body>', panel + f'<script type="module" src="/afterparty-update/_astro/{script}"></script></body>', 1)
    return page, assets


def render_index(page, ui_root):
    source = Path(__file__).resolve().parent / 'channel-ui-source'
    page, assets = integrate_html(page, source)
    directory = Path(ui_root) / '_astro'
    directory.mkdir(exist_ok=True)
    for name, content in assets.items():
        target = directory / name
        if not target.exists():
            temp = directory / (name + '.tmp')
            temp.write_text(content, encoding='utf-8')
            temp.replace(target)
    return page
