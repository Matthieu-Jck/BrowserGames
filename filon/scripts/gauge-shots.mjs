// gauge-shots.mjs — the pressure gauge (D155), for visual review: on bare land (FL.wipe) a pond, a pump,
// its line east with a gauge set into it, and steam boilers drawn off the line one at a time — one
// (enough: green), two (tight: amber), three (short: red); the gauge up close in iso at each, in plan at
// the last, and its inspector. scripts/shot-gauge-<TAG>-<what>.png (gitignored).
// Usage: a dev server or a frozen `vite preview`, then `URL=http://localhost:<port> TAG=d155 node scripts/gauge-shots.mjs`.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const TAG = process.env.TAG ?? 'after';
const URL = process.env.URL ?? 'http://localhost:5183';
const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-gauge-${TAG}-${name}.png`, import.meta.url));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'fr-FR' })).newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
const hud = await page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts, .nnotice, [data-screen="quests"] { display: none !important; }' });

const rig = await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim, W = 1024;
  FL.unlock(); FL.unlock('steam');
  const regrant = () => { for (const it of ['iron_plate', 'glass', 'copper_wire']) sim.grant(it, 4000); };
  const core = sim.ents.get(sim.hearthId), BW = 20, BH = 12;
  const free = (x, y) => sim.grid.level(x, y) === 0 && sim.grid.terrain(x, y) <= 1 && sim.grid.occ[y * W + x] === 0;
  let bx = -1, by = -1;
  outer: for (let r = 12; r < 160; r += 2) for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    let ok = true;
    for (let j = -1; j <= BH && ok; j++) for (let i = -1; i <= BW && ok; i++) ok = free(core.x + dx + i, core.y + dy + j);
    if (ok) { bx = core.x + dx; by = core.y + dy; break outer; }
  }
  if (bx < 0) return { error: 'no room' };
  for (let j = -2; j <= BH + 1; j++) for (let i = -2; i <= BW + 1; i++) { const p = FL.parcelAt(bx + i, by + j); if (!sim.land.holds(p)) sim.land.granted.add(p); }
  for (let j = 6; j <= 8; j++) for (let i = 1; i <= 2; i++) sim.grid.setTerrain(bx + i, by + j, 6);
  sim.markDirty();
  const fails = [];
  const put = (def, x, y, rot) => { regrant(); const r = sim.place(def, bx + x, by + y, rot); if (!r.ok) fails.push(`${def}@${x},${y}: ${r.reason}`); if (r.id) sim.ents.get(r.id).builtAt = 0; return r.id ?? 0; };
  const pump = put('pump', 3, 7, 1);
  regrant(); sim.placeBelts('conduit', Array.from({ length: 14 }, (_, k) => [bx + 4 + k, by + 7, 1]));
  const gauge = put('pressure_gauge', 6, 7, 1);
  sim.markDirty();
  FL.powerTo(pump);
  return { bx, by, fails, gauge };
});
console.log('rig', JSON.stringify(rig));
const boiler = (x) => page.evaluate(([bx, by, x]) => {
  const FL = window.FL, sim = FL.app.sim;
  for (const it of ['iron_plate', 'glass', 'copper_wire']) sim.grant(it, 4000);
  const r = sim.place('steam_boiler', bx + x, by + 3, 0);
  if (r.id) sim.ents.get(r.id).builtAt = 0;
  sim.placeBelts('conduit', [[bx + x + 2, by + 7, 0], [bx + x + 2, by + 6, 0], [bx + x + 2, by + 5, 0]]);
  sim.markDirty();
  return r.ok ? '' : r.reason;
}, [rig.bx, rig.by, x]);
const settle = async () => { await page.evaluate(() => window.FL.tick(30)); await page.waitForTimeout(400); await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(700); };
const look = async (mode, z) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 }).catch(() => {});
  await page.evaluate(([x, y, z]) => window.FL.lookAt(x, y, z), [rig.bx + 8, rig.by + 6, z]);
};
for (const [n, x] of [['ok', 7], ['tight', 11], ['low', 15]]) {
  console.log('boiler', n, await boiler(x));
  await look('iso', 2.6);
  await settle();
  console.log(n, JSON.stringify(await page.evaluate(() => window.FL.app.buildings.gaugeLook())));
  await page.screenshot({ path: shot(`${n}-iso`), clip: { x: 270, y: 150, width: 900, height: 600 } });
}
await look('plan', 2.6);
await settle();
await page.screenshot({ path: shot('low-plan'), clip: { x: 270, y: 150, width: 900, height: 600 } });
await hud.evaluate((n) => n.remove());
await page.addStyleTag({ content: '.qlog, .guide, .toasts, .nnotice { display: none !important; }' });
await look('iso', 2.2);
await page.evaluate((id) => window.FL.selected(id), rig.gauge);
await settle();
await page.screenshot({ path: shot('inspector') });
await browser.close();
