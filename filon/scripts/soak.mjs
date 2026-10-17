// soak.mjs — a long session in headless Chrome (D100): a debug base played as a player would, for
// MINUTES of wall time (game speed ×1, the camera moving, views and screens opened, buildings placed
// and removed), sampled every minute — the JS heap, DOM nodes and listeners, Pixi's textures and the
// atlas pages, what grows in the colony (statistics, ledger, events, command log), the frame time and
// the page's CPU — to find what grows without bound and what a long session costs. Then, with IDLE,
// the cost of the game left alone: the CPU % in a few states (playing, paused, a screen open, the
// main menu; sound on) — the page's main thread (CDP task time) and the whole browser's (its
// process tree in `ps`: the GPU process, the compositor and the audio count too).
// Usage: a server (better a frozen build: `npx vite build --outDir <dir>` then `npx vite preview
// --outDir <dir> --port <p>`), then `node scripts/soak.mjs` from filon/.
// Every minute's sample follows a forced garbage collection (CDP), so the heap is what is kept. AB
// (below) compares two builds' CPU in alternating windows: the fair way on a busy machine.
// Env: URL (http://localhost:5183; add ?debug on a build), MINUTES (30 rounds of play, ~35 s each), LEVEL (grown), DPR (2), JSON (a path: the samples),
// IDLE (only the idle measurements), IDLE_SECS (30 a state), AB / SAVER_B / ROUNDS (the A/B comparison), CHROME.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const URL = process.env.URL ?? 'http://localhost:5183';
const MINUTES = Number(process.env.MINUTES ?? 30);
const LEVEL = process.env.LEVEL ?? 'grown';
const IDLE_ONLY = !!process.env.IDLE;
const IDLE_SECS = Number(process.env.IDLE_SECS ?? 30);
/** A flag on this browser's command line: its process tree is found by it (the renderer, the GPU process, audio…). */
const MARK = `${process.pid}-${Date.now()}`;

/** CPU seconds the whole browser has used (its main process and every descendant: the GPU's work, the compositor's, the audio's count). */
function treeCpu(mark = MARK) {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,time=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n');
  const kids = new Map(), time = new Map();
  let root = -1;
  for (const r of rows) {
    const m = r.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const pid = +m[1], ppid = +m[2];
    const t = m[3].split(/[-:]/).map(Number).reverse(); // ss.cc, mm, hh, dd
    time.set(pid, (t[0] ?? 0) + 60 * (t[1] ?? 0) + 3600 * (t[2] ?? 0) + 86400 * (t[3] ?? 0));
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
    if (root < 0 && m[4].includes(`--soak-marker=${mark}`) && !m[4].includes('--type=')) root = pid;
  }
  let sum = 0;
  const walk = (p) => { sum += time.get(p) ?? 0; for (const k of kids.get(p) ?? []) walk(k); };
  if (root >= 0) walk(root);
  return sum;
}

