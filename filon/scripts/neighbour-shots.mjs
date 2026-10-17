// neighbour-shots.mjs — the neighbouring bases (D110) for review: the land round the starting square
// from afar (the fog lifted, a rig), the nearest base up close by day and by night, at mid zoom, and a
// base beside the claim's own buildings (the late debug base) by day and by night. Usage: a server
// (dev or a frozen preview), then `URL=… PREFIX=after node scripts/neighbour-shots.mjs` →
// scripts/nb-<prefix>-*.png (gitignored).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./${name}`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';
const PREFIX = process.env.PREFIX ?? 'now';
const SEED = process.env.SEED ?? '1';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=${SEED}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.waitForTimeout(600);
// The tutorial's card and its pointer out of the pictures.
await page.addStyleTag({ content: '.qlog, .guide, .toasts { display: none !important; }' });

const settle = async (ms = 1800) => {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const snap = async (name) => { await page.screenshot({ path: shot(`nb-${PREFIX}-${name}.png`) }); console.log(`✓ nb-${PREFIX}-${name}.png`); };
const phase = (p) => page.evaluate((x) => window.FL.dayPhase(x), p);

/** The bases near the Heart, nearest first: hub, its pad's middle, ring, parcels. */
const near = () => page.evaluate(() => {
  const sim = window.FL.app.sim, out = [];
  for (let p = 0; p < 45 * 45; p++) {
    const h = sim.neighbours.holdingOf(p);
    if (!h || h.hub !== p || sim.land.neighbour(p) < 0) continue;
    const L = sim.neighbours.layout(h), s = L.structs[0];
    if (!s) continue;
    out.push({ hub: p, at: [s.x + 2, s.y + 2], d: Math.hypot(s.x - 512, s.y - 512), parcels: h.parcels.length, n: L.structs.length });
  }
  return out.sort((a, b) => a.d - b.d);
});

// 1. The land round the starting square from afar, the fog lifted 260 tiles round the Heart.
await page.evaluate(() => { window.FL.app.sim.explored.push([512, 512, 260]); window.FL.pause(); });
await phase('noon');
await page.evaluate(() => window.FL.lookAt(512, 512, 0.16));
await settle(3000);
await snap('far');
const list = await near();
console.log(`bases: ${list.length}; nearest: ${list.slice(0, 5).map((b) => `${Math.round(b.d)} tiles (${b.parcels} parcels, ${b.n} buildings)`).join(', ')}`);

// 2. The nearest base: close by day and by night, mid zoom by day.
const b0 = list[0];
if (b0) {
  await page.evaluate(([x, y]) => window.FL.lookAt(x, y + 4, 1.3), b0.at);
  await settle();
  await snap('close-day');
  await phase('night');
  await settle(900);
  await snap('close-night');
  await phase('noon');
  await page.evaluate(([x, y]) => window.FL.lookAt(x, y + 4, 0.6), b0.at);
  await settle();
  await snap('mid');
}

// 2a. Their Core beside the claim's, at the same mid zoom, by day and by night: two views side by side.
const cores = async (name) => {
  const half = async (x, y) => {
    await page.evaluate(([cx, cy]) => window.FL.lookAt(cx, cy, 0.8), [x, y]);
    await settle(900);
    return (await page.screenshot({ clip: { x: 360, y: 150, width: 720, height: 600 } })).toString('base64');
  };
  const heart = await page.evaluate(() => { const h = window.FL.app.sim.ents.get(window.FL.app.sim.hearthId); return [h.x + 2.5, h.y + 2.5]; });
  const theirs = await page.evaluate((hub) => { const sim = window.FL.app.sim, L = sim.neighbours.layout(sim.neighbours.holdingOf(hub)); const c = L.structs[L.core]; return [c.x + 1.5, c.y + 1.5]; }, b0.hub);
  const a = await half(...heart), b = await half(...theirs);
  const sheet = await context.newPage();
  await sheet.setViewportSize({ width: 1440, height: 600 });
  await sheet.setContent(`<body style="margin:0;display:flex;background:#1b1830"><img src="data:image/png;base64,${a}" style="width:720px;height:600px;border-right:3px solid #1b1830"><img src="data:image/png;base64,${b}" style="width:717px;height:600px"></body>`);
  await sheet.waitForTimeout(200);
  await sheet.screenshot({ path: shot(`nb-${PREFIX}-${name}.png`) });
  console.log(`✓ nb-${PREFIX}-${name}.png (the claim's Core, left; theirs, right)`);
  await sheet.close();
};
if (b0) {
  await phase('noon');
  await cores('cores-day');
  await phase('night');
  await cores('cores-night');
  await phase('noon');
}

// 2b. A base with furnaces (smoke from its chimneys), and its drones: the clock run a few minutes.
const smoky = await page.evaluate(() => {
  const sim = window.FL.app.sim, out = [];
  for (let p = 0; p < 45 * 45; p++) {
    const h = sim.neighbours.holdingOf(p);
    if (!h || h.hub !== p || sim.land.neighbour(p) < 0) continue;
    const L = sim.neighbours.layout(h);
    out.push({ hub: p, profile: h.profile, at: [L.structs[0].x + 2, L.structs[0].y + 2], d: Math.hypot(L.structs[0].x - 512, L.structs[0].y - 512) });
  }
  return out.filter((b) => ['foundry', 'ember', 'glasshouse', 'drifter'].includes(b.profile)).sort((a, b) => a.d - b.d)[0] ?? null;
});
if (smoky) {
  await page.evaluate(([x, y]) => { window.FL.app.sim.explored.push([x, y, 30]); window.FL.lookAt(x, y + 3, 1.25); }, smoky.at);
  await phase('noon');
  await page.evaluate(() => window.FL.resume());
  await settle(2500);
  await snap('smoke');
  const before = await page.evaluate(() => window.FL.app.neighbours.launches);
  for (let m = 0; m < 12; m++) { await page.evaluate(() => window.FL.tick(600)); await page.waitForTimeout(120); }
  const after = await page.evaluate(() => window.FL.app.neighbours.launches);
  console.log(`smoke base: ${smoky.profile} at ${Math.round(smoky.d)} tiles; drones sent in 12 minutes: ${after - before}`);
  await page.evaluate(() => window.FL.pause());
}

// 3. Beside the claim's own buildings: the parcel next to the nearest base bought (a rig: Far Claim,
// the ocelles granted), a few of the claim's machines and a ribbon laid on it, by the base's side.
const pair = b0 && await page.evaluate((hub) => {
  const FL = window.FL, sim = FL.app.sim;
  FL.unlock('xp_far');
  FL.unlock(); // every plan
  const h = sim.neighbours.holdingOf(hub);
  const C = 45, side = [];
  for (const p of h.parcels) for (const q of [p - 1, p + 1, p - C, p + C]) {
    if (q < 0 || q >= C * C || h.parcels.includes(q) || sim.land.neighbour(q) >= 0 || sim.land.holds(q)) continue;
    side.push(q);
  }
  for (const q of side) {
    sim.grantCredits(sim.landPrice(q) + 100_000);
    if (sim.buyLand(q) !== null) continue;
    // The claim's machines on the bought parcel, nearest the base's hub first.
    const [cx, cy] = [sim.neighbours.layout(h).structs[0].x + 2, sim.neighbours.layout(h).structs[0].y + 2];
    const placed = [];
    for (const def of ['kiln', 'wind_flower', 'silo', 'kiln', 'wind_flower']) {
      sim.grant('iron_plate', 200); sim.grant('copper_wire', 200); sim.grant('stone', 200); sim.grant('gear', 50); sim.grant('circuit', 20);
      let best = null;
      for (let r = 0; r < 40 && !best; r++) for (let dy = -r; dy <= r && !best; dy++) for (let dx = -r; dx <= r && !best; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (FL.parcelAt(x, y) !== q) continue;
        const c = sim.canPlace(def, x, y, 0);
        if (c.ok) best = [x, y];
      }
      if (best && FL.place(def, best[0], best[1], 0).ok) placed.push([def, ...best]);
    }
    if (placed.length) return { q, at: [Math.round((placed[0][1] + cx) / 2), Math.round((placed[0][2] + cy) / 2)], placed };
  }
  return null;
}, b0.hub);
console.log(`beside: ${pair ? JSON.stringify(pair.placed) : 'no parcel to buy beside the base'}`);
if (pair) {
  await phase('noon');
  await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 0.95), pair.at);
  await settle();
  await snap('beside-day');
  await phase('night');
  await settle(900);
  await snap('beside-night');
}
await browser.close();
