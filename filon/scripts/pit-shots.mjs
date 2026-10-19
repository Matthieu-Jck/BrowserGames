// pit-shots.mjs — the incinerator's burst (D125; owner, 2026-10-18: « l'incinérateur doit avoir une
// petite animation quand il brûle quelque chose »), for visual review. It starts the sandbox base over
// (FL.wipe) and lays three rigs side by side near the Core, finished at once (a review rig, outside
// commands): A, a silo of sand → a ribbon → a sorter choosing nothing, so everything leaves by its
// sides, an incinerator against its east side (fed straight by the routing block: the layout waste
// sorting makes); B, a silo of slag → a ribbon straight into an incinerator (fed by a ribbon: its items
// ride up the chute and fall in); C, a silo of scrap → a ribbon → a sorter, an incinerator against its
// west side. It lets the lines fill, pauses, then steps tick by tick until A and B are both mid-burst
// (read from the engine: A's `SinkNode.burnTick`, B's ribbon hand-offs) and shoots that frozen moment
// — iso and plan, by day and by night, near and close — plus a strip of the waste glyphs beside their
// look-alikes (HUD 16 px, 32, 64; on a teal ribbon). Writes scripts/pit-*.png (gitignored).
// Usage: a server (URL=…, default :5183), then `node scripts/pit-shots.mjs` from filon/.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./pit-${name}.png`, import.meta.url));
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

// The rigs, at the first spot round the Core where every piece may stand (x0: rig A's column, Y: the silos' row).
const rig = await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim;
  FL.unlock();
  sim.grant('iron_plate', 400);
  sim.grant('glass', 40);
  sim.grant('copper_wire', 40);
  const core = sim.ents.get(sim.hearthId);
  const pieces = (x0, Y) => [
    ['silo', x0, Y, 0], ['ribbon', x0, Y - 1, 0], ['ribbon', x0, Y - 2, 0], ['ribbon', x0, Y - 3, 0], ['sorter', x0, Y - 4, 0], ['incinerator', x0 + 1, Y - 4, 0],
    ['silo', x0 + 4, Y, 0], ['ribbon', x0 + 4, Y - 1, 0], ['ribbon', x0 + 4, Y - 2, 0], ['ribbon', x0 + 4, Y - 3, 0], ['ribbon', x0 + 4, Y - 4, 0], ['incinerator', x0 + 4, Y - 5, 0],
    ['silo', x0 + 8, Y, 0], ['ribbon', x0 + 8, Y - 1, 0], ['ribbon', x0 + 8, Y - 2, 0], ['ribbon', x0 + 8, Y - 3, 0], ['sorter', x0 + 8, Y - 4, 0], ['incinerator', x0 + 7, Y - 4, 0],
  ];
  for (let r = 7; r < 40; r++) {
    for (let a = 0; a < 64; a++) {
      const x0 = Math.round(core.x + r * Math.cos((a * Math.PI) / 32)), Y = Math.round(core.y + r * Math.sin((a * Math.PI) / 32));
      const ps = pieces(x0, Y);
      if (!ps.every(([d, x, y, rot]) => sim.canPlace(d, x, y, rot).ok)) continue;
      // Clear ground round it too (nothing else in the shots' way).
      const ids = [];
      for (const [d, x, y, rot] of ps) {
        if (d === 'ribbon') { if (sim.placeBelts('ribbon', [[x, y, rot]]) !== 1) return { error: `ribbon at ${x},${y}` }; continue; }
        const p = sim.place(d, x, y, rot);
        if (!p.ok) return { error: `${d} at ${x},${y}: ${p.reason}` };
        ids.push([d, p.id]);
      }
      for (const e of sim.ents.map.values()) if (e.builtAt !== 0) e.builtAt = 0;
      sim.markDirty();
      sim.ensureCompiled();
      const silos = ids.filter(([d]) => d === 'silo').map(([, id]) => id), incs = ids.filter(([d]) => d === 'incinerator').map(([, id]) => id);
      ['sand', 'slag', 'scrap'].forEach((item, i) => {
        const it = FL.itemIndex(item);
        sim.stores.get(silos[i])[it] = 900 * 1000;
        sim.graph.nodeByEnt.get(silos[i]).locked = it;
      });
      return { x0, Y, incs };
    }
  }
  return { error: 'no spot' };
});
console.log('rig', JSON.stringify(rig));
if (rig.error) { await browser.close(); process.exit(1); }

const frame = () => page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))));
const settle = async (ms = 900) => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

