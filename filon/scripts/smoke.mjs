// smoke.mjs — headless end-to-end smoke test, driven ONLY through window.FL and
// data-screen selectors (agora/replicatas pattern). Fails on any console / page error.
// Usage: start `npm run dev` or `npm run preview` (port 5183), then `npm run smoke`.
// Env: URL (default http://localhost:5183), SMOKE_LOCALE (fr-FR), CHROME (path to a Chrome binary).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

/** Screenshots land next to this script, whatever the working directory. */
const shot = (name) => fileURLToPath(new globalThis.URL(`./${name}`, import.meta.url)); // (URL is shadowed below)

const URL = process.env.URL ?? 'http://localhost:5183';
const LOCALE = process.env.SMOKE_LOCALE ?? 'fr-FR';
const errors = [];

// Fail early and clearly when no server answers.
try { await fetch(URL); } catch {
  console.log(`✗ no server at ${URL}: start \`npm run dev\` (or \`npm run preview\`) first`);
  process.exit(2);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: LOCALE });
const page = await context.newPage();
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('response', (res) => {
  if (!res.ok() && res.status() !== 304 && !res.url().includes('favicon')) errors.push(`http ${res.status()}: ${res.url()}`);
});

const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✗ ${name}: ${e.message}`); errors.push(`step ${name}: ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const FL = (fn, arg) => page.evaluate(fn, arg);

await page.goto(URL, { waitUntil: 'networkidle' });

await step('boots: window.FL ready, boot veil gone', async () => {
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 15000 });
  await page.waitForSelector('body[data-ready]', { timeout: 5000 });
  await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 5000 });
  await FL(() => { if (window.FL.app.guide) window.FL.app.guide.enabled = false; }); // no tutorial arrows in the shots
});

await step('renderer is WebGL', async () => {
  const p = await FL(() => window.FL.perf());
  assert(p.renderer === 'webgl', `renderer = ${p.renderer}`);
});

await step('module worker round-trips', async () => {
  const r = await FL(() => window.FL.echo('ping'));
  assert(r && r.echo === 'ping' && r.from === 'worker', `bad echo ${JSON.stringify(r)}`);
});

await step('i18n: language follows the browser, toggles live', async () => {
  const l = await FL(() => window.FL.locale());
  assert(l === (LOCALE.startsWith('fr') ? 'fr' : 'en'), `locale ${l}`);
  await FL(() => window.FL.setLocale('en'));
  assert((await FL(() => window.FL.t('hud.power'))) === 'Power', 'en power');
  await FL(() => window.FL.setLocale('fr'));
  assert((await FL(() => window.FL.t('hud.power'))) === 'Énergie', 'fr power');
});

await step('stress: 20 000 particles stay above 30 fps', async () => {
  await FL(() => window.FL.stress({ items: 20000 }));
  await page.waitForTimeout(2500);
  const p = await FL(() => window.FL.perf());
  console.log(`    fps=${p.fps} frameMs=${p.frameMs.toFixed(2)} maxFrameMs=${p.maxFrameMs} drawCalls=${p.drawCalls}`);
  // A throttled browser (machine under load) caps frames at 30: then judge the frame's own cost.
  assert(p.fps > 30 || p.frameMs < 8, `too slow: ${p.fps} fps, ${p.frameMs.toFixed(2)} ms a frame`);
  await page.screenshot({ path: shot('smoke-m0.png') });
  await FL(() => window.FL.stress({ items: 0 }));
});

await step('iso: Crown relief stands up as sprites near, as paint far (LOD)', async () => {
  await FL(() => window.FL.lookAt(533, 495, 0.8)); // on the Crown (r 23–32), north-east
  await page.waitForFunction(() => window.FL.perf().reliefSprites > 100, undefined, { timeout: 8000 });
  await FL(() => window.FL.lookAt(512, 512, 0.2));
  await page.waitForFunction(() => window.FL.perf().reliefSprites === 0, undefined, { timeout: 4000 });
});

await step('iso: pan and zoom sweep leave no missing chunk once settled', async () => {
  for (const [x, y, z] of [[512, 512, 1], [470, 540, 0.5], [560, 470, 1.6], [512, 512, 0.32]]) {
    await FL(([a, b, c]) => window.FL.lookAt(a, b, c), [x, y, z]);
    await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 15000 });
  }
});

// ── M3: build mode, tools, inspector, production ──────────────────────────
const tileXY = (tx, ty) => FL(([a, b]) => window.FL.tileToScreen(a, b), [tx, ty]);
const settleView = (mode) => page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 4000 });

await step('build: the button morphs the colony to the plan view, B brings it back', async () => {
  await FL(() => window.FL.demo());
  await FL(() => window.FL.lookAt(512, 505, 1.2));
  await page.click('.hud-build');
  await settleView('plan');
  assert((await FL(() => window.FL.category())) !== null, 'no category open');
  await page.keyboard.press('b');
  await settleView('iso');
  assert((await FL(() => window.FL.category())) === null, 'category still open');
});

await step('power: the demo base is fully wired to the Heart’s grid', async () => {
  const r = await FL(() => {
    const sim = window.FL.app.sim;
    sim.ensureCompiled();
    const home = sim.graph.netOfEnt.get(sim.hearthId);
    const off = sim.ents.sorted()
      .filter((e) => ['drill', 'assembly_bench', 'observatory', 'trade_post', 'wind_flower'].includes(window.FL.entityAt(e.x, e.y)?.def))
      .filter((e) => sim.graph.netOfEnt.get(e.id) !== home)
      .map((e) => window.FL.entityAt(e.x, e.y)?.def);
    return { off, pairs: sim.links.size, wires: window.FL.wires() };
  });
  assert(r.off.length === 0, `not on the Heart's grid: ${r.off.join(', ')}`);
  assert(r.pairs >= 12 && r.wires === r.pairs, `wires ${r.wires} / pairs ${r.pairs}`);
});

await step('build: pick a drill in the tray and click it onto a deposit', async () => {
  // The tabs show only while building (D88): « Construire » first.
  assert(!(await page.isVisible('.bb-tab[data-cat="extraction"]')), 'build tabs shown while not building');
  await page.click('.hud-build');
  await page.waitForSelector('.bb-tab[data-cat="extraction"]', { state: 'visible', timeout: 2000 });
  if (!(await page.$('.bb-tab[data-cat="extraction"][data-on]'))) await page.click('.bb-tab[data-cat="extraction"]'); // « Construire » opens the last tab
  await settleView('plan');
  await page.click('.bb-slot[data-def="drill"]');
  const spot = await FL(() => {
    const sim = window.FL.app.sim;
    for (let r = 0; r < 40; r++) for (let y = 512 - r; y <= 512 + r; y++) for (let x = 512 - r; x <= 512 + r; x++) {
      if (Math.max(Math.abs(x - 512), Math.abs(y - 512)) === r && (() => { const c = sim.canPlace('drill', x, y, 0); return c.ok && c.replaces.length === 0; })()) return [x, y];
    }
    return null;
  });
  assert(spot, 'no drill spot');
  await FL(([x, y]) => window.FL.lookAt(x, y, 1.2), spot);
  await page.waitForTimeout(300);
  const [sx, sy] = await tileXY(spot[0], spot[1]);
  await page.mouse.move(sx, sy);
  await page.waitForTimeout(150);
  assert(await page.isVisible('#tooltip'), 'no build tip');
  await page.mouse.click(sx, sy);
  const e = await FL(([x, y]) => window.FL.entityAt(x, y), spot);
  assert(e && e.def === 'drill', `no drill at ${spot}: ${JSON.stringify(e)}`);
});

await step('build: drag a ribbon L, then box-demolish it (refunded)', async () => {
  await page.keyboard.press('Escape');
  await FL(() => window.FL.tool('ribbon'));
  // A spot whose whole box, a tile round the L, is free: the box takes down everything in it, and the
  // demo base's turbines stand six tiles apart now (D132), one of them near enough to fall in it.
  const a = await FL(() => {
    const sim = window.FL.app.sim, clear = (x0, y0) => {
      for (let y = y0 - 1; y <= y0 + 3; y++) for (let x = x0 - 1; x <= x0 + 5; x++) { const c = sim.canPlace('ribbon', x, y, 0); if (!c.ok || c.replaces.length) return false; }
      return true;
    };
    for (let d = 0; d <= 10; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === d && clear(518 + dx, 520 + dy)) return [518 + dx, 520 + dy];
    }
    return null;
  });
  assert(a, 'no ribbon spot with a clear box');
  const b = [a[0] + 4, a[1] + 2];
  await FL(([x, y]) => window.FL.lookAt(x, y, 1.2), [a[0] + 2, a[1] + 1]);
  await page.waitForTimeout(300);
  const plates0 = await FL(() => window.FL.stocks().iron_plate);
  const [ax, ay] = await tileXY(a[0], a[1]);
  const [bx, by] = await tileXY(b[0], b[1]);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps: 4 });
  await page.mouse.move(bx, by, { steps: 4 });
  await page.mouse.up();
  const laid = await FL(([x0, y0, x1, y1]) => {
    let n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const e = window.FL.entityAt(x, y); if (e && e.def === 'ribbon') n++; }
    return n;
  }, [a[0], a[1], b[0], b[1]]);
  assert(laid === 7, `expected an L of 7 ribbons, got ${laid}`);
  await page.keyboard.press('x');
  await page.mouse.move(ax - 20, ay - 20);
  await page.mouse.down();
  await page.mouse.move(bx + 20, by + 20, { steps: 6 });
  await page.mouse.up();
  const left = await FL(([x0, y0, x1, y1]) => {
    let n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const e = window.FL.entityAt(x, y); if (e && e.def === 'ribbon') n++; }
    return n;
  }, [a[0], a[1], b[0], b[1]]);
  assert(left === 0, `${left} ribbons survived the box`);
  const plates1 = await FL(() => window.FL.stocks().iron_plate);
  assert(Math.abs(plates1 - plates0) < 1, `not refunded: ${plates0} → ${plates1}`);
});

await step('build: place over things — a router clicked onto a ribbon replaces it; a drag across a line lays a junction', async () => {
  await page.keyboard.press('Escape');
  const at = await FL(() => {
    const sim = window.FL.app.sim;
    const free = (x, y) => { const c = sim.canPlace('ribbon', x, y, 2); return c.ok && c.replaces.length === 0; };
    for (let r = 6; r < 30; r++) for (let y = 512 - r; y <= 512 + r; y++) for (let x = 512 - r; x <= 512 + r; x++) {
      if (Math.max(Math.abs(x - 512), Math.abs(y - 512)) !== r) continue;
      let ok = true;
      for (let dy = 0; dy < 5 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) ok = free(x + dx, y + dy);
      if (ok) { sim.placeBelts('ribbon', [0, 1, 2, 3, 4].map((k) => [x, y + k, 2])); return [x, y]; }
    }
    return null;
  });
  assert(at, 'no free square for the line');
  const [lx, ly] = at;
  await FL(([x, y]) => window.FL.lookAt(x, y + 2, 1.4), at);
  await page.waitForTimeout(300);
  await FL(() => window.FL.tool('router'));
  const [rx, ry] = await tileXY(lx, ly);
  await page.mouse.move(rx, ry);
  await page.waitForTimeout(150);
  await page.screenshot({ path: shot('smoke-replace-router.png') });
  await page.mouse.click(rx, ry);
  let e = await FL(([x, y]) => window.FL.entityAt(x, y), [lx, ly]);
  assert(e && e.def === 'router', `the router did not replace the ribbon: ${JSON.stringify(e)}`);
  await page.keyboard.press('Escape');
  await FL(() => window.FL.tool('ribbon'));
  const [ax, ay] = await tileXY(lx - 2, ly + 2);
  const [bx, by] = await tileXY(lx + 2, ly + 2);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 6 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: shot('smoke-replace-junction.png') });
  await page.mouse.up();
  e = await FL(([x, y]) => window.FL.entityAt(x, y), [lx, ly + 2]);
  assert(e && e.def === 'crossing', `no junction where the drag crossed the line: ${JSON.stringify(e)}`);
  e = await FL(([x, y]) => window.FL.entityAt(x, y), [lx, ly + 3]);
  assert(e && e.def === 'ribbon' && e.rot === 2, 'the crossed line was cut');
});

await step('build: off the claim’s land a kiln is refused, with the reason and the land key', async () => {
  await page.keyboard.press('Escape');
  await FL(() => window.FL.tool('kiln'));
  // Past the starting square (3 × 3 parcels of 23 tiles round the Heart: ±34 tiles, D74), on explored floor.
  const far = await FL(() => {
    const sim = window.FL.app.sim;
    for (let d = 36; d <= 48; d++) for (const [x, y] of [[512, 512 + d], [512 + d, 512], [512, 512 - d], [512 - d, 512]]) {
      if (sim.canPlace('kiln', x, y, 0).reason === 'outside_zone') return [x, y];
    }
    return null;
  });
  assert(far, 'no explored floor just off the claim’s land');
  await FL(([x, y]) => window.FL.lookAt(x, y, 1.2), far);
  await page.waitForTimeout(300);
  const [sx, sy] = await tileXY(far[0], far[1]);
  await page.mouse.click(sx, sy);
  const t = (await FL(() => window.FL.toasts())).join(' | ');
  assert(/terres|land/i.test(t) && /\bI\b/.test(t), `no off-the-land refusal toast: ${t}`);
  assert(!(await FL(([x, y]) => window.FL.entityAt(x, y), far)), 'kiln placed off the claim’s land');
});

await step('build: a ribbon dragged over the Crown takes its steps with traction ribbons by itself (D73); nothing is laid before the release', async () => {
  await page.keyboard.press('Escape');
  await FL(() => { const s = window.FL.app.sim; s.done.add('traction'); s.rebuildDerived(); s.grant('iron_plate', 40); s.grant('copper_wire', 20); });
  await FL(() => window.FL.tool('ribbon'));
  // A free row east of the Heart whose drag meets the Crown's steps: the plan lays a traction ribbon at each.
  const row = await FL(() => {
    const sim = window.FL.app.sim;
    for (let y = 498; y <= 526; y++) {
      const path = []; for (let x = 526; x <= 548; x++) path.push([x, y, 1]);
      const plan = sim.planBelts('ribbon', path);
      if (!plan.every((s) => s.ok && !s.skip)) continue;
      const steps = plan.filter((s) => s.def === 'traction_ribbon').map((s) => s.x);
      if (steps.length >= 2) return { y, steps };
    }
    return null;
  });
  assert(row, 'no free row over the Crown');
  await FL(([y]) => window.FL.lookAt(537, y, 1.2), [row.y]);
  await page.waitForTimeout(300);
  const [ax, ay] = await tileXY(526, row.y);
  const [bx, by] = await tileXY(548, row.y);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 10 });
  await page.waitForTimeout(250);
  // Mid-drag: a placeholder of the plan, nothing on the ground yet.
  const mid = await FL(([y]) => {
    const pre = window.FL.app.tools.preview();
    return { drag: !!pre.drag, lifts: pre.pieces.filter((p) => p.def === 'traction_ribbon').length, laid: [526, 537, 548].filter((x) => window.FL.entityAt(x, y)).length };
  }, [row.y]);
  await page.screenshot({ path: shot('smoke-crown-steps.png') });
  await page.mouse.up();
  assert(mid.drag && mid.lifts === row.steps.length, `the ghost is not the plan's placeholder: ${JSON.stringify(mid)}`);
  assert(mid.laid === 0, `something was laid before the release: ${JSON.stringify(mid)}`);
  const laid = await FL(([y, xs]) => xs.map((x) => window.FL.entityAt(x, y)?.def ?? null), [row.y, row.steps]);
  assert(laid.every((d) => d === 'traction_ribbon'), `the steps did not take traction ribbons: ${JSON.stringify(laid)}`);
  assert((await FL(([y]) => window.FL.entityAt(548, y), [row.y]))?.def === 'ribbon', 'the drag was not laid to its end');
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('smoke-crown-laid.png') });
});

