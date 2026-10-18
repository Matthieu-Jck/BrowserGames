// chipfab-shots.mjs — D140's chip fab with its three entrances, for visual review: on the grown debug
// base, a review rig lays a chip fab etching circuits, each of its three inputs (copper plates, copper
// wire, glass) from a silo on a line of its own into its own entrance (the third, at the back-left,
// D140), its circuits out to an incinerator, powered; with a twin beside it left unwired (switched
// off, D83). Then shoots them near and mid, iso and plan, at noon and at night, and the fab's building
// card (its ports diagram): scripts/shot-chipfab-*.png (gitignored).
// Usage: a dev server (or a frozen `vite preview`), then `URL=http://localhost:<port> node scripts/chipfab-shots.mjs`.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-chipfab-${name}.png`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?debug&seed=1`, { waitUntil: 'networkidle' }); // ?debug: the debug bases on a frozen build too
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 10000 });
await page.evaluate(() => { window.FL.intro?.(false); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
const r = await page.evaluate(() => window.FL.debugSave('grown'));
console.log(`grown base: ${r.ok ? `${r.ms} ms, skipped ${JSON.stringify(r.skipped)}` : 'refused'}`);
await page.evaluate(() => { window.FL.menu(false); window.FL.close(); window.FL.dayPhase('noon'); });

// The rig: the circuit's and the fab's nodes learnt, the pieces paid by grants (a review rig, not
// play), laid on the first free spot near the Core (rotation 0: entrances at the back, south). Silos
// south of it, each to its entrance by `connect` (its index among the fab's inlets: 2 is D140's, at
// the back-left); the circuits north into an incinerator; the twin four tiles east, unwired.
const placed = await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim;
  for (const id of ['workshop', 'dn_chipfab', 'incinerator']) FL.unlock(id);
  for (const it of ['iron_plate', 'glass', 'copper_wire', 'copper_plate', 'steel', 'gear', 'brick', 'ceramic', 'circuit', 'robot_arm', 'lens', 'thermal_core']) sim.grant(it, 400);
  const SILOS = [[-3, 6, 'copper_plate', 2], [1, 7, 'copper_wire', 0], [4, 6, 'glass', 1]];
  for (let r = 10; r < 50; r += 2) {
    for (let a = 0; a < 16; a++) {
      const ox = Math.round(512 + r * Math.cos((a * Math.PI) / 8)), oy = Math.round(512 + r * Math.sin((a * Math.PI) / 8));
      const ids = [];
      const undo = () => { for (const [x, y] of ids.reverse()) sim.remove(x, y); };
      const put = (def, x, y, rot) => { const p = sim.place(def, x, y, rot); if (p.ok) ids.push([x, y]); return p; };
      const m = put('chip_fab', ox, oy, 0);
      if (!m.ok) continue;
      const twin = put('chip_fab', ox + 5, oy, 0);
      let ok = twin.ok && put('ribbon', ox + 1, oy - 1, 0).ok && put('ribbon', ox + 1, oy - 2, 0).ok && put('incinerator', ox + 1, oy - 3, 0).ok;
      const silos = [];
      for (const [dx, dy, item, inlet] of SILOS) { const s = ok && put('silo', ox + dx, oy + dy, 0); ok = ok && s.ok; if (s && s.ok) silos.push([s.id, item, inlet]); }
      if (ok) for (const [id, , inlet] of silos) ok = ok && FL.connect(id, m.id, 0, inlet) > 0;
      if (!ok) { undo(); continue; }
      sim.setRecipe(m.id, 'circuit');
      sim.setRecipe(twin.id, 'circuit');
      sim.ensureCompiled();
      for (const [id, item] of silos) { const it = FL.itemIndex(item); sim.stores.get(id)[it] = 1000 * 1000; sim.graph.nodeByEnt.get(id).locked = it; }
      FL.powerTo(m.id);
      sim.markDirty();
      sim.ensureCompiled();
      const g = sim.graph, n = g.nodeByEnt.get(m.id);
      return { id: m.id, x: ox, y: oy, fed: n.inE.map((e) => g.eDstPort[e]).sort(), off: { id: twin.id, x: ox + 5, y: oy } };
    }
  }
  return null;
});
console.log('placed', JSON.stringify(placed));
if (!placed) { await browser.close(); process.exit(1); }
await page.evaluate(() => window.FL.tick(2400));
await page.waitForTimeout(600);
await page.addStyleTag({ content: '.qlog, .guide, .toasts, [data-screen="quests"] { display: none !important; }' });

const settle = async (ms = 1000) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 }).catch(() => {});
};
// Near: the fab filling the frame; mid: the pair (lit and switched off) with the silos and lines.
const NEAR = { zoom: 2.4, clip: { x: 420, y: 230, width: 600, height: 440 } };
const MID = { zoom: 1.3, clip: { x: 270, y: 150, width: 900, height: 600 } };
for (const time of ['noon', 'night']) {
  await page.evaluate((t) => window.FL.dayPhase(t), time);
  for (const mode of ['iso', 'plan']) {
    await view(mode);
    for (const [tag, e] of [['fab', placed], ['fab-off', placed.off]]) {
      await page.evaluate(([x, y, z]) => window.FL.lookAt(x + 2, y + 2.5, z), [e.x, e.y, NEAR.zoom]);
      await settle();
      await page.screenshot({ path: shot(`${tag}-${mode}-near-${time}`), clip: NEAR.clip });
      console.log(`✓ shot-chipfab-${tag}-${mode}-near-${time}.png (lit: ${await page.evaluate((i) => window.FL.workLook(i).lit, e.id)})`);
    }
    await page.evaluate(([x, y, z]) => window.FL.lookAt(x + 4.5, y + 4, z), [placed.x, placed.y, MID.zoom]);
    await settle();
    await page.screenshot({ path: shot(`mid-${mode}-${time}`), clip: MID.clip });
    console.log(`✓ shot-chipfab-mid-${mode}-${time}.png`);
  }
}
// The fab's building card, its ports diagram: three arrows in at the back.
await page.evaluate(() => window.FL.dayPhase('noon'));
await view('iso');
if (!(await page.isVisible('.bb-tab'))) await page.click('.hud-build').catch(() => {});
await page.waitForTimeout(500);
if (!(await page.isVisible('.bb-slot[data-def="chip_fab"]'))) await page.click('.bb-tab[data-cat="production"]').catch(() => {});
await page.waitForTimeout(300);
const slot = page.locator('.bb-slot[data-def="chip_fab"]');
if (await slot.count()) {
  await slot.hover();
  await page.waitForSelector('[data-screen="building-card"]:not([hidden])', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('[data-screen="building-card"]').screenshot({ path: shot('card') }).catch((e) => console.log(`✗ card: ${e.message}`));
  console.log('✓ shot-chipfab-card.png');
} else console.log('✗ no chip fab slot');
const made = await page.evaluate(() => window.FL.produced('circuit'));
console.log('circuits made', made);
await browser.close();
