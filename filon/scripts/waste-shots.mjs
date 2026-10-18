// waste-shots.mjs — the machines' waste (D125) for visual review: on a fresh sandbox base (FL.wipe),
// two rigs laid near the Core, finished at once (a review rig, outside commands like the bridge's):
//   - a copper smelter (slag every five plates) fed by two stocked silos, its plates and slag down one
//     line (five tiles of it mixed), a sorter set to the plates on it, an incinerator against its side taking the slag, the
//     plates on into a silo — the mixed line and the sort;
//   - the steel mill on scrap (« Acier de récupération »: a recycler), the same geometry, its steel and
//     slag sorted the same way.
// The base runs a few minutes, then is paused right after the pit has burnt something (its node's
// `burnTick`, D125: the burst), and shot near: iso and plan, noon and night; the smelter's inspector
// (the equation with its slag, the waste bin) and the Stock panel's « Déchets ».
// scripts/shot-waste-<name>.png (gitignored). Usage: a server (URL=…, default :5183), then
// `node scripts/waste-shots.mjs` from filon/.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-waste-${name}.png`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=${process.env.SEED ?? '2'}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });

// The rigs: one geometry (the waste test's), its origin searched round the Core where every piece stands.
const rigs = await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim;
  FL.unlock();
  for (const r of ['dn_copper', 'dn_steel', 'ex_brick', 'tr1', 'dn3']) FL.unlock(r);
  for (const [it, n] of [['iron_plate', 900], ['glass', 200], ['copper_wire', 200], ['copper_plate', 200], ['brick', 200], ['gear', 50]]) sim.grant(it, n);
  const core = sim.ents.get(sim.hearthId);
  // Relative to the machine's top-left (0, 0), rot 0: inputs at (0|1, 1) from the south, output north at (0, 0).
  const pieces = (m) => [
    [m, 0, 0, 0],
    ['silo', 0, 4, 0], ['silo', 4, 2, 3],
    ['ribbon', 0, 3, 0], ['ribbon', 0, 2, 0], ['ribbon', 3, 2, 3], ['ribbon', 2, 2, 3], ['ribbon', 1, 2, 0],
    ['ribbon', 0, -1, 3], ...Array.from({ length: 8 }, (_, k) => ['ribbon', -1, -1 + k, 2]),
    ['sorter', -1, 5, 2], ['incinerator', -2, 5, 0], ['silo', -2, 7, 2],
  ];
  const lay = (m, recipe, a, b, keep, avoid) => {
    for (let r = 10; r < 60; r++) {
      for (let k = 0; k < 48; k++) {
        const ox = Math.round(core.x + r * Math.cos((k * Math.PI) / 24)), oy = Math.round(core.y + r * Math.sin((k * Math.PI) / 24));
        if (avoid && Math.abs(ox - avoid[0]) < 14 && Math.abs(oy - avoid[1]) < 14) continue;
        const ps = pieces(m).map(([d, x, y, rot]) => [d, ox + x, oy + y, rot]);
        if (!ps.every(([d, x, y, rot]) => sim.canPlace(d, x, y, rot).ok && sim.canPlace(d, x, y, rot).replaces.length === 0)) continue;
        sim.explored.push([ox, oy, 14]);
        const ids = {};
        for (const [d, x, y, rot] of ps) {
          const ok = d === 'ribbon' ? sim.placeBelts('ribbon', [[x, y, rot]]) === 1 : sim.place(d, x, y, rot);
          if (!ok || ok.ok === false) return { error: `${d} at ${x},${y}: ${ok.reason}` };
          if (d !== 'ribbon') ids[`${d}@${x - ox},${y - oy}`] = sim.entityAt(x, y).id;
        }
        for (const e of sim.ents.map.values()) if (e.builtAt !== 0) e.builtAt = 0;
        sim.markDirty();
        const mid = ids[`${m}@0,0`];
        sim.setRecipe(mid, recipe);
        sim.setForkFilter(ids['sorter@-1,5'], 0, keep);
        sim.ensureCompiled();
        // The silos stocked outside commands (a review rig), their item locked.
        for (const [key, it] of [['silo@0,4', a], ['silo@4,2', b]]) {
          const id = ids[key], idx = FL.itemIndex(it);
          sim.stores.get(id)[idx] = 900 * 1000;
          sim.graph.nodeByEnt.get(id).locked = idx;
        }
        FL.powerTo(mid);
        return { ox, oy, machine: mid, pit: ids['incinerator@-2,5'], sorter: ids['sorter@-1,5'] };
      }
    }
    return { error: `no room for the ${m}` };
  };
  const smelter = lay('kiln', 'copper_plate', 'copper_ore', 'coal', 'copper_plate', null);
  const mill = smelter.error ? smelter : lay('steel_mill', 'steel_scrap', 'scrap', 'coal', 'steel', [smelter.ox, smelter.oy]);
  return { smelter, mill };
});
console.log('rigs', JSON.stringify(rigs));
if (rigs.smelter.error || rigs.mill.error) { await browser.close(); process.exit(1); }