await step('build: a drag across two lines side by side lays a bridge pair over them (D73), never two junctions in a row', async () => {
  await page.keyboard.press('Escape');
  const at = await FL(() => {
    const sim = window.FL.app.sim;
    sim.done.add('bridge'); sim.rebuildDerived(); sim.grant('iron_plate', 20);
    const free = (x, y) => { const c = sim.canPlace('ribbon', x, y, 2); return c.ok && c.replaces.length === 0; };
    for (let r = 8; r < 34; r++) for (let y = 512 - r; y <= 512 + r; y++) for (let x = 512 - r; x <= 512 + r; x++) {
      if (Math.max(Math.abs(x - 512), Math.abs(y - 512)) !== r) continue;
      let ok = true;
      for (let dy = 0; dy < 5 && ok; dy++) for (let dx = -3; dx <= 4 && ok; dx++) ok = free(x + dx, y + dy);
      if (!ok) continue;
      for (const lx of [x, x + 1]) sim.placeBelts('ribbon', [0, 1, 2, 3, 4].map((k) => [lx, y + k, 2]));
      return [x, y];
    }
    return null;
  });
  assert(at, 'no free square for the two lines');
  const [lx, ly] = at;
  await FL(([x, y]) => window.FL.lookAt(x, y + 2, 1.4), at);
  await page.waitForTimeout(300);
  await FL(() => window.FL.tool('ribbon'));
  const [ax, ay] = await tileXY(lx - 3, ly + 2);
  const [bx, by] = await tileXY(lx + 4, ly + 2);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 8 });
  await page.waitForTimeout(200);
  const leaps = await FL(() => window.FL.app.tools.preview().leaps ?? []);
  await page.screenshot({ path: shot('smoke-bridge-ghost.png') });
  await page.mouse.up();
  assert(leaps.length === 1, `the ghost shows no leap: ${JSON.stringify(leaps)}`);
  const row = await FL(([x, y]) => [-1, 0, 1, 2].map((d) => window.FL.entityAt(x + d, y)), [lx, ly + 2]);
  assert(row[0]?.def === 'skybridge' && row[3]?.def === 'skybridge', `no bridge pair over the lines: ${JSON.stringify(row)}`);
  assert(row[1]?.def === 'ribbon' && row[1].rot === 2 && row[2]?.def === 'ribbon' && row[2].rot === 2, 'a crossed line was cut');
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('smoke-bridge-laid.png') });
});

await step('build: a ribbon dragged across a neighbouring base’s open land buries itself there (D109): the ghost and the tip say so; the rest stays plain', async () => {
  await page.keyboard.press('Escape');
  const at = await FL(() => {
    const FL = window.FL, sim = FL.app.sim;
    for (const id of ['xp_swift', 'xp_bigsilo', 'xp_guard', 'xp_camo']) FL.unlock(id);
    sim.grant('iron_plate', 200); sim.grant('sand', 200);
    // The bases stand from ring 4 out, a few (D110's second pass): look as far as ring 16.
    for (let ring = 2; ring <= 16; ring++) for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const q = FL.parcel(dx, dy), w = FL.parcel(dx - 1, dy);
      if (sim.land.neighbour(q.p) < 0 || sim.land.neighbour(w.p) >= 0 || sim.land.holds(w.p)) continue;
      let x0 = q.at[0];
      while (FL.parcelAt(x0 - 1, q.at[1]) === q.p) x0--;
      sim.explored.push([x0, q.at[1], 30]);
      for (let k = 0; k < 20; k++) {
        const y = q.at[1] + (k % 2 ? -1 : 1) * (k >> 1);
        let ok = true;
        for (let x = x0 - 4; x < x0 + 8 && ok; x++) ok = !sim.neighbours.at(x, y) && sim.canPlace('camo_ribbon', x, y, 1).ok && !sim.entityAt(x, y);
        if (ok) return { x0, y, p: q.p };
      }
    }
    return null;
  });
  assert(at, 'no neighbouring base beside free land with an open row');
  await FL(([x, y]) => window.FL.lookAt(x, y, 1.2), [at.x0 + 2, at.y]);
  await page.waitForTimeout(300);
  await FL(() => window.FL.tool('ribbon'));
  const [ax, ay] = await tileXY(at.x0 - 4, at.y);
  const [bx, by] = await tileXY(at.x0 + 7, at.y);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 8 });
  await page.waitForTimeout(250);
  const pre = await FL(() => { const p = window.FL.app.tools.preview(); return { buried: p.buried ?? null, camo: p.pieces.filter((q) => q.def === 'camo_ribbon').length }; });
  const tip = await page.evaluate(() => !!document.querySelector('.tip-buried'));
  await page.screenshot({ path: shot('smoke-camo-ghost.png') });
  await page.mouse.up();
  assert(pre.camo === 8 && pre.buried?.n === 8 && pre.buried?.land === 'neighbour_land', `the ghost buries no neighbour tiles: ${JSON.stringify(pre)}`);
  assert(tip, 'the tip does not name the buried pieces');
  const row = await FL(([x, y]) => [-4, -1, 0, 7].map((d) => window.FL.entityAt(x + d, y)?.def ?? null), [at.x0, at.y]);
  assert(row[0] === 'ribbon' && row[1] === 'ribbon' && row[2] === 'camo_ribbon' && row[3] === 'camo_ribbon', `laid: ${JSON.stringify(row)}`);
});

await step('inspect: in the iso view a click on the Heart’s uplink (above its footprint) opens the inspector', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await settleView('iso');
  await FL(() => window.FL.lookAt(512, 512, 1));
  await page.waitForTimeout(300);
  // The uplink dish stands above the Heart's footprint: click above its centre on screen (pixel-exact picking).
  const [sx, sy] = await tileXY(512, 512);
  await page.mouse.click(sx, sy - 40);
  await page.waitForSelector('.inspector:not([hidden])', { timeout: 2000 });
  const title = await page.textContent('.inspector h3');
  assert(/Cœur|Heart/.test(title ?? ''), `inspector shows ${title}`);
  await page.keyboard.press('Escape');
});

await step('produce: the demo line turns iron ore into plates', async () => {
  await FL(() => window.FL.tick(3000));
  const plates = await FL(() => window.FL.produced('iron_plate'));
  const ore = await FL(() => window.FL.produced('iron_ore'));
  console.log(`    produced: ore=${ore.toFixed(1)} plates=${plates.toFixed(1)}`);
  assert(ore > 20 && plates > 5, `production too low: ore ${ore}, plates ${plates}`);
  await page.waitForFunction(() => window.FL.itemsOnRibbons() > 5, undefined, { timeout: 5000 });
  await page.screenshot({ path: shot('smoke-m3.png') });
});

await step('power: the Relier tool wires a mast to a wind flower by mouse, a second click unwires it, right-click ends', async () => {
  await page.keyboard.press('Escape');
  const ids = await FL(() => {
    // Spots on the floor (level 0): one up on a terrace is drawn lifted, away from its tile's floor
    // point the clicks aim at (the map's springs and streams moved the free floor round, D94).
    const sim = window.FL.app.sim;
    const floorSpot = (def, x, y, r) => {
      for (let d = 0; d <= r; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d || sim.grid.level(x + dx, y + dy) !== 0) continue;
        const c = sim.canPlace(def, x + dx, y + dy, 0);
        if (c.ok && c.replaces.length === 0) return [x + dx, y + dy];
      }
      return null;
    };
    const m = floorSpot('mast', 530, 520, 14);
    if (!m) return null;
    const mast = window.FL.place('mast', m[0], m[1], 0);
    const f = floorSpot('wind_flower', m[0] + 2, m[1], 8);
    if (!f) return null;
    const flower = window.FL.place('wind_flower', f[0], f[1], 0);
    return { mast: mast.id, flower: flower.id, m, f };
  });
  assert(ids && ids.mast && ids.flower, `could not place: ${JSON.stringify(ids)}`);
  await FL(([x, y]) => window.FL.lookAt(x, y, 1.6), ids.m);
  await page.waitForTimeout(300);
  await page.keyboard.press('l');
  const [mx, my] = await tileXY(ids.m[0], ids.m[1]);
  await page.mouse.click(mx, my);
  assert((await FL(() => window.FL.linking().source)) === ids.mast, 'the mast is not the source');
  const [fx, fy] = await tileXY(ids.f[0], ids.f[1]);
  await page.mouse.click(fx, fy);
  assert((await FL((id) => window.FL.links(id), ids.flower)).includes(ids.mast), 'no wire to the flower');
  await page.screenshot({ path: shot('smoke-link.png') });
  await page.mouse.click(fx, fy);
  assert(!(await FL((id) => window.FL.links(id), ids.flower)).includes(ids.mast), 'the second click did not unwire');
  await page.mouse.click(fx, fy, { button: 'right' });
  await page.mouse.click(fx, fy, { button: 'right' });
  assert((await FL(() => window.FL.linking().active)) === false, 'still linking');
});

await step('power: a wire too long is refused, with the reason', async () => {
  const far = await FL(() => {
    const e = window.FL.app.sim.ents.sorted().find((o) => {
      const d = window.FL.entityAt(o.x, o.y)?.def;
      return (d === 'drill' || d === 'assembly_bench') && (Math.abs(o.x - 512) > 14 || Math.abs(o.y - 512) > 14);
    });
    return e ? [e.x, e.y] : null;
  });
  assert(far, 'no building far from the Heart');
  await FL(() => window.FL.linking(window.FL.app.sim.hearthId));
  await FL(([x, y]) => window.FL.lookAt(x, y, 1.4), far);
  await page.waitForTimeout(300);
  const [x, y] = await tileXY(far[0], far[1]);
  await page.mouse.click(x, y);
  assert((await FL(() => window.FL.toasts())).some((t) => /Trop loin|Too far/.test(t)), 'no « too far » notice');
  await FL(() => window.FL.linking(null));
});

await step('power: P shows the Électricité view (D88), P again the Normal one', async () => {
  await page.keyboard.press('p');
  await page.waitForFunction(() => { const v = window.FL.mapView(); return v.view === 'power' && v.marks > 0; }, undefined, { timeout: 3000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('smoke-power.png') });
  await page.keyboard.press('p');
  assert((await FL(() => window.FL.mapView().view)) === 'normal', 'P did not go back to Normal');
});

await step('inspect: the grid module (D76) — a wind flower shows rated × factor = now, its factor unfolds why (its wind once the Anémométrie plan is learnt, D95); a workshop shows what it draws, in the same card', async () => {
  const ids = await FL(() => {
    const sim = window.FL.app.sim;
    const of = (def) => sim.ents.sorted().find((e) => window.FL.entityAt(e.x, e.y)?.def === def && e.builtAt === 0)?.id ?? 0;
    return { wind: of('wind_flower'), shop: of('assembly_bench') };
  });
  assert(ids.wind && ids.shop, `demo base: ${JSON.stringify(ids)}`);
  await FL((id) => window.FL.selected(id), ids.wind);
  await page.waitForSelector('[data-power-card] [data-pw="formula"] .pw-coef', { timeout: 5000 });
  assert((await page.$$('[data-power-card]')).length === 1, 'one grid card');
  assert(await page.$('.pw-why[hidden]'), 'the reasons start folded');
  await page.click('.pw-coef');
  // D95: with the Anémométrie plan, the wind's reasons and the turbine's next 24 hours (now inked).
  const planned = await FL(() => window.FL.app.sim.done.has('anemometry'));
  if (planned) await page.waitForSelector('.pw-why:not([hidden]) [data-pw-viz="wind"] .pw-sun-bars i[data-on]', { timeout: 3000 });
  else await page.waitForSelector('.pw-why:not([hidden]) .pw-why-lines div', { timeout: 3000 });
  const f = await page.evaluate(() => [...document.querySelectorAll('[data-pw="formula"] .pw-kw, [data-pw="formula"] .pw-coef-n')].map((n) => n.textContent));
  assert(f.length === 3 && /kW/.test(f[0]) && /^×/.test(f[1]) && /kW/.test(f[2]), `formula: ${f.join(' | ')}`);
  await page.locator('.inspector').screenshot({ path: shot('smoke-grid-card.png') });
  // Before the plan (taken back in the sandbox): what its blades give, no picture of the wind.
  await FL(() => { const sim = window.FL.app.sim; sim.done.delete('anemometry'); sim.rebuildDerived(); });
  await page.waitForFunction(() => !document.querySelector('.pw-why [data-pw-viz="wind"]') && document.querySelectorAll('.pw-why-lines div').length === 2, undefined, { timeout: 3000 });
  if (planned) await FL(() => { const sim = window.FL.app.sim; sim.done.add('anemometry'); sim.rebuildDerived(); });
  await FL((id) => window.FL.selected(id), ids.shop);
  await page.waitForSelector('[data-power-card] [data-pw="draw"]', { timeout: 5000 });
  assert(!(await page.$('[data-pw="formula"]')), 'a consumer has no formula');
  await FL(() => window.FL.selected(0));
});

// ── M4: research ─────────────────────────────────────────────────────────────
await step('sound: the first click unlocked it; the score follows the clock; cues played; three live sliders', async () => {
  // The build and power steps' mouse clicks were the user gesture that starts Web Audio.
  const s = await FL(() => window.FL.app.sound.describe());
  assert(s.state === 'running' && s.context === 'running', `sound ${s.state} / ${s.context}`);
  assert(s.score?.chord && s.played > 0, `score ${JSON.stringify(s.score)}, ${s.played} cues`);
  await FL(() => window.FL.dayPhase('night'));
  await page.waitForFunction(() => window.FL.app.sound.describe().score?.part === 'night', undefined, { timeout: 3000 });
  await FL(() => window.FL.dayPhase(null));
  await FL(() => window.FL.menu(true, 'settings'));
  assert(await page.locator('input[data-vol]:not([disabled])').count() === 3, 'three live volume sliders');
  await FL(() => window.FL.menu(false));
});

await step('research (D122): Mechanics, Tier 1, opens the launch dialog — its resources from the Core, its tokens, the free flow; launched, its HUD chip a token bar (no data); it ends once its tokens are in; a notice lands', async () => {
  await FL(() => window.FL.lookAt(512, 512, 1));
  await FL(() => window.FL.pause()); // the tokens come at a minute's end, after the chip is read
  // Its 30 plates and 10 copper wire in the Core, the restart reserve kept (D36): a sandbox grant.
  await FL(() => { window.FL.app.sim.grant('iron_plate', 200); window.FL.app.sim.grant('copper_wire', 60); });
  await page.keyboard.press('t');
  await page.waitForSelector('[data-screen="research"][data-open]', { timeout: 2000 });
  await page.click('.rs-card[data-id="tr1"]');
  await page.click('.rs-detail .btn.primary');
  await page.waitForSelector('[data-launch]:not([hidden])', { timeout: 2000 });
  const dlg = await page.evaluate(() => ({
    res: document.querySelector('[data-launch-res]')?.textContent ?? '',
    eta: document.querySelector('[data-launch-eta]')?.textContent ?? '',
    data: /donn[ée]es d|survey data/i.test(document.querySelector('[data-launch]')?.textContent ?? ''),
  }));
  assert(dlg.res && dlg.eta && !dlg.data, `Tier 1's launch dialog: ${JSON.stringify(dlg)}`);
  await page.waitForTimeout(400); // its fade in
  await page.screenshot({ path: shot('smoke-d122-launch.png') });
  await page.click('[data-launch-go]');
  const r = await FL(() => window.FL.research());
  assert(r.projects?.some((p) => p.id === 'tr1'), `tr1 not running: ${JSON.stringify(r)}`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.hud-rs[data-id="tr1"]', { timeout: 2000 });
  const chip = await page.evaluate(() => {
    const c = document.querySelector('.hud-rs[data-id="tr1"]');
    return { data: !!c?.querySelector('.hud-rs-row[data-k="data"]'), tok: !!c?.querySelector('.hud-rs-row[data-k="tok"]:not([hidden])'), eta: c?.querySelector('.hud-rs-eta')?.textContent ?? '' };
  });
  assert(!chip.data && chip.tok, `Tier 1's chip: ${JSON.stringify(chip)}`);
  // Its tokens: banked for it (a sandbox hook, D122), given at the next minute's end while its lab has power.
  await FL(() => window.FL.bankTokens(2000));
  await FL(() => window.FL.resume());
  for (let i = 0; i < 12; i++) {
    await FL(() => window.FL.tick(60));
    if ((await FL(() => window.FL.research())).done?.includes('tr1')) break;
  }
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((n) => /Mécanique|Mechanics/.test(n.textContent ?? '')), undefined, { timeout: 3000 });
  const after = await FL(() => window.FL.research());
  assert(after.done?.includes('tr1'), 'tr1 not learnt');
  await page.screenshot({ path: shot('smoke-m4.png') });
});

