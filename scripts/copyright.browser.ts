// Local synthetic notices only. Never launches an email client or sends a notice.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { COPYRIGHT_ACCURACY, COPYRIGHT_GOOD_FAITH, copyrightContactEmail, copyrightMailto } from '../lib/copyright-notice.ts';
import type { Page } from 'playwright';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright') as typeof import('playwright');
const base = process.env.PREVIEW_URL ?? 'http://localhost:8790';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const shots = process.env.SCREENSHOT_DIR ?? '/tmp/afterparty-copyright-shots';
await mkdir(shots, { recursive: true });
const marker = 'COPYRIGHT_TEST_PRIVATE_7d9f', email = 'copyright-test-private-7d9f@example.test';
for (const value of [null, '', 'mailto:claims@example.test', 'claims@example.test?bcc=other@example.test',
  'claims@example.test\r\nBcc:other@example.test', 'claims%0d%0a@example.test', 'claims@example.test&body=secret',
  'claims@@example.test', 'claims..desk@example.test', ' claims@example.test', 'claims@example.test/']) {
  assert.equal(copyrightContactEmail(value), null);
  assert.equal(copyrightMailto(value, marker), null);
}
assert.equal(copyrightContactEmail('copyright+desk@example.test'), 'copyright+desk@example.test');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
  const requests: string[] = [], errors: string[] = [];
  context.on('request', request => requests.push(request.method() + ' ' + request.url() + ' ' + (request.postData() ?? '')));
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const storage = (target: Page) => target.evaluate(() => JSON.stringify({ local: Object.entries(localStorage).sort(), session: Object.entries(sessionStorage).sort() }));
  const fillNotice = async (target: Page) => {
    await target.getByLabel('Full name (required)', { exact: true }).fill('Synthetic Claimant ' + marker);
    await target.getByLabel('Contact email (required)', { exact: true }).fill(email);
    await target.getByLabel('Postal address (optional for a general notice)', { exact: true }).fill('Synthetic address ' + marker);
    await target.getByLabel('Phone (optional)', { exact: true }).fill('Synthetic phone ' + marker);
    await target.getByLabel('Copyrighted works claimed (required)', { exact: true }).fill('Fictional work ' + marker);
    await target.getByLabel('Exact Afterparty locations and identifying details (required)', { exact: true }).fill('Private room and timestamp ' + marker);
    await target.getByLabel('Additional information (optional)', { exact: true }).fill('Private explanation ' + marker);
  };
  const privacy = async () => {
    assert.equal(requests.some(request => request.includes(marker) || request.includes(email)), false, 'private fields never enter a network URL or body');
    assert.equal(page.url().includes(marker) || page.url().includes(email), false);
  };
  await page.goto(base + '/copyright');
  await page.waitForFunction(() => { const button = document.querySelector('.copyright-form button[type=submit]'); return Boolean(button && !button.matches(':disabled')); });
  const baselineStorage = await storage(page), form = page.locator('.copyright-form form');
  assert.equal(await form.locator('input[name], textarea[name]').count(), 0, 'native GET cannot serialize private fields');
  const prepare = page.getByRole('button', { name: 'Prepare notice', exact: true });
  await prepare.click();
  assert.equal(await page.getByLabel('Prepared copyright notice', { exact: true }).count(), 0);
  await fillNotice(page);
  await page.getByLabel('Contact email (required)', { exact: true }).fill('not-an-email');
  assert.equal(await form.evaluate(element => (element as HTMLFormElement).checkValidity()), false);
  await prepare.click(); assert.equal(await page.getByLabel('Prepared copyright notice', { exact: true }).count(), 0);
  await page.getByLabel('Contact email (required)', { exact: true }).fill(email);
  await page.getByLabel(COPYRIGHT_GOOD_FAITH + ' (required)', { exact: true }).check();
  await prepare.click(); assert.equal(await page.getByLabel('Prepared copyright notice', { exact: true }).count(), 0);
  await page.getByLabel(COPYRIGHT_ACCURACY + ' (required)', { exact: true }).check();
  await prepare.click(); assert.equal(await page.getByLabel('Prepared copyright notice', { exact: true }).count(), 0);
  await page.getByLabel('Typed signature (required)', { exact: true }).fill('Synthetic Claimant ' + marker);
  await page.getByLabel('Copyrighted works claimed (required)', { exact: true }).fill('   ');
  await prepare.click(); assert.equal(await page.getByLabel('Prepared copyright notice', { exact: true }).count(), 0);
  await page.getByLabel('Copyrighted works claimed (required)', { exact: true }).fill('Fictional work ' + marker);
  assert.deepEqual(await form.locator('input, textarea').evaluateAll(elements => elements.filter(element => !(element as HTMLInputElement).validity.valid).map(element => ({
    id: element.id, message: (element as HTMLInputElement).validationMessage,
  }))), [], 'complete synthetic fields satisfy browser validation');
  await prepare.click();
  const preview = page.getByLabel('Prepared copyright notice', { exact: true }); await preview.waitFor();
  const notice = await preview.inputValue();
  for (const text of [email, 'Synthetic address ' + marker, 'Synthetic phone ' + marker,
    'Fictional work ' + marker, 'Private room and timestamp ' + marker, 'Private explanation ' + marker,
    COPYRIGHT_GOOD_FAITH, COPYRIGHT_ACCURACY, 'Typed signature: Synthetic Claimant ' + marker]) assert(notice.includes(text));
  assert.equal(await page.getByLabel('Copyrighted works claimed (required)', { exact: true }).getAttribute('maxlength'), '4000');
  const draft = page.getByRole('link', { name: 'Open email draft', exact: true });
  const href = new URL((await draft.getAttribute('href'))!);
  assert.equal(href.protocol, 'mailto:'); assert(copyrightContactEmail(decodeURIComponent(href.pathname)));
  assert.equal(href.searchParams.get('subject'), 'Afterparty copyright removal request');
  assert.equal(href.searchParams.get('body'), notice);
  await preview.fill(notice + '\nEdited privately: ' + marker);
  const edited = await preview.inputValue();
  assert.equal(new URL((await draft.getAttribute('href'))!).searchParams.get('body'), edited, 'email draft reflects editable preview');
  await page.getByRole('button', { name: 'Copy notice', exact: true }).click();
  await page.getByText('Automatic copy is unavailable. Select and copy the notice below.', { exact: true }).waitFor();
  assert.equal(await preview.evaluate(element => { const input = element as HTMLTextAreaElement; return input.selectionEnd - input.selectionStart; }), edited.length);
  await page.getByText('No request has been submitted through this form.', { exact: false }).waitFor();
  await privacy(); assert.equal(await storage(page), baselineStorage, 'notice preparation never stores private fields');
  await page.screenshot({ path: `${shots}/copyright-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${shots}/copyright-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Clear form and preview', exact: true }).click();
  assert.equal(await preview.count(), 0); assert.equal(await draft.count(), 0);
  assert.equal(await form.locator('input:not([type=checkbox]), textarea').evaluateAll(elements => elements.some(element => (element as HTMLInputElement).value !== '')), false);
  assert.equal(await form.locator('input[type=checkbox]:checked').count(), 0);
  assert.equal((await page.locator('body').innerText()).includes(marker), false);
  assert.equal(await storage(page), baselineStorage); await privacy();

  // Isolate the exact production component to test absent/invalid operator configuration.
  // No environment, application source or real contact configuration is changed.
  const bundle = await build({ stdin: { contents: `import { createElement } from 'react'; import { createRoot } from 'react-dom/client';
    import { CopyrightForm } from './components/copyright-form.tsx';
    createRoot(document.getElementById('root')).render(createElement(CopyrightForm, { contactEmail: window.fixtureContact }));`,
    loader: 'tsx', resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false,
    outfile: 'copyright-fixture.js', platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
  let fixtureContact: string | null = null;
  await page.route('**/__copyright_fixture*', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text });
    if (path.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text });
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><link rel="stylesheet" href="/__copyright_fixture.css"></head>
      <body><div id="root"></div><script>window.fixtureContact=${JSON.stringify(fixtureContact)}</script><script src="/__copyright_fixture.js"></script></body></html>` });
  });
  for (const contact of [null, 'claims@example.test?bcc=other@example.test']) {
    fixtureContact = contact; await page.goto(base + '/__copyright_fixture');
    await page.getByText('No copyright email address is configured for this installation.', { exact: false }).waitFor();
    await fillNotice(page);
    await page.getByLabel(COPYRIGHT_GOOD_FAITH + ' (required)', { exact: true }).check();
    await page.getByLabel(COPYRIGHT_ACCURACY + ' (required)', { exact: true }).check();
    await page.getByLabel('Typed signature (required)', { exact: true }).fill('Synthetic Claimant ' + marker);
    await page.getByRole('button', { name: 'Prepare notice', exact: true }).click();
    await page.getByLabel('Prepared copyright notice', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open email draft', exact: true }).count(), 0);
    assert.equal(await page.locator('a[href^="mailto:"]').count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Support', exact: true }).getAttribute('href'), '/support');
    await privacy();
  }
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const noJsPage = await noJs.newPage(); await noJsPage.goto(base + '/copyright');
  assert(await noJsPage.getByLabel('Full name (required)', { exact: true }).isDisabled());
  assert(await noJsPage.getByRole('button', { name: 'Prepare notice', exact: true }).isDisabled());
  assert.equal(await noJsPage.locator('.copyright-form input[name], .copyright-form textarea[name]').count(), 0);
  await noJs.close(); assert.deepEqual(errors, []); await context.close();
  console.log(`Private copyright notice preparation passed; no email was sent; screenshots: ${shots}`);
} finally { await browser.close(); }
