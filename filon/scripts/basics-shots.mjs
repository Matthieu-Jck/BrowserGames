// basics-shots.mjs — D123's works at work (owner, 2026-10-17: « Il faut rajouter des trucs à faire avec
// les ressources de base »): on the grown debug base, a row of D123's lines laid by a review rig — the
// steel mill on plates and coal, the brickworks on sand and water, a smelter on copper plates, the press
// on pipes, the wire mill on cable — each fed from stocked silos and powered, then shot near and mid,
// iso and plan, at noon and at night, with one switched off (unwired) beside them; then the building
// cards of the two new works and of the item glyphs' row in the Stock panel: scripts/shot-basics-*.png
// (gitignored); LEVEL=late SEED=<land>: the late base's own works instead, shot-basics-late<land>-*.png. Usage: a dev server then
// `URL=http://localhost:<port> node scripts/basics-shots.mjs` (a dev server or a frozen `vite preview`).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-basics-${process.env.LEVEL === 'late' ? `late${process.env.SEED ?? '1'}-` : ''}${name}.png`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';
const LEVEL = process.env.LEVEL ?? 'grown';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?debug&seed=${process.env.SEED ?? '1'}`, { waitUntil: 'networkidle' }); // ?debug: the debug bases on a frozen build too
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 10000 });
await page.evaluate(() => { window.FL.intro?.(false); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
const r = await page.evaluate((l) => window.FL.debugSave(l), LEVEL);
console.log(`${LEVEL} base: ${r.ok ? `${r.ms} ms, skipped ${JSON.stringify(r.skipped)}` : "refused"}`);
await page.evaluate(() => { window.FL.menu(false); window.FL.close(); window.FL.dayPhase('noon'); });

// The rig: D123's nodes learnt, then each line laid on the first free spot near the Core (its pieces
// paid by grants: a review rig, not play), its silos stocked, its works wired.
// LEVEL=late: the late base's own works (scenario-basics.ts, D123), framed as they stand — no rig.
const own = LEVEL === 'late' ? await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim, out = {};
  for (const [name, def] of [['steel', 'steel_mill'], ['bricks', 'brickworks'], ['pipes', 'press']]) {
    const e = sim.ents.sorted().find((q) => FL.entityAt(q.x, q.y)?.def === def && (def !== 'press' || sim.ents.get(q.id).cfg));
    if (e) out[name] = { id: e.id, x: e.x, y: e.y };
  }
  return out;
}) : null;
const placed = own ?? await page.evaluate(async () => {
  const FL = window.FL, sim = FL.app.sim;
  // D123's nodes and what they stand on (ids, not modules: the rig runs on a frozen build too).
  for (const id of ['tr1', 'ex_fastdrill', 'ex_brick', 'dn_copper', 'dn3', 'dn_steel', 'dn_esmelt', 'dn_wiremill']) FL.unlock(id);
  const itemIdx = (id) => FL.itemIndex(id);
  for (const it of ['iron_plate', 'glass', 'copper_wire', 'gear', 'circuit', 'copper_plate', 'steel', 'brick', 'pipe', 'cable']) sim.grant(it, 400);
  const grantCost = () => {};
  // Each line: pieces relative to its machine's top-left (rotation 0: intakes at the back, south).
  const LINES = [
    { name: 'steel', def: 'steel_mill', recipe: 'steel', silos: [[-2, 4, 'iron_plate'], [2, 4, 'coal']], belts: [[[-1, 3, 1], [0, 3, 0], [0, 2, 0]], [[2, 3, 3], [1, 3, 0], [1, 2, 0]]] },
    { name: 'bricks', def: 'brickworks', recipe: 'brick', silos: [[-2, 3, 'sand'], [1, 2, 'water']], belts: [[[-1, 2, 1], [0, 2, 0]]] },
    { name: 'copper', def: 'kiln', recipe: 'copper_plate', silos: [[-2, 4, 'copper_ore'], [2, 4, 'coal']], belts: [[[-1, 3, 1], [0, 3, 0], [0, 2, 0]], [[2, 3, 3], [1, 3, 0], [1, 2, 0]]] },
    { name: 'pipes', def: 'press', recipe: 'pipe', silos: [[0, 2, 'steel']], belts: [] },
    { name: 'cable', def: 'wire_mill', recipe: 'cable', silos: [[0, 2, 'copper_wire']], belts: [] },
    { name: 'idle', def: 'steel_mill', recipe: 'steel', silos: [], belts: [], unwired: true },
  ];
  const out = {};
  const taken = [];
  for (const L of LINES) {
    let done = null;
    for (let r = 8; r < 40 && !done; r += 2) {
      for (let a = 0; a < 16 && !done; a++) {
        const ox = Math.round(512 + r * Math.cos((a * Math.PI) / 8)), oy = Math.round(512 + r * Math.sin((a * Math.PI) / 8));
        if (taken.some(([x, y]) => Math.abs(x - ox) < 8 && Math.abs(y - oy) < 10)) continue;
        const ids = [];
        const undo = () => { for (const [x, y] of ids.reverse()) sim.remove(x, y); };
        const put = (def, x, y, rot) => { grantCost(def); const p = sim.place(def, x, y, rot); if (p.ok) ids.push([x, y]); return p; };
        const m = put(L.def, ox, oy, 0);
        if (!m.ok) continue;
        let ok = put('ribbon', ox, oy - 1, 0).ok && put('ribbon', ox, oy - 2, 0).ok && put('incinerator', ox, oy - 3, 0).ok;
        const silos = [];
        for (const [dx, dy, item] of L.silos) { const s = ok && put('silo', ox + dx, oy + dy, 0); ok = ok && s.ok; if (s && s.ok) silos.push([s.id, item]); }
        for (const run of L.belts) ok = ok && sim.placeBelts('ribbon', run.map(([dx, dy, rot]) => [ox + dx, oy + dy, rot])) === run.length;
        if (!ok) { undo(); continue; }
        sim.setRecipe(m.id, L.recipe);
        sim.ensureCompiled();
        for (const [id, item] of silos) { const it = itemIdx(item); sim.stores.get(id)[it] = 1000 * 1000; sim.graph.nodeByEnt.get(id).locked = it; }
        if (!L.unwired) FL.powerTo(m.id);
        taken.push([ox, oy]);
        done = { id: m.id, x: ox, y: oy };
      }
    }
    out[L.name] = done;
  }
  sim.markDirty();
  return out;
});
console.log('placed', JSON.stringify(placed));
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
const clip = { x: 420, y: 250, width: 600, height: 400 };
for (const time of ['noon', 'night']) {
  await page.evaluate((t) => window.FL.dayPhase(t), time);
  for (const mode of ['iso', 'plan']) {
    await view(mode);
    for (const name of own ? ['steel', 'bricks'] : ['steel', 'bricks', 'copper', 'pipes', 'cable', 'idle']) {
      const at = placed[name];
      if (!at) continue;
      await page.evaluate(([x, y]) => window.FL.lookAt(x + 1, y + 1, 3), [at.x, at.y]);
      await settle();
      await page.screenshot({ path: shot(`${name}-${mode}-${time}`), clip });
      console.log(`✓ shot-basics-${name}-${mode}-${time}.png (lit: ${await page.evaluate((i) => window.FL.workLook(i).lit, at.id)})`);
    }
  }
}
// The new works' building cards, over the Production tray.
await page.evaluate(() => window.FL.dayPhase('noon'));
await view('iso');
if (!(await page.isVisible('.bb-tab'))) await page.click('.hud-build').catch(() => {});
await page.waitForTimeout(500);
for (const def of ['steel_mill', 'brickworks', 'press', 'kiln']) {
  if (!(await page.isVisible(`.bb-slot[data-def="${def}"]`))) await page.click('.bb-tab[data-cat="production"]').catch(() => {});
  await page.waitForTimeout(300);
  const slot = page.locator(`.bb-slot[data-def="${def}"]`);
  if (!(await slot.count())) { console.log(`✗ no slot ${def}`); continue; }
  await slot.hover();
  await page.waitForSelector('[data-screen="building-card"]:not([hidden])', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('[data-screen="building-card"]').screenshot({ path: shot(`card-${def}`) }).catch((e) => console.log(`✗ card ${def}: ${e.message}`));
  console.log(`✓ shot-basics-card-${def}.png`);
}
await page.mouse.move(700, 300);
await page.keyboard.press('Escape');
// The steel mill selected: its inspector (recipe, rates).
if (placed.steel) {
  await page.evaluate((i) => { const e = window.FL.app.sim.ents.get(i); window.FL.lookAt(e.x + 1, e.y + 1, 1.6); window.FL.selected(i); }, placed.steel.id);
  await page.waitForSelector('.inspector:not([hidden])', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot('inspector-steel') });
  console.log('✓ shot-basics-inspector-steel.png');
}
await browser.close();