await step('research (D118, D122): Tier 2 locked until the Core\'s level 3; then a Tier 2 node opens the launch dialog — its resources, tokens, a bought flow and its cost — and runs on a token bar', async () => {
  // A sandbox rig (outside commands): Tier 1 whole, every node of Tier 2 and up set aside (a tier a
  // claim holds a node of stays open to it), two expertises chosen, the purse full; all of it, and the
  // Core's level, put back after — whatever happens.
  const rig = await FL(() => {
    const sim = window.FL.app.sim;
    const t1 = window.FL.tierNodes(1);
    const added = t1.filter((id) => !sim.done.has(id));
    for (const id of added) sim.done.add(id);
    const aside = [...sim.done].filter((id) => window.FL.researchTier(id) >= 2);
    for (const id of aside) sim.done.delete(id);
    const slots = sim.expertise.slots.slice();
    sim.expertise.slots = [{ id: 'estate', at: 0, on: true }, { id: 'haulage', at: 0, on: true }];
    const level = sim.hearthLevel, credits = sim.credits;
    sim.hearthLevel = 2;
    sim.rebuildDerived();
    sim.grantCredits(5_000_000);
    for (const it of ['gear', 'iron_plate', 'steel', 'brick', 'pipe', 'glass']) sim.grant(it, 200); // Earthworks' resources, whatever they are (D122, D123)
    return { added, aside, slots, level, credits, core: sim.researchBlock('tr2') };
  });
  try {
    assert(rig.core === 'core', `Tier 2 at the Core's level 2: ${rig.core}`);
    await FL(() => window.FL.open('research'));
    await page.waitForSelector('[data-screen="research"][data-open]', { timeout: 2000 });
    await page.waitForSelector('.tr-tierhead[data-tier="2"][data-locked]', { timeout: 2000 }); // its next refresh (4 Hz)
    const head = await page.evaluate(() => ({ text: document.querySelector('.tr-tierhead[data-tier="2"]')?.textContent ?? '', locked: !!document.querySelector('.tr-tierhead[data-tier="2"][data-locked]') }));
    assert(/3/.test(head.text) && head.locked, `Tier 2's head names the Core's level 3, locked: ${JSON.stringify(head)}`);
    await FL(() => window.FL.close());
    await FL(() => { const sim = window.FL.app.sim; sim.hearthLevel = 3; sim.rebuildDerived(); });
    await FL(() => window.FL.pause());
    await FL(() => window.FL.open('research'));
    await page.waitForSelector('[data-screen="research"][data-open]', { timeout: 2000 });
    await page.click('.rs-card[data-id="tr2"]');
    await page.click('.rs-detail .btn.primary');
    await page.waitForSelector('[data-launch]:not([hidden])', { timeout: 2000 });
    const dlg = await page.evaluate(() => ({
      cost: document.querySelector('[data-launch-cost]')?.textContent ?? '',
      eta: document.querySelector('[data-launch-eta]')?.textContent ?? '',
      flow: !!document.querySelector('[data-launch-flow]'),
    }));
    assert(dlg.flow && dlg.cost && dlg.eta, `the launch dialog: ${JSON.stringify(dlg)}`);
    // The Core's compute covers Earthworks' pace (D122: its default flow is none): buy one on top, two steps up the ladder.
    await page.click('[data-launch-step="plus"]');
    await page.click('[data-launch-step="plus"]');
    await page.click('[data-launch-go]');
    const p = await FL(() => window.FL.app.sim.projects.find((q) => q.id === 'tr2'));
    assert(p && p.tokens > 0 && p.buy > 0, `tr2 launched with a bought flow: ${JSON.stringify(p)}`);
    await FL(() => window.FL.close());
    await page.waitForSelector('.hud-rs[data-id="tr2"] .hud-rs-row[data-k="tok"]:not([hidden])', { timeout: 2000 });
    await page.screenshot({ path: shot('smoke-d118.png') });
  } finally {
    // Back as it was: the project cancelled, the Core's level, the nodes, the slots, the purse.
    await FL((o) => {
      const sim = window.FL.app.sim;
      sim.cancelResearch('tr2');
      for (const id of o.added) sim.done.delete(id);
      for (const id of o.aside) sim.done.add(id);
      sim.expertise.slots = o.slots;
      sim.hearthLevel = o.level;
      sim.credits = o.credits;
      sim.rebuildDerived();
    }, rig);
    await FL(() => window.FL.close());
    await FL(() => window.FL.resume());
  }
});

await step('stats: the screen lists what the colony makes', async () => {
  await page.keyboard.press('g');
  await page.waitForSelector('[data-screen="stats"][data-open]', { timeout: 2000 });
  await page.waitForFunction(() => document.querySelectorAll('.st-table .st-row').length > 0, undefined, { timeout: 8000 });
  await page.keyboard.press('Escape');
});

// ── M6: the Crier ──────────────────────────────────────────────────────────
await step('crier: in the Port-Écume shortage, glass sells dear through the post (CrierBelt takes a fifth, D64); M opens the Crier', async () => {
  const post = await FL(() => window.FL.tradePost());
  assert(post > 0, 'no trade post in the demo');
  // The scripted first trade: bulbs short at Port-Écume from 20 min after founding, for 2 h,
  // easing in over ~20 min. Go 45 min in (if the run is not past it already).
  const t0 = await FL(() => window.FL.app.sim.tick);
  if (t0 < 600 * 45) await FL((n) => window.FL.tick(n), 600 * 45 - t0);
  const g = await FL(() => window.FL.gazette());
  const p = await FL(() => window.FL.price('glass'));
  console.log(`    bulbs bid ${p.bid.toFixed(2)} ◉ · gazette: ${g.active.join(' | ')}`);
  assert(g.active.some((l) => /Port-Écume/.test(l)), `no shortage in the Gazette: ${JSON.stringify(g)}`);
  assert(p.bid > 4.6, `bulbs not dearer in the shortage: ${p.bid}`);
  // A spot sale from the Heart's stock (a post's entrance sells only what ribbons bring it, D64).
  const c0 = await FL(() => window.FL.credits());
  const sale = await FL(() => window.FL.app.sim.spotTrade('glass', 'sell', 40));
  assert(sale && 'cents' in sale, `sale refused: ${JSON.stringify(sale)}`);
  const c1 = await FL(() => window.FL.credits());
  console.log(`    ocelles ${c0.toFixed(0)} → ${c1.toFixed(0)}`);
  assert(c1 > c0 + 100, `the sale did not pay: ${c0} → ${c1}`);
  await page.keyboard.press('m');
  await page.waitForSelector('[data-screen="market"][data-open]', { timeout: 2000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: shot('smoke-m6-crier.png') });
  await page.keyboard.press('Escape');
});

await step('crier: a standing order imports copper ore by the post’s one exit (D62), delivered after the lift and the colony’s delay; the inspector is a recap; a click on the post picks it', async () => {
  const post = await FL(() => window.FL.tradePost());
  // D62: the 5×5 post has one entrance (port 0) and one exit (port 1), each across its scorched
  // apron on a flame-proof ribbon. The exit hands out everything the post bought, in turn: there
  // is no outlet to set (setPortItem refuses a post), only a ribbon to lay from it into the Heart.
  const r = await FL((p) => {
    const sim = window.FL.app.sim;
    const def = sim.ents.get(p) && window.FL.entityAt(sim.ents.get(p).x, sim.ents.get(p).y)?.def;
    return { def, setItem: sim.setPortItem(p, 1, 'copper_ore'), laid: window.FL.connect(p, sim.hearthId) };
  }, post);
  assert(r.def === 'trade_post', `not a trade post: ${r.def}`);
  assert(r.setItem === false, 'a trade post’s exit took an item setting');
  assert(r.laid > 0, 'no ribbon from the post’s exit into the Heart');
  const ask = await FL(() => window.FL.price('copper_ore').ask);
  const id = await FL(([p, a]) => window.FL.app.sim.addImport(p, 'copper_ore', 10, Math.round(a * 100 * 2)), [post, ask]);
  assert(typeof id === 'number', `order refused: ${id}`);
  const have = () => FL(() => window.FL.stocks().copper_ore ?? 0);
  const before = await have();
  let after = before;
  for (let i = 0; i < 14 && after < before + 10; i++) { await FL(() => window.FL.tick(600 * 5)); after = await have(); }
  console.log(`    copper ore ${before} → ${after}`);
  assert(after >= before + 10, `nothing delivered: ${before} → ${after}`);
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((n) => /Livraison|Delivered/.test(n.textContent ?? '')), undefined, { timeout: 3000 });
  // The inspector is a recap (D64): its gates (the exit linked), what its container holds and what
  // it is worth, what is on its way and what it cost, its orders — no outlet or stream pickers.
  await FL((p) => { const e = window.FL.app.sim.ents.get(p); window.FL.lookAt(e.x + 2.5, e.y + 2.5, 1.5); window.FL.selected(p); }, post);
  await page.waitForSelector('.inspector:not([hidden]) [data-gate="out"]', { timeout: 3000 });
  const g = await FL(() => ({
    pickers: document.querySelectorAll('.inspector [data-outlet], .inspector [data-pick^="stream"]').length,
    linked: !!document.querySelector('.inspector [data-gate="out"][data-gate-linked]'),
    recaps: document.querySelectorAll('.inspector .tp-recap').length,
    cards: ['sell', 'cargo'].every((k) => !!document.querySelector(`.inspector [data-tp="${k}"]`)),
    order: !!document.querySelector('.inspector .tr-order[data-item="copper_ore"]'),
    lines: [...document.querySelectorAll('.inspector .tp-recap .tp-line[data-item]')].map((n) => n.getAttribute('data-item')),
  }));
  console.log(`    recap: ${g.lines.join(',') || 'empty'}${g.linked ? '' : ' (exit not linked)'}`);
  assert(g.pickers === 0, 'the trade post still shows outlet or stream pickers');
  assert(g.recaps === 3, `no to-sell / delivered / on-its-way recap (D131): ${g.recaps}`);
  assert(g.linked && g.order && g.cards, `the exit, the copper order or the two stores (à vendre, livré) are not shown: ${JSON.stringify(g)}`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot('smoke-m6-post.png') });
  // Iso picking: a click on the post's pad or apron picks the post — a flat ribbon in front never
  // takes it (owner, 2026-10-14: "my cursor was on the trade post, but it selected the ribbon").
  const pick = await FL((p) => {
    const pk = window.FL.app.picker, e = window.FL.app.sim.ents.get(p);
    let hits = 0, n = 0;
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
      const [sx, sy] = pk.tileToScreen(e.x - 0.4 + (i * 4.8) / 12, e.y - 0.4 + (j * 4.8) / 12);
      n++; if (pk.entityAt(sx, sy) === p) hits++;
    }
    return { hits, n };
  }, post);
  console.log(`    picking over the post: ${pick.hits}/${pick.n}`);
  assert(pick.hits >= 0.95 * pick.n, `clicks on the post pick something else: ${pick.hits}/${pick.n}`);
  await FL(() => window.FL.selected(0));
  await FL((o) => window.FL.app.sim.cancelImport(o), id);
});

// ── M5: space ──────────────────────────────────────────────────────────────
await step('space: mark rock with the brush, an excavator digs six tiles (stone, and the rock turns to floor)', async () => {
  const setup = await FL(() => {
    const sim = window.FL.app.sim;
    for (const id of ['tr1', 'tr2', 'tr3', 'tr4', 'tr6']) sim.done.add(id);
    sim.rebuildDerived();
    for (const [it, n] of [['iron_plate', 4000], ['gear', 800], ['circuit', 400], ['ceramic', 400], ['lens', 40], ['resin_canvas', 60], ['thermal_core', 40], ['steel', 200], ['brick', 200], ['pipe', 100], ['cable', 100], ['copper_plate', 100], ['motor', 40], ['copper_coil', 100]]) sim.grant(it, n); // D123: the excavator is built of steel; D129: and motors
    if (!sim.upgradeHearth().ok) return { err: 'hearth upgrade' };
    // The nearest rock to the Hearth, and an excavator on the claim's land facing it.
    let best = null;
    for (let y = 512 - 60; y <= 512 + 60; y++) for (let x = 512 - 60; x <= 512 + 60; x++) {
      const t = sim.grid.terrain(x, y);
      if (t !== 2) continue; // soft sandstone
      const d = (x - 512) ** 2 + (y - 512) ** 2;
      if (!best || d < best.d) best = { x, y, d };
    }
    if (!best) return { err: 'no rock' };
    const r = Math.sqrt(best.d), ux = (best.x - 512) / r, uy = (best.y - 512) / r;
    // As close to the rock as the floor allows: an excavator digs within 3 tiles of itself (D54).
    for (let k = Math.floor(r) - 2; k >= 11; k--) { // on the cirque's floor, short of the rim (the starting square holds it all)
      const ex = Math.round(512 + ux * k) - 1, ey = Math.round(512 + uy * k) - 1;
      const res = sim.place('excavator', ex, ey, 0);
      if (res.ok) return { rock: [best.x, best.y], exc: [ex, ey], id: res.id };
    }
    return { err: 'no excavator spot' };
  });
  assert(!setup.err, setup.err);
  // Power for the excavator: masts from the Hearth.
  await FL((id) => window.FL.powerTo(id), setup.id);
  await page.click('.hud-build');
  await settleView('plan');
  await page.keyboard.press('c');
  const [rx, ry] = setup.rock;
  await FL(([x, y]) => window.FL.lookAt(x, y, 1.3), [rx, ry]);
  await page.waitForTimeout(300);
  const [ax, ay] = await tileXY(rx - 2, ry - 2), [bx, by] = await tileXY(rx + 2, ry + 2);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 6 });
  await page.mouse.up();
  const marked = await FL(() => window.FL.app.sim.designated.size);
  assert(marked >= 6, `only ${marked} tiles marked`);
  const dug0 = await FL(() => window.FL.produced('stone'));
  // ~5 min a tile at full power; the weather follows the real clock (a calm hour browns the
  // grid out), so tick on until six are dug (bounded).
  const dugNow = () => FL(([x, y]) => { const sim = window.FL.app.sim; let n = 0; for (let j = y - 2; j <= y + 2; j++) for (let i = x - 2; i <= x + 2; i++) if (sim.grid.terrain(i, j) === 11) n++; return n; }, [rx, ry]);
  let dug = 0;
  for (let i = 0; i < 16 && dug < 6; i++) { await FL(() => window.FL.tick(3000)); dug = await dugNow(); }
  const rub = (await FL(() => window.FL.produced('stone'))) - dug0;
  console.log(`    dug ${dug} tiles, rubble ${rub.toFixed(0)}`);
  assert(dug >= 6, `only ${dug} tiles dug`);
  assert(rub >= 60, `rubble ${rub}`);
  await page.screenshot({ path: shot('smoke-m5-dig.png') });
  await page.keyboard.press('Escape');
});

await step('space: a parcel bought past the starting square takes a silo; a ribbon carries its plates home to a silo on the starting square', async () => {
  // Until D108 two skydocks and a drifter route carried the plates; the skydocks are retired, so
  // the far goods go home by ribbon (the plain ribbon free everywhere, the claim's land between).
  const r = await FL(() => {
    const sim = window.FL.app.sim;
    // The parcel two east of the Heart's (ring 2: just past the 3 × 3 starting square, D74), bought
    // with the ocelles granted if short (a rig: the land panel's own step buys one by the mouse).
    const { p, at } = window.FL.parcel(2, 0), cents = sim.landPrice(p);
    if (sim.credits < cents) sim.grantCredits(cents - sim.credits);
    if (sim.land.holds(p) ? false : sim.buyLand(p) !== null) return { err: 'land not bought' };
    if (!sim.land.covers(at[0], at[1])) return { err: 'parcel not held' }; // its middle tile
    // A silo on the new parcel (it needs the claim's land), full of plates, and a silo at home on the
    // starting square's east edge, past the Crown on the same floor (a plain ribbon climbs no terrace,
    // D77): both face west (outlets toward the Heart, inlets toward the parcel).
    const spotNear = (cx, cy) => {
      for (let d = 0; d <= 8; d++) for (let y = cy - d; y <= cy + d; y++) for (let x = cx - d; x <= cx + d; x++) {
        const c = sim.canPlace('silo', x, y, 3);
        if (c.ok && c.replaces.length === 0) return [x, y];
      }
      return null;
    };
    const far = spotNear(at[0], at[1]), near = spotNear(at[0] - 14, at[1]);
    if (!far || !near) return { err: `silo spots ${far} ${near}` };
    const s = sim.place('silo', far[0], far[1], 3), h = sim.place('silo', near[0], near[1], 3);
    if (!s.ok || !h.ok) return { err: `silos ${s.reason} ${h.reason}` };
    // Its plates in its store before the graph first builds its node: a silo locks onto the one item
    // it holds then (or the first that comes in), and hands out only that.
    const plates = new Float64Array(sim.stock.length);
    plates[window.FL.itemIndex('iron_plate')] = 800 * 1000;
    sim.stores.set(s.id, plates);
    sim.run(Math.max(0, sim.ents.get(s.id).builtAt - sim.tick, sim.ents.get(h.id).builtAt - sim.tick) + 5);
    sim.ensureCompiled();
    const n = window.FL.connect(s.id, h.id);
    if (!(n > 0)) return { err: 'no line home' };
    return { silo: s.id, home: h.id, tiles: n, ws: at };
  });
  assert(!r.err, r.err);
  await FL(() => window.FL.tick(1800));
  const got = await FL(({ home }) => window.FL.app.sim.stores.get(home)[window.FL.itemIndex('iron_plate')] / 1000, r);
  console.log(`    a ${r.tiles}-tile line carried ${got.toFixed(1)} plates home in 3 min`);
  assert(got > 10, `the line carried ${got}`);
  await FL(({ ws }) => window.FL.lookAt(ws[0] - 12, ws[1], 0.55), r);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot('smoke-m5-parcel-line.png') });
});

