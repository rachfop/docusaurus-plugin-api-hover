#!/usr/bin/env node
/**
 * Captures the hover screenshots for the README and the docs site from
 * the plugin's own website: the hovers on those pages run through the
 * plugin's Astro integration, so the capture doubles as an end-to-end
 * check (names JSON fetched, prose resolved, DOM annotated, tooltip
 * rendered from the info JSON).
 *
 * Serves nothing itself: run against `blume preview` (or any server
 * holding the built site).
 *
 * Usage:
 *   node scripts/capture-hover.mjs \
 *     --url http://localhost:4173/quickinfo/ \
 *     --symbol max.driver.CPU \
 *     --light ../media/hover-light.png,public/hover-light.png \
 *     --dark  ../media/hover-dark.png,public/hover-dark.png
 *
 * Each output flag takes a comma-separated list, so one capture lands in
 * both the README media dir and the docs site's public dir.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const url = arg('url', 'http://localhost:4173/quickinfo/');
const symbol = arg('symbol', 'max.driver.CPU');
const lightOuts = (arg('light', '../media/hover-light.png,public/hover-light.png') || '')
  .split(',')
  .filter(Boolean);
const darkOuts = (arg('dark', '../media/hover-dark.png,public/hover-dark.png') || '')
  .split(',')
  .filter(Boolean);

const VIEWPORT = { width: 1440, height: 900 };
const PAD_PX = 14;

async function capture(page, theme) {
  await page.addInitScript((t) => {
    localStorage.setItem('blume-theme', t);
  }, theme);
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(url, { waitUntil: 'load' });

  // The runtime must have fetched the names JSON, resolved the prose
  // mention, and stamped data-api-id before anything can hover.
  const target = `[data-api-id="${symbol}"]`;
  await page.waitForSelector(target, { state: 'attached', timeout: 15000 });
  const applied = await page.evaluate(() => document.documentElement.dataset.theme);
  if (applied !== theme) {
    throw new Error(`theme "${theme}" did not apply (html data-theme=${applied})`);
  }
  await page.evaluate(() => document.fonts.ready);

  await page.hover(target);
  // Settle delay runs inside the runtime; the tooltip then needs the
  // info JSON. Wait for the signature block (the richest state).
  await page.waitForSelector('.quickinfo-tooltip .quickinfo-sig', { timeout: 15000 });
  // The highlight on every instance of the symbol settles with the show.
  await page.waitForFunction(
    (sym) => document.querySelector(`[data-api-id="${sym}"]`)?.classList.contains('quickinfo-hl'),
    symbol,
    { timeout: 15000 },
  );
  await page.waitForTimeout(150);

  // Frame the whole code block when the symbol is in one, so the shot
  // shows the snippet the hover resolves against; prose frames the token.
  const anchorBox = await page.locator(target).first().evaluate((el) => {
    const frame = el.closest('figure') ?? el.closest('pre') ?? el;
    const r = frame.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const tooltipBox = await page.locator('.quickinfo-tooltip').boundingBox();
  if (!anchorBox || !tooltipBox) throw new Error('missing anchor or tooltip box');
  const clip = {
    x: Math.max(0, Math.min(anchorBox.x, tooltipBox.x) - PAD_PX),
    y: Math.max(0, Math.min(anchorBox.y, tooltipBox.y) - PAD_PX),
    width: 0,
    height: 0,
  };
  clip.width = Math.min(
    VIEWPORT.width - clip.x,
    Math.max(anchorBox.x + anchorBox.width, tooltipBox.x + tooltipBox.width) + PAD_PX - clip.x,
  );
  clip.height = Math.min(
    VIEWPORT.height - clip.y,
    Math.max(anchorBox.y + anchorBox.height, tooltipBox.y + tooltipBox.height) + PAD_PX - clip.y,
  );
  return page.screenshot({ clip, scale: 'device' });
}

async function save(buf, outs) {
  for (const out of outs) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, buf);
    console.log(`capture: wrote ${out}`);
  }
}

const browser = await chromium.launch();
try {
  for (const [theme, outs] of [
    ['light', lightOuts],
    ['dark', darkOuts],
  ]) {
    if (!outs.length) continue;
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const image = await capture(page, theme);
    await save(image, outs);
    await context.close();
  }
} finally {
  await browser.close();
}
