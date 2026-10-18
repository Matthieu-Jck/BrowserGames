// pipe-shots.mjs — D142's water ports, for visual review: on the late debug base (seed 1: its steam
// boiler watered by its left intake, the look's variant; seed 2: the brickworks too), every water
// pump, steam boiler, brickworks and ceramic oven with its conduit, close up and a little further
// (the ribbon-fed machines around them to compare), iso and plan, at noon and at night; and beside
// each water drinker a twin left unwired and unfed (switched off, D83: its default water entrance).
// scripts/shot-pipe-<TAG>-s<seed>-<what>-<iso|plan>-<near|mid>-<noon|night>.png (gitignored).
// Usage: a dev server (or a frozen `vite preview`), then
// `URL=http://localhost:<port> TAG=after SEEDS=1,2 node scripts/pipe-shots.mjs` (ONLY=pump,steam_boiler,… to pick).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const TAG = process.env.TAG ?? 'after';
const URL = process.env.URL ?? 'http://localhost:5183';
const SEEDS = (process.env.SEEDS ?? '1,2').split(',').map(Number);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const TIMES = (process.env.TIMES ?? 'noon,night').split(',');
const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-pipe-${TAG}-${name}.png`, import.meta.url));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const WATER = ['pump', 'steam_boiler', 'brickworks', 'ceramic_oven'].filter((d) => !ONLY || ONLY.includes(d));

// SHEET=1: the atlas's own pictures instead — each water building in its four turns, its own look and
// each variant (its pipework on another entrance), lit and switched off, iso and plan, a ribbon-fed
// kiln beside them; and a conduit's straight, corner and inlet pieces with their coupling:
// scripts/shot-pipe-<TAG>-sheet-<iso|plan>-<a|b>.png.
if (process.env.SHEET) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, locale: 'fr-FR' });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('pageerror:', err.message));
  await page.goto(`${URL}/?seed=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
  for (const [iso, page2, ids] of [[true, 'a', ['pump', 'hp_pump', 'steam_boiler']], [true, 'b', ['brickworks', 'ceramic_oven', 'kiln', '']], [false, 'a', ['pump', 'hp_pump', 'steam_boiler']], [false, 'b', ['brickworks', 'ceramic_oven', 'kiln', '']]]) {
    await page.evaluate(async ([iso, ids]) => {
      const A = await import('/src/render/art/atlas.ts');
      const { wetAlternatives } = await import('/src/render/art/pipe-ports.ts');
      const { buildingDef, buildingIdx } = await import('/src/content/registry.ts');
      const { drawOff } = await import('/src/render/art/recipes/off.ts');
      const atlas = window.FL.app.atlas;
      document.getElementById('pipe-sheet')?.remove();
      const root = document.createElement('div');
      root.id = 'pipe-sheet';
      root.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#eed7b8;display:flex;flex-direction:column;gap:6px;padding:8px;overflow:hidden';
      document.body.appendChild(root);
      const K = iso ? 0.9 : 1.1;
      const cell = (key, off, rot, id, wet) => {
        const c = A.frameCanvas(atlas, key, K);
        if (!c) return document.createElement('span');
        if (off) {
          const f = atlas.frames.get(key), raw = document.createElement('canvas');
          raw.width = f.w; raw.height = f.h;
          drawOff(raw.getContext('2d'), id, rot, iso, false, f.w, f.h, wet);
          const g = c.getContext('2d');
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.clearRect(0, 0, c.width, c.height);
          g.drawImage(raw, 0, 0, c.width, c.height);
        }
        return c;
      };
      // Each building: rot 0 in its own look, then (a drinker) its variant and its own look switched off, then rot 1–3.
      for (const id of ids.filter(Boolean)) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:14px;align-items:flex-end';
        const alts = wetAlternatives(buildingDef(buildingIdx(id)));
        const looks = [[0, -1, false], ...alts.map((w) => [0, w, false]), ...(alts.length ? [[0, -1, true]] : []), [1, -1, false], [2, -1, false], [3, -1, false]];
        for (const [rot, wet, off] of looks) {
          const base = iso ? A.bKey(id, rot) : A.btKey(id, rot);
          row.appendChild(cell(wet < 0 ? base : A.wetKey(base, wet), off, rot, id, wet));
        }
        root.appendChild(row);
      }
      if (!ids.includes('')) return;
      // A conduit's pieces, each with its coupling at the top edge (as the views lay it, turned to the port).
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px';
      for (const key of [A.beltKey('conduit', false), A.beltKey('conduit', true), A.inletKey('conduit'), A.beltKey('ribbon', false)]) {
        const c = A.frameCanvas(atlas, key, 2), cp = A.frameCanvas(atlas, A.COUPLING_KEY, 2);
        if (key === A.inletKey('conduit')) { const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-over'; g.drawImage(A.frameCanvas(atlas, A.beltKey('conduit', false), 2), 0, 0); }
        if (key !== A.beltKey('ribbon', false)) { const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.drawImage(cp, 0, 0); }
        c.style.background = '#f0d5b4';
        row.appendChild(c);
      }
      root.appendChild(row);
    }, [iso, ids]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot(`sheet-${iso ? 'iso' : 'plan'}-${page2}`) });
    console.log(`✓ shot-pipe-${TAG}-sheet-${iso ? 'iso' : 'plan'}-${page2}.png`);
  }
  await browser.close();
  process.exit(0);
}