// ── D60: land in parcels ───────────────────────────────────────────────────
await step('land (D60): I opens the land mode over the plan view; a click picks a parcel, the panel shows it, « Acheter » buys it', async () => {
  await FL(() => { window.FL.tool(null); window.FL.category(null); window.FL.close(); window.FL.selected(0); });
  await settleView('iso');
  // A parcel for sale just past the starting square (ring 2: 3 × 3 parcels of 23 tiles round the
  // Heart's, D74), clicked on its explored tile nearest its middle: a ring-2 middle lies 46 tiles
  // out and more, past the founding's reveal (`coreReveal[0]` 44), so whether one was explored
  // depended on the run; its inner edge (35 out) always is. The ocelles granted if short (a rig:
  // the purse of the demo base).
  const pick = await FL(() => {
    const sim = window.FL.app.sim;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
      const { p, at: mid } = window.FL.parcel(dx, dy);
      // Not one the claim cannot buy: held, a neighbouring base's (D110), or a corner only touching its land.
      if (sim.land.holds(p) || sim.land.neighbour(p) >= 0 || sim.buyBlock(p) === 'far') continue;
      let at = null, best = Infinity;
      for (let y = mid[1] - 11; y <= mid[1] + 11; y++) for (let x = mid[0] - 11; x <= mid[0] + 11; x++) {
        const d = (x - mid[0]) ** 2 + (y - mid[1]) ** 2;
        if (d < best && sim.revealed(x, y) && window.FL.parcelAt(x, y) === p) { best = d; at = [x, y]; }
      }
      if (!at) continue;
      const cents = sim.landPrice(p);
      if (sim.credits < cents + 100) sim.grantCredits(cents + 100 - sim.credits);
      return { p, at, bought: sim.land.bought.size };
    }
    return null;
  });
  assert(pick, 'no parcel for sale past the starting square');
  await FL(([x, y]) => window.FL.lookAt(x, y, 1), pick.at);
  await page.keyboard.press('i');
  await settleView('plan');
  await page.waitForSelector('[data-screen="land"]:not([hidden])', { timeout: 3000 });
  assert(await FL(() => window.FL.app.landTool.active), 'land mode not on');
  await page.waitForFunction(() => Math.abs(window.FL.camera().zoom - 0.36) < 0.02, undefined, { timeout: 4000 }); // zoomed out to a few parcels
  const [sx, sy] = await tileXY(pick.at[0], pick.at[1]);
  await page.mouse.move(sx, sy);
  await page.mouse.click(sx, sy);
  await page.waitForFunction((p) => window.FL.app.landTool.selected === p, pick.p, { timeout: 2000 });
  await page.waitForSelector('[data-screen="land"] [data-land-act="buy"]:not([disabled])', { timeout: 2000 });
  const card = await page.evaluate(() => document.querySelector('[data-screen="land"]')?.innerText ?? '');
  assert(/◉/.test(card) && /CrierBelt/.test(card), `land panel: ${card}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('smoke-land.png') });
  await page.click('[data-screen="land"] [data-land-act="buy"]');
  await page.waitForFunction((n) => window.FL.app.sim.land.bought.size === n + 1, pick.bought, { timeout: 2000 });
  assert(await FL((p) => window.FL.app.sim.land.bought.has(p), pick.p), 'the picked parcel was not bought');
  const t = (await FL(() => window.FL.toasts())).join(' | ');
  assert(/Parcelle achetée|Parcel bought/.test(t), `no purchase notice: ${t}`);
  // Esc lets the parcel go, then ends the mode: back to the view.
  await page.keyboard.press('Escape');
  assert((await FL(() => window.FL.app.landTool.selected)) === -1, 'Esc kept the parcel');
  await page.keyboard.press('Escape');
  await settleView('iso');
  assert(!(await FL(() => window.FL.app.landTool.active)), 'land mode still on');
});

await step('neighbouring bases (D110): a base stands on a neighbour\'s land, by day and by night; nothing of the claim\'s goes on its buildings; its parcel in the land panel: its name, its trade, not for sale', async () => {
  await FL(() => { window.FL.tool(null); window.FL.category(null); window.FL.close(); window.FL.selected(0); });
  await settleView('iso');
  // The base nearest the Heart: its lift pad's middle, surveyed (a rig: the fog lifted round it).
  const nb = await FL(() => {
    const sim = window.FL.app.sim;
    // None within three rings of the Heart's parcel (D110: « trop de bases de PNJ autour de moi »).
    for (let p = 0; p < 45 * 45; p++) if (sim.neighbours.holdingOf(p) && Math.max(Math.abs((p % 45) - 22), Math.abs(Math.floor(p / 45) - 22)) < 4) return { near: p };
    let best = null;
    for (let p = 0; p < 45 * 45; p++) {
      const h = sim.neighbours.holdingOf(p);
      if (!h || h.hub !== p || sim.land.neighbour(p) < 0) continue;
      const L = sim.neighbours.layout(h), pad = L.structs[0];
      if (!pad) continue;
      const d = (pad.x - 512) ** 2 + (pad.y - 512) ** 2;
      if (!best || d < best.d) best = { d, hub: p, at: [pad.x + 2, pad.y + 2], n: L.structs.length, r: L.ribbons.length, parcels: h.parcels.length };
    }
    if (best) sim.explored.push([best.at[0], best.at[1], 44]);
    return best;
  });
  assert(!(nb && 'near' in nb), `a neighbouring base within three rings of the Heart: ${JSON.stringify(nb)}`);
  assert(nb && nb.n >= 4 && nb.r >= 1, `no working neighbouring base: ${JSON.stringify(nb)}`);
  console.log(`    base at ${nb.at} (hub ${nb.hub}): ${nb.n} buildings, ${nb.r} ribbons, ${nb.parcels} parcels`);
  await FL(([x, y]) => window.FL.lookAt(x, y, 1.4), nb.at);
  await page.waitForFunction((hub) => window.FL.app.buildings.hasForeign(hub), nb.hub, { timeout: 5000 });
  // A working base (D110, owner: « il n'y a rien qui marche, même pas de câble électrique »): its own grid's wires drawn, never the claim's.
  const grid = await FL((hub) => ({ wires: window.FL.app.wires.foreignCount, laid: window.FL.app.neighbours.count, on: window.FL.app.wires.hasForeign(hub) }), nb.hub);
  assert(grid.on && grid.wires > 0 && grid.laid >= 1, `no grid drawn for the base: ${JSON.stringify(grid)}`);
  // Its goods ride its drawn lines (owner: « a ribbon from a PNJ base disappears »): none in the view off a line's tile, none on a stretch not drawn.
  await page.waitForTimeout(300);
  const goods = await FL((hub) => window.FL.app.neighbours.audit(hub), nb.hub);
  assert(goods.goods > 0 && goods.offTile === 0 && goods.undrawn === 0, `goods off the drawn lines: ${JSON.stringify(goods)}`);
  // Its land refuses a mast; with Neighbour Treaties its open land takes one, its buildings never.
  const placed = await FL(([x, y]) => window.FL.place('mast', x, y, 0), nb.at);
  assert(!placed.ok && placed.reason === 'neighbour_land', `a mast went on its land: ${JSON.stringify(placed)}`);
  await FL(() => window.FL.unlock('xp_treaties'));
  const treaty = await FL(([x, y]) => window.FL.place('mast', x, y, 0), nb.at);
  assert(!treaty.ok && treaty.reason === 'occupied', `a mast went on its pad: ${JSON.stringify(treaty)}`);
  await FL(() => window.FL.dayPhase('noon'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot('smoke-neighbour-day.png') });
  await FL(([x, y]) => window.FL.lookAt(x, y, 0.6), nb.at);
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot('smoke-neighbour-mid.png') });
  await FL(() => window.FL.dayPhase('night'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot('smoke-neighbour-night-mid.png') });
  await FL(([x, y]) => window.FL.lookAt(x, y, 1.4), nb.at);
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot('smoke-neighbour-night.png') });
  await FL(() => window.FL.dayPhase(null));
  // Its Core (owner: « ils devraient avoir un cœur, juste pas le même que le mien »): a click on it shows the base's card.
  await FL(([x, y]) => window.FL.lookAt(x, y, 1.4), nb.at);
  await page.waitForTimeout(500);
  const coreAt = await FL((hub) => { const sim = window.FL.app.sim, L = sim.neighbours.layout(sim.neighbours.holdingOf(hub)); const c = L.structs[L.core]; return c ? [c.x + 1.5, c.y + 1.5] : null; }, nb.hub);
  assert(coreAt, 'the base has no Core');
  const [csx, csy] = await tileXY(coreAt[0], coreAt[1]);
  await page.mouse.click(csx, csy - 24);
  await page.waitForSelector('[data-neighbour-card]:not([hidden])', { timeout: 2000 });
  const ncard = await page.evaluate(() => document.querySelector('[data-neighbour-card]')?.innerText ?? '');
  assert(/Base voisine|Neighbouring base/.test(ncard), `base card: ${ncard}`);
  await page.screenshot({ path: shot('smoke-neighbour-card.png') });
  await page.mouse.move(csx + 300, csy + 200);
  await page.waitForTimeout(150);
  // The Terrain view and the land panel on its hub: its emblem, its name, its trade; no deal.
  await page.keyboard.press('i');
  await settleView('plan');
  await page.waitForSelector('[data-screen="land"]:not([hidden])', { timeout: 3000 });
  await FL((hub) => { window.FL.app.landTool.selected = hub; }, nb.hub);
  await page.waitForSelector('[data-screen="land"] [data-deal="neighbour"]', { timeout: 3000 });
  const card = await page.evaluate(() => document.querySelector('[data-screen="land"]')?.innerText ?? '');
  assert(/Base voisine|Neighbouring base/.test(card) && !/Acheter|Buy/.test(card), `land panel: ${card}`);
  assert(!(await page.$('[data-screen="land"] [data-land-act="buy"]')), 'a neighbouring base\'s parcel offered for sale');
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('smoke-neighbour-land.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await settleView('iso');
});

await step('perf: 10 000 items riding ribbons stay above 30 fps', async () => {
  // Ribbons may cross land the claim does not hold; a neighbouring base's only with Neighbour Treaties,
  // and never its buildings (D110: its land is not for sale): the treaties learnt (a rig).
  await FL(() => window.FL.unlock('xp_treaties'));
  // The field's place: of a few blocks east of the cirque, the one with the least land a ribbon cannot
  // take (map 4, D94: rivers, crevasses, water and rock cross the plains; a neighbouring base's
  // buildings, D110), the first on a tie.
  const [fx, fy, nbTiles] = await FL(() => {
    const sim = window.FL.app.sim, g = sim.grid;
    let best = [600, 450], bad = Infinity, nb = 0;
    for (const [x0, y0] of [[600, 450], [600, 400], [600, 500], [640, 430], [560, 560], [560, 340], [380, 450], [420, 560], [640, 560], [380, 340]]) {
      let n = 0, m = 0;
      for (let y = y0; y < y0 + 100; y += 2) for (let x = x0; x < x0 + 105; x += 2) {
        const t = g.terrain(x, y);
        if (t > 1 && t !== 8) n++;
        else if (sim.neighbours.at(x, y)) { n++; m++; }
      }
      if (n < bad) { bad = n; best = [x0, y0]; nb = m; }
    }
    return [...best, nb];
  });
  console.log(`    the field at ${fx},${fy} (${nbTiles} sampled tiles under a neighbouring base)`);
  // One item per square: 10 710 squares, of which map 4's obstacles take a few hundred — the field alone
  // carries 10 000 (at 100 rows it laid 9 920 and leaned on the base's other lines, fewer under load).
  const laid = await FL(([fx, fy]) => window.FL.ribbonField(fx, fy, 102, 105), [fx, fy]);
  const filled = await FL(() => window.FL.fillRibbons('iron_ore'));
  await FL(([fx, fy]) => window.FL.lookAt(fx + 52, fy + 50, 0.5), [fx, fy]);
  await page.waitForTimeout(2500);
  const p = await FL(() => window.FL.perf());
  console.log(`    ribbons=${laid} items=${filled} drawn=${p.items} fps=${p.fps} frameMs=${p.frameMs.toFixed(2)}`);
  assert(filled >= 10000, `only ${filled} items`);
  // A throttled browser (machine under load) caps frames at 30: then judge the frame's own cost.
  assert(p.fps > 30 || p.frameMs < 8, `too slow: ${p.fps} fps, ${p.frameMs.toFixed(2)} ms a frame`);
  await page.screenshot({ path: shot('smoke-items.png') });
});

await step('render (D92): a change re-draws only what it touched (buildings and lights), as a full rebuild draws it; off-screen buildings are culled', async () => {
  // Near the Heart's demo line, the ribbon field off screen.
  await FL(() => window.FL.pause());
  try { await renderChecks(); } finally { await FL(() => window.FL.resume()); }
});
async function renderChecks() {
  await FL(() => window.FL.lookAt(512, 518, 1.2));
  await page.waitForTimeout(400);
  // Every sprite of the layers the buildings share, in draw order: what each one shows and where
  // (a hidden one, or one in a hidden container, only its texture and key: by night a shadow keeps the day's stretch until dawn).
  const snap = () => FL(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const app = window.FL.app, L = (n) => app.layers.get(n);
    const of = (c) => c.children.map((s) => (s.visible && c.visible
      ? [s.texture?.uid ?? -1, s.x, s.y, s.scale.x, s.scale.y, s.skew.x, s.skew.y, s.rotation, s.zIndex, s.culled, s.alpha, s.tint]
      : [s.texture?.uid ?? -1, s.zIndex, 'hidden', s.culled]).join('|'));
    return [...of(L('objects')), '/', ...of(L('plan')), '/', ...of(L('belts').children[0]), '/', ...L('shadows').children.flatMap(of), '/',
      // The night glows: those shown, at night (the hidden ones wait in the lights view's pools for reuse, in
      // any order; by day the whole layer is hidden and a beacon keeps the last night frame's pulse).
      ...(L('lights').visible ? L('lights').children.flatMap(of).filter((x) => !x.includes('hidden')) : ['lights: day'])];
  });
  const changed = await FL(async () => {
    const frames = (k) => new Promise((r) => { let n = 0; const f = () => (++n >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const app = window.FL.app, out = [];
    for (const def of ['ribbon', 'silo']) {
      const at = window.FL.freeSpot(def, 512, 518, 20);
      if (!at || !window.FL.place(def, at[0], at[1], 0).ok) continue;
      await frames(2);
      out.push(app.buildings.lastUpdate.laid);
      app.sim.remove(at[0], at[1]);
      await frames(2);
    }
    return { laid: out, drawn: app.buildings.cullStats().entities };
  });
  // By day (the shadows) and by night (the lights), whatever the world clock says.
  const both = async () => {
    await FL(() => window.FL.dayPhase('noon'));
    const day = await snap();
    await FL(() => window.FL.dayPhase('night'));
    const night = await snap();
    await FL(() => window.FL.dayPhase(null));
    return [...day, '//', ...night];
  };
  const a = await both();
  await FL(() => { const app = window.FL.app; app.buildings.rebuildAll(app.sim); app.items.rebuild(app.sim); app.lights.rebuildAll(app.sim); });
  const b = await both();
  const culledNear = await FL(() => window.FL.app.buildings.cullStats().culled);
  console.log(`    sprites laid per change ${changed.laid.join(', ')} (of ${changed.drawn} entities), ${a.length} sprites compared, ${culledNear} entities culled near`);
  assert(changed.laid.length === 2 && changed.laid.every((n) => n > 0 && n < 60), `a change re-drew too much: ${JSON.stringify(changed)}`);
  const diff = a.findIndex((s, i) => s !== b[i]);
  assert(a.length === b.length && diff < 0, `updated ≠ rebuilt: ${a.length} vs ${b.length} sprites, first difference at ${diff}: ${a[diff]} vs ${b[diff]}`);
  assert(culledNear > 0, 'nothing culled at near zoom');
}

await step('menu: out of the way under automation; over the running base; Esc steps back; Jouer closes', async () => {
  await FL(() => { window.FL.tool(null); window.FL.category(null); window.FL.close(); });
  await settleView('iso');
  try { await menuChecks(); } finally { await FL(() => window.FL.menu(false)); }
});
async function menuChecks() {
  assert(!(await FL(() => window.FL.menu())), 'menu open at boot under webdriver');
  await page.keyboard.press('Escape');
  assert(!(await FL(() => window.FL.menu())), 'Esc opened the menu under automation');
  const t0 = await FL(() => window.FL.app.sim.tick);
  await FL(() => window.FL.menu(true));
  await page.waitForSelector('[data-screen="menu"][data-open]', { timeout: 2000 });
  assert(await FL(() => document.body.hasAttribute('data-menu')), 'HUD not hidden');
  await page.keyboard.press('b');
  assert((await FL(() => window.FL.category())) === null, 'B went through the menu');
  await page.waitForTimeout(500);
  assert((await FL(() => window.FL.app.sim.tick)) > t0, 'the base stopped behind the menu');
  await page.screenshot({ path: shot('smoke-menu.png') });
  await page.click('.menu-btn[data-act="settings"]');
  await page.click('.set-opt[data-lang="en"]');
  assert((await FL(() => window.FL.locale())) === 'en', 'no live switch');
  assert(JSON.parse(await FL(() => localStorage.getItem('filon.settings.v1'))).locale === 'en', 'not stored');
  await page.click('.set-opt[data-lang="fr"]');
  await page.keyboard.press('Escape');
  assert(await FL(() => window.FL.menu()), 'Esc on a page closed the menu');
  await page.keyboard.press('Escape');
  assert(!(await FL(() => window.FL.menu())), 'Esc did not close the menu');
  await page.click('.hud-menu');
  assert(await FL(() => window.FL.menu()), 'HUD button');
  await page.click('.menu-btn[data-act="play"]');
  assert(!(await FL(() => window.FL.menu())), 'Jouer');
}

await step('debug bases: the menu page plays a ready-made base; the player’s base comes back untouched', async () => {
  const saves = await FL(() => window.FL.debugSaves());
  if (!saves) { console.log('    (no debug page on this build)'); return; }
  await FL(() => window.FL.pause());
  const own = await FL(() => window.FL.hash());
  await FL(() => window.FL.menu(true, 'debug'));
  await page.waitForSelector('[data-screen="debug"]', { timeout: 2000 });
  await page.click('[data-debug-load="survey"]');
  await page.waitForSelector('[data-debug-badge]:not([hidden])', { timeout: 10000 });
  const s = await FL(() => ({ menu: window.FL.menu(), cur: window.FL.debugSaves().current, q: window.FL.quests().current }));
  assert(!s.menu && s.cur === 'survey' && s.q === 'crier_trade', `after load: ${JSON.stringify(s)}`);
  await FL(() => window.FL.resume());
  await page.waitForTimeout(1500);
  assert((await FL(() => window.FL.debugSaves().realHash)) === own, 'the player’s base moved while aside');
  const r = await FL(() => window.FL.debugSave('tutorial'));
  console.log(`    tutorial built in ${r.ms} ms, forced ${r.forced.length}, skipped ${r.skipped.length}`);
  assert(r.ok && r.quest === 'synth_parts' && r.forced.length === 0, `tutorial: ${JSON.stringify(r)}`); // the last quest left to play (D90)
  // D83: a production building that does not work looks switched off — a drill whose wires are cut goes dark.
  const cut = await FL(() => {
    const app = window.FL.app;
    const e = app.sim.ents.sorted().find((x) => window.FL.entityAt(x.x, x.y)?.def === 'drill' && app.buildings.work.isLit(x.id) && window.FL.links(x.id).length > 0);
    if (!e) return null;
    for (const o of window.FL.links(e.id)) window.FL.unlink(e.id, o);
    return e.id;
  });
  assert(cut, 'no lit, wired drill on the tutorial base');
  await page.waitForFunction((id) => window.FL.workLook(id).lit === false, cut, { timeout: 8000 });
  await page.waitForFunction(() => window.FL.workLook().waiting === 0, undefined, { timeout: 4000 });
  const wl = await FL(() => window.FL.workLook());
  console.log(`    work look: ${wl.watched} watched, ${wl.off} switched off, ${wl.baked} unlit pictures`);
  assert(wl.watched > 0 && wl.off > 0 && wl.baked > 0, `work look: ${JSON.stringify(wl)}`);
  await page.screenshot({ path: shot('smoke-debug.png') });
  await FL(() => window.FL.pause());
  await page.click('[data-debug-back]');
  await page.waitForSelector('[data-debug-badge][hidden]', { state: 'attached', timeout: 2000 });
  assert((await FL(() => window.FL.hash())) === own, 'the player’s base did not come back as it was');
  await FL(() => window.FL.resume());
});

await step('views (D88, D95): P, F, O, V and I show one system each over the base veiled, with their panel; a click opens the inspector on that view; Esc goes back to Normal', async () => {
  const saves = await FL(() => window.FL.debugSaves());
  if (!saves) { console.log('    (no debug page on this build)'); return; }
  await FL(() => window.FL.pause());
  const own = await FL(() => window.FL.hash());
  const r = await FL(() => window.FL.debugSave('late'));
  assert(r.ok, `late base: ${JSON.stringify(r)}`);
  await FL(() => { window.FL.menu(false); window.FL.lookAt(512, 512, 0.62); window.FL.resume(); });
  const log0 = await FL(() => window.FL.app.sim.log.length);
  // Électricité (P): badges up, the side card with a grid card and its 24 h chart, the wires bold.
  await page.keyboard.press('p');
  await page.waitForFunction(() => { const v = window.FL.mapView(); return v.view === 'power' && v.marks > 0 && v.panel; }, undefined, { timeout: 3000 });
  const pw = await FL(() => ({
    grids: document.querySelectorAll('[data-screen="view"] .vp-grid').length,
    chart: !!document.querySelector('[data-screen="view"] .vp-grid[data-open] canvas.vp-chart'),
    lit: document.querySelector('[data-view="power"]')?.hasAttribute('data-on'),
    chip: document.querySelector('[data-hud-power]')?.hasAttribute('data-on'),
  }));
  assert(pw.grids >= 1 && pw.chart && pw.lit && pw.chip, `Électricité: ${JSON.stringify(pw)}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('smoke-views-power.png') });
  // A building clicked in the view: the inspector on its power part, over the card; Esc gives the card back, then Normal.
  const wind = await FL(() => window.FL.app.sim.ents.sorted().find((e) => window.FL.entityAt(e.x, e.y)?.def === 'wind_flower' && e.builtAt === 0)?.id ?? 0);
  assert(wind, 'no wind turbine on the late base');
  await FL((id) => window.FL.selected(id), wind);
  await page.waitForFunction(() => document.querySelector('[data-screen="inspector"]')?.getAttribute('data-facet') === 'power' && document.querySelector('[data-screen="view"]')?.hasAttribute('hidden'), undefined, { timeout: 2000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.FL.mapView().panel && window.FL.mapView().view === 'power', undefined, { timeout: 2000 });
  await page.keyboard.press('Escape');
  assert((await FL(() => window.FL.mapView().view)) === 'normal', 'Esc did not go back to Normal');
  // The HUD's energy chip opens it too.
  await page.click('[data-hud-power]');
  assert((await FL(() => window.FL.mapView().view)) === 'power', 'the energy chip did not open Électricité');
  // Logistique (F): the lines read, the heat drawn; Production (O): the states read.
  await page.keyboard.press('f');
  await page.waitForFunction(() => window.FL.mapView().view === 'logistics' && (window.FL.app.views.data.ribbonSummary?.lines ?? 0) > 0, undefined, { timeout: 3000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('smoke-views-logistics.png') });
  await page.keyboard.press('o');
  await page.waitForFunction(() => window.FL.mapView().view === 'production' && (window.FL.app.views.data.production?.length ?? 0) > 0 && window.FL.mapView().panel, undefined, { timeout: 3000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('smoke-views-production.png') });
  // Vent (V, D95: the late base has the Anémométrie plan): the turbines' badges, the card's compass, the 24 h chart, the turbines' rows.
  await page.keyboard.press('v');
  // (the card rebuilds at its next refresh, a quarter second after the view's readings: wait for its compass too)
  await page.waitForFunction(() => { const v = window.FL.mapView(); return v.view === 'wind' && v.marks > 0 && v.panel && (window.FL.app.views.data.wind?.turbines.length ?? 0) > 0 && !!document.querySelector('[data-screen="view"] canvas.vp-rose'); }, undefined, { timeout: 3000 });
  const wv = await FL(() => ({
    rose: !!document.querySelector('[data-screen="view"] canvas.vp-rose'),
    chart: !!document.querySelector('[data-screen="view"] .vp-wind canvas.vp-chart'),
    rows: document.querySelectorAll('[data-screen="view"] .vp-wind-row').length,
    lit: document.querySelector('[data-view="wind"]')?.hasAttribute('data-on'),
  }));
  assert(wv.rose && wv.chart && wv.rows > 0 && wv.lit, `Vent: ${JSON.stringify(wv)}`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot('smoke-views-wind.png') });
  await page.keyboard.press('v');
  assert((await FL(() => window.FL.mapView().view)) === 'normal', 'V did not go back to Normal');
  // Terrain (I) is the land mode; another view ends it.
  await page.keyboard.press('i');
  await page.waitForFunction(() => window.FL.mapView().view === 'land' && window.FL.app.landTool.active, undefined, { timeout: 2000 });
  await page.click('[data-view="power"]');
  assert(!(await FL(() => window.FL.app.landTool.active)) && (await FL(() => window.FL.mapView().view)) === 'power', 'a view did not end the land mode');
  await page.click('[data-view="normal"]');
  assert((await FL(() => window.FL.mapView().view)) === 'normal', 'the Normal button');
  // Views read the base and never change it: no command logged.
  assert((await FL(() => window.FL.app.sim.log.length)) === log0, 'a view logged a command');
  await FL(() => window.FL.pause());
  await FL(() => window.FL.debugSave(null));
  assert((await FL(() => window.FL.hash())) === own, 'the player’s base did not come back as it was');
  await FL(() => window.FL.resume());
});

