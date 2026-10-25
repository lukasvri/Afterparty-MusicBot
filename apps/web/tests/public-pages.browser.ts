// Native public routes and device-only notice preparation use fictional data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import releases from '../../../lib/releases.json' with { type: 'json' };

const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5174').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));

for (const width of [390, 1440]) {
  test(
    `native public pages and private notice preparation at ${width}px`,
    { timeout: 45000 },
    async (context) => {
      const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_PATH,
        args: ['--no-sandbox'],
      });
      context.after(() => browser.close());
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const routes = {
        '/support': 'Support and privacy requests',
        '/install': 'Add Afterparty to your server',
        '/privacy': 'Privacy Policy',
        '/terms': 'Terms of Service',
        '/patch-notes': 'Patch notes',
        '/copyright': 'Copyright and removal requests',
      };
      for (const [path, heading] of Object.entries(routes)) {
        const response = await page.goto(`${origin}${path}`);
        assert.equal(response?.status(), 200, path);
        await page.getByRole('heading', { level: 1, name: `${heading}.`, exact: true }).waitFor();
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${path} fits ${width}px`,
        );
        assert.equal(
          await page.getByRole('link', { name: 'Afterparty home' }).getAttribute('href'),
          '/',
        );
      }
      const writes: string[] = [];
      page.on('request', (request) => {
        if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
      });
      await page.getByRole('button', { name: 'Prepare notice', exact: true }).click();
      assert.equal(await page.getByRole('heading', { name: 'Review your notice' }).count(), 0);
      await page.locator('#copyright-name').fill('Synthetic Rights Holder');
      await page.locator('#copyright-email').fill('synthetic@example.com');
      await page.locator('#copyright-works').fill('Fictional recording for a local test');
      await page.locator('#copyright-locations').fill('https://example.com/fictional-track');
      await page.locator('#copyright-good-faith').check();
      await page.locator('#copyright-accuracy').check();
      await page.locator('#copyright-signature').fill('Synthetic Rights Holder');
      await page.getByRole('button', { name: 'Prepare notice', exact: true }).click();
      const preview = page.getByLabel('Prepared copyright notice', { exact: true });
      await preview.waitFor();
      assert.match(await preview.inputValue(), /Full name: Synthetic Rights Holder/);
      assert.match(await preview.inputValue(), /Fictional recording for a local test/);
      assert.equal(
        await page.locator('form [name]').count(),
        0,
        'private fields cannot be serialized by native form submission',
      );
      const draft = await page.getByRole('link', { name: 'Open email draft' }).getAttribute('href');
      assert(draft?.startsWith('mailto:'));
      assert.match(decodeURIComponent(draft!), /Synthetic Rights Holder/);
      await page.getByRole('button', { name: 'Clear form and preview' }).click();
      assert.equal(await preview.count(), 0);
      assert.equal(await page.locator('#copyright-email').inputValue(), '');
      assert.deepEqual(writes, [], 'preparing and clearing a notice makes no server mutation');
      await page.goto(`${origin}/patch-notes`);
      await page.getByRole('heading', { name: releases[0].title, exact: true }).waitFor();
      assert.equal(
        await page.locator('.timeline article').first().locator('.stamp > span').textContent(),
        `v${releases[0].version}`,
      );
      assert.deepEqual(errors, []);
    },
  );
}