// A few minutes of work (the lines full of their mix), then real time until a pit has just burnt.
await page.evaluate(() => window.FL.tick(1800));
const burst = async (pit) => {
  await page.evaluate(() => window.FL.resume());
  const ok = await page.waitForFunction((id) => {
    const sim = window.FL.app.sim, n = sim.graph.nodeByEnt.get(id);
    const d = sim.tick - n.burnTick;
    if (n.burnTick >= 0 && d >= 2 && d <= 3) { window.FL.pause(); return true; }
    return false;
  }, pit, { timeout: 120000, polling: 16 }).catch(() => false);
  await page.waitForTimeout(250);
  return !!ok;
};

const ui = '.qlog, .guide, .toasts, [data-screen="quests"] { display: none !important; }';
const hideUi = await page.addStyleTag({ content: `${ui} .hud, .buildbar { display: none !important; }` });
const frame = async (r, view, moment, name) => {
  await page.evaluate(([x, y, v, m]) => { window.FL.view(v); window.FL.dayPhase(m); window.FL.lookAt(x, y, 2.4); }, [r.ox - 0.5, r.oy + 3, view, moment]);
  await page.waitForTimeout(view === 'plan' ? 900 : 600);
  const burnt = await burst(r.pit);
  await page.screenshot({ path: shot(name) });
  console.log(name, burnt ? 'mid-burst' : 'no burn seen');
};
// The mixed line: paused while a slag rides the smelter's line (one in five of what it puts out).
const mixed = async (r, view, name) => {
  await page.evaluate(([x, y, v]) => { window.FL.view(v); window.FL.dayPhase('noon'); window.FL.lookAt(x, y, 2.4); window.FL.resume(); }, [r.ox - 0.5, r.oy + 3, view]);
  await page.waitForTimeout(700);
  const ok = await page.waitForFunction(([ox, oy]) => {
    const sim = window.FL.app.sim, slag = window.FL.itemIndex('slag') + 1;
    const near = (t) => { const x = t % 1024, y = (t - x) / 1024; return x === ox - 1 && y >= oy + 1 && y <= oy + 3; }; // mid-line, between the bend and the sorter
    if (sim.graph.chains.some((c) => c.cells.some((v, i) => v === slag && i < c.cells.length - 1 && near(c.tiles[i])))) { window.FL.pause(); return true; }
    return false;
  }, [r.ox, r.oy], { timeout: 120000, polling: 16 }).catch(() => false);
  await page.waitForTimeout(250);
  await page.screenshot({ path: shot(name) });
  console.log(name, ok ? 'a slag on the line' : 'no slag seen');
};
await mixed(rigs.smelter, 'plan', 'line-mixed-plan');
await mixed(rigs.smelter, 'iso', 'line-mixed-iso');
await frame(rigs.smelter, 'iso', 'noon', 'line-iso-day');
await frame(rigs.smelter, 'plan', 'noon', 'line-plan-day');
await frame(rigs.smelter, 'iso', 'night', 'line-iso-night');
await frame(rigs.smelter, 'plan', 'night', 'line-plan-night');
await frame(rigs.mill, 'iso', 'noon', 'recycler-iso-day');
await frame(rigs.mill, 'plan', 'dusk', 'recycler-plan-dusk');

// The smelter's inspector and the Stock panel, the HUD back.
await hideUi.evaluate((n) => n.remove());
await page.addStyleTag({ content: ui });
await page.evaluate(([x, y, id]) => { window.FL.view('iso'); window.FL.dayPhase('noon'); window.FL.lookAt(x, y, 2); window.FL.selected(id); window.FL.resume(); }, [rigs.smelter.ox, rigs.smelter.oy + 2, rigs.smelter.machine]);
await page.waitForTimeout(1200);
await page.screenshot({ path: shot('inspector') });
await page.evaluate(() => { window.FL.selected(0); window.FL.app.sim.grant('slag', 40); window.FL.app.sim.grant('scrap', 12); });
await page.click('[data-hud-stock]').catch(() => console.log('no stock button'));
await page.waitForTimeout(800);
await page.screenshot({ path: shot('stock') });
const facts = await page.evaluate(() => ({ slag: window.FL.produced('slag'), scrap: window.FL.produced('scrap'), steel: window.FL.produced('steel'), stocks: window.FL.stocks() }));
console.log('made', JSON.stringify({ slag: facts.slag, scrap: facts.scrap, steel: facts.steel, slagInCore: facts.stocks.slag ?? 0 }));
await browser.close();
