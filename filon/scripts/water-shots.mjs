// water-shots.mjs — the water's texture (D115; owner, 2026-10-17, of a mesa canyon and its falls:
// « The water texture can be improved to reach the level of the mountains texture ») and the
// Crown's spring in the old tarn's place (« Il reste un lac vestige… Il faut l'enlever ou le
// remplacer »): a narrow stream, a broad river's middle, a confluence, a fall and where it lands, the
// spring coming down the Crown into its pool (and its summit whole, further off), a lake, the sea's edge — each at near and mid zoom,
// iso and plan, by day and by night, cropped round the spot: scripts/shot-water-<TAG>-*.png
// (gitignored; TAG=before|after; ONLY=stream,broad,… to pick). Usage: a server on :5183 (or URL=…,
// SEED=…), then `TAG=after node scripts/water-shots.mjs`. It starts the sandbox base over (FL.wipe:
// map 4) and lifts the fog out to the sea (a review rig).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const TAG = process.env.TAG ?? 'after';
const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-water-${TAG}-${name}.png`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

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

// The spots: searched outward from the cirque over the land's tiles (the fog lifted out to r 460).
const spots = await page.evaluate(() => {
  const sim = window.FL.app.sim, g = sim.grid, C = 512, RIVER = 14, SH = 6, DEEP = 7;
  sim.explored.push([C, C, 460]);
  const still = (t) => t === SH || t === DEEP;
  const wet = (x, y) => still(g.terrain(x, y)) || g.terrain(x, y) === RIVER;
  const biome = (x, y) => g.chunkAt(x >> 5, y >> 5).biome[(y & 31) * 32 + (x & 31)];
  const flow = (x, y) => { const c = biome(x, y) - 16; return c >= 0 && c < 8 ? c : -1; };
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
  const depth = (x, y) => { for (let r = 1; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!wet(x + dx, y + dy)) return r; return 4; };
  const sp = g.source.spring ?? g.source.tarn;
  // The spring's falls: a few tiles down its stream from the summit (map 4, D115), or the tarn; the
  // whole summit (its plateau and basin, the falls, the ledge, the pool), seen from further off;
  // the basin up close; the foot of the ledge's fall, where the stream comes down the Crown's last
  // terraces into its pool (owner, 2026-10-17: « the visuals are still a little bit broken »).
  const out = { spring: sp ? (g.source.spring ? [sp.x, sp.y + 5] : [sp.x, sp.y]) : null, summit: g.source.spring ? [sp.x, sp.y + 7] : null, basin: g.source.spring ? [sp.x, sp.y] : null, foot: g.source.spring ? [sp.x, sp.y + 11] : null, stream: null, broad: null, confluence: null, fall: null, lake: null, sea: null };
  for (let r = 40; r < 440 && Object.values(out).some((v) => !v); r += 1) {
    for (let a = 0; a < 720; a++) {
      const x = Math.round(C + r * Math.cos((a * Math.PI) / 360)), y = Math.round(C + r * Math.sin((a * Math.PI) / 360));
      const t = g.terrain(x, y), lv = g.level(x, y);
      if (t === RIVER && lv === 0) {
        const dep = depth(x, y);
        if (!out.stream && dep === 1 && N4.filter(([dx, dy]) => g.terrain(x + dx, y + dy) === RIVER).length === 2 && depth(x + 6, y) > 0) out.stream = [x, y];
        if (!out.broad && dep >= 4) out.broad = [x, y];
        if (!out.confluence) {
          const ways = new Set();
          for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (g.terrain(x + dx, y + dy) === RIVER && g.level(x + dx, y + dy) === 0) ways.add(flow(x + dx, y + dy));
          if (ways.size >= 4) out.confluence = [x, y];
        }
        const touch = N4.some(([dx, dy]) => still(g.terrain(x + dx, y + dy)) && g.level(x + dx, y + dy) === 0);
        if (touch) {
          const sea = N4.some(([dx, dy]) => biome(x + dx, y + dy) === 24);
          if (sea && !out.sea) out.sea = [x, y];
          if (!sea && !out.lake) out.lake = [x, y];
        }
      }
      const f = flow(x, y);
      if (!out.fall && t === RIVER && lv > 0 && f >= 0 && g.level(x + DX[f], y + DY[f]) < lv) out.fall = [x + DX[f], y + DY[f]];
    }
  }
  return out;
});
console.log('spots', JSON.stringify(spots));


const ZOOMS = { near: 3, mid: 1.2 };
const clip = { x: 300, y: 200, width: 600, height: 400 };
// The summit whole: further off, the whole window.
const WIDE = { summit: { zooms: { far: 0.85 }, clip: undefined }, foot: { zooms: { near: 1.6, mid: 1.0 }, clip: { x: 300, y: 150, width: 600, height: 500 } } };
for (const [name, at] of Object.entries(spots)) {
  if (!at || (ONLY && !ONLY.includes(name))) continue;
  for (const time of ['noon', 'night']) {
    await page.evaluate((t) => window.FL.dayPhase(t), time);
    for (const mode of ['iso', 'plan']) {
      await view(mode);
      for (const [zn, z] of Object.entries(WIDE[name]?.zooms ?? ZOOMS)) {
        await page.evaluate(([x, y, zz]) => window.FL.lookAt(x, y, zz), [at[0], at[1], z]);
        await settle();
        await page.screenshot({ path: shot(`${name}-${zn}-${mode}-${time}`), clip: WIDE[name] ? WIDE[name].clip : clip });
        console.log(`✓ shot-water-${TAG}-${name}-${zn}-${mode}-${time}.png`);
      }
    }
  }
}
await browser.close();