await step('expertise (D93): the late base holds two expertises and Tier 2 is open; E opens the window; a réorientation, armed on a card and made on a slot, leaves 24 h before it is in place; a click on the Core\'s Archive opens it too', async () => {
  const saves = await FL(() => window.FL.debugSaves());
  if (!saves) { console.log('    (no debug page on this build)'); return; }
  await FL(() => window.FL.pause());
  const own = await FL(() => window.FL.hash());
  const r = await FL(() => window.FL.debugSave('late'));
  assert(r.ok, `late base: ${JSON.stringify(r)}`);
  await FL(() => { window.FL.menu(false); window.FL.close(); window.FL.view('iso'); window.FL.lookAt(512, 511, 2.4); window.FL.resume(); });
  const x = await FL(() => window.FL.expertise());
  assert(x.archive && x.tierTwo && x.slots.every((s) => s && s.on), `expertises: ${JSON.stringify(x.slots)}`);
  // The chip shows at the HUD's next refresh (4 Hz).
  const chip = await page.waitForFunction(() => document.querySelector('[data-hud-expertise]')?.hidden === false, undefined, { timeout: 2000 }).then(() => true, () => false);
  assert(chip, 'no Expertise chip in the HUD');
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.FL.screen() === 'expertise', undefined, { timeout: 2000 });
  const id = await FL(() => [...document.querySelectorAll('.ex-act[data-kind="reorient"]')].find((n) => !n.disabled && !n.hidden)?.getAttribute('data-ex-act') ?? null);
  assert(id, 'no expertise to reorient to');
  await page.click(`[data-ex-act="${id}"]`);
  await page.click('[data-ex-replace="0"]');
  const y = await FL(() => window.FL.expertise());
  assert(y.slots[0]?.id === id && !y.slots[0].on && y.reorientCost > x.reorientCost, `after the réorientation: ${JSON.stringify(y.slots[0])}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('smoke-expertise.png') });
  await page.keyboard.press('Escape');
  assert((await FL(() => window.FL.screen())) === null, 'Esc did not close the window');
  // The Archive: its drum on the Core's south-west corner, a level up.
  const at = await FL(() => {
    const sim = window.FL.app.sim, e = sim.ents.get(sim.hearthId), [sx, sy] = window.FL.tileToScreen(e.x + 0.06, e.y + 3.94);
    return [sx, sy - 16 * window.FL.app.camera.state.zoom];
  });
  await page.waitForTimeout(400);
  await page.mouse.click(at[0], at[1]);
  await page.waitForFunction(() => window.FL.screen() === 'expertise', undefined, { timeout: 2000 });
  await FL(() => { window.FL.close(); window.FL.pause(); });
  await FL(() => window.FL.debugSave(null));
  assert((await FL(() => window.FL.hash())) === own, 'the player’s base did not come back as it was');
  await FL(() => window.FL.resume());
});

await step('responsive (D96): on a phone-sized window the HUD folds its rows, the inspector is a bottom sheet under the HUD, the build bar scrolls; nothing leaves the window; the canvas follows the resize', async () => {
  const saves = await FL(() => window.FL.debugSaves());
  if (!saves) { console.log('    (no debug page on this build)'); return; }
  await FL(() => window.FL.pause());
  const own = await FL(() => window.FL.hash());
  const r = await FL(() => window.FL.debugSave('late'));
  assert(r.ok, `late base: ${JSON.stringify(r)}`);
  await FL(() => { window.FL.menu(false); window.FL.resume(); });
  const cam0 = await FL(() => window.FL.camera());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  // Everything the HUD shows inside the window; the research row behind its fold; no sideways scroll.
  const hud = await FL(() => {
    const W = innerWidth, H = innerHeight, out = [];
    for (const n of document.querySelectorAll('.hud .hud-grp, .hud .hud-fold, .hud .hud-build, .hud .hud-menu, .hud .hud-vfold')) {
      if (n.closest('[hidden]') || getComputedStyle(n).display === 'none') continue;
      const b = n.getBoundingClientRect();
      if (b.left < -1 || b.right > W + 1 || b.top < -1 || b.bottom > H + 1) out.push(n.className);
    }
    const canvas = document.querySelector('#stage canvas').getBoundingClientRect();
    return { out, fold: !!document.querySelector('[data-hud-fold="research"]')?.getBoundingClientRect().width, row: getComputedStyle(document.querySelector('.hud-research')).display,
      scroll: document.documentElement.scrollWidth - W, canvas: [Math.round(canvas.width), Math.round(canvas.height)], zoom: document.documentElement.style.getPropertyValue('--ui-zoom') };
  });
  assert(!hud.out.length && hud.fold && hud.row === 'none' && hud.scroll <= 0, `HUD at 390 × 844: ${JSON.stringify(hud)}`);
  assert(hud.canvas[0] === 390 && hud.canvas[1] === 844, `the canvas did not follow the window: ${hud.canvas}`);
  const cam1 = await FL(() => window.FL.camera());
  assert(Math.abs(cam1.tx - cam0.tx) < 0.01 && Math.abs(cam1.ty - cam0.ty) < 0.01, `the camera lost its centre: ${JSON.stringify([cam0, cam1])}`);
  // The inspector: a bottom sheet with its grip, under the HUD, inside the window.
  const kiln = await FL(() => window.FL.app.sim.ents.sorted().find((e) => window.FL.entityAt(e.x, e.y)?.def === 'kiln' && e.builtAt === 0)?.id ?? 0);
  await FL((id) => window.FL.selected(id), kiln);
  await page.waitForTimeout(400);
  const sheet = await FL(() => {
    const i = document.querySelector('[data-screen="inspector"]').getBoundingClientRect(), h = document.querySelector('.hud').getBoundingClientRect();
    return { top: i.top, bottom: i.bottom, left: i.left, right: i.right, hud: h.bottom, H: innerHeight, W: innerWidth, grip: !!document.querySelector('[data-screen="inspector"] .sheet-grip')?.getBoundingClientRect().width };
  });
  assert(sheet.grip && sheet.top >= sheet.hud && sheet.bottom <= sheet.H && sheet.left >= 0 && sheet.right <= sheet.W && sheet.bottom > sheet.H - 40, `the sheet: ${JSON.stringify(sheet)}`);
  await page.screenshot({ path: shot('smoke-responsive-phone.png') });
  // The build bar: its tabs and tray inside the window, scrolling sideways.
  await FL(() => { window.FL.selected(0); window.FL.category('production'); });
  await page.waitForTimeout(500);
  const bar = await FL(() => {
    const t = document.querySelector('.bb-tabs'), y = document.querySelector('.bb-tray');
    const a = t.getBoundingClientRect(), b = y.getBoundingClientRect();
    return { inside: a.left >= 0 && a.right <= innerWidth && b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight, scrolls: y.scrollWidth > y.clientWidth && getComputedStyle(y).overflowX === 'auto' };
  });
  assert(bar.inside && bar.scrolls, `the build bar at 390 px: ${JSON.stringify(bar)}`);
  await FL(() => window.FL.category(null));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(600);
  assert((await FL(() => document.documentElement.style.getPropertyValue('--ui-zoom'))) === '1', 'the zoom did not come back to 1 at 1440 × 900');
  await FL(() => window.FL.pause());
  await FL(() => window.FL.debugSave(null));
  assert((await FL(() => window.FL.hash())) === own, 'the player’s base did not come back as it was');
  await FL(() => window.FL.resume());
});

await step('stock (D96): no stock bar on the HUD; « Stock » opens the Heart\'s stock by kind with each item\'s amount and rate; Esc, a click on the world and the button close it; the choice is remembered', async () => {
  const saves = await FL(() => window.FL.debugSaves());
  if (!saves) { console.log('    (no debug page on this build)'); return; }
  await FL(() => window.FL.pause());
  const own = await FL(() => window.FL.hash());
  const r = await FL(() => window.FL.debugSave('late'));
  assert(r.ok, `late base: ${JSON.stringify(r)}`);
  await FL(() => { window.FL.menu(false); window.FL.close(); window.FL.resume(); });
  await page.waitForFunction(() => !document.querySelector('[data-hud-stock]')?.hidden, undefined, { timeout: 2000 });
  // The bar is gone: no item chips on the HUD; the panel closed.
  const hud = await FL(() => ({ chips: document.querySelectorAll('.hud [data-item]').length, closed: document.querySelector('[data-screen="stock"]').hasAttribute('hidden'), label: document.querySelector('[data-hud-stock]').textContent }));
  assert(hud.chips === 0 && hud.closed && /Stock/.test(hud.label), `HUD: ${JSON.stringify(hud)}`);
  // Open: sections by kind, a row per item with its amount; with the telemetry, some rates (the late base has it).
  await page.click('[data-hud-stock]');
  await page.waitForTimeout(1300); // a refresh, and a second of the rates' samples
  const p = await FL(() => {
    const root = document.querySelector('[data-screen="stock"]');
    const rows = [...root.querySelectorAll('.stk-row[data-item]')];
    return { open: !root.hasAttribute('hidden'), secs: root.querySelectorAll('.ksec[data-sec^="stock-"]').length, rows: rows.length,
      vals: rows.filter((n) => n.querySelector('.stk-val')?.textContent).length, tele: root.hasAttribute('data-tele'),
      expanded: document.querySelector('[data-hud-stock]').getAttribute('aria-expanded'), kept: localStorage.getItem('filon.stock.v1') };
  });
  assert(p.open && p.secs >= 2 && p.rows >= 5 && p.vals === p.rows && p.tele && p.expanded === 'true' && /"open":true/.test(p.kept ?? ''), `the panel: ${JSON.stringify(p)}`);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-screen="stock"] .stk-rate')].some((n) => /\/min/.test(n.textContent ?? '')), undefined, { timeout: 4000 });
  await page.screenshot({ path: shot('smoke-stock.png') });
  // Esc closes it (first, before any tool or selection); the button opens it again; a click on the world closes it.
  await page.keyboard.press('Escape');
  assert(await FL(() => document.querySelector('[data-screen="stock"]').hasAttribute('hidden')), 'Esc did not close the Stock');
  await page.click('[data-hud-stock]');
  assert(!(await FL(() => document.querySelector('[data-screen="stock"]').hasAttribute('hidden'))), 'the button did not open it again');
  await page.mouse.click(720, 600);
  assert(await FL(() => document.querySelector('[data-screen="stock"]').hasAttribute('hidden')), 'a click on the world did not close it');
  assert(/"open":false/.test(await FL(() => localStorage.getItem('filon.stock.v1') ?? '')), 'the closed choice was not kept');
  await FL(() => { window.FL.selected(0); window.FL.pause(); });
  await FL(() => window.FL.debugSave(null));
  assert((await FL(() => window.FL.hash())) === own, 'the player’s base did not come back as it was');
  await FL(() => window.FL.resume());
});

await step('auto-sell (D127): on the late base the Stock shows a ◉ per item, its auto-sold item marked; a click switches another on, its threshold edited in place; the purse breaks out « Vente automatique »', async () => {
  const saves = await FL(() => window.FL.debugSaves());
  if (!saves) { console.log('    (no debug page on this build)'); return; }
  await FL(() => window.FL.pause());
  const own = await FL(() => window.FL.hash());
  const r = await FL(() => window.FL.debugSave('late'));
  assert(r.ok, `late base: ${JSON.stringify(r)}`);
  await FL(() => { window.FL.menu(false); window.FL.close(); window.FL.resume(); });
  await page.waitForFunction(() => !document.querySelector('[data-hud-stock]')?.hidden, undefined, { timeout: 2000 });
  await page.click('[data-hud-stock]');
  await page.waitForTimeout(1300); // a refresh, and a second of the rates' samples
  // The late base auto-sells its most plentiful item (scenarios.ts): its row is marked, its line and threshold shown.
  const a = await FL(() => {
    const root = document.querySelector('[data-screen="stock"]');
    const on = [...root.querySelectorAll('.stk-row[data-auto]')];
    return { toggles: root.querySelectorAll('[data-stock-auto]:not([hidden])').length, on: on.map((n) => n.getAttribute('data-item')),
      at: on[0]?.querySelector('[data-stock-at]')?.textContent ?? '', line: on[0]?.querySelector('.stk-sold')?.textContent ?? '',
      engine: [...window.FL.app.sim.trade.autoSell.keys()].length };
  });
  assert(a.toggles >= 5 && a.on.length === 1 && a.engine === 1 && /seuil/.test(a.at) && /Vendu automatiquement/.test(a.line), `the auto-sold row: ${JSON.stringify(a)}`);
  // Another item switched on: the one the Core takes in fastest (its rate), not yet on.
  const pick = await FL(() => {
    const rows = [...document.querySelectorAll('[data-screen="stock"] .stk-row[data-item]:not([data-auto])')].filter((n) => !n.querySelector('[data-stock-auto]')?.hidden);
    const rate = (n) => Number((n.querySelector('.stk-rate')?.textContent ?? '').replace(/[^0-9,]/g, '').replace(',', '.')) || 0;
    rows.sort((x, y) => rate(y) - rate(x));
    return rows[0]?.getAttribute('data-item') ?? null;
  });
  assert(pick, 'no item to switch on');
  await page.click(`[data-stock-auto="${pick}"]`);
  await page.waitForFunction((id) => !!document.querySelector(`[data-screen="stock"] .stk-row[data-item="${id}"][data-auto]`), pick, { timeout: 2000 });
  // Its threshold edited in place: the chip gives way to a field; 100, Enter.
  await page.click(`[data-stock-at="${pick}"]`);
  await page.waitForSelector(`[data-stock-at-in="${pick}"]:not([hidden])`, { timeout: 1000 });
  await page.fill(`[data-stock-at-in="${pick}"]`, '100');
  await page.keyboard.press('Enter');
  const set = await FL((id) => ({ at: window.FL.app.sim.trade.autoSell.get(window.FL.itemIndex(id)), log: window.FL.app.sim.log.filter((l) => l.cmd.k === 'autoSell').map((l) => l.cmd) }), pick);
  assert(set.at === 100 && set.log.length >= 2, `the threshold: ${JSON.stringify(set)}`);
  // Ten game minutes one at a time (the HUD samples the purse once a minute): the surplus sold.
  for (let m = 0; m < 10; m++) { await FL(() => window.FL.tick(600)); await page.waitForTimeout(100); }
  if (await FL(() => document.querySelector('[data-screen="stock"]').hasAttribute('hidden'))) await page.click('[data-hud-stock]');
  await page.waitForTimeout(600);
  const sold = await FL((id) => document.querySelector(`[data-screen="stock"] .stk-row[data-item="${id}"] .stk-sold`)?.textContent ?? '', pick);
  assert(/◉\/h/.test(sold), `its line: ${sold}`);
  await page.screenshot({ path: shot('smoke-autosell-stock.png') });
  await page.click('[data-hud-purse]');
  await page.waitForSelector('[data-screen="purse"]:not([hidden]) .purse-line[data-flow="auto"]', { timeout: 3000 });
  const c = await FL(() => ({ sec: !!document.querySelector('[data-screen="purse"] [data-sec="purse-auto"]'), lines: document.querySelectorAll('[data-screen="purse"] .purse-line[data-flow="auto"]').length }));
  assert(c.sec && c.lines >= 1, `the purse: ${JSON.stringify(c)}`);
  await FL(() => document.querySelector('[data-screen="purse"] [data-sec="purse-auto"]')?.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: shot('smoke-autosell-purse.png') });
  // A click on the line opens the Stock, where it is set.
  await page.click('[data-screen="purse"] .purse-line[data-flow="auto"]');
  await page.waitForFunction(() => !document.querySelector('[data-screen="stock"]').hasAttribute('hidden') && document.querySelector('[data-screen="purse"]').hasAttribute('hidden'), undefined, { timeout: 2000 });
  await page.keyboard.press('Escape');
  await FL(() => { window.FL.selected(0); window.FL.pause(); });
  await FL(() => window.FL.debugSave(null));
  assert((await FL(() => window.FL.hash())) === own, 'the player’s base did not come back as it was');
  await FL(() => window.FL.resume());
});

await step('purse (D102): the HUD\'s ◉/h is the purse\'s real recurring change; a click on the purse breaks it down — each item sold, each standing order, the tokens, the rent — the biggest drain named; a line goes where it is managed; Esc closes the card', async () => {
  const saves = await FL(() => window.FL.debugSaves());
  if (!saves) { console.log('    (no debug page on this build)'); return; }
  await FL(() => window.FL.pause());
  const own = await FL(() => window.FL.hash());
  const r = await FL(() => window.FL.debugSave('late'));
  assert(r.ok, `late base: ${JSON.stringify(r)}`);
  await FL(() => { window.FL.menu(false); window.FL.close(); window.FL.resume(); });
  // Ten game minutes one at a time: the HUD samples the purse's journal once a minute.
  for (let m = 0; m < 10; m++) { await FL(() => window.FL.tick(600)); await page.waitForTimeout(100); }
  await page.click('[data-hud-purse]');
  await page.waitForSelector('[data-screen="purse"]:not([hidden]) .purse-line', { timeout: 3000 });
  const c = await FL(() => {
    const root = document.querySelector('[data-screen="purse"]');
    const lines = [...root.querySelectorAll('.purse-line')];
    return { kinds: lines.map((n) => n.getAttribute('data-flow')), values: lines.map((n) => n.querySelector('.purse-v')?.textContent ?? ''),
      total: root.querySelector('.purse-top b')?.textContent ?? '', hud: document.querySelector('[data-hud-purse] .hud-delta')?.textContent ?? '',
      drain: root.querySelector('.purse-drain')?.textContent ?? '', crier: !!root.querySelector('[data-hud-crier]') };
  });
  console.log(`    flows: ${c.kinds.join(', ')} · total ${c.total} · HUD ${c.hud}`);
  assert(c.kinds.includes('sale') && c.values.every((v) => /◉\/h/.test(v)) && c.crier, `the card: ${JSON.stringify(c)}`);
  assert(!/^\s*$/.test(c.total) && (c.drain === '' || /Commande|Baux|Tokens|Forfait|Autres/.test(c.drain)), `total / drain: ${JSON.stringify(c)}`);
  await page.screenshot({ path: shot('smoke-purse.png') });
  // An item sold: the Crier on its Trade tab, its post's card flashed.
  await page.click('[data-screen="purse"] .purse-line[data-flow="sale"]');
  await page.waitForFunction(() => window.FL.screen() === 'market' && !!document.querySelector('.crier [data-post][data-flash], .crier [data-order][data-flash]'), undefined, { timeout: 3000 });
  assert(await FL(() => document.querySelector('[data-screen="purse"]').hasAttribute('hidden')), 'the card stayed open over the Crier');
  await FL(() => window.FL.close());
  // Esc closes the card.
  await page.click('[data-hud-purse]');
  await page.keyboard.press('Escape');
  assert(await FL(() => document.querySelector('[data-screen="purse"]').hasAttribute('hidden')), 'Esc did not close the card');
  await FL(() => window.FL.pause());
  await FL(() => window.FL.debugSave(null));
  assert((await FL(() => window.FL.hash())) === own, 'the player’s base did not come back as it was');
  await FL(() => window.FL.resume());
});

await step('weak grid (D91): the tutorial base by night, its turbines and accumulators cut off, serves under 100 %: a drill at work reads « Au ralenti » in amber with the half-bolt and its %; the Production view counts it among the waiting', async () => {
  const saves = await FL(() => window.FL.debugSaves());
  if (!saves) { console.log('    (no debug page on this build)'); return; }
  await FL(() => window.FL.pause());
  const own = await FL(() => window.FL.hash());
  const r = await FL(() => window.FL.debugSave('tutorial'));
  assert(r.ok, `tutorial base: ${JSON.stringify(r)}`);
  // Night, its panels asleep; the wind follows the real clock, so its turbines', accumulators' and
  // steam boiler's wires are cut (a rig; D114: the boiler alone would carry the night): the Core's
  // isotope core serves part of the demand (D143: no coal generator beside it any more).
  await FL(() => {
    window.FL.menu(false);
    window.FL.dayPhase('night');
    const sim = window.FL.app.sim, off = new Set(['wind_flower', 'pitch_turbine', 'big_turbine', 'accumulator', 'heavy_accumulator', 'steam_boiler']);
    for (const e of sim.ents.sorted()) if (off.has(window.FL.entityAt(e.x, e.y)?.def)) for (const o of window.FL.links(e.id)) window.FL.unlink(e.id, o);
    window.FL.tick(20);
  });
  const slow = await FL(() => {
    const sim = window.FL.app.sim;
    const low = (x) => { const n = sim.graph.nodeByEnt.get(x.id); return n && n.status === 6 ? n : null; }; // St.LowPower: it ran, slowed
    const e = sim.ents.sorted().find((x) => low(x)?.kind === 'drill') ?? sim.ents.sorted().find((x) => low(x));
    return e ? { id: e.id, x: e.x, y: e.y, sat: sim.ctx.sat[low(e).net] } : null;
  });
  assert(slow, 'nothing slowed by a weak grid on the tutorial base at night');
  console.log(`    ${await FL((id) => window.FL.entityAt(window.FL.app.sim.ents.get(id).x, window.FL.app.sim.ents.get(id).y)?.def, slow.id)} on a grid at ${slow.sat / 10} %`);
  await FL((s) => { window.FL.lookAt(s.x + 1, s.y + 1, 1.3); window.FL.selected(s.id); window.FL.resume(); }, slow);
  await page.waitForSelector('[data-screen="inspector"] .kstatus[data-state="slow"] .kreason[data-k="weak"]', { timeout: 4000 });
  const line = await page.evaluate(() => document.querySelector('[data-screen="inspector"] .kstatus')?.innerText ?? '');
  assert(/Au ralenti|Slowed/.test(line) && /%/.test(line), `status line: ${line}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('smoke-weak-inspect.png') });
  await FL(() => window.FL.selected(0));
  await page.keyboard.press('o');
  await page.waitForSelector('[data-screen="view"] .vp-why[data-why="weak"][data-work="pause"]', { timeout: 4000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('smoke-weak-production.png') });
  await FL(() => { window.FL.mapView('normal'); window.FL.pause(); window.FL.dayPhase(null); });
  await FL(() => window.FL.debugSave(null));
  assert((await FL(() => window.FL.hash())) === own, 'the player’s base did not come back as it was');
  await FL(() => window.FL.resume());
});

