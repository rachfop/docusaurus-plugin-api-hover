/**
 * End-to-end check of the standalone script on real Sphinx (Furo) and
 * MkDocs (Material + mkdocstrings) output, in Chromium.
 *
 * tests/e2e/sites holds pages from both generators' builds of a toy
 * package, trimmed of theme scripts and styles, with each build's
 * objects.inv. The run copies each site to a temp dir, runs
 * `quickinfo build` on it (as a site's CI would), serves it, and drives
 * the pages: annotation, hover, highlight, Escape, keyboard focus,
 * navigation chrome, nested pages.
 *
 * Needs the compiled lib/ (npm run build) and Playwright's Chromium.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', '..', 'lib', 'cli', 'index.js');

const SITES = [
  // `out` is where each site's script tag points: Sphinx loads from
  // _static/, MkDocs from the site root.
  {
    name: 'sphinx',
    guide: 'guide.html',
    nested: 'reference/driver.html',
    out: '_static/quickinfo',
  },
  { name: 'mkdocs', guide: 'guide/', nested: 'reference/driver/', out: 'quickinfo' },
];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

function serve(root) {
  const server = createServer((req, res) => {
    let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
}

const browser = await chromium.launch();

for (const site of SITES) {
  console.log(`\n== ${site.name}`);
  const root = mkdtempSync(path.join(tmpdir(), `quickinfo-e2e-${site.name}-`));
  cpSync(path.join(here, 'sites', site.name), root, { recursive: true });
  execFileSync(process.execPath, [cli, 'build', root, '--out', path.join(root, site.out)], {
    stdio: 'pipe',
  });
  const server = await serve(root);
  const base = `http://localhost:${server.address().port}`;

  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') problems.push(m.text());
  });
  const annotations = (scope, inCode = null) =>
    page.$$eval(
      `${scope} [data-api-id]`,
      (els, inCode) =>
        els
          .filter((e) => inCode === null || !!e.closest('pre') === inCode)
          .map((e) => `${e.textContent.trim()}=>${e.getAttribute('data-api-id')}`),
      inCode,
    );

  await page.goto(`${base}/${site.guide}`);
  await page
    .waitForSelector('[data-api-id]', { state: 'attached', timeout: 10000 })
    .catch((err) => {
      throw new Error(
        `${site.name}: no annotations (${problems.join(' || ') || 'no console output'})`,
        {
          cause: err,
        },
      );
    });
  const code = await annotations('body', true);
  const prose = await annotations('body', false);
  for (const expected of [
    'Graph=>toyapi.graph.Graph',
    'Accelerator=>toyapi.driver.Accelerator',
    'id=>toyapi.driver.Device.id',
    'relu=>toyapi.graph.ops.relu',
    'output=>toyapi.graph.Graph.output',
  ]) {
    check(`code block: ${expected}`, code.includes(expected));
  }
  check(
    'prose cross-reference annotated',
    prose.some((a) => a.endsWith('=>toyapi.driver.Accelerator')),
    prose.join(' | '),
  );
  const inChrome = await page.$$eval(
    'nav [data-api-id], aside [data-api-id], .md-nav [data-api-id], .toc-tree [data-api-id]',
    (els) => els.length,
  );
  check('navigation chrome stays plain', inChrome === 0, `${inChrome} in chrome`);

  await page.locator('pre [data-api-id="toyapi.driver.Accelerator"]').first().hover();
  await page
    .waitForSelector('.quickinfo-tooltip .quickinfo-sig', { timeout: 5000 })
    .catch(() => {});
  const tip = await page
    .$eval('.quickinfo-tooltip', (el) => ({
      text: el.innerText,
      href: el.querySelector('a')?.href,
      role: el.getAttribute('role'),
    }))
    .catch(() => null);
  check(
    'hover shows the signature',
    /Accelerator\(/.test(tip?.text ?? ''),
    tip?.text.replace(/\n/g, ' / '),
  );
  check(
    'reference link resolves to the API page',
    tip?.href === `${base}/${site.nested}#toyapi.driver.Accelerator`,
    tip?.href,
  );
  check('tooltip has role=tooltip', tip?.role === 'tooltip');
  const highlighted = await page.$$eval('.quickinfo-hl', (els) => els.length);
  check('every instance highlighted', highlighted >= 2, `${highlighted}`);
  await page.keyboard.press('Escape');
  check('Escape dismisses', (await page.$('.quickinfo-tooltip')) === null);

  await page.mouse.move(0, 0);
  await page
    .locator(
      'main a:has([data-api-id]), main a[data-api-id], article a:has([data-api-id]), article a[data-api-id]',
    )
    .first()
    .focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await page.waitForSelector('.quickinfo-tooltip', { timeout: 3000 }).catch(() => {});
  const described = await page.evaluate(
    () =>
      document.querySelector('[aria-describedby="quickinfo-tooltip"]')?.textContent?.trim() ?? null,
  );
  check('keyboard focus opens the tooltip', described !== null, described ?? 'none');

  await page.goto(`${base}/${site.nested}`);
  await page.waitForSelector('[data-api-id]', { state: 'attached', timeout: 10000 });
  const nested = await annotations('body');
  check('nested page finds its data', nested.length > 0, `${nested.length} annotations`);
  check(
    'Bases link annotated',
    nested.some((a) => a.endsWith('=>toyapi.driver.Device')),
  );
  if (site.name === 'mkdocs') {
    const inSignatures = await annotations('.doc-signature');
    check('mkdocstrings signatures annotated', inSignatures.length > 0, inSignatures.join(' | '));
  }
  check('no console errors or warnings', problems.length === 0, problems.join(' || '));

  await page.close();
  server.close();
}

await browser.close();
console.log(failures ? `\n${failures} e2e checks failed` : '\nall e2e checks passed');
process.exit(failures ? 1 : 0);
