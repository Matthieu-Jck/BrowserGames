// bench-shots.mjs — D129's two works at work, for visual review: on the grown debug base, a review rig
// lays an assembly bench winding copper coils (fed from silos of copper wire and iron plates) and an
// electronics workshop etching circuits (copper wire, copper plates and glass, its third intake on its
// west side), each powered, with a twin of each beside it left unwired (switched off, D83); then shoots
// them near and mid, iso and plan, at noon and at night; then the two building cards over the build
// bar and the Stock panel's rows with the two new items' glyphs (copper coil, electric motor):
// scripts/shot-bench-*.png (gitignored).
// Usage: a dev server (or a frozen `vite preview`), then `URL=http://localhost:<port> node scripts/bench-shots.mjs`.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-bench-${name}.png`, import.meta.url));
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

// The rig: the bench, its coils' recipe and the workshop learnt, the pieces paid by grants (a review
// rig, not play); each line laid on the first free spot near the Core, its silos stocked and locked,
// its works wired; a twin of each works laid three tiles east of it, left unwired.
const placed = await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim;
  for (const id of ['assembly_bench', 'tr1', 'workshop']) FL.unlock(id);
  for (const it of ['iron_plate', 'glass', 'copper_wire', 'copper_plate', 'steel', 'cable', 'oscillator', 'gear', 'brick']) sim.grant(it, 400);
  // Each line: pieces relative to its machine's top-left (rotation 0: intakes at the back, south;
  // the workshop's third intake on its west side, at (0, 1)).
  const BACK = [[[-1, 3, 1], [0, 3, 0], [0, 2, 0]], [[2, 3, 3], [1, 3, 0], [1, 2, 0]]];
  const LINES = [
    { name: 'bench', def: 'assembly_bench', recipe: 'copper_coil', silos: [[-2, 4, 'copper_wire'], [2, 4, 'iron_plate']], belts: BACK },
    { name: 'works', def: 'workshop', recipe: 'circuit', silos: [[-2, 4, 'copper_wire'], [2, 4, 'copper_plate'], [-4, 1, 'glass']], belts: [...BACK, [[-3, 0, 1], [-2, 0, 1], [-1, 0, 2], [-1, 1, 1]]] },
  ];
  const out = {};
  const taken = [];
  for (const L of LINES) {
    let done = null;
    for (let r = 8; r < 44 && !done; r += 2) {
      for (let a = 0; a < 16 && !done; a++) {
        const ox = Math.round(512 + r * Math.cos((a * Math.PI) / 8)), oy = Math.round(512 + r * Math.sin((a * Math.PI) / 8));
        if (taken.some(([x, y]) => Math.abs(x - ox) < 12 && Math.abs(y - oy) < 10)) continue;
        const ids = [];
        const undo = () => { for (const [x, y] of ids.reverse()) sim.remove(x, y); };
        const put = (def, x, y, rot) => { const p = sim.place(def, x, y, rot); if (p.ok) ids.push([x, y]); return p; };
        const m = put(L.def, ox, oy, 0);
        if (!m.ok) continue;
        let ok = put('ribbon', ox, oy - 1, 0).ok && put('ribbon', ox, oy - 2, 0).ok && put('incinerator', ox, oy - 3, 0).ok;
        const twin = ok ? put(L.def, ox + 3, oy, 0) : { ok: false };
        ok = ok && twin.ok;
        const silos = [];
        for (const [dx, dy, item] of L.silos) { const s = ok && put('silo', ox + dx, oy + dy, 0); ok = ok && s.ok; if (s && s.ok) silos.push([s.id, item]); }
        for (const run of L.belts) ok = ok && sim.placeBelts('ribbon', run.map(([dx, dy, rot]) => [ox + dx, oy + dy, rot])) === run.length;
        if (!ok) { undo(); continue; }
        sim.setRecipe(m.id, L.recipe);
        sim.setRecipe(twin.id, L.recipe);
        sim.ensureCompiled();
        for (const [id, item] of silos) { const it = FL.itemIndex(item); sim.stores.get(id)[it] = 1000 * 1000; sim.graph.nodeByEnt.get(id).locked = it; }
        FL.powerTo(m.id);
        taken.push([ox, oy]);
        done = { id: m.id, x: ox, y: oy, off: { id: twin.id, x: ox + 3, y: oy } };
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
// Near: one works filling the frame; mid: the pair (lit and switched off) with their silos.
const NEAR = { zoom: 3, clip: { x: 420, y: 250, width: 600, height: 400 } };
const MID = { zoom: 1.5, clip: { x: 270, y: 150, width: 900, height: 600 } };
for (const time of ['noon', 'night']) {
  await page.evaluate((t) => window.FL.dayPhase(t), time);
  for (const mode of ['iso', 'plan']) {
    await view(mode);
    for (const name of ['bench', 'works']) {
      const at = placed[name];
      if (!at) { console.log(`✗ no ${name}`); continue; }
      for (const [tag, e] of [[name, at], [`${name}-off`, at.off]]) {
        await page.evaluate(([x, y, z]) => window.FL.lookAt(x + 1, y + 1, z), [e.x, e.y, NEAR.zoom]);
        await settle();
        await page.screenshot({ path: shot(`${tag}-${mode}-near-${time}`), clip: NEAR.clip });
        console.log(`✓ shot-bench-${tag}-${mode}-near-${time}.png (lit: ${await page.evaluate((i) => window.FL.workLook(i).lit, e.id)})`);
      }
      await page.evaluate(([x, y, z]) => window.FL.lookAt(x + 2.5, y + 2, z), [at.x, at.y, MID.zoom]);
      await settle();
      await page.screenshot({ path: shot(`${name}-${mode}-mid-${time}`), clip: MID.clip });
      console.log(`✓ shot-bench-${name}-${mode}-mid-${time}.png`);
    }
  }
}
// The two works' building cards, over the Production tray.
await page.evaluate(() => window.FL.dayPhase('noon'));
await view('iso');
if (!(await page.isVisible('.bb-tab'))) await page.click('.hud-build').catch(() => {});
await page.waitForTimeout(500);
for (const def of ['assembly_bench', 'workshop']) {
  if (!(await page.isVisible(`.bb-slot[data-def="${def}"]`))) await page.click('.bb-tab[data-cat="production"]').catch(() => {});
  await page.waitForTimeout(300);
  const slot = page.locator(`.bb-slot[data-def="${def}"]`);
  if (!(await slot.count())) { console.log(`✗ no slot ${def}`); continue; }
  await slot.hover();
  await page.waitForSelector('[data-screen="building-card"]:not([hidden])', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('[data-screen="building-card"]').screenshot({ path: shot(`card-${def}`) }).catch((e) => console.log(`✗ card ${def}: ${e.message}`));
  console.log(`✓ shot-bench-card-${def}.png`);
}
await page.mouse.move(700, 300);
await page.keyboard.press('Escape');
// The Stock panel: some coils and motors in the Core, their rows brought into view.
await page.evaluate(() => { window.FL.selected(0); window.FL.app.sim.grant('copper_coil', 40); window.FL.app.sim.grant('motor', 12); });
await page.waitForTimeout(400);
await page.click('[data-hud-stock]').catch(() => console.log('✗ no stock button'));
await page.waitForTimeout(900);
const row = await page.evaluate(() => { const n = document.querySelector('[data-screen="stock"] .stk-row[data-item="copper_coil"]'); n?.scrollIntoView({ block: 'center' }); return !!n; });
console.log(`${row ? '✓' : '✗'} the copper coil's row in the Stock panel`);
await page.waitForTimeout(300);
await page.screenshot({ path: shot('stock') });
const panel = page.locator('[data-screen="stock"]');
if (await panel.count()) await panel.screenshot({ path: shot('stock-panel') }).catch((e) => console.log(`✗ stock panel: ${e.message}`));
console.log('✓ shot-bench-stock.png, shot-bench-stock-panel.png');
const made = await page.evaluate(() => ({ coils: window.FL.produced('copper_coil'), circuits: window.FL.produced('circuit') }));
console.log('made', JSON.stringify(made));
await browser.close();
