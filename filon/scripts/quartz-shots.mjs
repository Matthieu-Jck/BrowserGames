// quartz-shots.mjs — the quartz vein (D87) for review: the bare wall a parcel past the Crown, two
// face cutters set against it (iso and plan, by day and by night), a third in hand (its ghost shows
// the side that must meet the face), and the grown debug base mining it, its line over the Crown:
// scripts/shot-quartz-*.png (gitignored). Usage: a dev server on :5183, then
// `node scripts/quartz-shots.mjs`. It starts the sandbox base over (FL.wipe): today's map has the vein.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./${name}`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
// A new base on today's land (map 3: the vein), whatever the sandbox held.
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
const hideUi = () => page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts, [data-screen="quests"] { display: none !important; }' });
await hideUi();

const settle = async (ms = 1200) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

const v = await page.evaluate(() => window.FL.vein());
if (!v) throw new Error('no quartz vein on this land (map 1–2?)');
console.log('vein', JSON.stringify(v));
// The floor at the foot of the vein's middle, a little out (the wall, its cutters and their front in view).
const mid = [v.x + ((v.n - 1) / 2) * v.dx + 2 * [0, 1, 0, -1][v.look], v.y + ((v.n - 1) / 2) * v.dy + 2 * [-1, 0, 1, 0][v.look]];
const look = (zoom) => page.evaluate(([x, y, z]) => window.FL.lookAt(Math.round(x), Math.round(y), z), [mid[0], mid[1], zoom]);

await view('iso');
await look(1.7);
await settle();
await page.screenshot({ path: shot('shot-quartz-vein-iso.png') }); // as the player first sees it
console.log('✓ shot-quartz-vein-iso.png');

// The vein's parcel bought, the Face Cutter learnt (a review rig), two cutters dropped facing away from the wall.
await page.evaluate((v) => {
  const sim = window.FL.app.sim;
  const price = sim.landPrice(v.parcel);
  if (sim.credits < price + 100) sim.grantCredits(price + 100 - sim.credits);
  sim.buyLand(v.parcel);
  window.FL.unlock('ex_quartz');
  for (const [it, n] of [['iron_plate', 200], ['glass', 40], ['copper_wire', 80]]) sim.grant(it, n);
  return price;
}, v);
console.log('parcel bought');
await settle();
await page.screenshot({ path: shot('shot-quartz-vein-bought-iso.png') }); // the bought parcel: the bare wall
console.log('✓ shot-quartz-vein-bought-iso.png');
const placed = await page.evaluate((v) => {
  const sim = window.FL.app.sim;
  const out = [];
  for (const [x, y, rot] of v.spots.slice(0, 2)) {
    const r = window.FL.place('face_cutter', x, y, (rot + 2) % 4);
    out.push({ ...r, rot: r.id ? sim.ents.get(r.id).rot : -1 });
    if (r.id) window.FL.powerTo(r.id);
  }
  return out;
}, v);
console.log('cutters', JSON.stringify(placed));
await page.evaluate(() => window.FL.tick(600));
await settle();
await page.screenshot({ path: shot('shot-quartz-cutters-iso.png') });
console.log('✓ shot-quartz-cutters-iso.png');
await view('plan');
await look(1.7);
await settle();
await page.screenshot({ path: shot('shot-quartz-cutters-plan.png') });
console.log('✓ shot-quartz-cutters-plan.png');

// A third cutter in hand over the next pair of face tiles: its ghost shows the side that must meet the face.
await page.evaluate(() => window.FL.tool('face_cutter'));
const [gx, gy] = v.spots[2];
// The build tool puts a 2×2's top-left on the tile under the cursor (input/tools.ts `originFor`).
const [sx, sy] = await page.evaluate(([x, y]) => window.FL.tileToScreen(x, y), [gx, gy]);
await page.mouse.move(sx, sy);
await page.waitForTimeout(500);
await page.screenshot({ path: shot('shot-quartz-ghost-plan.png') });
console.log('✓ shot-quartz-ghost-plan.png');
await page.evaluate(() => { window.FL.tool(null); window.FL.category(null); });

await page.evaluate(() => window.FL.dayPhase('night'));
await settle(1500);
await page.screenshot({ path: shot('shot-quartz-cutters-plan-night.png') });
console.log('✓ shot-quartz-cutters-plan-night.png');
await view('iso');
await look(1.7);
await settle(1500);
await page.screenshot({ path: shot('shot-quartz-cutters-iso-night.png') });
console.log('✓ shot-quartz-cutters-iso-night.png');
await page.evaluate(() => window.FL.dayPhase('noon'));

// The grown debug base: the vein mined, its quartz over the Crown, the quartz workshop.
const lvl = await page.evaluate(() => window.FL.debugSave('grown'));
console.log('debug base', JSON.stringify({ ok: lvl.ok, ms: lvl.ms, skipped: lvl.skipped }));
await hideUi();
await view('iso');
await look(1.3);
await settle(1500);
await page.screenshot({ path: shot('shot-quartz-debug-vein.png') });
console.log('✓ shot-quartz-debug-vein.png');
// By night: the cutters at work, lit (D83: a stopped one would stand dark).
await page.evaluate(() => window.FL.dayPhase('night'));
await settle(1500);
await page.screenshot({ path: shot('shot-quartz-debug-vein-night.png') });
console.log('✓ shot-quartz-debug-vein-night.png');
await page.evaluate(() => window.FL.dayPhase('noon'));
// Halfway home: the line climbing the Crown.
await page.evaluate(([x, y]) => window.FL.lookAt(Math.round((x + 512) / 2), Math.round((y + 512) / 2), 0.75), mid);
await settle(1500);
await page.screenshot({ path: shot('shot-quartz-debug-line.png') });
console.log('✓ shot-quartz-debug-line.png');
await page.evaluate(() => window.FL.debugSave(null));
await browser.close();
