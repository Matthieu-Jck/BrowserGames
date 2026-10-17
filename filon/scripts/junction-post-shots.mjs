// junction-post-shots.mjs — a trade post whose exit feeds a junction, in four orientations, iso and
// plan: the ribbon must run under the little bridge. Usage: a server on :5183 (or URL=…, OUT=a folder),
// `node scripts/junction-post-shots.mjs` → <OUT>/junction-<tag>-<mode>.png. Starts the sandbox base over.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('.', import.meta.url));
const TAG = process.env.TAG ?? 'after';
const URL = process.env.URL ?? 'http://localhost:5183';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, locale: 'fr-FR' })).newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
await page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts { display: none !important; }' });
const settle = async (ms = 1000) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
};

// Four posts, each with a junction at its exit or its entrance and a ribbon past it (the junction
// has one under axis, east–west: a post facing east or west meets it).
const CASE = Number(process.env.CASE ?? 0);
const TURN = process.env.TURN === '1'; // the ribbon past the junction runs north, off the axis
const placed = await page.evaluate(([CASE, TURN]) => {
  const sim = window.FL.app.sim;
  window.FL.unlock('trade_post'); window.FL.unlock('junction'); sim.grant('iron_plate', 2000); sim.grant('glass', 200); sim.grant('copper_wire', 500);
  const out = [];
  // [rot, spot, port side, ribbon runs]: exit east (rot 1) / exit west (rot 3), then each entrance.
  const cases = [[1, [497, 497], 'exit'], [3, [497, 508], 'exit'], [1, [511, 497], 'entrance'], [3, [511, 508], 'entrance']];
  const belt = (x, y, rot, n) => { const dx = [0, 1, 0, -1][rot], dy = [-1, 0, 1, 0][rot]; return Array.from({ length: n }, (_, i) => [x + dx * i, y + dy * i, rot]); };
  for (const [rot, [x, y], side] of [cases[CASE]]) {
    let r = null, px = x, py = y;
    for (let dy = 0; dy < 5 && !r?.ok; dy++) for (let dx = 0; dx < 5 && !r?.ok; dx++) { px = x + dx; py = y + dy; r = sim.place('trade_post', px, py, rot); }
    if (!r?.ok) { out.push({ rot, side, fail: r?.reason }); continue; }
    // exit: rot 1 at the east edge, rot 3 at the west; the entrance on the opposite edge.
    const east = (rot === 1) === (side === 'exit');
    const jx = east ? px + 5 : px - 1, jy = py + 2;
    const j = sim.place('crossing', jx, jy, 2);
    // The ribbon runs the way items go: away from an exit, into an entrance.
    const away = east ? 1 : 3, run = side === 'exit' ? away : (away + 2) % 4;
    const bx = east ? jx + 1 : jx - 1;
    const n = sim.placeBelts('ribbon', TURN ? belt(bx, jy, 0, 3) : side === 'exit' ? belt(bx, jy, away, 3) : (east ? belt(bx + 2, jy, 3, 3) : belt(bx - 2, jy, 1, 3)));
    out.push({ rot, side, at: [px, py], junction: j.ok ? true : j.reason, belts: n, run });
  }
  return out;
}, [CASE, TURN]);
console.log(JSON.stringify(placed));
for (const mode of ['iso', 'plan']) {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
  await page.evaluate((v) => window.FL.lookAt(...v), [Number(process.env.LX ?? 507), Number(process.env.LY ?? 505), Number(process.env.ZOOM ?? 1.1)]);
  await settle();
  await page.screenshot({ path: join(OUT, `junction-${TAG}${CASE}-${mode}.png`) });
  console.log(`✓ junction-${TAG}${CASE}-${mode}.png`);
}
await browser.close();