// AB=<url A>,<url B>: the same states on two builds (or `SAVER_B=1`: the same build, B in « Basse
// consommation »), each in its own browser, measured in alternating 8-second windows (the machine's
// load drifts: alternating keeps the comparison fair), ROUNDS (6) a state; the medians of the whole
// browser's CPU %.
if (process.env.AB) {
  const [ua, ub] = process.env.AB.split(',');
  const side = async (url, tag, saver) => {
    const mark = `${MARK}-${tag}`;
    const b = await chromium.launch({ headless: true, executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--soak-marker=${mark}`] });
    const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.DPR ?? 2), locale: 'fr-FR' })).newPage();
    await p.goto(url, { waitUntil: 'networkidle' });
    await p.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
    await p.evaluate((lv) => { window.FL.debugSave(lv); window.FL.menu(false); window.FL.close(); window.FL.lookAt(512, 512, 0.8); }, LEVEL);
    await p.mouse.click(1430, 890); // sound on
    if (saver) { await p.evaluate(() => window.FL.menu(true, 'settings')); await p.click('[data-low-power="true"]'); await p.evaluate(() => window.FL.menu(false)); }
    return { b, p, mark };
  };
  const A = await side(ua, 'a', false), B = await side(ub ?? ua, 'b', !!process.env.SAVER_B);
  const states = [['playing', (x) => x.p.evaluate(() => window.FL.close())], ['paused', (x) => x.p.evaluate(() => window.FL.pause())], ['the tree open', (x) => x.p.evaluate(() => { window.FL.resume(); window.FL.open('research'); })]];
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  for (const [name, set] of states) {
    await set(A); await set(B); await new Promise((r) => setTimeout(r, 3000));
    const r = { a: [], b: [] };
    for (let k = 0; k < Number(process.env.ROUNDS ?? 6); k++) {
      for (const [x, out] of [[A, r.a], [B, r.b]]) {
        const c0 = treeCpu(x.mark), t0 = Date.now();
        await new Promise((res) => setTimeout(res, 8000));
        out.push((100 * (treeCpu(x.mark) - c0)) / ((Date.now() - t0) / 1000));
      }
    }
    console.log(`${name.padEnd(16)} A ${med(r.a).toFixed(0).padStart(3)} %   B ${med(r.b).toFixed(0).padStart(3)} %   (A: ${r.a.map((v) => v.toFixed(0)).join(' ')} · B: ${r.b.map((v) => v.toFixed(0)).join(' ')})`);
  }
  await A.b.close(); await B.b.close();
  process.exit(0);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', `--soak-marker=${MARK}`],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.DPR ?? 2), locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 15000 });
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });

const r = await page.evaluate((lv) => window.FL.debugSave(lv), LEVEL);
console.log(`${LEVEL} base built in ${r.ms} ms`);
await page.evaluate(() => { window.FL.menu(false); window.FL.close(); window.FL.resume(); window.FL.lookAt(512, 512, 0.8); });
await page.waitForTimeout(3000);

/** CDP's counters (ms of task and script time are cumulative: CPU % comes from their deltas). */
async function metrics() {
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(m.map((x) => [x.name, x.value]));
}

/** What the page holds: heap, DOM, Pixi's textures, the atlases, the colony's growing arrays, the frame. */
const probe = () => page.evaluate(() => {
  const app = window.FL.app, sim = app.sim, p = window.FL.perf();
  const mem = performance.memory ?? {};
  const tex = app.stage.renderer.texture;
  const sizeOf = (a) => (a && typeof a.size === 'number' ? a.size : Array.isArray(a) ? a.length : 0);
  const b = app.buildings;
  const lenOf = (o) => (Array.isArray(o) ? o.length : o && typeof o.size === 'number' ? o.size : -1);
  return {
    heap: mem.usedJSHeapSize ?? 0,
    heapTotal: mem.totalJSHeapSize ?? 0,
    dom: document.getElementsByTagName('*').length,
    toasts: document.querySelectorAll('.toast').length,
    // Pixi keeps a slot (null) for each texture it ever managed: count the live ones.
    textures: tex?.managedTextures ? tex.managedTextures.filter(Boolean).length : -1,
    texSlots: tex?.managedTextures?.length ?? -1,
    offBaked: b.offSheet?.size ?? -1,
    offPages: b.offSheet?.pages?.length ?? -1,
    shadowPages: b.shadowSheet?.pages?.length ?? -1,
    reliefPages: app.relief?.atlas?.pages?.length ?? app.relief?.dyn?.pages?.length ?? -1,
    chunks: p.chunks, vramMB: p.vramMB,
    statsFine: app.stats.fine.length, statsCoarse: app.stats.coarse.length,
    log: lenOf(sim.log), events: lenOf(sim.events),
    ledger: lenOf(sim.trade?.ledger), gazette: lenOf(sim.market?.gazette ?? sim.market?.state?.gazette),
    lifts: lenOf(app.lifts),
    ents: sim.ents.size, items: p.items, lights: p.lights, wires: p.wires,
    fps: p.fps, frameMs: p.frameMs, drawCalls: p.drawCalls, tick: sim.tick,
  };
});

const key = (k) => page.keyboard.press(k);
/** A minute of play, as a player does it: look around, open a view, a screen, inspect, build. */
async function playMinute(i) {
  // Look around: pan with the mouse, zoom in and out.
  for (let k = 0; k < 4; k++) {
    await page.mouse.move(720, 450);
    await page.mouse.down({ button: 'middle' }).catch(() => {});
    await page.evaluate((d) => { for (let j = 0; j < 30; j++) window.FL.app.camera.panScreen(d[0], d[1]); }, [k % 2 ? -6 : 6, k < 2 ? 3 : -3]);
    await page.mouse.up({ button: 'middle' }).catch(() => {});
    await page.mouse.wheel(0, k % 2 ? 240 : -240);
    await page.waitForTimeout(2500);
  }
  // A view (P, F, O, I in turn), then Normal again.
  const v = ['p', 'f', 'o', 'i'][i % 4];
  await key(v); await page.waitForTimeout(6000); await key('Escape'); await page.waitForTimeout(500);
  if (v === 'i') { await key('Escape'); }
  // A screen every other minute (the tree, the statistics, the Crier), then back.
  if (i % 2 === 0) {
    const s = ['t', 'g', 'm'][(i / 2) % 3];
    await key(s); await page.waitForTimeout(6000); await key('Escape'); await page.waitForTimeout(500);
  }
  // Inspect a building, then let go.
  await page.evaluate((n) => {
    const all = window.FL.app.sim.ents.sorted().filter((e) => e.builtAt === 0);
    const e = all[(n * 37) % all.length];
    if (e) window.FL.selected(e.id);
  }, i);
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.FL.selected(0));
  // Build: the plan view, a ribbon and a silo near the Heart, removed again a minute later.
  await key('b'); await page.waitForTimeout(1500);
  await page.evaluate((n) => {
    const app = window.FL.app, sim = app.sim;
    for (const at of window.__soakPlaced ?? []) sim.remove(at[0], at[1]);
    window.__soakPlaced = [];
    for (const def of ['ribbon', 'silo']) {
      const at = window.FL.freeSpot(def, 512 + ((n * 7) % 30) - 15, 512 + ((n * 11) % 30) - 15, 25);
      if (at && window.FL.place(def, at[0], at[1], 0).ok) window.__soakPlaced.push(at);
    }
  }, i);
  await page.waitForTimeout(3000);
  await key('b'); await page.waitForTimeout(1000);
}

/** The page's CPU % over `secs` (task time / wall time, CDP), and the frames drawn. */
async function cpuOver(secs) {
  const a = await metrics(), [f0, r0] = await page.evaluate(() => [window.__frames, window.__renders]), c0 = treeCpu();
  const t0 = Date.now();
  await page.waitForTimeout(secs * 1000);
  const b = await metrics(), [f1, r1] = await page.evaluate(() => [window.__frames, window.__renders]), c1 = treeCpu();
  const wall = (Date.now() - t0) / 1000;
  return {
    cpu: (100 * (b.TaskDuration - a.TaskDuration)) / wall, script: (100 * (b.ScriptDuration - a.ScriptDuration)) / wall, all: (100 * (c1 - c0)) / wall, fps: (f1 - f0) / wall, renders: (r1 - r0) / wall,
    // The DOM's churn: style recalculations and layouts a second (a change-only refresh writes nothing when nothing changed).
    styles: (b.RecalcStyleCount - a.RecalcStyleCount) / wall, layouts: (b.LayoutCount - a.LayoutCount) / wall,
  };
}
// Frames the loop runs (after « Basse consommation »'s pacing) and renders of the world (fewer under a full screen).
await page.evaluate(() => {
  const app = window.FL.app, f = app.frame.bind(app), r = app.stage.renderer, render = r.render.bind(r);
  window.__frames = 0; window.__renders = 0;
  app.frame = (dt) => { window.__frames++; f(dt); };
  r.render = (...a) => { window.__renders++; return render(...a); };
});

if (IDLE_ONLY) {
  // Sound on, as for a player (the first key or press unlocks it: app/sound.ts).
  await page.mouse.click(1430, 890);
  const states = [
    ['playing, iso, still camera', async () => { await page.evaluate(() => { window.FL.resume(); window.FL.view('iso'); window.FL.lookAt(512, 512, 0.8); }); }],
    ['playing, plan', async () => { await page.evaluate(() => window.FL.view('plan')); }],
    ['paused', async () => { await page.evaluate(() => { window.FL.view('iso'); window.FL.pause(); }); }],
    ['a screen open (the tree)', async () => { await page.evaluate(() => { window.FL.resume(); window.FL.open('research'); }); }],
    ['the main menu', async () => { await page.evaluate(() => { window.FL.close(); window.FL.menu(true); }); }],
    // « Basse consommation » (D100), switched on from the settings page where the build has it.
    ['battery saver, playing, iso', async () => {
      await page.evaluate(() => window.FL.menu(true, 'settings'));
      await page.waitForTimeout(300);
      const b = await page.$('[data-low-power="true"]');
      if (b) await b.click();
      await page.evaluate(() => window.FL.menu(false));
      return !!b;
    }],
  ];
  // A hidden tab is not measured: headless Chrome keeps every page visible. In a browser a hidden tab
  // gets no animation frames (no frame, no tick: the catch-up pays the time back on return) and the
  // sound suspends (audio/sound.ts); only the autosave and the clock's resync timers run.
  const out = [];
  for (const [name, set] of states) {
    if ((await set()) === false) { console.log(`${name.padEnd(30)} (not in this build)`); continue; }
    await page.waitForTimeout(3000);
    const c = await cpuOver(IDLE_SECS);
    out.push({ state: name, ...c });
    console.log(`${name.padEnd(30)} page ${c.cpu.toFixed(1).padStart(5)} % (script ${c.script.toFixed(1).padStart(5)} %)  whole browser ${c.all.toFixed(0).padStart(4)} %  ${c.fps.toFixed(0)} frames/s, ${c.renders.toFixed(0)} renders/s  styles ${c.styles.toFixed(1)}/s  layouts ${c.layouts.toFixed(1)}/s`);
  }
  if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify(out, null, 1));
  await browser.close();
  process.exit(0);
}

const samples = [];
const t0 = Date.now();
await cdp.send('HeapProfiler.enable').catch(() => {});
let m0 = await metrics(), c0 = treeCpu();
for (let i = 0; i <= MINUTES; i++) {
  // The heap a garbage collection leaves (twice: what the first frees can free more): what is truly kept, not the sawtooth.
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const m = await metrics(), c = treeCpu();
  const wall = Math.max(1, (Date.now() - (samples.at(-1)?.at ?? t0)) / 1000);
  const s = { min: Math.round((Date.now() - t0) / 6000) / 10, ...(await probe()),
    nodes: m.Nodes, listeners: m.JSEventListeners, docs: m.Documents, cpu: (100 * (m.TaskDuration - m0.TaskDuration)) / wall, all: (100 * (c - c0)) / wall, at: Date.now() };
  m0 = m; c0 = c;
  samples.push(s);
  console.log(`${String(s.min).padStart(5)} min  heap ${(s.heap / 1048576).toFixed(1).padStart(6)} MB  dom ${String(s.dom).padStart(5)}  listeners ${String(s.listeners).padStart(6)}  textures ${String(s.textures).padStart(5)}  off ${s.offBaked}/${s.offPages}p  shadow ${s.shadowPages}p  log ${s.log}  events ${s.events}  stats ${s.statsFine}/${s.statsCoarse}  fps ${s.fps}  frame ${s.frameMs.toFixed(1)} ms  cpu page ${s.cpu.toFixed(0)} % browser ${s.all.toFixed(0)} %`);
  if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify(samples, null, 1));
  if (i < MINUTES) await playMinute(i);
}
// Growth per hour of what matters, from a straight line through the samples after the first five minutes.
const tail = samples.filter((s) => s.min >= 5);
const slope = (k) => {
  const n = tail.length; if (n < 3) return NaN;
  const mx = tail.reduce((a, s) => a + s.min, 0) / n, my = tail.reduce((a, s) => a + s[k], 0) / n;
  const num = tail.reduce((a, s) => a + (s.min - mx) * (s[k] - my), 0), den = tail.reduce((a, s) => a + (s.min - mx) ** 2, 0);
  return (60 * num) / den;
};
console.log(`per hour: heap ${(slope('heap') / 1048576).toFixed(1)} MB, DOM ${slope('dom').toFixed(0)}, listeners ${slope('listeners').toFixed(0)}, textures ${slope('textures').toFixed(0)}, command log ${slope('log').toFixed(0)}`);
await browser.close();
