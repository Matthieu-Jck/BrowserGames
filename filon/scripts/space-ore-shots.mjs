// space-ore-shots.mjs — space or ore on map 4 (D94; owner, 2026-10-16: « Dans les grandes étendues
// de désert, il ne devrait pas y avoir beaucoup de minéraux, mais au moins il y a de la place. Alors
// que sur les parcelles où il y a des minéraux, il faut qu'il y ait peu de place »): an open desert
// parcel and a rich, cramped one near each other at far zoom, in plan and in iso, then the Terrain
// view (I) over them — each parcel's usable-floor gauge and its ore pips — with the cramped one
// picked (the land panel's « Sol constructible » and « Minerai »): scripts/shot-space-ore-*.png
// (gitignored). Usage: a server on :5183 (or URL=…, SEED=…), then `node scripts/space-ore-shots.mjs`.
// It starts the sandbox base over (FL.wipe: map 4) and lifts the fog round the cirque (a review rig).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-space-ore-${name}.png`, import.meta.url));
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
await page.addStyleTag({ content: '.qlog, .guide, .buildbar, .toasts, [data-screen="quests"] { display: none !important; }' });

const settle = async (ms = 1500) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

// Per parcel of the rings past the starting square: its ore tiles and its usable floor (a floor tile a
// 2 × 2 square of floor at one level holds: sim/world/floor.ts's rule, read here from the grid). The
// pair: an open desert parcel (≥ 85 %, no ore) and a rich, cramped one (≥ 30 ore tiles, ≤ 45 %), closest first.
const pair = await page.evaluate(() => {
  const sim = window.FL.app.sim, g = sim.grid;
  sim.explored.push([512, 512, 200]);
  const FLOOR = new Set([0, 1, 8, 9, 11, 12]);
  const fl = (x, y, lv) => FLOOR.has(g.terrain(x, y)) && g.level(x, y) === lv;
  const usable = (x, y) => {
    if (!FLOOR.has(g.terrain(x, y))) return false;
    const lv = g.level(x, y);
    for (const [ox, oy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (fl(x + ox, y + oy, lv) && fl(x + ox + 1, y + oy, lv) && fl(x + ox, y + oy + 1, lv) && fl(x + ox + 1, y + oy + 1, lv)) return true;
    return false;
  };
  const facts = [];
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 2) continue;
    const c = window.FL.parcel(dx, dy), [cx, cy] = c.at;
    let ore = 0, surface = 0, use = 0;
    for (let y = cy - 11; y <= cy + 11; y++) for (let x = cx - 11; x <= cx + 11; x++) {
      if (g.ore(x, y) >= 0) { ore++; if (g.level(x, y) === 0) surface++; }
      if (usable(x, y)) use++;
    }
    facts.push({ p: c.p, dx, dy, cx, cy, ore, surface, floor: Math.round((use * 100) / 529) });
  }
  // The rich one with ore at the foot of its walls (drillable now), not only veins under the rock.
  const open = facts.filter((f) => f.floor >= 85 && f.ore === 0), rich = facts.filter((f) => f.ore >= 30 && f.surface >= 15 && f.floor <= 50);
  let best = null;
  for (const a of open) for (const b of rich) {
    const d = (a.dx - b.dx) ** 2 + (a.dy - b.dy) ** 2;
    if (!best || d < best.d) best = { d, open: a, rich: b };
  }
  return { best, open: open.length, rich: rich.length };
});
console.log('pair', JSON.stringify(pair));
if (!pair.best) throw new Error('no open desert and rich parcels on this land');
const mid = [Math.round((pair.best.open.cx + pair.best.rich.cx) / 2), Math.round((pair.best.open.cy + pair.best.rich.cy) / 2)];

for (const mode of ['plan', 'iso']) {
  await view(mode);
  await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 0.22), mid);
  await settle(2500);
  await page.screenshot({ path: shot(`far-${mode}`) });
  console.log(`✓ shot-space-ore-far-${mode}.png`);
}
// The Terrain view: gauges and pips over the pair, the rich one picked.
await page.evaluate((p) => { window.FL.mapView('land'); window.FL.app.landTool.click(p); }, pair.best.rich.p);
await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 0.26), mid);
await settle(2500);
await page.screenshot({ path: shot('terrain-view') });
console.log('✓ shot-space-ore-terrain-view.png');
const panel = await page.evaluate(() => ({ floor: document.querySelector('.land-floor')?.textContent, ore: document.querySelector('.land-ore')?.textContent, price: document.querySelector('[data-land-act="buy"] .land-price')?.textContent }));
console.log('panel (rich)', JSON.stringify(panel));
await page.evaluate((p) => window.FL.app.landTool.click(p), pair.best.open.p);
await settle(800);
const panel2 = await page.evaluate(() => ({ floor: document.querySelector('.land-floor')?.textContent, ore: document.querySelector('.land-ore')?.textContent, price: document.querySelector('[data-land-act="buy"] .land-price')?.textContent }));
console.log('panel (open)', JSON.stringify(panel2));
await browser.close();
