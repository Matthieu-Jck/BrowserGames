// bridge-shots.mjs — a backed-up line over a skybridge (D121; owner, 2026-10-17: « quand la file
// est pleine, les objets devraient pouvoir patienter sur le pont »): a ribbon north, a skybridge pair
// over a three-tile gap with a line running under its deck, a dead end past it, a tall silo just in
// front of the deck (the iso order: the silo hides the deck behind it, and what waits there with it),
// every square filled (FL.fillRibbons) and the base paused — iso near and mid, plan near, by day:
// scripts/shot-bridge-<TAG>-*.png (gitignored; TAG=before|after). Also prints what the items view
// drew over the deck's tiles (tile, height, drawn over or its depth key). Usage: a server (URL=…,
// default :5183), then `TAG=after node scripts/bridge-shots.mjs`. It starts the sandbox base over
// (FL.wipe) and lays the rig near the Core, finished at once (a review rig, outside commands).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const TAG = process.env.TAG ?? 'after';
const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-bridge-${TAG}-${name}.png`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=${process.env.SEED ?? '2'}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
await page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts, [data-screen="quests"] { display: none !important; }' });

// The rig, at the first spot round the Core where every piece may stand (x0: the line's column, Y: its first ribbon).
const rig = await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim;
  FL.unlock();
  sim.grant('iron_plate', 400);
  sim.grant('glass', 40);
  const core = sim.ents.get(sim.hearthId);
  const pieces = (x0, Y) => {
    const out = [];
    for (let k = 0; k < 3; k++) out.push(['ribbon', x0, Y - k, 0]); // Y…Y−2, north
    out.push(['skybridge', x0, Y - 3, 0]);
    for (let i = -3; i <= 3; i++) out.push(['ribbon', x0 + i, Y - 4, 1]); // the line under the deck, east
    out.push(['skybridge', x0, Y - 7, 0]); // the gap: Y−4…Y−6
    for (let k = 8; k <= 10; k++) out.push(['ribbon', x0, Y - k, 0]); // a dead end
    out.push(['silo', x0 + 1, Y - 6, 0]); // tall, beside the deck and in front of it (x0+1…x0+2, Y−6…Y−5)
    return out;
  };
  for (let r = 6; r < 40; r++) {
    for (let a = 0; a < 64; a++) {
      const x0 = Math.round(core.x + r * Math.cos((a * Math.PI) / 32)), Y = Math.round(core.y + r * Math.sin((a * Math.PI) / 32));
      const ps = pieces(x0, Y);
      if (!ps.every(([d, x, y, rot]) => sim.canPlace(d, x, y, rot).ok)) continue;
      sim.explored.push([x0, Y - 5, 12]);
      for (const [d, x, y, rot] of ps) {
        const ok = d === 'ribbon' ? sim.placeBelts('ribbon', [[x, y, rot]]) === 1 : sim.place(d, x, y, rot).ok;
        if (!ok) return { error: `${d} at ${x},${y}` };
      }
      for (const e of sim.ents.map.values()) if (e.builtAt !== 0) e.builtAt = 0;
      sim.markDirty();
      sim.ensureCompiled();
      const n = FL.fillRibbons('iron_ore');
      FL.pause();
      const c = sim.chainAt(x0, Y);
      return { x0, Y, filled: n, cells: c ? c.length : 0 };
    }
  }
  return { error: 'no spot' };
});
console.log('rig', JSON.stringify(rig));
if (rig.error) { await browser.close(); process.exit(1); }

const settle = async (ms = 1200) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};
/** What the items view drew over the column's deck and ramps last frame. */
const deck = async () => page.evaluate(({ x0, Y }) => {
  const items = window.FL.app.items;
  items.debugOn = true;
  return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const out = items.debugSnapshot().filter((d) => d.x > x0 && d.x < x0 + 1 && d.y > Y - 8 && d.y < Y - 2)
      .map((d) => `${(d.y - (Y - 7)).toFixed(2)}@z${d.z.toFixed(0)}:${d.over ? 'over' : Number.isNaN(d.sorted) ? 'floor' : `k${d.sorted.toFixed(2)}`}`);
    items.debugOn = false;
    res(out.sort());
  })));
}, rig);

const clip = { x: 350, y: 175, width: 500, height: 450 };
for (const [mode, zooms] of [['iso', { near: 1.6, mid: 1.0 }], ['plan', { near: 1.6 }]]) {
  await view(mode);
  for (const [zn, z] of Object.entries(zooms)) {
    await page.evaluate(({ x, y, z }) => window.FL.lookAt(x, y, z), { x: rig.x0 + 0.5, y: rig.Y - 4.5, z });
    await settle();
    await page.screenshot({ path: shot(`${zn}-${mode}`), clip });
    console.log(`${zn}-${mode}`, (await deck()).join(' '));
  }
}
await browser.close();
