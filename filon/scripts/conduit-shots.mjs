// conduit-shots.mjs — the conduits as raised pipes in iso (D145; owner, 2026-10-19: « the conduits are
// still flat in isometric view, is that normal »), for visual review. It starts the sandbox base over
// (FL.wipe: bare land) and lays a review rig on free floor south of the Core (granted, not played):
// a pond with a pump, a conduit run out of it — straight, a corner, along a kiln's east face and a
// silo's west face — into a steam boiler's water intake; a second pump's line joining it from the
// side (a tee); a third pump feeding a brickworks; a ribbon beside the first run to compare; and a
// ridge one terrace up with a pond and a pump on it, its conduit along the top, pouring down the
// ridge's south wall (a fall, its wall facing the camera) into a ceramic oven on the floor.
// scripts/shot-conduit-<TAG>-<spot>-<iso|plan>-<near|mid>-<noon|night|dusk>.png (gitignored).
// Usage: a dev server (or a frozen `vite preview`), then
// `URL=http://localhost:<port> TAG=after node scripts/conduit-shots.mjs` (ONLY=run,boiler,… to pick
// spots; TIMES=noon,night,dusk).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const TAG = process.env.TAG ?? 'after';
const URL = process.env.URL ?? 'http://localhost:5183';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const TIMES = (process.env.TIMES ?? 'noon,night').split(',');
const MODES = (process.env.MODES ?? 'iso,plan').split(',');
const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-conduit-${TAG}-${name}.png`, import.meta.url));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=${process.env.SEED ?? '1'}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
await page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts, .nnotice, [data-screen="quests"] { display: none !important; }' });

const rig = await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim, W = 1024, SHALLOW = 6, ROCK = 2;
  FL.unlock();
  for (const id of ['ex_brick', 'tr3', 'steam']) FL.unlock(id);
  const regrant = () => { for (const it of ['iron_plate', 'glass', 'copper_wire', 'gear', 'brick', 'pipe', 'steel']) sim.grant(it, 4000); };
  const core = sim.ents.get(sim.hearthId);
  const BW = 26, BH = 26;
  // A box of free floor (BW × BH) near the Core: no building, level 0, plain ground.
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
  const water = (x0, y0, w, h, lv = 0) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { sim.grid.setTerrain(bx + x0 + i, by + y0 + j, SHALLOW); if (lv) sim.grid.setLevel(bx + x0 + i, by + y0 + j, lv); } };
  // The ridge: rows 0 … 4, columns 12 … 25, one terrace up (its south wall at y = 5 faces the camera).
  for (let j = 0; j <= 4; j++) for (let i = 12; i < BW; i++) { sim.grid.setTerrain(bx + i, by + j, ROCK); sim.grid.setLevel(bx + i, by + j, 1); }
  water(1, 7, 3, 3); // the pond (rig A)
  water(1, 18, 2, 5); // a second pond (the brickworks)
  water(21, 0, 3, 2, 1); // a pond up on the ridge
  sim.markDirty();
  const fails = [];
  const put = (def, x, y, rot) => { regrant(); const r = sim.place(def, bx + x, by + y, rot); if (!r.ok) fails.push(`${def}@${x},${y}: ${r.reason}`); return r.id ?? 0; };
  const line = (def, pts) => { regrant(); const path = pts.map(([x, y, r]) => [bx + x, by + y, r]); const n = sim.placeBelts(def, path); if (n !== path.length) fails.push(`${def} ${n}/${path.length} from ${pts[0]}`); return n; };
  const run = (x, y, dx, dy, n, rot) => Array.from({ length: n }, (_, k) => [x + dx * k, y + dy * k, rot]);
  // Rig A: pump (outlet east) → east 5 → corner south → south along a kiln (west of the line) and a
  // silo (east of it) → corner east → east → corner north into the boiler's water intake.
  const pump = put('pump', 4, 8, 1);
  line('conduit', [...run(5, 8, 1, 0, 5, 1), [10, 8, 2], ...run(10, 9, 0, 1, 6, 2), [10, 15, 1], ...run(11, 15, 1, 0, 5, 1), [16, 15, 0]]);
  const kiln = put('kiln', 8, 10, 0);
  const silo = put('silo', 11, 11, 0);
  const boiler = put('steam_boiler', 14, 13, 0); // tiles 14–16 × 13–14; water intake (2,1) S: from (16, 15) going north
  // A second pump on the pond's south shore, its line joining the run from the side (a tee at (10, 13)).
  const pump2 = put('pump', 2, 10, 2); // outlet south
  line('conduit', [...run(2, 11, 0, 1, 2, 2), [2, 13, 1], ...run(3, 13, 1, 0, 7, 1)]);
  // A ribbon beside the first run, one tile north of it (to compare), fed from a silo with plates.
  const src = put('silo', 3, 4, 1); // a 2 × 2: hands out east at (5, 5)?
  line('ribbon', run(5, 7, 1, 0, 9, 1));
  // Rig B: the brickworks fed by a conduit from the second pond; a sand ribbon into its other intake.
  const brick = put('brickworks', 4, 19, 0); // tiles 4–5 × 19–20; sand (0,1) S from (4, 21), water (1,1) S from (5, 21)
  const pump3 = put('pump', 3, 22, 1); // touches the pond at (2, 22); hands out east into (4, 22)
  line('conduit', [[4, 22, 1], [5, 22, 0], [5, 21, 0]]);
  // Rig C: up on the ridge, a pump by its pond, the conduit west along the top, then south off the
  // edge (a fall down the wall facing the camera) onto the floor, round a ceramic oven by four
  // elbows into its water intake (from the south).
  const pump4 = put('pump', 20, 2, 3); // outlet west
  line('conduit', [...run(19, 2, -1, 0, 4, 3), [15, 2, 2], ...run(15, 3, 0, 1, 3, 2), [15, 6, 1], [16, 6, 1], [17, 6, 2], [17, 7, 2], [17, 8, 2], [17, 9, 3], [16, 9, 3], [15, 9, 0]]);
  const oven = put('ceramic_oven', 14, 7, 0); // tiles 14–15 × 7–8; water (1,1) S: from (15, 9) going north
  for (const e of sim.ents.map.values()) if (e.builtAt !== 0) e.builtAt = 0;
  sim.markDirty();
  sim.ensureCompiled();
  // Plates on the ribbon only (FL.fillRibbons would push them into the conduits too).
  const plate = FL.itemIndex('iron_plate');
  for (const c of sim.graph.chains) if (!c.fluid) for (let i = 0; i < c.length; i++) if (c.itemAt(i) < 0) c.place(i, plate);
  const conduits = [...sim.ents.map.values()].filter((e) => FL.ids().buildings[e.def] === 'conduit').length;
  return { bx, by, fails, ids: { pump, pump2, pump3, pump4, kiln, silo, boiler, brick, oven, src }, conduits };
});
console.log('rig', JSON.stringify(rig));
if (rig.error) { await browser.close(); process.exit(1); }
await page.evaluate(() => window.FL.tick(120));
if (process.env.PROBE) {
  await page.waitForTimeout(800);
  console.log(JSON.stringify(await page.evaluate(() => {
    const bv = window.FL.app.buildings, ps = bv.pipeShades, c = ps.children;
    return { n: c.length, rootVis: bv.shadowRoot.visible, rootAlpha: bv.shadowRoot.alpha, pos: [ps.position.x, ps.position.y], first: c[0] ? { vis: c[0].visible, alpha: c[0].alpha, w: c[0].texture.frame.width, h: c[0].texture.frame.height, x: c[0].x, y: c[0].y, tint: c[0].tint, src: c[0].texture.source.label, parentVis: ps.visible } : null };
  })));
  if (process.env.PROBE === 'hide') {
    await page.evaluate(() => {
      const app = window.FL.app, pipeTex = new Set([...app.atlas.textures].filter(([k]) => k.startsWith('pipe:')).map(([, t]) => t));
      for (const s of app.layers.get('objects').children) if (pipeTex.has(s.texture)) s.visible = false;
    });
    await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 4), [rig.bx + 8, rig.by + 9]);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot('probe-hidden'), clip: { x: 420, y: 250, width: 600, height: 400 } });
  }
}

const settle = async (ms = 900) => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 }).catch(() => {});
};
// The spots (box tiles), each at near (zoom 4) and mid (zoom 1.6); `wide` at 0.8.
const SPOTS = [
  ['run', 8, 9, ['near', 'mid']], // pump → straight → corner, the ribbon beside
  ['along', 10, 12, ['near', 'mid']], // the run between the kiln and the silo, the tee
  ['boiler', 15, 15, ['near']], // into the boiler's intake
  ['brick', 4.5, 21, ['near', 'mid']], // the brickworks
  ['fall', 15.5, 6, ['near', 'mid']], // down the ridge's wall, round the oven
  ['wide', 11, 11, ['wide']],
].filter(([s]) => !ONLY || ONLY.includes(s));
const ZOOM = { near: 4, mid: 1.6, wide: 0.8 };
const CLIP = { near: { x: 420, y: 250, width: 600, height: 400 }, mid: { x: 320, y: 150, width: 800, height: 600 }, wide: { x: 0, y: 0, width: 1440, height: 900 } };
for (const time of TIMES) {
  await page.evaluate((t) => window.FL.dayPhase(t), time);
  for (const mode of MODES) {
    await view(mode);
    for (const [name, x, y, zooms] of SPOTS) {
      for (const z of zooms) {
        // In iso a tile on the ridge (level 1: 2 relief levels) shows lifted; aim at the floor point under it.
        const lift = mode === 'iso' && name === 'fall' ? 0.5 : 0;
        await page.evaluate(([x, y, z]) => window.FL.lookAt(x, y, z), [rig.bx + x - lift, rig.by + y - lift, ZOOM[z]]);
        await settle();
        const file = `${name}-${mode}-${z}-${time}`;
        await page.screenshot({ path: shot(file), clip: CLIP[z] });
        console.log(`✓ shot-conduit-${TAG}-${file}.png`);
      }
    }
  }
}
await browser.close();
