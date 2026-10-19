// obstacle-shots.mjs — map 4's obstacles (D94) for review: the land round the cirque at far zoom
// in iso and in plan (massifs and their cliffs, chasms, rivers), a river and a chasm up close, a
// ribbon dragged across a chasm (the planner's skybridge pair), and the Terrain view (I) with each
// parcel's usable-floor gauge and the land panel's figure: scripts/shot-obstacles-*.png
// (gitignored). Usage: a server on :5183 (or URL=…), then `node scripts/obstacle-shots.mjs`. It
// starts the sandbox base over (FL.wipe: today's map, 4).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./${name}`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';
const SEED = process.env.SEED ?? '1';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=${SEED}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
const hideUi = () => page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts, [data-screen="quests"] { display: none !important; }' });

const settle = async (ms = 1200) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

// The land: its map version, the nearest chasm and river.
const land = await page.evaluate(() => {
  const sim = window.FL.app.sim, g = sim.grid, C = 512;
  const near = (t) => {
    let best = null, bd = Infinity;
    for (let y = C - 110; y <= C + 110; y++) for (let x = C - 110; x <= C + 110; x++) {
      if (g.terrain(x, y) !== t) continue;
      const d = (x - C) ** 2 + (y - C) ** 2;
      if (d < bd) { bd = d; best = [x, y]; }
    }
    return best;
  };
  // A straight crossing of a chasm, east–west or north–south: floor, 2–3 chasm tiles, floor, all at level 0.
  let cross = null;
  for (let r = 40; r < 110 && !cross; r++) {
    for (let y = C - r; y <= C + r && !cross; y++) for (let x = C - r; x <= C + r && !cross; x++) {
      if (Math.max(Math.abs(x - C), Math.abs(y - C)) !== r) continue;
      for (const [dx, dy, rot] of [[1, 0, 1], [0, 1, 2]]) {
        let n = 0;
        while (g.terrain(x + dx * (3 + n), y + dy * (3 + n)) === 13 && n < 5) n++;
        if (n < 2 || n > 3) continue;
        let ok = true;
        for (let k = 0; k < 3; k++) if (g.terrain(x + dx * k, y + dy * k) === 13 || g.level(x + dx * k, y + dy * k) !== 0 || ![0, 1].includes(g.terrain(x + dx * k, y + dy * k))) ok = false;
        for (let k = 3 + n; k < 6 + n; k++) if (g.level(x + dx * k, y + dy * k) !== 0 || ![0, 1].includes(g.terrain(x + dx * k, y + dy * k))) ok = false;
        if (ok) { cross = { x, y, dx, dy, rot, n }; break; }
      }
    }
  }
  return { mapV: g.source.mapV, chasm: near(13), river: near(14), cross };
});
console.log('land', JSON.stringify(land));
if ((land.mapV ?? 1) < 4) throw new Error(`map ${land.mapV}: the obstacles are map 4's (and 5's, D136)`);
await hideUi();

await view('iso');
await page.evaluate(() => window.FL.lookAt(512, 512, 0.2));
await settle(2500);
await page.screenshot({ path: shot('shot-obstacles-far-iso.png') });
console.log('✓ shot-obstacles-far-iso.png');
await view('plan');
await page.evaluate(() => window.FL.lookAt(512, 512, 0.2));
await settle(2500);
await page.screenshot({ path: shot('shot-obstacles-far-plan.png') });
console.log('✓ shot-obstacles-far-plan.png');

await view('iso');
if (land.river) {
  await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 1.5), land.river);
  await settle(1500);
  await page.screenshot({ path: shot('shot-obstacles-river-iso.png') });
  console.log('✓ shot-obstacles-river-iso.png');
}
if (land.chasm) {
  await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 1.5), land.chasm);
  await settle(1500);
  await page.screenshot({ path: shot('shot-obstacles-chasm-iso.png') });
  console.log('✓ shot-obstacles-chasm-iso.png');
  await view('plan');
  await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 1.5), land.chasm);
  await settle(1500);
  await page.screenshot({ path: shot('shot-obstacles-chasm-plan.png') });
  console.log('✓ shot-obstacles-chasm-plan.png');
  await view('iso');
}

// A ribbon dragged across the chasm: the parcel bought (no kite delay), the drag planned whole.
if (land.cross) {
  const laid = await page.evaluate((c) => {
    const sim = window.FL.app.sim, len = c.n + 6, path = [];
    for (let k = 0; k < len; k++) path.push([c.x + c.dx * k, c.y + c.dy * k, c.rot]);
    for (const [x, y] of [path[0], path[len - 1]]) {
      const p = window.FL.parcelAt(x, y);
      if (!sim.land.holds(p)) { const price = sim.landPrice(p); if (sim.credits < price) sim.grantCredits(price - sim.credits + 100); sim.buyLand(p); }
    }
    window.FL.unlock('bridge');
    sim.grant('iron_plate', 60);
    const planned = sim.planBelts('ribbon', path).map((s) => (s.leapt ? 'leapt' : s.ok ? s.def : s.reason));
    const n = sim.placeBelts('ribbon', path);
    return { planned, n };
  }, land.cross);
  console.log('bridge', JSON.stringify(laid));
  await page.evaluate(() => window.FL.tick(50));
  const mid = [land.cross.x + land.cross.dx * (2 + land.cross.n / 2), land.cross.y + land.cross.dy * (2 + land.cross.n / 2)];
  await page.evaluate(([x, y]) => window.FL.lookAt(Math.round(x), Math.round(y), 2.2), mid);
  await settle(1500);
  await page.screenshot({ path: shot('shot-obstacles-bridge-iso.png') });
  console.log('✓ shot-obstacles-bridge-iso.png');
}

// The Terrain view (I): the parcels' gauges, a parcel past the starting square picked, its panel.
await page.addStyleTag({ content: '.hud, .toasts { display: revert !important; }' });
await view('plan');
const picked = await page.evaluate(() => {
  window.FL.mapView('land');
  // A parcel just past the starting square, west.
  const P = window.FL.parcel(-2, 0);
  window.FL.app.landTool.click(P.p);
  return P;
});
await page.evaluate(() => window.FL.lookAt(482, 512, 0.24));
await settle(2500);
await page.screenshot({ path: shot('shot-obstacles-terrain-view.png') });
console.log('✓ shot-obstacles-terrain-view.png', JSON.stringify(picked));
const panel = await page.evaluate(() => document.querySelector('.land-floor')?.textContent ?? null);
console.log('land panel floor:', panel);
await browser.close();
