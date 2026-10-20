// orders-shots.mjs — CrierBelt's delivery orders and the claims' standings (D153) for visual review, in
// French and in English at 1440 × 900:
//   · the « grown » debug base, just past the tutorial: the first order's notice (quartz) and the HUD;
//     the Crier's Commandes tab with the offers; the first order accepted and filling through the
//     post (a rig: a silo of quartz led into the post's entrance, `FL.orderRig`), its card and the
//     HUD's chip; the order filled (its notice, the history); the Gazette's « Classement des
//     concessions »;
//   · the « late » debug base: its orders (bigger, at its Core's level 5) and its standings.
// Usage: a server (the dev one on :5183, or a frozen preview build: URL=…), then
// `node scripts/orders-shots.mjs` → scripts/orders-<tag>-<lang>-*.png (gitignored).
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

/** A page on a debug base of its own (a context each: a second debug base reloads the page). */
async function open(lang, level) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: lang === 'fr' ? 'fr-FR' : 'en-GB' });
  const page = await context.newPage();
  page.on('pageerror', (err) => { failed = true; console.log('pageerror:', err.message); });
  page.on('console', (msg) => { if (msg.type() === 'error') { failed = true; console.log('console:', msg.text()); } });
  await page.goto(`${URL}/?debug`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 15000 });
  const FL = (fn, arg) => page.evaluate(fn, arg);
  await FL(() => { if (window.FL.app.guide) window.FL.app.guide.enabled = false; window.FL.pause(); });
  const r = await FL((l) => window.FL.debugSave(l), level);
  check(r.ok, `${lang}: the ${level} base (${r.quest})`);
  await FL(() => { window.FL.menu(false); window.FL.close(); window.FL.resume(); });
  const shot = (name) => page.screenshot({ path: join(OUT, `orders-${TAG}-${lang}-${name}.png`) });
  const minutes = async (n) => { for (let m = 0; m < n; m++) { await FL(() => window.FL.tick(600)); await page.waitForTimeout(40); } };
  return { context, page, FL, shot, minutes };
}

for (const lang of LANGS) {
  // ── a base just past the tutorial ──
  let { context, page, FL, shot, minutes } = await open(lang, 'grown');
  {
  // Its orders as the build left them: start them afresh so the first (quartz) is the one on show.
  await FL(() => { const d = window.FL.app.sim.deliveries; d.open = []; d.past = []; d.firstPosted = false; d.filled = d.missed = d.paid = 0; });
  await minutes(1);
  let o = await FL(() => window.FL.orders());
  check(o.open.length === 1 && o.open[0].first && o.open[0].item === 'quartz', `${lang}: the first order is quartz (${JSON.stringify(o.open)})`);
  await page.waitForSelector('[data-screen="order-notice"]:not([hidden])', { timeout: 3000 }).catch(() => null);
  check(await page.isVisible('[data-screen="order-notice"]'), `${lang}: the first order's notice`);
  check(await page.isVisible('[data-hud-orders]'), `${lang}: the HUD's orders chip`);
  await page.waitForTimeout(400);
  await shot('1-first-notice');
  // More orders over the next half hour, then the Crier's Commandes tab.
  await minutes(31);
  await page.click('[data-order-see]').catch(() => page.click('[data-hud-orders]'));
  await page.waitForSelector('[data-screen="market"][data-open] [data-crier-pane="orders"]:not([hidden])', { timeout: 3000 });
  await page.waitForTimeout(700);
  const cards = await FL(() => document.querySelectorAll('.dl-card').length);
  check(cards >= 2, `${lang}: ${cards} order cards`);
  await shot('2-crier-orders');
  // The first accepted from its card; a rig leads quartz into the post: the order fills through it.
  const first = await FL(() => window.FL.orders().open.find((x) => x.first)?.id ?? 0);
  await page.click(`[data-delivery-accept="${first}"]`);
  // The grown base's post takes quartz already (its quartz line, D87); else a rig leads some in.
  const fed = await FL(() => window.FL.app.sim.graph.postIn && [...window.FL.app.sim.selling.values()].some((st) => st[window.FL.itemIndex('quartz')] > 0));
  if (!fed) {
    const rig = await FL(() => window.FL.orderRig('quartz', 200, 600));
    check(rig && rig.ribbons > 0, `${lang}: a silo of quartz led into the post (${JSON.stringify(rig)})`);
  }
  await minutes(3);
  await page.waitForTimeout(600);
  o = await FL(() => window.FL.orders());
  const f = o.open.find((x) => x.id === first);
  check(f && f.due >= 0 && f.got > 0 && f.got < f.n, `${lang}: the order filling (${f && `${f.got}/${f.n}`})`);
  await shot('3-crier-filling');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, `orders-${TAG}-${lang}-4-hud-chip.png`), clip: { x: 0, y: 0, width: 1100, height: 130 } });
  // Filled: CrierBelt pays; its notice; the history in the Crier.
  for (let m = 0; m < 20 && (await FL((id) => window.FL.orders().open.some((x) => x.id === id), first)); m++) await minutes(1);
  o = await FL(() => window.FL.orders());
  check(o.past.some((x) => x.id === first && x.what === 'filled'), `${lang}: the order filled (${JSON.stringify(o.past)})`);
  await page.waitForTimeout(500);
  await shot('5-filled-toast');
  await page.keyboard.press('m');
  await page.waitForSelector('[data-screen="market"][data-open]', { timeout: 3000 });
  await FL(() => window.FL.app.crier.show('orders'));
  await page.waitForTimeout(600);
  await shot('6-crier-history');
  // The standings, after the next world hour.
  await minutes(60);
  await page.waitForTimeout(500);
  const rk = await FL(() => window.FL.orders().ranking);
  check(rk.rank > 0 && rk.rank <= 41, `${lang}: the standings (${JSON.stringify(rk)})`);
  await FL(() => document.querySelector('[data-crier-section="ranking"]')?.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: join(OUT, `orders-${TAG}-${lang}-7-ranking.png`), clip: { x: 0, y: 0, width: 720, height: 900 } });
  await page.keyboard.press('Escape');
  }
  await context.close();

  // ── the late base ──
  ({ context, page, FL, shot, minutes } = await open(lang, 'late'));
  await minutes(46);
  const lo = await FL(() => window.FL.orders());
  check(lo.open.length >= 2, `${lang}: the late base's orders (${lo.open.map((x) => `${x.n} ${x.item}`).join(', ')})`);
  await page.keyboard.press('m');
  await page.waitForSelector('[data-screen="market"][data-open]', { timeout: 3000 });
  await FL(() => window.FL.app.crier.show('orders'));
  await page.waitForTimeout(800);
  await shot('8-late-orders');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await shot('9-late-hud');
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
