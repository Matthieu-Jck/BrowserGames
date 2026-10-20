// tee-shots.mjs — conduits that share their water (D152; owner, 2026-10-19: « we also need conduits
// that share the water between multiple paths »), for visual review. It starts the sandbox base over
// (FL.wipe: bare land) and lays a rig on free floor near the Core (granted, not played): a pond, a
// pump, a conduit run east and north into a steam boiler's water intake (its coal from a silo by a
// ribbon); a branch drawn south off the run's third tile (a tee: its sharing valve), round into a
// brickworks' water intake (its sand from a silo by a ribbon, its bricks into an incinerator); a
// second pump's line joining the run from the side just before the tee (a join: no valve). Shots:
// the rig at near and mid zoom, iso and plan, noon and night; the tee's inspector (its water by way);
// the Logistique view; the tip while a conduit is dragged off the run's side (the tee's mark).
// scripts/shot-tee-<TAG>-<what>.png (gitignored).
// Usage: a dev server (or a frozen `vite preview`), then
// `URL=http://localhost:<port> TAG=after node scripts/tee-shots.mjs` (TIMES=noon,night; MODES=iso,plan).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const TAG = process.env.TAG ?? 'after';
const URL = process.env.URL ?? 'http://localhost:5183';
const TIMES = (process.env.TIMES ?? 'noon,night').split(',');
const MODES = (process.env.MODES ?? 'iso,plan').split(',');
const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-tee-${TAG}-${name}.png`, import.meta.url));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => { errors.push(err.message); console.log('pageerror:', err.message); });
await page.goto(`${URL}/?seed=${process.env.SEED ?? '1'}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
const hideHud = await page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts, .nnotice, [data-screen="quests"] { display: none !important; }' });