// Let the lines fill (the game running), then pause and step a tick at a time, a frame between
// each (the fire sees every hand-off), until A is 2–3 ticks into a burst and B 1.5–5.
await page.evaluate(({ x0, Y }) => window.FL.lookAt(x0 + 4, Y - 4, 1.6), rig);
await page.waitForTimeout(9000);
await page.evaluate(() => window.FL.pause());
const fallsB = [];
let found = null;
for (let i = 0; i < 200 && !found; i++) {
  const st = await page.evaluate(({ x0, Y, incs }) => {
    const FL = window.FL, sim = FL.app.sim;
    FL.tick(1);
    const a = sim.graph.nodeByEnt.get(incs[0]), c = sim.chainAt(x0 + 4, Y - 4);
    return { tick: sim.tick, burnA: a.burnTick, burnsA: a.burns, lo: c ? c.lastOut.tick : -1, step: c ? c.stepTicks : 10 };
  }, rig);
  await frame();
  if (st.lo >= 0 && !fallsB.includes(st.lo)) fallsB.push(st.lo);
  const ageA = st.tick - (st.burnA + 1);
  const seenB = fallsB.map((T) => st.tick - (T + 1 + 0.88 * st.step)).filter((a) => a >= 0);
  const ageB = seenB.length ? Math.min(...seenB) : Infinity;
  if (i % 20 === 0) console.log(`tick ${st.tick} ageA ${ageA} ageB ${ageB.toFixed(1)} burnsA ${st.burnsA}`);
  if (ageA >= 2 && ageA <= 3 && ageB >= 1.5 && ageB <= 5) found = { ...st, ageA, ageB };
}
console.log('frozen at', JSON.stringify(found));

const clip = { x: 300, y: 150, width: 600, height: 500 };
for (const mode of ['iso', 'plan']) {
  await view(mode);
  for (const phase of ['noon', 'night']) {
    await page.evaluate((p) => window.FL.dayPhase(p), phase);
    await page.evaluate(({ x0, Y }) => window.FL.lookAt(x0 + 4, Y - 4, 1.6), rig);
    await settle();
    await page.screenshot({ path: shot(`${mode}-${phase === 'noon' ? 'day' : 'night'}`), clip });
    // Close on A (the sorter-fed pit) and B (the ribbon-fed one).
    await page.evaluate(({ x0, Y }) => window.FL.lookAt(x0 + 2.5, Y - 4.2, 2), rig);
    await settle(500);
    await page.screenshot({ path: shot(`${mode}-${phase === 'noon' ? 'day' : 'night'}-close`), clip: { x: 250, y: 120, width: 700, height: 560 } });
  }
  await page.evaluate(() => window.FL.dayPhase('noon'));
}

// The waste glyphs beside their look-alikes, from the atlas: 64, 32, 16 px on paper, 22 on a teal ribbon (its belt token).
await page.evaluate(() => {
  const atlas = window.FL.app.atlas;
  const ids = ['slag', 'scrap', 'coal', 'stone', 'iron_ore', 'iron_plate', 'steel', 'pipe', 'cable', 'sand'];
  const c = document.createElement('canvas');
  const W = 90 * ids.length + 20, H = 240, k = 2;
  c.width = W * k; c.height = H * k;
  c.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;z-index:99999;background:#efe6d2`;
  c.id = 'glyph-strip';
  const g = c.getContext('2d');
  g.scale(k, k);
  g.imageSmoothingQuality = 'high';
  const draw = (key, x, y, s) => {
    const f = atlas.frames.get(key);
    if (!f) return;
    const src = atlas.pages[f.page];
    g.drawImage(src, f.x, f.y, f.w, f.h, x - s / 2, y - s / 2, s, s * (f.h / f.w));
  };
  ids.forEach((id, i) => {
    const x = 20 + i * 90 + 35;
    draw(`i:${id}`, x, 45, 64);
    draw(`i:${id}`, x, 112, 32);
    draw(`i:${id}`, x, 150, 16);
    g.fillStyle = '#3aa79a';
    g.fillRect(x - 18, 172, 36, 36);
    draw(`ib:${id}`, x, 190, 22);
    g.fillStyle = '#2b2838';
    g.font = '11px sans-serif';
    g.textAlign = 'center';
    g.fillText(id, x, 228);
  });
  document.body.appendChild(c);
});
await page.locator('#glyph-strip').screenshot({ path: shot('glyphs') });
await browser.close();
