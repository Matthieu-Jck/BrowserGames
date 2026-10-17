// camo-shots.mjs — the camouflaged ribbon (D109) for review, on bare land (the sandbox wiped, every
// plan and the Logistique nodes up to `xp_camo` learnt, not the treaties): a plain ribbon dragged
// from free land across a neighbouring base's open land — the drag's ghost while it runs (plain
// pieces, then the buried ones in their dashed frames) and the tip (« n enfouis », whose land); the
// line laid, in plan and in iso by day and by night; a camouflaged line with a bend across free land
// beside a plain one, both carrying plates (the plates go under the sand and come out of it); the
// Logistique view (F) with the buried tiles edged; a buried tile's inspector: scripts/shot-camo-*.png
// (gitignored). Usage: a server (default :5183; URL=… for another), then `node scripts/camo-shots.mjs`.
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
await page.goto(`${URL}/?seed=1&debug`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
const HIDE = '.qlog, .guide, .toasts, .nnotice, [data-screen="quests"], [data-screen="night"], [data-screen="gleaners"] { display: none !important; }';
await page.addStyleTag({ content: HIDE });

const settle = async (ms = 900) => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};
const snap = async (name) => { await page.screenshot({ path: shot(name) }); console.log(`✓ ${name}`); };
const look = (x, y, zoom) => page.evaluate(([a, b, z]) => window.FL.lookAt(a, b, z), [x, y, zoom]);
const tileXY = (x, y) => page.evaluate(([a, b]) => window.FL.tileToScreen(a, b), [x, y]);

// ── the land: every plan, Logistique to the camouflaged ribbon; a neighbour's parcel beside free land ──
const at = await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim;
  FL.unlock();
  for (const id of ['xp_swift', 'xp_bigsilo', 'xp_guard', 'xp_camo']) FL.unlock(id);
  sim.grant('iron_plate', 3000); sim.grant('sand', 3000); sim.grant('copper_wire', 500);
  for (let ring = 2; ring <= 6; ring++) {
    for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const q = FL.parcel(dx, dy), w = FL.parcel(dx - 1, dy);
      if (sim.land.neighbour(q.p) < 0 || sim.land.neighbour(w.p) >= 0 || sim.land.holds(w.p)) continue;
      let x0 = q.at[0];
      while (FL.parcelAt(x0 - 1, q.at[1]) === q.p) x0--;
      sim.explored.push([x0, q.at[1], 34]);
      for (let k = 0; k < 20; k++) {
        const row = q.at[1] + (k % 2 ? -1 : 1) * (k >> 1);
        let ok = true;
        for (let x = x0 - 7; x < x0 + 23 && ok; x++) if (sim.neighbours.at(x, row) || !sim.canPlace('camo_ribbon', x, row, 1).ok) ok = false;
        if (ok) return { x0, row, p: q.p };
      }
    }
  }
  return null;
});
if (!at) { console.log('no neighbouring base beside free land with an open row'); await browser.close(); process.exit(1); }
console.log('neighbour parcel', JSON.stringify(at));
const { x0, row } = at;

// ── a plain ribbon dragged across it: the ghost while it runs, then laid ──
await view('plan');
await page.evaluate(() => window.FL.tool('ribbon'));
await look(x0 + 8, row, 0.95);
await settle(500);
const [ax, ay] = await tileXY(x0 - 7, row);
const [bx, by] = await tileXY(x0 + 22, row);
await page.mouse.move(ax, ay);
await page.mouse.down();
await page.mouse.move((ax + bx) / 2, ay, { steps: 6 });
await page.mouse.move(bx, by, { steps: 6 });
await settle(400);
await snap('shot-camo-drag-ghost.png');
await page.mouse.up();
const laid = await page.evaluate(([x, y]) => {
  let camo = 0, plain = 0;
  for (let k = x - 7; k < x + 23; k++) { const e = window.FL.entityAt(k, y); if (e?.def === 'camo_ribbon') camo++; else if (e?.def === 'ribbon') plain++; }
  return { camo, plain };
}, [x0, row]);
console.log('laid', JSON.stringify(laid));
await page.keyboard.press('Escape');
await page.evaluate(() => window.FL.tick(3000)); // the kites land
await page.evaluate(() => window.FL.fillRibbons('iron_plate'));

await page.evaluate(() => window.FL.dayPhase('noon'));
await settle();
await snap('shot-camo-neighbour-plan.png');
await view('iso');
await look(x0 + 2, row, 1.3);
await settle();
await snap('shot-camo-neighbour-iso-day.png');
await page.evaluate(() => window.FL.dayPhase('night'));
await settle();
await snap('shot-camo-neighbour-iso-night.png');
await page.evaluate(() => window.FL.dayPhase('noon'));

// ── on free land: a camouflaged line with a bend beside a plain one, both carrying plates ──
const free = await page.evaluate(([x, y]) => {
  const sim = window.FL.app.sim;
  const fy = y + 4;
  const path = [];
  for (let k = x - 14; k < x - 4; k++) path.push([k, fy, 1]);
  for (let j = fy; j < fy + 5; j++) path.push([x - 4, j, 2]);
  const plain = [];
  for (let k = x - 14; k < x - 4; k++) plain.push([k, fy - 2, 1]);
  return { camo: sim.placeBelts('camo_ribbon', path), plain: sim.placeBelts('ribbon', plain), at: [x - 9, fy + 1] };
}, [x0, row]);
console.log('free land', JSON.stringify(free));
await page.evaluate(() => { window.FL.tick(3000); window.FL.fillRibbons('iron_plate'); });
await look(free.at[0], free.at[1], 1.9);
await settle();
await snap('shot-camo-free-iso.png');
await view('plan');
await settle();
await snap('shot-camo-free-plan.png');

// ── the Logistique view, then a buried tile's inspector ──
await view('iso');
await look(x0 - 2, row + 2, 1.0);
await page.evaluate(() => window.FL.mapView('logistics'));
await settle(1200);
await snap('shot-camo-logistics.png');
await view('plan');
await settle(600);
await snap('shot-camo-logistics-plan.png');
await page.evaluate(() => window.FL.mapView('normal'));
const id = await page.evaluate(([x, y]) => window.FL.entityAt(x + 6, y)?.id ?? 0, [x0, row]);
await page.evaluate((i) => window.FL.selected(i), id);
await settle(600);
await snap('shot-camo-inspector.png');

await browser.close();