const rig = await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim, W = 1024, SHALLOW = 6;
  FL.unlock();
  for (const id of ['ex_brick', 'steam']) FL.unlock(id);
  const regrant = () => { for (const it of ['iron_plate', 'glass', 'copper_wire', 'gear', 'brick', 'pipe', 'steel', 'circuit', 'cable', 'oscillator']) sim.grant(it, 4000); };
  const core = sim.ents.get(sim.hearthId);
  const BW = 16, BH = 18;
  const free = (x, y) => sim.grid.level(x, y) === 0 && sim.grid.terrain(x, y) <= 1 && sim.grid.occ[y * W + x] === 0;
  let bx = -1, by = -1;
  outer: for (let r = 12; r < 160; r += 2) for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x0 = core.x + dx, y0 = core.y + dy;
    let ok = true;
    for (let j = -1; j <= BH && ok; j++) for (let i = -1; i <= BW && ok; i++) ok = free(x0 + i, y0 + j);
    if (!ok) continue;
    bx = x0; by = y0; break outer;
  }
  if (bx < 0) return { error: 'no room' };
  for (let j = -2; j <= BH + 1; j++) for (let i = -2; i <= BW + 1; i++) { const p = FL.parcelAt(bx + i, by + j); if (!sim.land.holds(p)) sim.land.granted.add(p); }
  for (let j = 6; j <= 9; j++) for (let i = 1; i <= 3; i++) sim.grid.setTerrain(bx + i, by + j, SHALLOW); // the pond
  sim.markDirty();
  const fails = [];
  const put = (def, x, y, rot) => { regrant(); const r = sim.place(def, bx + x, by + y, rot); if (!r.ok) fails.push(`${def}@${x},${y}: ${r.reason}`); return r.id ?? 0; };
  const line = (def, pts, want = pts.length) => { regrant(); const path = pts.map(([x, y, r]) => [bx + x, by + y, r]); const n = sim.placeBelts(def, path); if (n !== want) fails.push(`${def} ${n}/${want} from ${pts[0]}`); return n; };
  const run = (x, y, dx, dy, n, rot) => Array.from({ length: n }, (_, k) => [x + dx * k, y + dy * k, rot]);
  // The boiler (tiles 10–12 × 2–3): coal in at (10, 3) from the south, water at (12, 3) from the south.
  const boiler = put('steam_boiler', 10, 2, 0);
  const coal = put('silo', 9, 5, 0); // hands out north at (10, 5) into the ribbon (10, 4)
  line('ribbon', [[10, 4, 0]]);
  // The pump (outlet east) and the run: east along y = 7, north up x = 12 into the boiler.
  const pump = put('pump', 4, 7, 1);
  line('conduit', [...run(5, 7, 1, 0, 7, 1), ...run(12, 7, 0, -1, 4, 0)]);
  // The brickworks (tiles 8–9 × 11–12): sand in at (8, 12), water at (9, 12), both from the south; bricks out at (8, 11) north into an incinerator.
  const works = put('brickworks', 8, 11, 0);
  const inc = put('incinerator', 8, 10, 0);
  const sand = put('silo', 6, 14, 0); // hands out north at (7, 14) into the ribbon (7, 13)
  line('ribbon', [[7, 13, 1], [8, 13, 0]]);
  // The branch, dragged off the run's side at (7, 7) — the drag starts on the run (kept: a tee) — south, east, south, west into the brickworks.
  line('conduit', [[7, 7, 2], [7, 8, 2], [7, 9, 1], [8, 9, 1], [9, 9, 1], [10, 9, 1], [11, 9, 2], [11, 10, 2], [11, 11, 2], [11, 12, 2], [11, 13, 3], [10, 13, 3], [9, 13, 0]], 12);
  // A second pump on the pond's shore, its line into the run's side at (6, 7): a join.
  const pump2 = put('pump', 4, 9, 1);
  line('conduit', [[5, 9, 1], [6, 9, 0], [6, 8, 0]]);
  for (const e of sim.ents.map.values()) if (e.builtAt !== 0) e.builtAt = 0;
  sim.markDirty();
  sim.ensureCompiled();
  for (const [id, item] of [[coal, 'coal'], [sand, 'sand']]) { const it = FL.itemIndex(item); sim.stores.get(id)[it] = 800 * 1000; sim.graph.nodeByEnt.get(id).locked = it; }
  for (const id of [boiler, pump, pump2, works]) FL.powerTo(id);
  // Two servers ask the grid for more than the Core gives: the boiler at work, drinking.
  const servers = [];
  FL.unlock('an_servers');
  for (const [x, y] of [[1, 12], [3, 12], [1, 15]]) { const id = put('server', x, y, 0); if (id) { servers.push(id); sim.ents.get(id).builtAt = 0; } }
  sim.markDirty();
  for (const id of servers) FL.powerTo(id);
  const t = (x, y) => (by + y) * W + bx + x;
  return {
    bx, by, fails, ids: { boiler, pump, pump2, works, inc, coal, sand, servers },
    tee: sim.graph.tees.get(t(7, 7)) ?? 0, join: sim.graph.tees.has(t(6, 7)), teeId: sim.grid.occ[t(7, 7)],
  };
});
console.log('rig', JSON.stringify(rig));
if (rig.error || rig.fails.length) console.log('RIG PROBLEMS', rig.error ?? rig.fails);
if (rig.error) { await browser.close(); process.exit(1); }
await page.evaluate(() => window.FL.tick(1800)); // three minutes: the lines full, the boiler and the works at it

