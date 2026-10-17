// render-shots.mjs — the renderer's pictures of a pinned late base, for before / after comparisons
// of render work (D92: culling and incremental rebuilds must draw exactly the same). The late debug
// base is built on seed 1 at a fixed epoch and paused, so two runs draw the same pixels (but for
// the wires' glints, held at their start): iso near / mid / far, plan, by night, at dusk, held mid-morph, the specialised
// views (D88), the Core (D86), the quartz vein and its face cutters (D87), buildings switched off
// (D83: placing and removing buildings while paused leaves a few switched off until the next tick).
// Then, in the same session, a ribbon, a silo and a wind turbine placed and removed (the views
// updated after each change) must draw what a full rebuild draws.
// Usage: a dev server, then `node scripts/render-shots.mjs` → scripts/<PREFIX>-*.png (gitignored).
// Env: URL (http://localhost:5183), PREFIX (rs), BASE (a prefix shot earlier: compare with it, pixel by
// pixel, and write <PREFIX>-diff-*.png where they differ), CHROME.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL = process.env.URL ?? 'http://localhost:5183';
const PREFIX = process.env.PREFIX ?? 'rs';
const BASE = process.env.BASE ?? '';
const here = (name) => fileURLToPath(new globalThis.URL(`./${name}`, import.meta.url));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=1&paused`, { waitUntil: "networkidle" });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 15000 });
await page.addStyleTag({ content: '#ui, .qlog, .guide, .toasts, .debug-badge, .tooltip, #tooltip { display: none !important; }' });

// The pinned late base: seed 1, a fixed epoch, paused before it is swapped in (nothing moves).
const info = await page.evaluate(async () => {
  if (window.FL.app.guide) window.FL.app.guide.enabled = false;
  window.FL.clock('manual');
  window.FL.app.paused = true; // from now on: nothing turns (a moving part's phase is kept across a swap of colony, by entity)
  window.FL.debugSave('late'); // the player's base set aside
  const { foundScenario } = await import('/src/sim/scenarios.ts');
  const { WORLD_EPOCH0 } = await import('/src/sim/constants.ts');
  const { sim } = foundScenario('late', { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Banc' });
  sim.events.length = 0;
  const app = window.FL.app;
  // The wires' glints run on real time: held at their start so two runs draw the same pixels.
  const wires = app.wires, upd = wires.update.bind(wires);
  wires.update = (s, te, dt, ...rest) => { wires.time = 0; return upd(s, te, 0, ...rest); };
  app.setSim(sim);
  app.buildings.show(sim.hearthId);
  window.FL.menu(false); window.FL.close();
  const h = sim.ents.get(sim.hearthId);
  return { hearth: [h.x + 1.5, h.y + 1.5], vein: window.FL.vein(), ents: sim.ents.sorted().length, off: window.FL.workLook().off };
});
console.log(`pinned late base: ${info.ents} entities, ${info.off} switched off, vein ${info.vein ? `${info.vein.x},${info.vein.y}` : 'none'}`);

const settle = async (ms = 1200) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 30000 }).catch(() => console.log('    (chunks still missing)'));
  await page.waitForFunction(() => { const s = window.FL.perf(); return !(s.reliefPending > 0); }, undefined, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((x) => window.FL.view().t === x, mode === 'plan' ? 1 : 0, { timeout: 5000 }).catch(() => {});
};
const at = (x, y, z) => page.evaluate(([a, b, c]) => window.FL.lookAt(a, b, c), [x, y, z]);
const shots = [];
const snap = async (name) => {
  const path = here(`${PREFIX}-${name}.png`);
  await page.screenshot({ path });
  shots.push(name);
  return path;
};

const [hx, hy] = info.hearth;
await page.evaluate(() => window.FL.dayPhase('noon'));
await view('iso');
for (const [n, z] of [['near', 1.3], ['mid', 0.6], ['far', 0.2]]) { await at(hx, hy, z); await settle(); await snap(`iso-${n}`); }
await view('plan');
await at(hx, hy, 0.6); await settle(); await snap('plan-mid');
await at(hx, hy, 1.3); await settle(); await snap('plan-near');
await view('iso');
await page.evaluate(() => window.FL.dayPhase('night'));
await at(hx, hy, 0.6); await settle(); await snap('iso-mid-night');
await page.evaluate(() => window.FL.dayPhase('dusk'));
await settle(); await snap('iso-mid-dusk');
await page.evaluate(() => window.FL.dayPhase('noon'));
// Mid-morph: both the volumes and the plan sprites half shown (layers.ts cross-fade), held there.
await page.evaluate(async () => {
  const { proj } = await import('/src/render/projection.ts');
  const v = window.FL.app.view, keep = v.update;
  v.update = function () { this.t = 0.5; this.te = 0.45; this.P = proj(0.45); };
  window.__unmorph = () => { v.update = keep; };
});
await settle(); await snap('iso-mid-morph');
await page.evaluate(() => window.__unmorph());
for (const v of ['power', 'logistics', 'production']) {
  await page.evaluate((x) => window.FL.mapView(x), v);
  await settle(800); await snap(`iso-${v}`);
}
await page.evaluate(() => window.FL.mapView('normal'));
await at(hx - 1, hy - 1, 2.2); await settle(); await snap('heart');
if (info.vein) { await at(info.vein.x, info.vein.y, 1.6); await settle(); await snap('vein'); }

// Structural changes: a ribbon and a silo placed and removed near the Heart, the views updated
// after each (the frames carry the rebuild); the picture after must be the picture before.
await at(hx, hy, 0.9); await settle(); const before = await snap('change-before');
const changed = await page.evaluate(async () => {
  const frames = (k) => new Promise((res) => { let n = 0; const f = () => (++n >= k ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const app = window.FL.app, c = app.camera.target, done = [];
  for (const def of ['ribbon', 'silo', 'wind_flower']) {
    const spot = window.FL.freeSpot(def, Math.round(c.tx) + 3, Math.round(c.ty) + 3, 30);
    if (!spot) continue;
    const r = window.FL.place(def, spot[0], spot[1], 0);
    await frames(3);
    if (r.ok) { app.sim.remove(spot[0], spot[1]); done.push(def); }
    await frames(3);
  }
  return done;
});
console.log(`placed and removed: ${changed.join(', ')}`);
await settle(600); const after = await snap('change-after');
await page.evaluate(() => window.FL.dayPhase('night'));
await settle(600); const afterNight = await snap('change-after-night');
await page.evaluate(() => window.FL.dayPhase('noon'));
// From scratch: the buildings, the items' paths, the lights (a lights view without records starts afresh on another colony).
await page.evaluate(() => {
  const app = window.FL.app;
  (app.buildings.rebuildAll ?? app.buildings.rebuild).call(app.buildings, app.sim);
  app.items.rebuild(app.sim);
  if (app.lights.rebuildAll) app.lights.rebuildAll(app.sim); else app.lights.rebuild(app.sim);
});
await settle(600); const full = await snap('change-full');
await page.evaluate(() => window.FL.dayPhase('night'));
await settle(600); const fullNight = await snap('change-full-night');
await page.evaluate(() => window.FL.dayPhase('noon'));

/** Pixels that differ between two PNGs (per channel beyond `tol`), and a diff picture (red where they differ). */
async function diff(a, b, out) {
  const r = await page.evaluate(async ([a64, b64]) => {
    const load = async (s) => createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
    const [A, B] = await Promise.all([load(a64), load(b64)]);
    const w = A.width, h = A.height;
    const cv = new OffscreenCanvas(w, h), cx = cv.getContext('2d');
    cx.drawImage(A, 0, 0); const da = cx.getImageData(0, 0, w, h).data;
    cx.clearRect(0, 0, w, h); cx.drawImage(B, 0, 0); const db = cx.getImageData(0, 0, w, h);
    let n = 0, worst = 0;
    const o = db.data;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - o[i]), Math.abs(da[i + 1] - o[i + 1]), Math.abs(da[i + 2] - o[i + 2]));
      if (d > worst) worst = d;
      if (d > 8) { n++; o[i] = 255; o[i + 1] = 0; o[i + 2] = 0; o[i + 3] = 255; } else { const g = (o[i] + o[i + 1] + o[i + 2]) / 3; o[i] = o[i + 1] = o[i + 2] = 200 + g / 5; }
    }
    cx.putImageData(db, 0, 0);
    const blob = await cv.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { n, worst, w, h, png: n ? btoa(s) : null };
  }, [readFileSync(a).toString('base64'), readFileSync(b).toString('base64')]);
  if (r.png && out) writeFileSync(out, Buffer.from(r.png, 'base64'));
  return r;
}
const report = (label, r) => console.log(`${label.padEnd(34)} ${r.n === 0 ? 'same' : `${r.n} px differ (${(100 * r.n / (r.w * r.h)).toFixed(3)} %), worst ${r.worst}`}`);
void before;
report('after changes: updated vs full rebuild', await diff(after, full, here(`${PREFIX}-diff-change-full.png`)));
report('the same by night (the lights)', await diff(afterNight, fullNight, here(`${PREFIX}-diff-change-full-night.png`)));
if (BASE) {
  for (const s of shots) {
    const old = here(`${BASE}-${s}.png`);
    if (!existsSync(old)) continue;
    report(`${BASE} → ${PREFIX}: ${s}`, await diff(old, here(`${PREFIX}-${s}.png`), here(`${PREFIX}-diff-${s}.png`)));
  }
}
await browser.close();
