"""Keep the reviewed channel UI present when the base panel is rebuilt."""
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
import re


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


def build_assets(source):
    model = (source / 'model.mjs').read_text()
    model_name = 'update-channel-model.' + sha256(model.encode()).hexdigest()[:12] + '.js'
    script = (source / 'channel.js').read_text().replace("'./model.mjs'", repr('./' + model_name))
    css = (source / 'channel.css').read_text()
    js_name = 'update-channel.' + sha256(script.encode()).hexdigest()[:12] + '.js'
    css_name = 'update-channel.' + sha256(css.encode()).hexdigest()[:12] + '.css'
    return {model_name: model, js_name: script, css_name: css}, js_name, css_name


def integrate_html(page, source):
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
    assets, script, css = build_assets(source)
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