for (const seed of SEEDS) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'fr-FR' });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('pageerror:', err.message));
  await page.goto(`${URL}/?debug&seed=${seed}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 10000 });
  await page.evaluate(() => { window.FL.intro?.(false); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
  const r = await page.evaluate(() => window.FL.debugSave('late'));
  console.log(`seed ${seed}: late base ${r.ok ? `${r.ms} ms, skipped ${JSON.stringify(r.skipped)}` : 'refused'}`);
  await page.evaluate(() => { window.FL.menu(false); window.FL.close(); window.FL.dayPhase('noon'); });
  await page.addStyleTag({ content: '.qlog, .guide, .toasts, .hud, .buildbar, [data-screen="quests"] { display: none !important; }' });

  // Each water building of the base (the first of its kind), what feeds each entrance (W: a conduit,
  // R: a ribbon), and an unwired twin beside each drinker (a review rig: granted, not played).
  const found = await page.evaluate(async (defs) => {
    const FL = window.FL, sim = FL.app.sim, ids = FL.ids().buildings;
    const { worldPorts } = await import('/src/sim/entities.ts');
    const { SHIFT, tileTop } = await import('/src/render/relief.ts');
    sim.ensureCompiled();
    const g = sim.graph, out = [];
    for (const def of defs) {
      const e = sim.ents.sorted().find((x) => ids[x.def] === def);
      if (!e) { out.push({ def, missing: true }); continue; }
      const n = g.nodeByEnt.get(e.id);
      const fed = (n?.inE ?? []).map((ed) => { const s = g.nodes[g.eSrc[ed]]; return `${g.eDstPort[ed]}:${s.kind === 'chain' ? (s.fluid ? 'W' : 'R') : s.kind}`; }).sort();
      let twin = null;
      if (def !== 'pump') {
        for (const it of ['iron_plate', 'glass', 'copper_wire', 'brick', 'pipe', 'gear']) sim.grant(it, 200);
        const spot = FL.freeSpot(def, e.x + 6, e.y, 14, e.rot);
        const p = spot && sim.place(def, spot[0], spot[1], e.rot);
        if (p && p.ok) twin = { id: p.id, x: spot[0], y: spot[1] };
      }
      // The close-up's aim: the port its water comes by (the pump's outlet, a drinker's watered
      // entrance), its face tile; lifted in iso by the level it stands on (relief.ts SHIFT).
      const ports = worldPorts(e);
      const wet = def === 'pump' ? ports[0] : ports[Number((fed.find((f) => f.endsWith(':W')) ?? '0:').split(':')[0])] ?? ports[0];
      const lv = tileTop(sim.grid, e.x, e.y); // the rock top it stands on, in levels
      const aim = (x, y) => ({ plan: [x, y], iso: [x - lv * SHIFT, y - lv * SHIFT] });
      const twinAim = twin && aim(twin.x + 1, twin.y + 1.5);
      out.push({ def, id: e.id, x: e.x, y: e.y, rot: e.rot, fed, lv, near: aim((wet.x + wet.fx) / 2 + 0.5, (wet.y + wet.fy) / 2 + 0.5), mid: aim(e.x + 1, e.y + 1), twin: twin && { ...twin, near: twinAim } });
    }
    return out;
  }, WATER);
  console.log(JSON.stringify(found));
  await page.evaluate(() => window.FL.tick(600));
  await page.waitForTimeout(500);

  const settle = async (ms = 900) => {
    await page.waitForTimeout(250);
    await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(ms);
  };
  const view = async (mode) => {
    await page.evaluate((m) => window.FL.view(m), mode);
    await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 }).catch(() => {});
  };
  const NEAR = { zoom: 4, clip: { x: 520, y: 300, width: 400, height: 300 } };
  const MID = { zoom: 1.6, clip: { x: 320, y: 150, width: 800, height: 600 } };
  for (const time of TIMES) {
    await page.evaluate((t) => window.FL.dayPhase(t), time);
    for (const mode of ['iso', 'plan']) {
      await view(mode);
      for (const b of found) {
        if (b.missing) continue;
        const spots = [['', b.near], ...(b.twin ? [['-twin', b.twin.near]] : [])];
        for (const [suffix, at] of spots) {
          await page.evaluate(([[x, y], z]) => window.FL.lookAt(x, y, z), [at[mode], NEAR.zoom]);
          await settle();
          const name = `s${seed}-${b.def}${suffix}-${mode}-near-${time}`;
          await page.screenshot({ path: shot(name), clip: NEAR.clip });
          console.log(`✓ shot-pipe-${TAG}-${name}.png`);
        }
        await page.evaluate(([[x, y], z]) => window.FL.lookAt(x, y, z), [b.mid[mode], MID.zoom]);
        await settle();
        const name = `s${seed}-${b.def}-${mode}-mid-${time}`;
        await page.screenshot({ path: shot(name), clip: MID.clip });
        console.log(`✓ shot-pipe-${TAG}-${name}.png`);
      }
    }
  }
  await context.close();
}
await browser.close();
