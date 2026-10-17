// tree-shots.mjs — the tech tree (D33, D107, D111) for visual review: the whole canvas, the window at
// 1440 × 900 on the grown and the late debug bases, a selected node's focused chain (upstream and
// downstream lit, the rest faded), the zoom (the whole tree in the view, a chain focused there and
// kept through a zoom step, a mid zoom, Ctrl+wheel about the pointer), and the same on a tablet held
// upright (768 × 1024, touch).
// Usage: a server (the dev one on :5183, or a frozen preview build: URL=…), then
// `node scripts/tree-shots.mjs` → scripts/tree-<tag>-*.png (gitignored).
// Env: URL, CHROME, TAG (a prefix for the files: « before », « after »…), OUT (a folder for them).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5183';
const TAG = process.env.TAG ?? 'now';
const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('.', import.meta.url));
const shot = (name) => join(OUT, `tree-${TAG}-${name}.png`);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];

/** A page at this size, a debug base loaded, the tree open. */
async function open(viewport, level, touch = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'fr-FR', hasTouch: touch });
  const page = await context.newPage();
  page.on('pageerror', (err) => { errors.push(err.message); console.log('pageerror:', err.message); });
  await page.goto(`${URL}/?debug`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 15000 });
  await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
  const r = await page.evaluate((lv) => window.FL.debugSave(lv), level);
  console.log(`${level} base: ${r.ok ? `${r.ms} ms` : 'refused'}`);
  await page.evaluate(() => { window.FL.menu(false); window.FL.close(); window.FL.pause(); });
  await page.evaluate(() => window.FL.open('research'));
  await page.waitForSelector('[data-screen="research"][data-open]', { timeout: 3000 });
  await page.waitForTimeout(500);
  return { page, context };
}

/** The whole canvas: the window made as big as it, the shot taken, the window put back. */
async function whole(page, name, viewport) {
  const size = await page.evaluate(() => { const c = document.querySelector('.tr-canvas'); return { w: c.offsetWidth, h: c.offsetHeight }; });
  await page.setViewportSize({ width: size.w + 420, height: size.h + 160 });
  await page.waitForTimeout(400);
  await page.locator('.tr-canvas').screenshot({ path: shot(name) });
  await page.setViewportSize(viewport);
  await page.waitForTimeout(300);
}

/** Bring a node into the middle of the tree's view. */
async function centre(page, id) {
  await page.evaluate((nid) => document.querySelector(`.tr-node[data-id="${nid}"]`)?.scrollIntoView({ block: 'center', inline: 'center' }), id);
  await page.waitForTimeout(250);
}

/** The zoom bar's button (D111): fit, in, out, reset; a finger taps it. */
async function zoom(page, how, touch, times = 1) {
  for (let k = 0; k < times; k++) {
    if (touch) await page.tap(`[data-tree-zoom="${how}"]`);
    else await page.click(`[data-tree-zoom="${how}"]`);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(250);
  return page.evaluate(() => ({ z: Number(document.querySelector('.tr-canvas')?.style.zoom || 1), level: document.querySelector('.tr-canvas')?.getAttribute('data-zoom') ?? 'near' }));
}

/** Select a node (a click, or a finger's tap): its chain is focused (D107, D111), the rest fades. */
async function focus(page, id, touch) {
  const box = await page.locator(`.tr-node[data-id="${id}"]`).boundingBox();
  if (!box) { console.log(`✗ no node ${id}`); process.exitCode = 1; return; }
  if (touch) await page.tap(`.tr-node[data-id="${id}"]`);
  else await page.click(`.tr-node[data-id="${id}"]`);
  await page.waitForTimeout(350);
}

// ── desktop, 1440 × 900 ──
{
  const { page, context } = await open({ width: 1440, height: 900 }, 'late');
  await page.screenshot({ path: shot('1440-open') });
  await whole(page, 'whole', { width: 1440, height: 900 });
  await centre(page, 'dn_etcher');
  await focus(page, 'dn_etcher', false);
  await page.screenshot({ path: shot('1440-focus-etcher') });
  await centre(page, 'cm3');
  await focus(page, 'cm3', false);
  await page.screenshot({ path: shot('1440-focus-commerce') });
  await centre(page, 'tr1');
  await page.keyboard.press('Escape'); // the focus let go: the whole tree back
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('1440-tier1') });
  // The zoom (D111): the whole tree in the view, a chain lit at that size, then a mid zoom.
  const fit = await zoom(page, 'fit', false);
  console.log(`fit: ${JSON.stringify(fit)}`);
  await page.screenshot({ path: shot('1440-zoom-fit') });
  await focus(page, 'dn_etcher', false);
  await page.screenshot({ path: shot('1440-zoom-fit-focus') });
  const mid = await zoom(page, 'in', false, 4);
  console.log(`mid: ${JSON.stringify(mid)}`);
  const kept = await page.evaluate(() => document.querySelector('.tr-node[data-id="dn_etcher"]')?.getAttribute('data-chain'));
  console.log(`${kept === 'self' ? '✓' : '✗'} zooming keeps the focus (${kept})`);
  if (kept !== 'self') process.exitCode = 1;
  await page.screenshot({ path: shot('1440-zoom-mid-focus') });
  await page.keyboard.press('Escape');
  await centre(page, 'en4');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('1440-zoom-mid') });
  // Ctrl+wheel about the pointer: the card under it stays under it.
  const b = await page.locator('.tr-node[data-id="en4"]').boundingBox();
  const px = b.x + b.width * 0.3, py = b.y + b.height / 2;
  await page.mouse.move(px, py);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);
  const a = await page.locator('.tr-node[data-id="en4"]').boundingBox();
  const z2 = await page.evaluate(() => Number(document.querySelector('.tr-canvas').style.zoom));
  const held = px >= a.x && px <= a.x + a.width && py >= a.y && py <= a.y + a.height;
  console.log(`${held && z2 > mid.z ? '✓' : '✗'} Ctrl+wheel: ${mid.z.toFixed(3)} → ${z2.toFixed(3)}, the card under the pointer stays (${held})`);
  if (!(held && z2 > mid.z)) process.exitCode = 1;
  await context.close();
}
{
  const { page, context } = await open({ width: 1440, height: 900 }, 'grown');
  await whole(page, 'whole-grown', { width: 1440, height: 900 });
  await centre(page, 'tr_synth');
  await focus(page, 'tr_synth', false);
  await page.screenshot({ path: shot('1440-focus-synth') });
  await context.close();
}

// ── a tablet held upright, 768 × 1024, by touch ──
{
  const { page, context } = await open({ width: 768, height: 1024 }, 'late', true);
  await page.screenshot({ path: shot('tablet-open') });
  await centre(page, 'en_cellgen');
  await focus(page, 'en_cellgen', true);
  await page.screenshot({ path: shot('tablet-focus') });
  const fit = await zoom(page, 'fit', true);
  console.log(`tablet fit: ${JSON.stringify(fit)}`);
  await page.screenshot({ path: shot('tablet-zoom-fit') });
  const mid = await zoom(page, 'in', true, 3);
  console.log(`tablet mid: ${JSON.stringify(mid)}`);
  await centre(page, 'cm2');
  await page.screenshot({ path: shot('tablet-zoom-mid') });
  await context.close();
}

await browser.close();
if (errors.length) { console.log(`✗ ${errors.length} page errors`); process.exitCode = 1; }
console.log(`shots in ${OUT} (tree-${TAG}-*.png)`);
