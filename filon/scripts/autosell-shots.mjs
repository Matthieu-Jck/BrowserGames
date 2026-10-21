// autosell-shots.mjs — auto-sell (D127) for visual review, in French and in English at 1440 × 900, on
// the « late » debug base (it learns « Vente automatique » and auto-sells its most plentiful item):
// the Stock panel with the auto-sold rows — the ◉ at each row's end, « Vendu automatiquement : +X ◉/h »
// —, then a second item switched on from its ◉ and filled to the Core's cap (what comes beyond is sold,
// D164), and after ten game minutes the purse's card scrolled to its « Vente automatique » section.
// Usage: a server (the dev one on :5183, or a frozen preview build: URL=…), then
// `node scripts/autosell-shots.mjs` → scripts/autosell-<tag>-<lang>-*.png (gitignored).
// Env: URL, CHROME, TAG (a prefix for the files), OUT (a folder for them), LANGS (« fr,en »).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5183';
const TAG = process.env.TAG ?? 'now';
const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('.', import.meta.url));
const LANGS = (process.env.LANGS ?? 'fr,en').split(',');

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let failed = false;
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed = true; };

for (const lang of LANGS) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: lang === 'fr' ? 'fr-FR' : 'en-GB' });
  const page = await context.newPage();
  page.on('pageerror', (err) => { failed = true; console.log('pageerror:', err.message); });
  await page.goto(`${URL}/?debug`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 15000 });
  const FL = (fn, arg) => page.evaluate(fn, arg);
  const shot = (name) => page.screenshot({ path: join(OUT, `autosell-${TAG}-${lang}-${name}.png`) });
  await FL(() => { if (window.FL.app.guide) window.FL.app.guide.enabled = false; window.FL.pause(); });
  const r = await FL(() => window.FL.debugSave('late'));
  check(r.ok, `${lang}: the late base`);
  await FL(() => { window.FL.menu(false); window.FL.close(); window.FL.resume(); });
  await page.waitForFunction(() => !document.querySelector('[data-hud-stock]')?.hidden, undefined, { timeout: 3000 });
  await page.click('[data-hud-stock]');
  await page.waitForTimeout(1300);
  // The auto-sold row brought into view, then the panel.
  const top = await FL(() => { const n = document.querySelector('[data-screen="stock"] .stk-row[data-auto]'); n?.scrollIntoView({ block: 'center' }); return n?.getAttribute('data-item') ?? null; });
  check(!!top, `${lang}: an auto-sold row (${top})`);
  await page.waitForTimeout(300);
  await shot('1-stock');
  // Another item on from its ◉, the Core filled to its cap of it (D164).
  const pick = await FL(() => [...document.querySelectorAll('[data-screen="stock"] .stk-row[data-item]:not([data-auto])')].find((n) => !n.querySelector('[data-stock-auto]')?.hidden && Number((n.querySelector('.stk-val')?.textContent ?? '0').replace(/\D/g, '')) > 150)?.getAttribute('data-item') ?? null);
  check(!!pick, `${lang}: an item to switch on (${pick})`);
  await FL((id) => document.querySelector(`[data-stock-auto="${id}"]`)?.scrollIntoView({ block: 'center' }), pick);
  await page.click(`[data-stock-auto="${pick}"]`);
  await page.waitForTimeout(400);
  await FL((id) => { const sim = window.FL.app.sim, i = window.FL.itemIndex(id), room = Math.floor(sim.hearthCap() / 1000) - Math.floor(sim.stock[i] / 1000); if (room > 0) sim.grant(id, room); }, pick);
  await page.waitForTimeout(400);
  await shot('2-on');
  check(await FL((id) => window.FL.app.sim.trade.autoSell.has(window.FL.itemIndex(id)), pick), `${lang}: switched on`);
  // Ten game minutes, one at a time (the HUD samples the purse once a minute): the lines fill.
  for (let m = 0; m < 10; m++) { await FL(() => window.FL.tick(600)); await page.waitForTimeout(80); }
  await page.waitForTimeout(600);
  await FL(() => document.querySelector('[data-screen="stock"] .stk-row[data-auto]')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await shot('3-stock-sold');
  await page.click('[data-hud-purse]');
  await page.waitForSelector('[data-screen="purse"]:not([hidden]) [data-sec="purse-auto"]', { timeout: 3000 }).catch(() => null);
  const sec = await FL(() => { const n = document.querySelector('[data-screen="purse"] [data-sec="purse-auto"]'); n?.scrollIntoView({ block: 'center' }); return n ? n.querySelectorAll('.purse-line[data-flow="auto"]').length : 0; });
  check(sec >= 1, `${lang}: the purse's « Vente automatique » lines (${sec})`);
  await page.waitForTimeout(300);
  await shot('4-purse');
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
