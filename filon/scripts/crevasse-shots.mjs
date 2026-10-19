// crevasse-shots.mjs — map 4's chasms (D94) for review: the nearest crossing of a chasm, a ribbon
// dragged over it (the planner's skybridge pair, its parcels bought), up close and at mid zoom, in iso
// and in plan, by day and by night: scripts/shot-crevasse-<TAG>-*.png (gitignored; TAG=before|after,
// default "after"). Usage: a server on :5183 (or URL=…), then `node scripts/crevasse-shots.mjs`. It
// starts the sandbox base over (FL.wipe: map 4).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const TAG = process.env.TAG ?? 'after';
const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-crevasse-${TAG}-${name}.png`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=${process.env.SEED ?? '1'}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
await page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts, [data-screen="quests"] { display: none !important; }' });

const settle = async (ms = 1200) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

// The nearest straight crossing (east–west) of a chasm 2–4 tiles across, floor on both sides; the bridge over it.
const at = await page.evaluate(() => {
  const sim = window.FL.app.sim, g = sim.grid, C = 512;
  const floor = (x, y) => [0, 1].includes(g.terrain(x, y)) && g.level(x, y) === 0;
  let best = null, bd = Infinity;
  for (let y = C - 110; y <= C + 110; y++) for (let x = C - 110; x <= C + 110; x++) {
    const d = (x - C) ** 2 + (y - C) ** 2;
    if (d >= bd || g.terrain(x + 2, y) !== 13 || !floor(x, y) || !floor(x + 1, y)) continue;
    let n = 0;
    while (g.terrain(x + 2 + n, y) === 13 && n < 5) n++;
    if (n >= 2 && n <= 3 && floor(x + 2 + n, y) && floor(x + 3 + n, y)) { best = [x, y, n]; bd = d; }
  }
  if (!best) return null;
  const [x, y, n] = best;
  const path = Array.from({ length: n + 4 }, (_, k) => [x + k, y, 1]);
  for (const [tx] of [path[0], path[path.length - 1]]) {
    const p = window.FL.parcelAt(tx, y);
    if (!sim.land.holds(p)) { const price = sim.landPrice(p); if (sim.credits < price + 100) sim.grantCredits(price + 100 - sim.credits); sim.buyLand(p); }
  }
  window.FL.unlock('bridge');
  sim.grant('iron_plate', 60);
  const laid = sim.placeBelts('ribbon', path);
  return { x: x + 2 + n / 2, y, n, laid };
});
console.log('crossing', JSON.stringify(at));
if (!at) throw new Error('no chasm crossing near the cirque');
await page.evaluate(() => window.FL.tick(50));

for (const phase of ['noon', 'night']) {
  await page.evaluate((p) => window.FL.dayPhase(p), phase);
  for (const mode of ['iso', 'plan']) {
    await view(mode);
    for (const [name, z] of [['near', 2.0], ['mid', 0.7]]) {
      await page.evaluate(([x, y, zz]) => window.FL.lookAt(Math.round(x), y, zz), [at.x, at.y, z]);
      await settle(1300);
      await page.screenshot({ path: shot(`${mode}-${name}-${phase}`) });
      console.log(`✓ shot-crevasse-${TAG}-${mode}-${name}-${phase}.png`);
    }
  }
}
await browser.close();
