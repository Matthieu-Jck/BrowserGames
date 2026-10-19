// stream-shots.mjs — the streams up on the rock as one ribbon (D135; owner, 2026-10-18: « cascade
// is still slightly broken here, there's a brown stripe inside the lake » and « it is also a bit
// broken when the water goes straight towards the camera like this »): the spring's outflow from its
// basin over the plateau's edge, and a raised stream running each way it can — towards the camera
// (+x +y, straight down the screen), away from it, across the screen both ways and along each iso
// axis —, each at near and mid zoom, iso and plan, by day and by night, cropped round the spot:
// <OUT>/shot-stream-<TAG>-<spot>-<zoom>-<mode>-<time>.png (OUT defaults to scripts/, gitignored).
// Usage: a server (URL=…, default :5183), then `TAG=after node scripts/stream-shots.mjs`
// (ONLY=outflow,toward,… to pick; ZOOMS=near,mid,close; MODES=iso; TIMES=noon; DX/DY tiles off the spot).
// It starts the sandbox base
// over (FL.wipe: map 4).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const TAG = process.env.TAG ?? 'after';
const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('.', import.meta.url));
const shot = (name) => join(OUT, `shot-stream-${TAG}-${name}.png`);
const URL = process.env.URL ?? 'http://localhost:5183';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const pick = (env, all) => (process.env[env] ? process.env[env].split(',') : all);

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

const settle = async (ms = 1200) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

// The spots: the spring's outflow (its basin's edge, two tiles down its way: the owner's first
// report), and for each way a stream can run (the eighth of a turn, 0 = +x), the longest run of
// raised stream tiles at that way nearest the cirque — `toward` (+x +y) the owner's second report.
const spots = await page.evaluate(() => {
  const sim = window.FL.app.sim, g = sim.grid, C = 512, RIVER = 14;
  const biome = (x, y) => g.chunkAt(x >> 5, y >> 5).biome[(y & 31) * 32 + (x & 31)];
  const flow = (x, y) => { const c = biome(x, y) - 16; return c >= 0 && c < 8 ? c : -1; };
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
  const NAMES = ['east', 'toward', 'south', 'left', 'west', 'away', 'north', 'right'];
  const sp = g.source.spring;
  const out = { outflow: sp ? [sp.x, sp.y + 2] : null };
  const best = new Array(8).fill(null);
  for (let r = 20; r < 330; r++) {
    for (let a = 0; a < 1440; a++) {
      const x = Math.round(C + r * Math.cos((a * Math.PI) / 720)), y = Math.round(C + r * Math.sin((a * Math.PI) / 720));
      if (g.terrain(x, y) !== RIVER || g.level(x, y) === 0) continue;
      const f = flow(x, y);
      if (f < 0 || g.terrain(x - DX[f], y - DY[f]) === RIVER && flow(x - DX[f], y - DY[f]) === f && g.level(x - DX[f], y - DY[f]) > 0) continue;
      let n = 0;
      while (g.terrain(x + DX[f] * n, y + DY[f] * n) === RIVER && flow(x + DX[f] * n, y + DY[f] * n) === f && g.level(x + DX[f] * n, y + DY[f] * n) > 0 && n < 30) n++;
      if (!best[f] || n > best[f].n + 1) best[f] = { n, x, y, f };
    }
  }
  for (const b of best) if (b) out[NAMES[b.f]] = [b.x + DX[b.f] * Math.floor(b.n / 2), b.y + DY[b.f] * Math.floor(b.n / 2), b.n];
  // Falls by the way they pour: a raised stream tile whose next tile along it stands lower — towards
  // the camera (+x +y, the owner's second report: its foot « with hard seams »), and two side by side
  // (a lane beside it falling too), nearest the cirque.
  const falls = (f) => {
    let one = null, two = null;
    for (let r = 20; r < 330 && !two; r++) {
      for (let a = 0; a < 1440 && !two; a++) {
        const x = Math.round(C + r * Math.cos((a * Math.PI) / 720)), y = Math.round(C + r * Math.sin((a * Math.PI) / 720));
        if (g.terrain(x, y) !== RIVER || flow(x, y) !== f || g.level(x, y) === 0 || g.level(x + DX[f], y + DY[f]) >= g.level(x, y)) continue;
        one ??= [x, y];
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (g.terrain(x + dx, y + dy) === RIVER && flow(x + dx, y + dy) === f && g.level(x + dx, y + dy) === g.level(x, y) && g.level(x + dx + DX[f], y + dy + DY[f]) < g.level(x, y)) two = [x, y];
      }
    }
    return two ?? one;
  };
  out.towardfall = falls(1);
  out.eastfall = falls(0);
  return out;
});
// AT=x,y;x,y…: spots of one's own (at0, at1 …), in place of the searched ones.
if (process.env.AT) for (const k of Object.keys(spots)) delete spots[k];
(process.env.AT ?? '').split(';').filter(Boolean).forEach((xy, n) => { spots[`at${n}`] = xy.split(',').map(Number); });
console.log('spots', JSON.stringify(spots));

const ZOOMS = { near: 3, mid: 1.4, close: 5, far: 0.5 };
const clip = { x: 300, y: 150, width: 600, height: 500 };
for (const [name, at] of Object.entries(spots)) {
  if (!at || (ONLY && !ONLY.includes(name))) continue;
  for (const time of pick('TIMES', ['noon', 'night'])) {
    await page.evaluate((t) => window.FL.dayPhase(t), time);
    for (const mode of pick('MODES', ['iso', 'plan'])) {
      await view(mode);
      for (const zn of pick('ZOOMS', ['near', 'mid'])) {
        // Lifted (iso): a top a level up shows where the ground a tile back along −x −y does (relief.ts
        // `surfaceTile`: a relief level is SHIFT, half a tile; a level of the land two of them).
        const up = mode === 'iso' ? await page.evaluate(([x, y]) => window.FL.app.sim.grid.level(x, y), at) : 0;
        await page.evaluate(([x, y, zz]) => window.FL.lookAt(x, y, zz), [at[0] - up + Number(process.env.DX ?? 0), at[1] - up + Number(process.env.DY ?? 0), ZOOMS[zn]]);
        await settle();
        await page.screenshot({ path: shot(`${name}-${zn}-${mode}-${time}`), clip });
        console.log(`✓ shot-stream-${TAG}-${name}-${zn}-${mode}-${time}.png`);
      }
    }
  }
}
await browser.close();