await step('build bar: only unlocked buildings; a research adds one with a notice', async () => {
  await FL(() => window.FL.category('energy'));
  await page.waitForTimeout(300);
  assert(!(await page.$('.bb-slot[data-def="sun_bulb"]')), 'locked solar shown');
  await FL(() => { const s = window.FL.app.sim; s.done.add('en2'); s.rebuildDerived(); });
  await page.waitForSelector('.bb-slot[data-def="sun_bulb"][data-new]', { timeout: 2000 });
  assert((await FL(() => window.FL.toasts())).some((x) => /Nouveau|New/.test(x)), 'no notice');
  await FL(() => window.FL.category(null));
});

await step('card: a pointer resting on a tray slot shows the building (recipes, ports); the tip in hand shows only its cost', async () => {
  await page.mouse.move(700, 120);
  await FL(() => window.FL.category('production'));
  await page.waitForTimeout(500);
  await page.hover('.bb-slot[data-def="kiln"]');
  await page.waitForTimeout(500);
  assert((await FL(() => window.FL.app.card.shown)) === 'kiln', 'no card for the kiln');
  assert((await FL(() => document.querySelectorAll('[data-screen="building-card"] .bcard-recipe').length)) >= 2, 'no recipes on the card');
  assert(await FL(() => !!document.querySelector('[data-screen="building-card"] .bc-ports') && !document.querySelector('[data-screen="building-card"] .bcard-desc')), 'the kiln card tells instead of showing');
  await page.screenshot({ path: shot('smoke-card.png') });
  await FL(() => window.FL.category('distribution'));
  await page.waitForTimeout(500);
  await page.hover('.bb-slot[data-def="sorter"]');
  await page.waitForTimeout(500);
  assert(await FL(() => window.FL.app.card.shown === 'sorter' && !!document.querySelector('[data-screen="building-card"] .bc-diagram')), 'no routing diagram');
  await page.mouse.move(700, 120);
  await page.waitForTimeout(400);
  assert((await FL(() => window.FL.app.card.shown)) === null, 'the card stayed open');
  await FL(() => window.FL.tool('kiln'));
  await page.mouse.move(720, 330);
  await page.waitForTimeout(150);
  await page.mouse.move(730, 340);
  await page.waitForTimeout(300);
  // Placing: the cost and nothing else to read (owner, 2026-10-13).
  assert(await FL(() => !!document.querySelector('#tooltip .tip-chip') && !document.querySelector('#tooltip .tip-desc, #tooltip .tip-title')), 'the tip still says more than the cost');
  await FL(() => { window.FL.tool(null); window.FL.category(null); });
});

