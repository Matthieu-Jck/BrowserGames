// d158-shots.mjs — D158's review shots (owner, 2026-10-19: « the junction should prevent putting
// something other than a ribbon on the two sides where the junction brings the items, but not on the
// other two sides. You can have items going below multiple junctions in a row »):
// - row: three upright junctions in a row (their decks north–south) with a line east under all three
//   and a line south over each; beside it three junctions turned east–west (decks east–west) with a
//   line south under them and a line east over each — items on every line, iso and plan, noon and night;
// - refused (in plan, where a building in hand is placed): a router in hand at a junction's deck end
//   (the ghost, the deck's coral arrow, the tip's reason and its junction → ribbon row), a junction in
//   hand between a router and a mast (both axes blocked), and one beside a router only (it turns its
//   deck by itself: turquoise arrows);
// - inspector: a junction whose deck end holds a router laid before the rule (its warning row).
// Writes <OUT>/d158-<TAG>-<name>.png (OUT defaults to scripts/, gitignored). Starts the sandbox base over.
// Usage: a server (URL=…, default :5183), then `TAG=after node scripts/d158-shots.mjs`.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const TAG = process.env.TAG ?? 'after';
const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('.', import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const shot = (name) => join(OUT, `d158-${TAG}-${name}.png`);
const want = (name) => !ONLY || ONLY.some((o) => name.includes(o));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1, locale: 'fr-FR' })).newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
await page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts, [data-screen="quests"] { display: none !important; }' });

const settle = async (ms = 900) => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

// The layout, laid through the Sim's own commands (every placement checked by `canPlace`), on the
// flat floor of the claim's land round the Heart (seed 1). Every line is fed by a silo of its own
// item — copper ore under the rows, iron ore over them — and ends in an incinerator, so items flow.
const laid = await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim;
  for (const id of ['junction', 'router', 'incinerator', 'silo']) FL.unlock(id);
  sim.grant('iron_plate', 3000); sim.grant('copper_wire', 500); sim.grant('glass', 200); sim.grant('brick', 200);
  const line = (x, y, rot, n) => { const dx = [0, 1, 0, -1][rot], dy = [-1, 0, 1, 0][rot]; return Array.from({ length: n }, (_, i) => [x + dx * i, y + dy * i, rot]); };
  const out = {};
  const put = (k, r) => { out[k] = typeof r === 'number' ? r : r.ok ? 'ok' : r.reason; return r; };
  const silos = [];
  const silo = (k, x, y, rot, item) => { const r = put(k, sim.place('silo', x, y, rot)); if (r.ok) silos.push([r.id, item]); };
  // Row A: three upright junctions at (499–501, 520); a line east under them; a line south over each.
  for (const x of [499, 500, 501]) put(`A${x}`, sim.place('crossing', x, 520, 0));
  silo('A-src', 494, 520, 1, 'copper_ore'); // out at (496, 520)
  put('A-under', sim.placeBelts('ribbon', line(496, 520, 1, 12)));
  put('A-sink', sim.place('incinerator', 508, 520, 0));
  silo('A-src1', 499, 513, 2, 'iron_ore'); // out at (499, 515) and (500, 515)
  silo('A-src2', 501, 513, 2, 'iron_ore'); // out at (501, 515)
  for (const x of [499, 500, 501]) { put(`A-over${x}`, sim.placeBelts('ribbon', line(x, 515, 2, 10))); put(`A-sink${x}`, sim.place('incinerator', x, 525, 0)); }
  // Row B: three junctions turned east–west at (522, 518–520); a line south under them; a line east over each.
  for (const y of [518, 519, 520]) put(`B${y}`, sim.place('crossing', 522, y, 1));
  silo('B-src', 522, 512, 2, 'copper_ore'); // out at (522, 514)
  put('B-under', sim.placeBelts('ribbon', line(522, 514, 2, 11)));
  put('B-sink', sim.place('incinerator', 522, 525, 0));
  silo('B-src1', 515, 518, 1, 'iron_ore'); // out at (517, 518) and (517, 519)
  silo('B-src2', 515, 520, 1, 'iron_ore'); // out at (517, 520)
  for (const y of [518, 519, 520]) { put(`B-over${y}`, sim.placeBelts('ribbon', line(517, y, 1, 10))); put(`B-sink${y}`, sim.place('incinerator', 527, y, 0)); }
  // The refusals' ground: a junction with its lines at (504, 530); a router and a mast round (510, 530);
  // a router alone north of (515, 530).
  put('C', sim.place('crossing', 504, 530, 0));
  put('C-over', sim.placeBelts('ribbon', line(504, 531, 2, 2)));
  put('C-under', sim.placeBelts('ribbon', line(501, 530, 1, 7)));
  put('D-router', sim.place('router', 510, 529, 0));
  put('D-mast', sim.place('mast', 511, 530, 0));
  put('E-router', sim.place('router', 515, 529, 0));
  // A junction from before the rule: upright with a router at its north end, written as a save of then held it.
  const ids = FL.ids().buildings;
  for (const [def, x, y, rot] of [['crossing', 520, 531, 0], ['router', 520, 530, 2]]) {
    const e = sim.ents.add({ def: ids.indexOf(def), x, y, rot, cfg: 0, builtAt: 0 });
    sim.grid.occ[y * 1024 + x] = e.id;
    if (def === 'crossing') out.old = e.id;
  }
  sim.dirty = true;
  sim.events.push({ k: 'structure' });
  put('F-under', sim.placeBelts('ribbon', line(517, 531, 1, 7)));
  put('F-over', sim.placeBelts('ribbon', line(520, 532, 2, 2)));
  sim.ensureCompiled();
  for (const [id, item] of silos) {
    const it = FL.itemIndex(item);
    sim.stores.get(id)[it] = 1000 * 1000;
    sim.graph.nodeByEnt.get(id).locked = it;
  }
  out.rows = { A: [499, 500, 501].map((x) => sim.entityAt(x, 520)?.rot), B: [518, 519, 520].map((y) => sim.entityAt(522, y)?.rot) };
  return out;
});
console.log(JSON.stringify(laid));
await page.evaluate(() => window.FL.clock('live'));
await page.waitForTimeout(12000); // the lines fill and flow
for (const phase of ['noon', 'night']) {
  await page.evaluate((p) => window.FL.dayPhase(p), phase);
  for (const mode of phase === 'noon' ? ['iso', 'plan'] : ['iso']) {
    await view(mode);
    for (const [tag, x, y, z] of [['both', 511, 520, 1.2], ['a', 500, 520, 2.6], ['b', 522, 519, 2.6], ['a-close', 500, 520, 5.5], ['b-close', 522, 519, 5.5]]) {
      const name = `row-${tag}-${mode}-${phase}`;
      if (!want(name)) continue;
      await page.evaluate(([x, y, z]) => window.FL.lookAt(x, y, z), [x, y, z]);
      await settle();
      await page.screenshot({ path: shot(name) });
      console.log('✓', name);
    }
  }
}
await page.evaluate(() => window.FL.dayPhase('noon'));

