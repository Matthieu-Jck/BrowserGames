// tree-d144-shots.mjs — the tech tree's presentation (D144) for visual review, before and after: on a
// fresh base (`claim`: the plans only), the tutorial's end (`tutorial`: the lab, Tier 1 open), the
// grown and the late debug bases, in French and English, at 1440 × 900 —
//   · `open`: the tree as it opens (the zoom this browser last left: 100 % in a new one);
//   · `fit`: « Tout voir », the whole tree in the view;
//   · `mid`: a mid zoom (about 55 %), the selection in the middle;
//   · `focus`: a node selected (its chain lit, the rest dimmed), at its own size;
//   · `next`: the « available now » filter on (D144), where it exists;
//   · `launch`: the launch dialog of a research node that can start;
//   · `phone`: a phone held upright (390 × 844, touch), as the tree opens.
// Usage: a server (a frozen preview build on a port of your own: URL=…), then
// `node scripts/tree-d144-shots.mjs` → <OUT>/tree144-<tag>-<base>-<lang>-<shot>.png.
// Env: URL, CHROME, TAG (« before », « after »…), OUT (a folder), BASES (« claim,tutorial,grown,late »),
// LANGS (« fr,en »), SHOTS (a comma list to keep, default all).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5183';
const TAG = process.env.TAG ?? 'now';
const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('.', import.meta.url));
const BASES = (process.env.BASES ?? 'claim,tutorial,grown,late').split(',');
const LANGS = (process.env.LANGS ?? 'fr,en').split(',');
const SHOTS = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
const want = (s) => !SHOTS || SHOTS.has(s);
/** The node each base focuses: a mid-tree one with a chain both ways. */
const FOCUS = { claim: 'sorter', tutorial: 'dn_steel', grown: 'tr_synth', late: 'dn_chipfab' };

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];

async function open(viewport, base, lang, touch = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: lang === 'fr' ? 'fr-FR' : 'en-GB', hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  page.on('pageerror', (err) => { errors.push(err.message); console.log('pageerror:', err.message); });
  await page.goto(`${URL}/?debug`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 15000 });
  await page.evaluate((l) => { window.FL.setLocale(l); window.FL.intro?.(false); window.FL.menu?.(false); if (window.FL.app.guide) window.FL.app.guide.enabled = false; }, lang);
  const r = await page.evaluate((lv) => window.FL.debugSave(lv), base);
  await page.evaluate(() => { window.FL.menu(false); window.FL.close(); window.FL.pause(); });
  const facts = await page.evaluate(() => ({ done: window.FL.app.sim.done.size, lvl: window.FL.app.sim.hearthLevel }));
  console.log(`[${base}/${lang}${touch ? '/touch' : ''}] ${r.ok ? `${r.ms} ms` : 'refused'} · ${facts.done} done · Core ${facts.lvl}`);
  await page.evaluate(() => window.FL.open('research'));
  await page.waitForSelector('[data-screen="research"][data-open]', { timeout: 3000 });
  await page.waitForTimeout(600);
  return { page, context };
}

const shot = (base, lang, name) => join(OUT, `tree144-${TAG}-${base}-${lang}-${name}.png`);

async function zoomTo(page, how, times = 1) {
  for (let k = 0; k < times; k++) { await page.click(`[data-tree-zoom="${how}"]`); await page.waitForTimeout(120); }
  await page.waitForTimeout(250);
}

async function centre(page, id) {
  await page.evaluate((nid) => document.querySelector(`.tr-node[data-id="${nid}"]`)?.scrollIntoView({ block: 'center', inline: 'center' }), id);
  await page.waitForTimeout(250);
}

for (const base of BASES) for (const lang of LANGS) {
  const { page, context } = await open({ width: 1440, height: 900 }, base, lang);
  if (want('open')) await page.screenshot({ path: shot(base, lang, 'open') });
  if (want('fit')) { await zoomTo(page, 'fit'); await page.mouse.move(5, 5); await page.screenshot({ path: shot(base, lang, 'fit') }); }
  if (want('mid')) {
    await zoomTo(page, 'reset');
    await zoomTo(page, 'out', 3);
    const sel = await page.evaluate(() => document.querySelector('.tr-node[data-on]')?.getAttribute('data-id'));
    if (sel) await centre(page, sel);
    await page.mouse.move(5, 5);
    await page.screenshot({ path: shot(base, lang, 'mid') });
  }
  if (want('focus')) {
    await zoomTo(page, 'reset');
    const id = FOCUS[base];
    await centre(page, id);
    await page.click(`.tr-node[data-id="${id}"]`, { position: { x: 20, y: 12 } });
    await page.waitForTimeout(350);
    await page.mouse.move(5, 5);
    await page.screenshot({ path: shot(base, lang, 'focus') });
    await page.keyboard.press('Escape');
  }
  if (want('next')) {
    const has = await page.$('[data-tree-filter]');
    if (has) {
      await page.click('[data-tree-filter]');
      await page.waitForTimeout(400);
      const ready = await page.evaluate(() => document.querySelector('.tr-node[data-state="ready"]')?.getAttribute('data-id') ?? null);
      if (ready) await centre(page, ready);
      await page.mouse.move(5, 5);
      await page.screenshot({ path: shot(base, lang, 'next') });
      await page.click('[data-tree-filter]');
      await page.waitForTimeout(200);
    }
  }
  if (want('launch')) {
    // A research node that can start, its detail's « Lancer »: the launch dialog. The base rigged in the
    // sandbox (outside commands, as launch-shots.mjs does): the projects cancelled, the Core stocked.
    const id = await page.evaluate(() => {
      const sim = window.FL.app.sim;
      for (const p of [...sim.projects]) sim.cancelResearch(p.id);
      for (const it of window.FL.ids().items) sim.grant(it, 3000);
      return [...document.querySelectorAll('.tr-node[data-kind="research"]')].map((n) => n.getAttribute('data-id')).find((nid) => !sim.done.has(nid) && !sim.researchBlock(nid)) ?? null;
    });
    if (id) {
      await page.waitForTimeout(400); // a refresh: the card's state follows the rig
      await centre(page, id);
      await page.click(`.tr-node[data-id="${id}"]`, { position: { x: 20, y: 12 } });
      await page.waitForTimeout(300);
      const go = (await page.$('[data-start]')) ?? (await page.$('.rs-detail .rs-actions .btn.primary'));
      if (go) {
        await go.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: shot(base, lang, 'launch') });
        await page.keyboard.press('Escape');
      }
    } else console.log(`  (${base}: no research can start — no launch shot)`);
  }
  await context.close();
  if (want('phone')) {
    const ph = await open({ width: 390, height: 844 }, base, lang, true);
    await ph.page.screenshot({ path: shot(base, lang, 'phone') });
    await ph.context.close();
  }
}

await browser.close();
if (errors.length) { console.log(`✗ ${errors.length} page error(s)`); process.exitCode = 1; }
else console.log('✓ no page errors');
