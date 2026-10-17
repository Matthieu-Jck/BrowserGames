// mesa-shots.mjs — the mountains for review (owner, 2026-10-16: « les montagnes ne sont pas très
// belles, il faut faire mieux »): map 4's massifs south and west of the Crown, and the Crown itself,
// and a heartrock crest in the far ring, near (1.6), mid (0.6) and far (0.2), in iso and in plan,
// by day, dusk and night:
// scripts/shot-mesa-<TAG>-*.png (gitignored; TAG=before|after, default after). Usage: a server on
// :5183 (or URL=…), then `TAG=after node scripts/mesa-shots.mjs`. It starts the sandbox base over
// (FL.wipe: today's map, 4) and lifts the fog round the cirque (a review rig: `sim.explored`, never
// a command). Each shot waits for the ground chunks and the relief sprites to be baked.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./${name}`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';
const SEED = process.env.SEED ?? '1';
const TAG = process.env.TAG ?? 'after';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=${SEED}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => {
  window.FL.intro?.(false); window.FL.menu?.(false);
  if (window.FL.app.guide) window.FL.app.guide.enabled = false;
  window.FL.app.sim.explored.push([512, 512, 170]);
});
await page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts, .view-bar, .views-card, [data-screen="quests"] { display: none !important; }' });
const mapV = await page.evaluate(() => window.FL.app.sim.grid.source.mapV);
if (mapV !== 4) console.log(`warning: map ${mapV}, the massifs' places are map 4's`);

const settle = async (ms = 900) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0 && !(window.FL.app.relief?.pending > 0), undefined, { timeout: 30000 }).catch(() => console.log('  (not settled)'));
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

// A heartrock (H4) cliff out in the far ring: a crest tile of it with a drop in front of it (south),
// the fog lifted round it.
const h4 = await page.evaluate(() => {
  const g = window.FL.app.sim.grid;
  let best = null, bd = Infinity;
  for (let y = 120; y < 900; y++) for (let x = 120; x < 900; x++) {
    if (g.terrain(x, y) !== 5 || g.level(x, y) < 4 || g.level(x, y + 2) > 1 || g.level(x + 2, y) > 1) continue;
    const d = (x - 512) ** 2 + (y - 512) ** 2;
    if (d < bd) { bd = d; best = [x, y]; }
  }
  if (best) window.FL.app.sim.explored.push([best[0], best[1], 40]);
  return best;
});
console.log('heartrock cliff at', JSON.stringify(h4));

// A stream up on a massif (D94) falling down a wall the camera sees: a river tile above the floor
// whose next tile along its way (east, south-east or south) stands lower; the nearest to the
// centre, the fog lifted round it. (On map 4, seed 2, there are some round (447, 152) and (202, 530).)
const fall = await page.evaluate(() => {
  const g = window.FL.app.sim.grid, DX = [1, 1, 0], DY = [0, 1, 1];
  let best = null, bd = Infinity;
  for (let y = 40; y < 990; y++) for (let x = 40; x < 990; x++) {
    if (g.terrain(x, y) !== 14 || g.level(x, y) < 1) continue;
    const f = g.chunkAt(x >> 5, y >> 5).biome[(y & 31) * 32 + (x & 31)] - 16;
    if (f < 0 || f > 2) continue;
    if (g.level(x + DX[f], y + DY[f]) >= g.level(x, y)) continue;
    const d = (x - 512) ** 2 + (y - 512) ** 2;
    if (d < bd) { bd = d; best = [x, y, g.level(x, y) - g.level(x + DX[f], y + DY[f])]; }
  }
  if (best) window.FL.app.sim.explored.push([best[0], best[1], 40]);
  return best;
});
console.log('stream fall at', JSON.stringify(fall));

/**
 * [name, view, phase, x, y, zoom]. Map 4, seed 1 (as of 2026-10-16): massifs south of the Crown
 * (~528, 560), south-west (~430, 580) and north-east (~600, 465); the Crown's ring at radius 23–34
 * round (512, 512), its inner walls facing the camera in the north-west.
 */
const SHOTS = [
  ['south-near', 'iso', 'noon', 528, 566, 1.6],
  ['south-mid', 'iso', 'noon', 528, 570, 0.6],
  ['south-far', 'iso', 'noon', 520, 560, 0.2],
  ['south-mid-night', 'iso', 'night', 528, 570, 0.6],
  ['south-mid-dusk', 'iso', 'dusk', 528, 570, 0.6],
  ['south-near-plan', 'plan', 'noon', 528, 566, 1.6],
  ['south-mid-plan', 'plan', 'noon', 528, 570, 0.6],
  ['south-far-plan', 'plan', 'noon', 520, 560, 0.2],
  ['south-mid-plan-night', 'plan', 'night', 528, 570, 0.6],
  ['west-mid', 'iso', 'noon', 445, 588, 0.6],
  ['west-near', 'iso', 'noon', 448, 594, 1.6],
  ['west-mid-plan', 'plan', 'noon', 445, 588, 0.6],
  ['east-mid', 'iso', 'noon', 600, 482, 0.6],
  ['crown-mid', 'iso', 'noon', 512, 512, 0.35],
  ['crown-near', 'iso', 'noon', 490, 492, 1.6],
  ['crown-mid-night', 'iso', 'night', 512, 512, 0.35],
  ['crown-mid-plan', 'plan', 'noon', 512, 512, 0.35],
  ['crown-near-plan', 'plan', 'noon', 490, 492, 1.6],
  ...(h4 ? [['h4-mid', 'iso', 'noon', h4[0], h4[1] + 4, 0.6], ['h4-near', 'iso', 'noon', h4[0], h4[1] + 2, 1.6]] : []),
  ...(fall ? [['fall-near', 'iso', 'noon', fall[0] + 1, fall[1] + 1, 1.8], ['fall-mid', 'iso', 'noon', fall[0] + 2, fall[1] + 2, 0.6], ['fall-near-plan', 'plan', 'noon', fall[0] + 1, fall[1] + 1, 1.8]] : []),
];

for (const [name, mode, phase, x, y, zoom] of SHOTS) {
  if (ONLY && !ONLY.has(name)) continue;
  await view(mode);
  await page.evaluate((p) => window.FL.dayPhase(p), phase);
  await page.evaluate(([a, b, z]) => window.FL.lookAt(a, b, z), [x, y, zoom]);
  await settle(zoom < 0.3 ? 2200 : 1200);
  const file = `shot-mesa-${TAG}-${name}.png`;
  await page.screenshot({ path: shot(file) });
  console.log(`✓ ${file}`);
}
const perf = await page.evaluate(() => { const p = window.FL.perf(); return { reliefBaked: p.reliefBaked, reliefSprites: p.reliefSprites, vramMB: p.vramMB, pages: window.FL.app.relief?.atlas.pages.length }; });
console.log('perf', JSON.stringify(perf));
await browser.close();