// The refusals: a building in hand, the pointer on the tile.
const hover = async (def, x, y, name, modes = ['iso', 'plan']) => {
  for (const mode of modes) {
    if (!want(`${name}-${mode}`)) continue;
    await view(mode);
    await page.evaluate(([cx, cy]) => window.FL.lookAt(cx, cy, 2.4), [x, y]);
    await settle(400);
    await page.evaluate((d) => window.FL.tool(d), def);
    const [sx, sy] = await page.evaluate(([a, b]) => window.FL.tileToScreen(a, b), [x, y]); // the tile's centre
    await page.mouse.move(sx - 30, sy - 30);
    await page.mouse.move(sx, sy, { steps: 4 });
    await page.waitForTimeout(500);
    const tip = await page.evaluate(() => document.querySelector('.tip')?.textContent ?? '');
    await page.screenshot({ path: shot(`${name}-${mode}`) });
    console.log('✓', `${name}-${mode}`, '·', tip.replace(/\s+/g, ' ').slice(0, 160));
    await page.evaluate(() => window.FL.tool(null));
  }
};
await hover('router', 504, 529, 'refused-router', ['plan']);
await hover('crossing', 510, 530, 'refused-junction', ['plan']);
await hover('crossing', 515, 530, 'turned-junction', ['plan']);

// A drag's preview (held, not released): east along y 506 across a line south at x 500 whose next
// tile north is a router, a mast on the drag's tile past it — the junction's deck would come down on
// the router one way, on the mast the other (no bridge learnt to leap them): refused, its deck's ends
// shown, the drag laid in part were it released.
if (want('drag')) {
  const g = await page.evaluate(() => {
    const sim = window.FL.app.sim;
    const line = (x, y, rot, n) => { const dx = [0, 1, 0, -1][rot], dy = [-1, 0, 1, 0][rot]; return Array.from({ length: n }, (_, i) => [x + dx * i, y + dy * i, rot]); };
    return [sim.placeBelts('ribbon', line(500, 503, 2, 7)), sim.place('router', 500, 505, 2).ok, sim.place('mast', 501, 506, 0).ok];
  });
  await view('plan');
  await page.evaluate(() => window.FL.lookAt(500, 506, 2.4));
  await settle(400);
  await page.evaluate(() => window.FL.tool('ribbon'));
  const [ax, ay] = await page.evaluate(() => window.FL.tileToScreen(497, 506));
  const [bx, by] = await page.evaluate(() => window.FL.tileToScreen(503, 506));
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 10 });
  await page.waitForTimeout(500);
  const tip = await page.evaluate(() => document.querySelector('.tip')?.textContent ?? '');
  await page.screenshot({ path: shot('drag-refused-plan') });
  console.log('✓ drag-refused-plan ·', JSON.stringify(g), tip.replace(/\s+/g, ' ').slice(0, 160));
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.evaluate(() => window.FL.tool(null));
}

// The inspector of the junction from before the rule: its deck and the router at its north end.
if (want('inspector')) {
  await view('iso');
  await page.evaluate((j) => { window.FL.lookAt(509, 527, 2.4); window.FL.selected(j); }, laid.old);
  await settle(700);
  await page.screenshot({ path: shot('inspector') });
  const text = await page.evaluate(() => document.querySelector('[data-sec="junction"]')?.textContent ?? '(none)');
  console.log('✓ inspector ·', text.replace(/\s+/g, ' ').slice(0, 220));
}
await browser.close();