await step('deposit (D99): nothing in hand, a pointer resting on a known deposit shows its card — the ore, the drills that work it; a tool in hand hides it', async () => {
  await FL(() => { window.FL.tool(null); window.FL.category(null); window.FL.view('plan'); });
  await settleView('plan');
  // A known iron tile on open ground, nothing standing on it, nearest the Core.
  const spot = await FL(() => {
    const sim = window.FL.app.sim, g = sim.grid, it = window.FL.itemIndex('iron_ore');
    for (let r = 0; r < 40; r++) for (let y = 512 - r; y <= 512 + r; y++) for (let x = 512 - r; x <= 512 + r; x++) {
      if (Math.max(Math.abs(x - 512), Math.abs(y - 512)) !== r) continue;
      if (g.ore(x, y) === it && (g.terrain(x, y) < 2 || g.terrain(x, y) > 5) && sim.revealed(x, y) && !sim.entityAt(x, y)) return [x, y];
    }
    return null;
  });
  assert(spot, 'no known iron tile');
  await FL(([x, y]) => window.FL.lookAt(x + 0.5, y + 0.5, 1.2), spot);
  await page.waitForTimeout(300);
  const [sx, sy] = await tileXY(spot[0], spot[1]);
  await page.mouse.move(sx + 25, sy + 25);
  await page.mouse.move(sx, sy, { steps: 3 });
  await page.waitForTimeout(700);
  const card = await FL(() => {
    const n = document.querySelector('[data-deposit-card]');
    return n && !n.hidden ? { ore: n.dataset.ore, defs: [...n.querySelectorAll('.dcard-m')].map((m) => m.dataset.def), meter: !!n.querySelector('.kmeter'), land: !!n.querySelector('.dcard-land') } : null;
  });
  assert(card && card.ore === 'iron_ore', `no card on the iron: ${JSON.stringify(card)}`);
  assert(card.defs.includes('drill') && card.defs.includes('deep_bore') && !card.defs.includes('face_cutter'), `the wrong machines: ${card.defs}`);
  assert(card.meter && card.land, 'no yield or no parcel on the card');
  await page.screenshot({ path: shot('smoke-deposit.png') });
  // Placing (D53): the tip's job, not the card's.
  await FL(() => window.FL.tool('drill'));
  await page.mouse.move(sx + 2, sy + 1);
  await page.waitForTimeout(400);
  assert(await FL(() => document.querySelector('[data-deposit-card]')?.hidden !== false), 'the card stayed while placing');
  await FL(() => { window.FL.tool(null); window.FL.category(null); });
});

await step('quests: CrierBelt has the claim named; the log moves on; rewards pay once', async () => {
  // The demo base starts with the tutorial skipped: the tutorial needs a fresh base. The base
  // persists (M7): a reload would open it again, so start over (a new base, the page reloads).
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), FL(() => window.FL.wipe()).catch(() => null)]);
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
  await FL(() => { if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
  // The bar builds its tabs shown and hides them at its first refresh (4 Hz), which can land just after `ready`.
  const tabsHidden = await page.waitForFunction(() => document.querySelectorAll('.bb-tab[data-cat]:not([hidden])').length === 0, undefined, { timeout: 2000 }).then(() => true, () => false);
  assert(tabsHidden, 'build tabs shown before the tutorial introduces them');
  let q = await FL(() => window.FL.quests());
  assert(q.current === 'claim' && q.named === false, `start: ${q.current} named=${q.named}`);
  assert(await page.isVisible('[data-screen="quests"]'), 'no quest log');
  assert((await FL(() => window.FL.nameModal())) === false, 'naming modal open under automation');
  await page.click('[data-quest-name]');
  await page.waitForSelector('[data-screen="name"]:not([hidden])', { timeout: 2000 });
  await page.fill('[data-quest-name-input]', 'Smoke');
  await page.click('[data-quest-name-ok]');
  q = await FL(() => window.FL.quests());
  const tabs = await page.waitForFunction(() => document.querySelectorAll('.bb-tab[data-cat]:not([hidden])').length === 3, undefined, { timeout: 2000 }).then(() => true, () => false);
  assert(tabs, 'quest 1 should reveal Extraction, Logistics and Energy');
  // The demo base already meets the first quests' state checks, so the log may jump ahead at once.
  assert(q.current !== 'claim' && q.done.includes('claim'), `after naming: ${q.current}`);
  const seen = await page.waitForFunction(() => window.FL.toasts().some((t) => /CrierBelt/.test(t)), undefined, { timeout: 3000 }).then(() => true, () => false);
  assert(seen, `no CrierBelt notice: ${JSON.stringify(await FL(() => window.FL.toasts()))}`);
  await page.screenshot({ path: shot('smoke-quests.png') });
  // D101: a goal shows no arrow until its « Indice » is asked for — then one marker, gone on a second click.
  await FL(() => { window.FL.app.guide.enabled = true; window.FL.completeQuest('first_wind'); });
  await page.waitForSelector('[data-quest-hint]:not([disabled])', { timeout: 2000 });
  await page.waitForTimeout(400);
  let g = await FL(() => window.FL.quests().guide);
  assert(g.quest === null && g.at === 'hidden' && !g.hint, `a goal unasked shows nothing: ${JSON.stringify(g)}`);
  await page.click('[data-quest-hint]');
  const shownHint = await page.waitForFunction(() => { const d = window.FL.quests().guide; return d.hint && d.at !== 'hidden'; }, undefined, { timeout: 2000 }).then(() => true, () => false);
  assert(shownHint, `the hint shows one marker: ${JSON.stringify(await FL(() => window.FL.quests().guide))}`);
  await page.click('[data-quest-hint]');
  const goneHint = await page.waitForFunction(() => window.FL.quests().guide.at === 'hidden', undefined, { timeout: 2000 }).then(() => true, () => false);
  assert(goneHint, 'the hint put away');
  // The night notice (D101): on show, its « Compris » puts it away for good.
  assert(await FL(() => window.FL.nightNotice(true)), 'the night notice did not show');
  assert(await page.isVisible('[data-screen="night"]'), 'the night notice is not visible');
  await page.click('[data-night-ok]');
  assert(!(await FL(() => window.FL.nightNotice())), 'the night notice stayed');
  await FL(() => { window.FL.app.guide.enabled = false; });
  const c0 = await FL(() => window.FL.credits());
  assert((await FL(() => window.FL.completeQuest('synth_parts'))) === null, 'completeQuest refused'); // the last quest (D90)
  q = await FL(() => window.FL.quests());
  assert(q.done.length === 12, `done: ${q.done.length}`); // the claim's name and the tutorial's eleven quests (D101: « Le Cœur grandit » added; D114: « La vapeur »; D125: « Les scories », paid in items; the Synthesis's parts last, D90)
  const c1 = await FL(() => window.FL.credits());
  assert(Math.abs(c1 - c0 - 1150) < 0.01, `credits ${c0} → ${c1}`); // 150 (« La Criée ») + 100 (« Le Cœur grandit ») + 600 (Survey Data) + 300 (the Synthesis's parts), D90, D101
  await FL(() => window.FL.completeQuest('synth_parts'));
  assert(Math.abs((await FL(() => window.FL.credits())) - c1) < 0.01, 'paid twice');
});

await step('quartz (D87): today\'s land has its vein a parcel away; a face cutter dropped facing away turns its back to the wall and cuts 15 a minute', async () => {
  const v = await FL(() => window.FL.vein());
  assert(v && v.n === 8 && (v.look === 1 || v.look === 2) && v.spots.length === 4, `vein: ${JSON.stringify(v)}`);
  const [x, y, rot] = v.spots[0];
  const r = await FL(([p, x, y, rot]) => {
    const sim = window.FL.app.sim;
    if (sim.credits < sim.landPrice(p) + 100) sim.grantCredits(sim.landPrice(p) + 100 - sim.credits);
    if (sim.buyLand(p) !== null) return { ok: false, reason: 'land' };
    window.FL.unlock('ex_quartz');
    // Dropped facing the wall (its back away from it): the placement turns it round.
    const placed = window.FL.place('face_cutter', x, y, (rot + 2) % 4);
    if (!placed.ok) return placed;
    sim.ensureCompiled();
    const e = sim.ents.get(placed.id), n = sim.graph.nodeByEnt.get(placed.id);
    return { ok: true, id: placed.id, rot: e.rot, item: n.item, rate: n.rateEp, quartz: window.FL.itemIndex('quartz') };
  }, [v.parcel, x, y, rot]);
  assert(r.ok && r.rot === rot, `cutter: ${JSON.stringify(r)}`);
  assert(r.item === r.quartz && r.rate === 10000, `its face: ${JSON.stringify(r)}`);
  // Off the wall it is refused, with the reason.
  const off = await FL(([x, y, rot]) => window.FL.app.sim.canPlace('face_cutter', x + 3 * [0, 1, 0, -1][rot], y + 3 * [-1, 0, 1, 0][rot], rot).reason, [x, y, rot]);
  assert(off === 'needs_face', `off the wall: ${off}`);
  await FL(([x, y]) => { window.FL.view('iso'); window.FL.lookAt(x, y, 1.6); }, [x, y]);
  await settleView('iso');
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: shot('smoke-vein.png') });
});

await step('the Gleaners (D103): a ribbon out past the Crown is exposed at night, none in the cirque; under glass it is safe; the Logistique card counts them; the morning report shows and goes', async () => {
  const v = await FL(() => window.FL.vein());
  const [x, y, rot] = v.spots[0];
  const r = await FL(([x, y, rot]) => {
    const sim = window.FL.app.sim;
    const dx = [0, 1, 0, -1][rot], dy = [-1, 0, 1, 0][rot], sx = [0, 1, 0, -1][(rot + 1) & 3], sy = [-1, 0, 1, 0][(rot + 1) & 3];
    // Five tiles across the floor before the cutter, four out from it.
    const path = [0, 1, 2, 3, 4].map((k) => [x + dx * 4 + sx * k, y + dy * 4 + sy * k, (rot + 1) & 3]);
    const laid = sim.placeBelts('ribbon', path);
    sim.ensureCompiled();
    const ex = new Set(sim.graph.glean.exposed), tiles = path.map(([a, b]) => b * 1024 + a);
    const crown = sim.grid.source.crownOuter ?? 29;
    const inCirque = [...ex].filter((t) => ((t & 1023) - 512) ** 2 + ((t >> 10) - 512) ** 2 < crown * crown).length;
    const exposed = tiles.filter((t) => ex.has(t)).length;
    window.FL.unlock('xp_guard');
    sim.grant('glass', 20);
    const glazed = sim.placeBelts('glazed_ribbon', path);
    sim.ensureCompiled();
    const g = new Set(sim.graph.glean.guarded), ex2 = new Set(sim.graph.glean.exposed);
    return { laid, exposed, inCirque, glazed, guarded: tiles.filter((t) => g.has(t)).length, still: tiles.filter((t) => ex2.has(t)).length };
  }, [x, y, rot]);
  assert(r.laid >= 3 && r.exposed === r.laid, `a desert ribbon is exposed: ${JSON.stringify(r)}`);
  assert(r.inCirque === 0, `nothing exposed in the cirque: ${JSON.stringify(r)}`);
  assert(r.glazed === r.laid && r.still === 0 && r.guarded === r.laid, `under glass it is safe: ${JSON.stringify(r)}`);
  // The Logistique card's night block, and the morning report.
  await FL(() => window.FL.mapView('logistics'));
  await page.waitForTimeout(400);
  assert(await page.isVisible('.vp-glean'), 'the Logistique card shows the night');
  await FL(() => window.FL.mapView('normal'));
  const card = await FL(() => { window.FL.selected(0); return window.FL.gleaners({ card: 'dawn' }).card; });
  assert(card === 'dawn', `the morning report: ${card}`);
  assert(await page.isVisible('[data-screen="gleaners"]'), 'the morning report is not visible');
  await page.click('[data-gleaners-ok]');
  assert((await FL(() => window.FL.gleaners().card)) === null, 'the morning report stayed');
});

await step('gaps (D94): today\'s land (map 4, and 5: D136) has chasms and rivers past the Crown; nothing stands in them, a ribbon drag leaps one with a skybridge pair; the land panel shows a parcel\'s usable floor', async () => {
  const r = await FL(() => {
    const sim = window.FL.app.sim, g = sim.grid, C = 512;
    if ((g.source.mapV ?? 1) < 4) return { ok: false, why: `map ${g.source.mapV}` }; // map 4's obstacles, and map 5's (D136)
    // The nearest straight crossing of a chasm, east–west: two floor tiles, 2–3 chasm tiles, two floor tiles, level 0.
    const floor = (x, y) => [0, 1].includes(g.terrain(x, y)) && g.level(x, y) === 0;
    let at = null, best = Infinity, rivers = 0;
    for (let y = C - 120; y <= C + 120; y++) for (let x = C - 120; x <= C + 120; x++) {
      if (g.terrain(x, y) === 14) rivers++;
      const d = (x - C) ** 2 + (y - C) ** 2;
      if (d >= best || g.terrain(x + 2, y) !== 13 || !floor(x, y) || !floor(x + 1, y)) continue;
      let n = 0;
      while (g.terrain(x + 2 + n, y) === 13 && n < 4) n++;
      if (n >= 2 && n <= 3 && floor(x + 2 + n, y) && floor(x + 3 + n, y)) { at = [x, y, n]; best = d; }
    }
    if (!at) return { ok: false, why: 'no chasm crossing within 120 tiles' };
    const [x, y, n] = at;
    sim.explored.push([x + 3, y, 12]); // a rig: the fog lifted over the crossing (land too far to buy is crossed by kite)
    const refused = sim.canPlace('mast', x + 2, y, 0).reason;
    for (const tx of [x, x + 3 + n]) { const p = window.FL.parcelAt(tx, y); if (!sim.land.holds(p)) { if (sim.credits < sim.landPrice(p) + 100) sim.grantCredits(sim.landPrice(p) + 100 - sim.credits); sim.buyLand(p); } }
    window.FL.unlock('bridge');
    sim.grant('iron_plate', 40);
    const path = Array.from({ length: n + 4 }, (_, k) => [x + k, y, 1]);
    const plan = sim.planBelts('ribbon', path).map((s) => (s.leapt ? 'leapt' : s.ok ? s.def : s.reason));
    const laid = sim.placeBelts('ribbon', path);
    return { ok: true, at, rivers, refused, plan, laid, p: window.FL.parcelAt(x, y) };
  });
  assert(r.ok, `gaps: ${JSON.stringify(r)}`);
  assert(r.rivers > 20, `rivers round the cirque: ${r.rivers}`);
  assert(r.refused === 'chasm', `a mast in a chasm: ${r.refused}`);
  assert(r.plan.filter((s) => s === 'skybridge').length === 2 && r.plan.filter((s) => s === 'leapt').length === r.at[2], `the drag's plan: ${r.plan.join(' ')}`);
  // The land mode: the picked parcel's usable floor in the panel.
  await FL((p) => { window.FL.mapView('land'); window.FL.app.landTool.click(p); }, r.p);
  await page.waitForSelector('.land-floor b', { timeout: 3000 });
  const share = await page.$eval('.land-floor b', (n) => n.textContent ?? '');
  assert(/\d+\s?%/.test(share), `usable floor: « ${share} »`);
  await FL(() => window.FL.mapView('normal'));
});

await step('intro (D31): not by itself under automation; FL.intro plays it; the register refuses another claim’s name; the landing names the claim and gives it the emblem designed on the form', async () => {
  let st = await FL(() => window.FL.intro());
  assert(!st.open && !st.heartHidden, `intro under webdriver: ${JSON.stringify(st)}`);
  await FL(() => window.FL.intro(true));
  await page.waitForSelector('[data-screen="intro"][data-stage="story"]', { timeout: 3000 });
  st = await FL(() => window.FL.intro());
  assert(st.panel === 'city' && st.heartHidden, `story: ${JSON.stringify(st)}`);
  await page.mouse.click(720, 450); await page.mouse.click(720, 450); // finish the caption, next panel
  assert((await FL(() => window.FL.intro())).panel === 'investor', 'a click moves on');
  await page.keyboard.press('Escape'); // to the register, never past it
  await page.waitForSelector('[data-screen="intro"][data-stage="name"]', { timeout: 2000 });
  await page.fill('[data-intro-name-input]', 'port ecume');
  await page.click('[data-intro-name-ok]');
  const err = (re) => page.waitForFunction((src) => new RegExp(src, 'i').test(document.querySelector('[data-intro-err]')?.textContent ?? ''), re, { timeout: 2000 });
  await err('registre|register');
  assert((await FL(() => window.FL.intro())).panel === 'name', 'another claim\'s name went through');
  // A free name, but the form is not signed yet: refused.
  await page.fill('[data-intro-name-input]', 'Mines du Smoke');
  // The emblem: round, the ocelle, coral with the symbol in paper (owner, 2026-10-13: the Heart flies it).
  for (const [row, v] of [['shape', 'round'], ['symbol', 'eye'], ['field', 'coral'], ['ink', 'paper']]) await page.click(`[data-emb="${row}"] [data-emb-v="${v}"]`);
  await page.click('[data-intro-name-ok]');
  await err('signature');
  // Sign it with the real mouse: a scrawl across the box.
  const box = await page.locator('[data-intro-sign]').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 55);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 30 + i * 18, box.y + 55 + (i % 2 ? -22 : 6), { steps: 3 });
  await page.mouse.up();
  assert(await FL(() => document.querySelector('.intro-register')?.hasAttribute('data-signed')), 'the signature did not take');
  await page.screenshot({ path: shot('smoke-intro-form.png') });
  await page.click('[data-intro-name-ok]');
  await page.waitForSelector('.intro-register[data-registered]', { timeout: 2000 }); // the « Enregistré » stamp
  await page.waitForFunction(() => window.FL.intro().landing, undefined, { timeout: 3000 });
  await FL(() => window.FL.app.landing.seek(4.3, true));
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('smoke-intro.png') });
  await page.click('[data-intro-skip]'); // hurries the landing
  await page.waitForFunction(() => !window.FL.intro().open, undefined, { timeout: 4000 });
  const q = await FL(() => window.FL.quests());
  st = await FL(() => window.FL.intro());
  assert(q.named && q.name === 'Mines du Smoke' && q.current !== 'claim', `after the intro: ${JSON.stringify(q)}`);
  const emb = await FL(() => window.FL.app.sim.emblem);
  assert(emb && emb.shape === 'round' && emb.symbol === 'eye' && emb.field === 'coral' && emb.ink === 'paper', `the claim's emblem: ${JSON.stringify(emb)}`);
  assert(!st.heartHidden && !(await FL(() => document.body.hasAttribute('data-intro'))), 'Heart or HUD not back');
});

