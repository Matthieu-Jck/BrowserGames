// lift-shots.mjs — a line through a traction lift (D141), for visual review: does the lift keep its
// line's pace, or do items back up behind it? It starts the sandbox base over (FL.wipe), raises a
// ridge of rock one terrace up (four tiles deep) on free floor near the Core, and lays two lines
// north across it, each from a silo to a sink silo: a plain ribbon line (west) and a swift one
// (east). The drag lays the lifts itself (D73): one up the ridge's south wall, one down its north
// wall. It runs the base three minutes ahead, measures each line (items into its sink a minute,
// and how full the line is behind and past the lift), then shoots it in iso by day, items moving
// (two frames), and in plan. Writes scripts/lift-<TAG>-*.png (gitignored) and prints the figures.
// Usage: a server (URL=…, default :5183), then `TAG=after node scripts/lift-shots.mjs` from filon/.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const TAG = process.env.TAG ?? 'now';
const shot = (name) => fileURLToPath(new globalThis.URL(`./lift-${TAG}-${name}.png`, import.meta.url));
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
await page.addStyleTag({ content: '.qlog, .guide, .toasts, .nnotice, [data-screen="quests"] { display: none !important; }' });

const rig = await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim, W = 1024;
  FL.unlock();
  FL.unlock('xp_swift');
  const ITEMS = FL.ids().items;
  const regrant = () => { for (const it of ['iron_plate', 'glass', 'copper_wire', 'gear']) if (sim.stock[ITEMS.indexOf(it)] < 2e6) sim.grant(it, 4000); };
  const core = sim.ents.get(sim.hearthId);
  // A box of free floor (16 × 24) south-west of the Core: no building, level 0, plain ground.
  const free = (x, y) => sim.grid.level(x, y) === 0 && sim.grid.terrain(x, y) <= 1 && sim.grid.occ[y * W + x] === 0;
  let bx = -1, by = -1;
  outer: for (let r = 14; r < 120; r += 2) for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x0 = core.x + dx, y0 = core.y + dy;
    let ok = true;
    for (let j = -1; j <= 24 && ok; j++) for (let i = -1; i <= 16 && ok; i++) ok = free(x0 + i, y0 + j);
    if (!ok) continue;
    bx = x0; by = y0; break outer;
  }
  if (bx < 0) return { error: 'no room' };
  sim.explored.push([bx + 8, by + 12, 20]);
  for (let j = -1; j <= 24; j++) for (let i = -1; i <= 16; i++) { const p = FL.parcelAt(bx + i, by + j); if (!sim.land.holds(p)) sim.land.granted.add(p); }
  // The ridge: rows by + 9 … by + 12, the whole box wide, one terrace up.
  const ry = by + 9;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 16; i++) { sim.grid.setTerrain(bx + i, ry + j, 2); sim.grid.setLevel(bx + i, ry + j, 1); }
  sim.markDirty();
  const lines = [];
  for (const [def, lx] of [['ribbon', bx + 5], ['swift_ribbon', bx + 10]]) {
    regrant();
    const src = sim.place('silo', lx, by + 21, 0); // hands out north into (lx, by + 20)
    const sink = sim.place('silo', lx, by + 1, 0); // takes in at its back from (lx, by + 3)
    if (!src.ok || !sink.ok) return { error: `silos ${src.reason} ${sink.reason}` };
    const path = [];
    for (let y = by + 20; y >= by + 3; y--) path.push([lx, y, 0]);
    const n = sim.placeBelts(def, path);
    if (n !== path.length) return { error: `${def}: ${n}/${path.length}` };
    lines.push({ def, x: lx, src: src.id, sink: sink.id, lifts: path.filter(([x, y]) => FL.entityAt(x, y)?.def === 'traction_ribbon').map(([, y]) => y) });
  }
  for (const e of sim.ents.map.values()) if (e.builtAt !== 0) e.builtAt = 0;
  sim.markDirty();
  sim.ensureCompiled();
  const it = FL.itemIndex('iron_plate');
  for (const l of lines) { sim.stores.get(l.src)[it] = 1000 * 1000; sim.graph.nodeByEnt.get(l.src).locked = it; }
  return { bx, by, ry, lines };
});
console.log('rig', JSON.stringify(rig));
if (rig.error) { await browser.close(); process.exit(1); }

// Three minutes ahead (the lines fill and settle), then a minute measured.
const figures = await page.evaluate(({ lines, by }) => {
  const FL = window.FL, sim = FL.app.sim, it = FL.itemIndex('iron_plate');
  sim.run(1800);
  const s0 = lines.map((l) => sim.stores.get(l.sink)[it]);
  sim.run(600);
  return lines.map((l, k) => {
    // How full the line is behind the up lift (its 6 floor tiles) and past the down lift (its 5).
    const full = (ys) => ys.filter((y) => { const c = sim.chainAt(l.x, y); if (!c) return false; const i = c.tiles.indexOf(y * 1024 + l.x); return i >= 0 && c.itemAt(i) >= 0; }).length / ys.length;
    const lift = sim.chainAt(l.x, l.lifts[0]);
    return {
      def: l.def, lifts: l.lifts, perMinIn: Math.round((sim.stores.get(l.sink)[it] - s0[k]) / 1000),
      liftPace: lift?.perMin, behind: full([by + 14, by + 15, by + 16, by + 17, by + 18, by + 19]), past: full([by + 4, by + 5, by + 6, by + 7]),
    };
  });
}, rig);
console.log('figures', JSON.stringify(figures));

const settle = async (ms = 900) => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

await view('iso');
await page.evaluate(({ bx, ry }) => window.FL.lookAt(bx + 8, ry + 1, 2.2), rig);
await settle(1500);
await page.screenshot({ path: shot('iso-1') });
await page.waitForTimeout(260);
await page.screenshot({ path: shot('iso-2') });
await page.evaluate(({ bx, ry }) => window.FL.lookAt(bx + 8, ry + 2, 1.2), rig);
await settle(600);
await page.screenshot({ path: shot('iso-wide') });
await view('plan');
await settle(600);
await page.screenshot({ path: shot('plan') });
await browser.close();