const settle = async (ms = 900) => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 }).catch(() => {});
};
const ZOOM = { near: 4.2, mid: 1.7, wide: 1.2 };
const CLIP = { near: { x: 420, y: 250, width: 600, height: 400 }, mid: { x: 220, y: 100, width: 1000, height: 700 }, wide: { x: 120, y: 60, width: 1200, height: 780 } };
// The tee up close; the whole rig (the pumps, the tee, the boiler up the run, the brickworks down the branch).
const SPOTS = [['tee', 7, 7.6, ['near']], ['rig', 8, 7.6, ['mid']]];
for (const time of TIMES) {
  await page.evaluate((t) => window.FL.dayPhase(t), time);
  for (const mode of MODES) {
    await view(mode);
    for (const [name, x, y, zooms] of SPOTS) {
      for (const z of zooms) {
        await page.evaluate(([x, y, z]) => window.FL.lookAt(x, y, z), [rig.bx + x, rig.by + y, ZOOM[z]]);
        await settle();
        const file = `${name}-${mode}-${z}-${time}`;
        await page.screenshot({ path: shot(file), clip: CLIP[z] });
        console.log(`✓ shot-tee-${TAG}-${file}.png`);
      }
    }
  }
}

// The tee's inspector: its water by way (the HUD back, the camera on the rig).
await page.evaluate((t) => window.FL.dayPhase(t), 'noon');
await view('iso');
await hideHud.evaluate((n) => n.remove());
await page.addStyleTag({ content: '.qlog, .guide, .toasts, .nnotice, [data-screen="quests"] { display: none !important; }' });
await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 2), [rig.bx + 6, rig.by + 8.5]);
await page.evaluate((id) => window.FL.selected(id), rig.teeId);
await page.evaluate(() => window.FL.tick(300));
await settle(1500);
await page.screenshot({ path: shot('inspector'), fullPage: false });
console.log(`✓ shot-tee-${TAG}-inspector.png`);
const insp = await page.evaluate(() => {
  const sec = document.querySelector('[data-sec="tee"]');
  if (!sec) return null;
  return { text: sec.textContent, ways: [...sec.querySelectorAll('[data-tee-way]')].map((r) => ({ way: r.getAttribute('data-tee-way'), v: r.querySelector('.kmeter-v')?.textContent, title: r.getAttribute('title') })) };
});
console.log('inspector', JSON.stringify(insp));
const box = await page.locator('[data-sec="tee"]').boundingBox().catch(() => null);
if (box) await page.screenshot({ path: shot('inspector-tee'), clip: { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 12), width: box.width + 24, height: box.height + 24 } });
await page.evaluate(() => window.FL.selected(0));

// The Logistique view.
await page.evaluate(() => window.FL.mapView('logistics'));
await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 2), [rig.bx + 8.5, rig.by + 8.5]);
for (const mode of MODES) {
  await view(mode);
  await settle(1500);
  await page.screenshot({ path: shot(`logistics-${mode}`), fullPage: false });
  console.log(`✓ shot-tee-${TAG}-logistics-${mode}.png`);
}
await page.evaluate(() => window.FL.mapView('normal'));

// The tip while a conduit is dragged off the run's side (plan view, building).
await view('plan');
await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 3), [rig.bx + 9, rig.by + 8]);
await page.evaluate(() => window.FL.tool('conduit'));
await settle(600);
const at = async (x, y) => page.evaluate(([x, y]) => window.FL.tileToScreen(x, y), [rig.bx + x, rig.by + y]);
const [ax, ay] = await at(9, 7), [cx, cy] = await at(9, 8);
await page.mouse.move(ax, ay);
await page.mouse.down();
await page.mouse.move((ax + cx) / 2, (ay + cy) / 2, { steps: 4 });
await page.mouse.move(cx, cy, { steps: 4 });
await page.waitForTimeout(700);
await page.screenshot({ path: shot('tip-split'), clip: { x: Math.max(0, cx - 260), y: Math.max(0, cy - 200), width: 520, height: 400 } });
console.log(`✓ shot-tee-${TAG}-tip-split.png`);
const tip = await page.evaluate(() => { const n = document.querySelector('.tip-tee'); return n ? { tee: n.getAttribute('data-tee'), label: n.getAttribute('aria-label') } : null; });
console.log('tip', JSON.stringify(tip));
await page.keyboard.press('Escape');
await page.mouse.up();
console.log('errors', errors.length);
await browser.close();
