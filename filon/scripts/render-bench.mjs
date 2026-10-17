// render-bench.mjs — the renderer's frame times on big bases, headless (playwright-core, the system
// Chrome), for perf work (D92): the late debug base and the stress colony (the engine bench's base20k,
// ~15 000 entities, loaded in the browser) at near, mid and far zoom, in iso and plan, by day and night,
// and with a specialised view on (D88); then the cost of a structural change (a ribbon placed, a
// building placed), and while panning. Each case settles (terrain painted, relief baked), then frames are recorded for
// a few seconds: the median and 95th percentile of the frame's JS time (`frameMs`: sim ticks, views,
// UI, the Pixi render call), the render call alone, the frames per second seen.
// Usage: start a dev server, then `node scripts/render-bench.mjs` (from filon/).
// Env: URL (default http://localhost:5183), CASES (comma-separated names, or a substring), REPS (3),
// SECS (recording seconds a case, 3), BASES (late,stress), DPR (device pixel ratio, 1), JSON (a path: write the results there),
// PROFILE (a case name: also write a CPU profile of it to PROFILE_DIR (the system's temp directory)/render-bench-<case>.cpuprofile),
// TRACE (print every recorded frame's time: the 10 Hz sim tick's frames stand out), CHROME.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5183';
const REPS = Number(process.env.REPS ?? 3);
const SECS = Number(process.env.SECS ?? 3);
const BASES = (process.env.BASES ?? 'late,stress').split(',');
const ONLY = process.env.CASES ? process.env.CASES.split(',') : null;
const PROFILE = process.env.PROFILE ?? '';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.DPR ?? 1), locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 15000 });
await page.evaluate(() => {
  if (window.FL.app.guide) window.FL.app.guide.enabled = false;
  // Every frame's JS time, render call and dt, recorded while `on`.
  const app = window.FL.app, perf = app.perf, orig = perf.frame.bind(perf);
  window.__rb = { on: false, rows: [] };
  perf.frame = (ms, dt) => { if (window.__rb.on) window.__rb.rows.push([ms, perf.stats.renderMs, dt]); orig(ms, dt); };
});

const settle = async (ms = 1200) => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 30000 }).catch(() => console.log('    (chunks still missing)'));
  await page.waitForTimeout(ms);
};
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] ?? NaN; };
const median = (a) => q(a, 0.5);

/** Record SECS seconds of frames: median and p95 frame time, median render call, fps. */
async function record(pan = false) {
  await page.evaluate((p) => {
    window.__rb.rows = []; window.__rb.on = true;
    // Panning: the camera dragged 8 px a frame, back and forth (terrain streams, buckets are culled and shown).
    if (p) { let k = 0; const step = () => { if (!window.__rb.on) return; const d = (Math.floor(k++ / 90) % 2 ? -8 : 8); window.FL.app.camera.panScreen(d, d * 0.4); requestAnimationFrame(step); }; requestAnimationFrame(step); }
  }, pan);
  await page.waitForTimeout(SECS * 1000);
  const rows = await page.evaluate(() => { window.__rb.on = false; return window.__rb.rows; });
  const ms = rows.map((r) => r[0]), rd = rows.map((r) => r[1]);
  const secs = rows.reduce((s, r) => s + r[2], 0);
  const st = await page.evaluate(() => { const p = window.FL.perf(); return { draw: p.drawCalls, items: p.items, relief: p.reliefSprites, objects: window.FL.app.layers.get('objects').children.length, plan: window.FL.app.layers.get('plan').children.length, belts: window.FL.app.layers.get('belts').children.length }; });
  return { med: median(ms), p95: q(ms, 0.95), render: median(rd), fps: rows.length / Math.max(secs, 1e-6), n: rows.length, ...st };
}

const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  const t = mode === 'plan' ? 1 : 0;
  await page.waitForFunction((x) => window.FL.view().t === x, t, { timeout: 5000 }).catch(() => {});
};

const results = [];
async function runCase(base, name, setup, pan = false) {
  const full = `${base}:${name}`;
  if (ONLY && !ONLY.some((o) => full.includes(o))) return;
  await setup();
  await settle();
  const reps = [];
  let cdp = null;
  if (PROFILE && full === PROFILE) { cdp = await context.newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  for (let i = 0; i < REPS; i++) reps.push(await record(pan));
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    const out = join(process.env.PROFILE_DIR ?? tmpdir(), `render-bench-${full.replace(/[^a-z0-9]+/gi, '-')}.cpuprofile`);
    writeFileSync(out, JSON.stringify(profile));
    console.log(`    profile → ${out}`);
  }
  if (process.env.TRACE) { const rows = await page.evaluate(() => window.__rb.rows.map((r) => r[0].toFixed(1))); console.log(`    frames: ${rows.join(' ')}`); }
  const pick = (k) => median(reps.map((r) => r[k]));
  const r = { case: full, med: pick('med'), p95: pick('p95'), render: pick('render'), fps: pick('fps'), draw: pick('draw'), objects: reps[0].objects, plan: reps[0].plan, belts: reps[0].belts, items: reps[0].items, relief: reps[0].relief };
  results.push(r);
  console.log(`${full.padEnd(30)} frame ${r.med.toFixed(2).padStart(6)} ms (p95 ${r.p95.toFixed(1).padStart(5)})  render ${r.render.toFixed(2).padStart(5)} ms  ${r.fps.toFixed(0).padStart(3)} fps  draws ${String(r.draw).padStart(4)}  objects ${r.objects} plan ${r.plan} belts ${r.belts} items ${r.items} relief ${r.relief}`);
}