await step('tree (D33): the HUD chip opens the tech tree; one click on a plan unlocks it, paid by the Heart; a selected card focuses its chain, a hover only raises it, Esc lets go (D107, D111); « Tout voir » zooms out on the whole tree (D111)', async () => {
  // This base's quests were forced, which unlocks no plan; the quartz step took the Face Cutter's
  // with its prerequisites (D107: the trade post first, so the telemetry too). The first plan still
  // to take, its prerequisites met (the Statistics' stays for the next step), is bought here.
  await FL(() => { window.FL.close(); window.FL.pause(); });
  const id = await FL(() => ['telemetry', 'incinerator', 'traction', 'silo', 'sorter', 'junction', 'wire_mill', 'sand_collector']
    .find((p) => !window.FL.app.sim.unlocked(p) && window.FL.app.sim.planBlock(p) === null) ?? null);
  assert(id, 'no plan left to take');
  const before = await FL((p) => ({ plates: window.FL.stocks().iron_plate ?? 0, on: window.FL.app.sim.unlocked(p) }), id);
  await page.click('[data-hud-tree]');
  await page.waitForSelector('[data-screen="research"][data-open]', { timeout: 3000 });
  const cost = Number(await page.textContent(`.tr-node[data-id="${id}"] .tr-chip`));
  await page.click(`[data-unlock="${id}"]`);
  await page.waitForSelector(`.tr-node[data-id="${id}"][data-state="done"]`, { timeout: 2000 });
  const after = await FL((p) => ({ plates: window.FL.stocks().iron_plate ?? 0, on: window.FL.app.sim.unlocked(p) }), id);
  assert(!before.on && after.on && Math.abs(before.plates - after.plates - cost) < 0.01, `${id} ${after.on}, plates ${before.plates} → ${after.plates} (cost ${cost})`);
  // The focus (D107, D111): opened, the tree focuses nothing, and a card under the mouse is only
  // raised. Selecting the Compute Plan lights its chain — its Server Room across the lanes —, the
  // rest faded; it stays when the mouse goes; Esc lets it go and leaves the tree open.
  assert(!(await page.$('.tr-canvas[data-chain]')), 'a chain lit on opening');
  await page.hover('.tr-node[data-id="cm_plan"]');
  await page.waitForTimeout(150);
  assert(!(await page.$('.tr-canvas[data-chain]')), 'a hover lights a chain');
  await page.click('.tr-node[data-id="cm_plan"]');
  const chain = await page.evaluate(() => ({
    on: document.querySelector('.tr-canvas')?.hasAttribute('data-chain'),
    self: document.querySelector('.tr-node[data-id="cm_plan"]')?.getAttribute('data-chain'),
    servers: document.querySelector('.tr-node[data-id="an_servers"]')?.getAttribute('data-chain'),
    far: document.querySelector('.tr-node[data-id="en_tower"]')?.hasAttribute('data-chain'),
    link: !!document.querySelector('.tr-link[data-chain][data-kind="cross"]'),
    detail: document.querySelector('.rs-detail h3')?.textContent,
  }));
  assert(chain.on && chain.self === 'self' && chain.servers === '' && !chain.far && chain.link && chain.detail, `chain: ${JSON.stringify(chain)}`);
  await page.mouse.move(2, 2);
  await page.waitForTimeout(200);
  assert(await page.$('.tr-canvas[data-chain]'), 'the focus went with the mouse');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.tr-canvas')?.hasAttribute('data-chain'), undefined, { timeout: 2000 });
  assert(await page.$('[data-screen="research"][data-open]'), 'Esc closed the tree instead of letting the focus go');
  // The zoom (D111): « Tout voir » fits the whole tree, its cards simplified; a click there focuses,
  // a zoom step keeps the focus, a click on the empty tree lets it go; « 100 % » brings the size
  // back (the next steps click its tabs).
  await page.click('[data-tree-zoom="fit"]');
  const zoomed = await page.evaluate(() => {
    const c = document.querySelector('.tr-canvas'), v = document.querySelector('.tr-view');
    return { z: Number(c.style.zoom), level: c.getAttribute('data-zoom'), fits: c.getBoundingClientRect().width <= v.getBoundingClientRect().width + 2 };
  });
  assert(zoomed.z < 0.5 && zoomed.level === 'far' && zoomed.fits, `fit: ${JSON.stringify(zoomed)}`);
  await page.click('.tr-node[data-id="cm_plan"]');
  assert(await page.$('.tr-node[data-id="an_servers"][data-chain]'), 'no chain at the whole tree');
  await page.click('[data-tree-zoom="in"]');
  assert(await page.$('.tr-node[data-id="an_servers"][data-chain]'), 'a zoom step lost the focus');
  const vr = await page.locator('.tr-view').boundingBox();
  await page.mouse.click(vr.x + 30, vr.y + vr.height - 30);
  await page.waitForFunction(() => !document.querySelector('.tr-canvas')?.hasAttribute('data-chain'), undefined, { timeout: 2000 });
  await page.click('[data-tree-zoom="fit"]');
  await page.click('.tr-node[data-id="tr1"]');
  assert(await page.$('.tr-node[data-id="tr1"][data-on][data-chain="self"]'), 'a click at the whole tree does not select and focus');
  await page.click('[data-tree-zoom="reset"]');
  assert(await page.evaluate(() => !document.querySelector('.tr-canvas').hasAttribute('data-zoom') && document.querySelector('.tr-canvas').style.zoom === '1'), 'not back to 100 %');
  assert(await page.$('.tr-canvas[data-chain]'), 'back to 100 % lost the focus');
  await page.screenshot({ path: shot('smoke-tree.png') });
  await page.click('.rs-close');
  await FL(() => window.FL.resume());
});

await step('analytics (D41): the tree’s five paths (D117: no survey path); the ledger brings the Statistics chip and G; no reveal by itself under automation; FL.focusReveal dims the base around the chip, Esc skips it', async () => {
  await FL(() => window.FL.close());
  await page.click('[data-hud-tree]');
  await page.waitForSelector('[data-screen="research"][data-open]', { timeout: 3000 });
  const paths = await page.$$eval('.tr-lane[data-kind="plan"]', (ns) => ns.map((n) => n.getAttribute('data-lane')));
  assert(paths.join() === 'production,logistics,energy,analytics,trade', `paths: ${paths}`);
  assert(await page.$('.tr-node[data-id="ex_quartz"][data-lane="production"]'), 'the Face Cutter is not on the Production path (D117)');
  for (const id of ['telemetry', 'statistics', 'power_log', 'diagnostics']) assert(await page.$(`.tr-node[data-id="${id}"][data-lane="analytics"]`), `${id} is not on the Analytics path`);
  assert(!(await page.isVisible('[data-hud-stats]')), 'the Statistics chip shows before the ledger');
  await page.click('[data-unlock="statistics"]');
  await page.waitForSelector('.tr-node[data-id="statistics"][data-state="done"]', { timeout: 2000 });
  await page.screenshot({ path: shot('smoke-paths.png') });
  await page.click('.rs-close');
  await page.waitForSelector('[data-hud-stats]:not([hidden])', { timeout: 2000 });
  await page.waitForTimeout(700); // a few HUD refreshes with nothing over it
  assert(!(await page.$('[data-screen="focus"]')), 'a reveal played by itself under automation');
  await page.click('[data-hud-stats]');
  await page.waitForSelector('[data-screen="stats"][data-open]', { timeout: 2000 });
  await page.keyboard.press('Escape');
  const r = await FL(() => window.FL.focusReveal('statistics'));
  assert(r.played && r.open && r.id === 'statistics', `focusReveal: ${JSON.stringify(r)}`);
  await page.waitForSelector('[data-screen="focus"][data-phase="hold"]', { timeout: 2000 });
  const [hole, chip] = await page.evaluate(() => ['.focus-hole', '[data-hud-stats]'].map((q) => document.querySelector(q).getBoundingClientRect().toJSON()));
  assert(hole.left <= chip.left && hole.right >= chip.right && hole.top <= chip.top && hole.bottom >= chip.bottom, `the hole ${JSON.stringify(hole)} misses the chip ${JSON.stringify(chip)}`);
  await page.screenshot({ path: shot('smoke-focus.png') });
  // It holds two seconds whatever the player does, then waits for a click or a key.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert(await page.$('[data-screen="focus"]'), 'Esc ended the reveal before its two seconds');
  await page.waitForSelector('[data-screen="focus"][data-ready]', { timeout: 3500 });
  await page.waitForTimeout(1200);
  assert(await page.$('[data-screen="focus"]'), 'the reveal ended by itself');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-screen="focus"]'), undefined, { timeout: 1500 });
  assert((await FL(() => window.FL.screen())) === null, 'Esc went through to the game');
});

await step('i18n: no missing key (⟦…⟧) on any screen, in French and in English', async () => {
  const missing = [];
  for (const loc of ['en', 'fr']) {
    await FL((l) => window.FL.setLocale(l), loc);
    await FL(() => { window.FL.close(); window.FL.selected(window.FL.entityAt(512, 512)?.id ?? 0); });
    for (const scr of [null, 'research', 'stats', 'market', 'expertise', 'menu', 'menu:settings', 'menu:about']) {
      if (scr?.startsWith('menu')) await FL((p) => window.FL.menu(true, p || undefined), scr.split(':')[1] ?? '');
      else if (scr) await FL((s) => window.FL.open(s), scr);
      await page.waitForTimeout(350);
      const txt = await page.evaluate(() => document.body.innerText);
      for (const m of txt.match(/⟦[^⟧]*⟧/g) ?? []) missing.push(`${loc}${scr ? `/${scr}` : ''}: ${m}`);
      if (scr?.startsWith('menu')) await FL(() => window.FL.menu(false));
      else if (scr) await FL(() => window.FL.close());
    }
    // The land mode's panel, on a parcel for sale (far off: its refusal) and on the Heart's (D60).
    for (const off of [[4, 0], [0, 0]]) {
      await FL(([dx, dy]) => { window.FL.app.build.land(true); window.FL.app.landTool.selected = window.FL.parcel(dx, dy).p; }, off);
      await page.waitForTimeout(350);
      const txt = await page.evaluate(() => document.body.innerText);
      for (const m of txt.match(/⟦[^⟧]*⟧/g) ?? []) missing.push(`${loc}/land: ${m}`);
    }
    await FL(() => { window.FL.app.build.land(false); window.FL.selected(window.FL.entityAt(512, 512)?.id ?? 0); });
  }
  assert(!missing.length, `missing keys: ${[...new Set(missing)].join(', ')}`);
});

// ── M7: the base is kept (sandbox database under automation), caught up, exported, one tab at a time ──
/** The page opened paused (?paused): a hash read after the boot is the base as it was loaded. */
// Built with the URL API: a URL that already has a query (?debug, to get the debug bases on a production build) keeps it.
const PAUSED = (() => { const u = new globalThis.URL(URL); u.searchParams.set('paused', ''); return u.href; })();
const ready = async (pg = page) => {
  await pg.waitForFunction(() => !!window.FL && window.FL.ready() && document.body.hasAttribute('data-ready'), undefined, { timeout: 30000 });
  await pg.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 10000 });
};

await step('saves: the settings say when the base was last saved', async () => {
  await FL(() => window.FL.save());
  await FL(() => window.FL.menu(true, 'settings'));
  await page.waitForSelector('[data-save-act="export"]', { timeout: 2000 });
  await page.waitForTimeout(600);
  const note = await page.textContent('[data-save-note]');
  assert(/sauvegarde|saved/i.test(note ?? ''), `save note: ${note}`);
  await page.screenshot({ path: shot('smoke-save-settings.png') });
  await FL(() => window.FL.menu(false));
});

await step('saves: a reload opens the very base it saved', async () => {
  await FL(() => window.FL.pause());
  const saved = await FL(() => window.FL.save());
  assert(saved && saved.seq > 0, `save: ${JSON.stringify(saved)}`);
  const slots = await FL(() => window.FL.saves());
  assert(slots.some((x) => x.slot === 'a' && x.ok) && slots.every((x) => x.ok), `slots: ${JSON.stringify(slots)}`);
  await page.goto(PAUSED, { waitUntil: 'networkidle' }); // a reload, opened paused (wipe and import below reload it too)
  await ready();
  const h = await FL(() => window.FL.hash());
  assert(h === saved.hash, `reloaded ${h}, saved ${saved.hash}`);
  await FL(() => window.FL.resume());
});

await step('absence: eight hours away are caught up in seconds, with a report', async () => {
  await FL(() => window.FL.demo()); // the tutorial steps started over on bare land: give the base a working line
  const t0 = Date.now();
  const r = await FL(() => window.FL.simulateAbsence(8));
  const ms = Date.now() - t0;
  console.log(`    8 h caught up in ${ms} ms (${r?.mode}), ${Math.round(r?.produced ?? 0)} items made`);
  assert(r && r.ticks === 8 * 36000 && r.produced > 0, `report: ${JSON.stringify(r)}`);
  assert(ms < 15000, `too slow: ${ms} ms`);
  await page.waitForSelector('[data-screen="absence"] [data-absence-panel="heart"]', { timeout: 3000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('smoke-absence.png') });
  await page.click('[data-absence-ok]');
  assert(!(await FL(() => window.FL.absence())), 'the report did not close');
});

await step('saves: export → start over → import gives the same base back', async () => {
  await FL(() => window.FL.pause());
  const h = await FL(() => window.FL.hash());
  const text = await FL(() => window.FL.exportText());
  assert(text && text.length > 100, 'no export text');
  // Both reload the page: the evaluation in flight may die with it.
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), FL(() => window.FL.wipe()).catch(() => null)]);
  await ready();
  const fresh = await FL(() => ({ h: window.FL.hash(), named: window.FL.quests().named }));
  assert(fresh.h !== h && !fresh.named, 'start over kept the base');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), FL((t) => window.FL.importText(t), text).catch(() => null)]);
  await ready();
  const back = await FL(() => { window.FL.pause(); return window.FL.hash(); });
  assert(back === h, `imported ${back}, exported ${h}`);
  const copies = (await FL(() => window.FL.saves())).map((x) => x.slot);
  assert(copies.includes('pre-wipe') && copies.includes('pre-import'), `copies: ${copies.join(', ')}`);
  await FL(() => window.FL.resume());
});

await step('one tab at a time: a second tab takes the base over, the first steps aside', async () => {
  const page2 = await context.newPage();
  page2.on('pageerror', (err) => errors.push(`pageerror (tab 2): ${err.message}`));
  await page2.goto(PAUSED, { waitUntil: 'networkidle' });
  await page2.waitForSelector('[data-screen="conflict"] [data-conflict-take]', { timeout: 15000 });
  await page2.screenshot({ path: shot('smoke-conflict.png') });
  const h = await FL(() => { window.FL.pause(); return window.FL.hash(); });
  await page2.click('[data-conflict-take]');
  await ready(page2);
  await page.waitForSelector('[data-screen="conflict"][data-left]', { timeout: 10000 });
  const h2 = await page2.evaluate(() => window.FL.hash());
  assert(h2 === h, `tab 2 opened ${h2}, tab 1 left ${h}`);
  await page2.close();
});

await browser.close();

const realErrors = errors.filter((e) => !e.includes('favicon') && !e.includes('Autoplay'));
if (realErrors.length) {
  console.log('\nERRORS:');
  for (const e of realErrors) console.log('  ' + e);
  process.exit(1);
}
console.log('\nSMOKE TEST PASSED.');
