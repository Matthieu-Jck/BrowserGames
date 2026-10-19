// core-door-shots.mjs — the Core's refusal of waste (D139), for visual review. It starts the sandbox
// base over (FL.wipe) and lays a rig south of the Core, finished at once (a review rig, outside
// commands): a silo of a few steel and a silo of slag whose lines join into one ribbon up into a south
// input of the Core. The first slag stops at the door, the line backs up behind it, and the refusal's badge
// hangs over the door (render/world/views-view.ts). Shoots it in iso and plan, then the inspector on
// the stopped line and on the Core, in French and in English. Writes scripts/door-*.png (gitignored).
// Usage: a server (URL=…, default :5183), then `node scripts/core-door-shots.mjs` from filon/.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./door-${name}.png`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=${process.env.SEED ?? '1'}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
await page.addStyleTag({ content: '.qlog, .guide, .toasts, [data-screen="quests"] { display: none !important; }' });

// The rig: below the Core's south side, x = its column + 1 (its first south input, fed from y + 5).
const rig = await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim;
  FL.unlock();
  sim.grant('iron_plate', 200);
  sim.grant('glass', 40);
  sim.grant('copper_wire', 40);
  const c = sim.ents.get(sim.hearthId), x = c.x + 1, y = c.y;
  const steel = sim.place('silo', x, y + 9, 0), slag = sim.place('silo', x + 2, y + 9, 0);
  if (!steel.ok || !slag.ok) return { error: `silos ${steel.reason} ${slag.reason}` };
  const n = sim.placeBelts('ribbon', [[x + 2, y + 8, 3], [x + 1, y + 8, 3]]) + sim.placeBelts('ribbon', [[x, y + 8, 0], [x, y + 7, 0], [x, y + 6, 0], [x, y + 5, 0]]);
  if (n !== 6) return { error: `ribbons ${n}` };
  for (const e of sim.ents.map.values()) if (e.builtAt !== 0) e.builtAt = 0;
  sim.markDirty();
  sim.ensureCompiled();
  // The steel silo (behind the merge, served first) holds a few: once it is dry the slag follows.
  for (const [id, item, k] of [[steel.id, 'steel', 6], [slag.id, 'slag', 40]]) {
    const it = FL.itemIndex(item);
    sim.stores.get(id)[it] = k * 1000;
    sim.graph.nodeByEnt.get(id).locked = it;
  }
  // B, west of the Core: a silo of slag straight into a wire mill's input (the tutorial's « Les
  // scories »: the contract's slag at the mill's door) — a machine's door, the same badge.
  const mx = c.x - 9, my = c.y + 1;
  const mill = sim.place('wire_mill', mx, my, 0), ms = sim.place('silo', mx, my + 4, 0);
  if (!mill.ok || !ms.ok) return { error: `mill ${mill.reason} ${ms.reason}` };
  if (sim.placeBelts('ribbon', [[mx, my + 3, 0], [mx, my + 2, 0]]) !== 2) return { error: 'mill ribbons' };
  for (const e of sim.ents.map.values()) if (e.builtAt !== 0) e.builtAt = 0;
  sim.markDirty();
  sim.ensureCompiled();
  const sl = FL.itemIndex('slag');
  sim.stores.get(ms.id)[sl] = 10 * 1000;
  sim.graph.nodeByEnt.get(ms.id).locked = sl;
  return { x, y, line: sim.entityAt(x, y + 6).id, core: sim.hearthId, mx, my, millLine: sim.entityAt(mx, my + 2).id };
});
console.log('rig', JSON.stringify(rig));
if (rig.error) { await browser.close(); process.exit(1); }

const settle = async (ms = 900) => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

// Let the line run until a slag waits at the door (read from the engine), then pause.
await page.evaluate(({ x, y }) => window.FL.lookAt(x, y + 5, 1.8), rig);
await page.waitForFunction(() => window.FL.app.sim.graph && window.FL.app.views && true, undefined, { timeout: 5000 });
for (let i = 0; i < 60; i++) {
  const ok = await page.evaluate(() => {
    const sim = window.FL.app.sim, h = sim.graph.hearth;
    return h.inE.some((e) => { const s = sim.graph.nodes[sim.graph.eSrc[e]]; return s.kind === 'chain' && s.cells.length && s.itemAt(s.cells.length - 1) === window.FL.itemIndex('slag'); });
  });
  if (ok) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(3000); // the line backs up behind it
await page.evaluate(() => window.FL.pause());
const state = await page.evaluate(() => ({ steel: window.FL.app.sim.stock[window.FL.itemIndex('steel')] / 1000, slag: window.FL.app.sim.stock[window.FL.itemIndex('slag')] / 1000, doors: window.FL.app.viewsView?.doorCount ?? null }));
console.log('state', JSON.stringify(state));

const clip = { x: 300, y: 150, width: 600, height: 500 };
for (const mode of ['iso', 'plan']) {
  await view(mode);
  await page.evaluate(({ x, y }) => window.FL.lookAt(x + 1, y + 5, 2.2), rig);
  await settle();
  await page.screenshot({ path: shot(`${mode}`), clip });
  await page.evaluate(({ mx, my }) => window.FL.lookAt(mx + 1, my + 2, 2.2), rig);
  await settle();
  await page.screenshot({ path: shot(`${mode}-mill`), clip });
}

// The inspector on the stopped line, then on the Core, in French then in English.
for (const loc of ['fr', 'en']) {
  await page.evaluate((l) => window.FL.setLocale(l), loc);
  for (const [name, id] of [['line', rig.line], ['core', rig.core], ['mill-line', rig.millLine]]) {
    await page.evaluate((i) => window.FL.selected(i), id);
    await page.waitForTimeout(700);
    const insp = page.locator('aside.inspector');
    await insp.screenshot({ path: shot(`insp-${name}-${loc}`) });
    const text = await insp.innerText();
    console.log(`${loc} ${name}:`, text.replace(/\s+/g, ' ').slice(0, 260));
  }
}
await page.evaluate(() => window.FL.selected(0));
await browser.close();