/** The cases on the base in play, centred on (cx, cy). */
async function cases(base, cx, cy) {
  const at = (z) => page.evaluate(([x, y, zz]) => window.FL.lookAt(x, y, zz), [cx, cy, z]);
  const day = (p) => page.evaluate((x) => window.FL.dayPhase(x), p);
  const mapView = (v) => page.evaluate((x) => window.FL.mapView(x), v);
  for (const [zn, z] of [['near', 1.2], ['mid', 0.55], ['far', 0.18]]) {
    await runCase(base, `iso-${zn}-day`, async () => { await mapView('normal'); await view('iso'); await day('noon'); await at(z); });
    await runCase(base, `plan-${zn}-day`, async () => { await view('plan'); await at(z); });
  }
  await runCase(base, 'iso-mid-night', async () => { await view('iso'); await day('night'); await at(0.55); });
  await runCase(base, 'iso-far-night', async () => { await at(0.18); });
  for (const v of ['power', 'logistics', 'production']) {
    await runCase(base, `iso-mid-${v}`, async () => { await day('noon'); await mapView(v); await at(0.55); });
  }
  await runCase(base, 'plan-mid-power', async () => { await mapView('power'); await view('plan'); await at(0.55); });
  await runCase(base, 'iso-near-pan', async () => { await mapView('normal'); await view('iso'); await at(1.2); }, true);
  await runCase(base, 'plan-near-pan', async () => { await view('plan'); await at(1.2); }, true);
  await runCase(base, 'iso-far-pan', async () => { await view('iso'); await at(0.18); }, true);
  await mapView('normal');
  await view('iso');
  await day('noon');
  await at(0.55);
}

/** A structural change: the views' rebuilds timed alone (median of REPS×3), then the frame that carries one. */
async function structural(base) {
  const full = `${base}:structural`;
  if (ONLY && !ONLY.some((o) => full.includes(o))) return;
  await settle(500);
  let cdp = null;
  if (PROFILE && full === PROFILE) { cdp = await context.newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  const r = await page.evaluate(async (n) => {
    const app = window.FL.app, sim = app.sim;
    const time = (f) => { const t0 = performance.now(); f(); return performance.now() - t0; };
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const b = [], full = [], it = [], li = [];
    for (let i = 0; i < n; i++) {
      if (app.buildings.rebuildAll) full.push(time(() => app.buildings.rebuildAll(sim)));
      b.push(time(() => app.buildings.rebuild(sim)));
      it.push(time(() => app.items.rebuild(sim)));
      li.push(time(() => app.lights.rebuild(sim)));
    }
    // A ribbon, then a building, placed by a command at a free spot near the camera: the next frames' JS time.
    const frames = async (k) => { const out = []; for (let i = 0; i < k; i++) { await new Promise((res) => requestAnimationFrame(res)); out.push(app.perf.stats.frameMs); } return out; };
    const c = app.camera.target;
    const place = async (def) => {
      const spot = window.FL.freeSpot(def, Math.round(c.tx), Math.round(c.ty), 40);
      if (!spot) return null;
      await frames(3);
      const placed = window.FL.place(def, spot[0], spot[1], 0);
      const f = await frames(4);
      if (placed.ok) window.FL.app.sim.remove(spot[0], spot[1]);
      await frames(3);
      return { ok: placed.ok, reason: placed.reason, frames: f };
    };
    const ribbon = await place('ribbon');
    const building = await place('silo');
    return { buildings: med(b), full: full.length ? med(full) : NaN, items: med(it), lights: med(li), ribbon, building, ents: sim.ents.sorted().length };
  }, REPS * 3);
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    const out = join(process.env.PROFILE_DIR ?? tmpdir(), `render-bench-${full.replace(/[^a-z0-9]+/gi, '-')}.cpuprofile`);
    writeFileSync(out, JSON.stringify(profile));
    console.log(`    profile → ${out}`);
  }
  const worst = (p) => (p && p.frames ? Math.max(...p.frames).toFixed(1) : 'n/a');
  console.log(`${full.padEnd(30)} rebuild: buildings ${r.buildings.toFixed(1)} ms (from scratch ${r.full.toFixed(1)} ms), items ${r.items.toFixed(1)} ms, lights ${r.lights.toFixed(1)} ms (${r.ents} entities); frame with a ribbon placed ${worst(r.ribbon)} ms (${r.ribbon?.reason ?? '-'}), a silo ${worst(r.building)} ms (${r.building?.reason ?? '-'})`);
  results.push({ case: full, ...r });
}

if (BASES.includes('late')) {
  const r = await page.evaluate(() => window.FL.debugSave('late'));
  console.log(`late base built in ${r.ms} ms`);
  await page.evaluate(() => { window.FL.menu(false); window.FL.close(); window.FL.tick(600); });
  await cases('late', 512, 512);
  await structural('late');
}
if (BASES.includes('stress')) {
  const n = await page.evaluate(async () => {
    if (!window.FL.debugSaves()?.current) window.FL.debugSave('late'); // the player's base set aside first
    const { buildBench } = await import('/src/sim/bench/base20k.ts');
    const sim = buildBench();
    sim.run(600);
    window.FL.app.setSim(sim);
    window.FL.app.buildings.show(sim.hearthId);
    window.FL.menu(false); window.FL.close();
    return sim.ents.sorted().length;
  });
  console.log(`stress colony: ${n} entities`);
  await cases('stress', 512, 512);
  await structural('stress');
}

if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify(results, null, 1));
await browser.close();
