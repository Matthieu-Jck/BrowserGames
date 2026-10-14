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
      .filter((e) => ['drill', 'workshop', 'observatory', 'trade_post', 'brazier', 'wind_flower'].includes(window.FL.entityAt(e.x, e.y)?.def))
      .filter((e) => sim.graph.netOfEnt.get(e.id) !== home)
      .map((e) => window.FL.entityAt(e.x, e.y)?.def);
    return { off, pairs: sim.links.size, wires: window.FL.wires() };
  });
  assert(r.off.length === 0, `not on the Heart's grid: ${r.off.join(', ')}`);
  assert(r.pairs >= 12 && r.wires === r.pairs, `wires ${r.wires} / pairs ${r.pairs}`);
});

await step('build: pick a drill in the tray and click it onto a deposit', async () => {
  await page.click('.bb-tab[data-cat="extraction"]');
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
  const a = await FL(() => window.FL.freeSpot('ribbon', 518, 520, 10));
  assert(a, 'no ribbon spot');
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
  // Past the starting square (5 × 5 parcels of 16 tiles round the Heart: ±40 tiles), on explored floor.
  const far = await FL(() => {
    const sim = window.FL.app.sim;
    for (let d = 41; d <= 48; d++) for (const [x, y] of [[512, 512 + d], [512 + d, 512], [512, 512 - d], [512 - d, 512]]) {
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

await step('build: a ribbon dragged over the Crown leaves its steps to traction ribbons (D77): the tip names it, the toast counts them', async () => {
  await page.keyboard.press('Escape');
  await FL(() => window.FL.tool('ribbon'));
  // A free row east of the Heart whose drag meets the Crown's steps: the tiles the plan leaves out.
  const row = await FL(() => {
    const sim = window.FL.app.sim;
    for (let y = 498; y <= 526; y++) {
      const path = []; for (let x = 526; x <= 548; x++) path.push([x, y, 1]);
      const plan = sim.planBelts('ribbon', path);
      if (plan.some((s) => !s.ok && s.reason !== 'needs_lift')) continue;
      const steps = plan.filter((s) => s.reason === 'needs_lift').map((s) => s.x);
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
  const tip = await page.evaluate(() => document.querySelector('#tooltip .tip-lift')?.textContent ?? null);
  await page.screenshot({ path: shot('smoke-crown-steps.png') });
  await page.mouse.up();
  assert(tip && /traction|2|T/i.test(tip), `the tip does not name the traction ribbon: ${tip}`);
  const t = (await FL(() => window.FL.toasts())).join(' | ');
  assert(new RegExp(`${row.steps.length} (tuiles laissées|tiles left out)`).test(t), `no toast counting the steps left out: ${t}`);
  const laid = await FL(([y, xs]) => xs.map((x) => window.FL.entityAt(x, y)), [row.y, row.steps]);
  assert(laid.every((e) => !e), `a ribbon was laid facing a step: ${JSON.stringify(laid)}`);
  assert((await FL(([y]) => window.FL.entityAt(526, y), [row.y]))?.def === 'ribbon', 'the rest of the drag was not laid');
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
    const m = window.FL.freeSpot('mast', 530, 520, 10);
    if (!m) return null;
    const mast = window.FL.place('mast', m[0], m[1], 0);
    const f = window.FL.freeSpot('wind_flower', m[0] + 2, m[1], 6);
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
      return (d === 'drill' || d === 'workshop') && (Math.abs(o.x - 512) > 14 || Math.abs(o.y - 512) > 14);
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

await step('power: P shows the power overlay', async () => {
  await page.keyboard.press('p');
  assert((await FL(() => window.FL.app.overlays.powerOn)) === true, 'overlay off');
  await page.screenshot({ path: shot('smoke-power.png') });
  await page.keyboard.press('p');
});

await step('inspect: the grid module (D76) — a wind flower shows rated × factor = now, its factor unfolds why; a workshop shows what it draws, in the same card', async () => {
  const ids = await FL(() => {
    const sim = window.FL.app.sim;
    const of = (def) => sim.ents.sorted().find((e) => window.FL.entityAt(e.x, e.y)?.def === def && e.builtAt === 0)?.id ?? 0;
    return { wind: of('wind_flower'), shop: of('workshop') };
  });
  assert(ids.wind && ids.shop, `demo base: ${JSON.stringify(ids)}`);
  await FL((id) => window.FL.selected(id), ids.wind);
  await page.waitForSelector('[data-power-card] [data-pw="formula"] .pw-coef', { timeout: 5000 });
  assert((await page.$$('[data-power-card]')).length === 1, 'one grid card');
  assert(await page.$('.pw-why[hidden]'), 'the reasons start folded');
  await page.click('.pw-coef');
  await page.waitForSelector('.pw-why:not([hidden]) [data-pw-viz="wind"] .pw-step[data-on]', { timeout: 3000 });
  const f = await page.evaluate(() => [...document.querySelectorAll('[data-pw="formula"] .pw-kw, [data-pw="formula"] .pw-coef-n')].map((n) => n.textContent));
  assert(f.length === 3 && /kW/.test(f[0]) && /^×/.test(f[1]) && /kW/.test(f[2]), `formula: ${f.join(' | ')}`);
  await page.locator('.inspector').screenshot({ path: shot('smoke-grid-card.png') });
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

await step('research: start Mechanics from the screen, the HUD counts down, a notice lands', async () => {
  await FL(() => window.FL.lookAt(512, 512, 1));
  assert(await FL(() => window.FL.feedLab('journal_1', 40)), 'no research lab to feed');
  await page.keyboard.press('t');
  await page.waitForSelector('[data-screen="research"][data-open]', { timeout: 2000 });
  await page.click('.rs-card[data-id="tr1"]');
  await page.click('.rs-detail .btn.primary');
  const r = await FL(() => window.FL.research());
  assert(r.projects?.some((p) => p.id === 'tr1'), `tr1 not running: ${JSON.stringify(r)}`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.hud-rs[data-id="tr1"]', { timeout: 2000 });
  const eta = await page.textContent('.hud-rs[data-id="tr1"] .hud-rs-eta');
  assert(/min|m|s/.test(eta ?? ''), `no countdown in the HUD: ${eta}`);
  // 3 000 ticks at full power; the weather follows the real clock, so a calm hour browns
  // the demo grid out: tick on until it is learnt (bounded).
  for (let i = 0; i < 12; i++) {
    await FL(() => window.FL.tick(600));
    if ((await FL(() => window.FL.research())).done?.includes('tr1')) break;
  }
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((n) => /Mécanique|Mechanics/.test(n.textContent ?? '')), undefined, { timeout: 3000 });
  const after = await FL(() => window.FL.research());
  assert(after.done?.includes('tr1'), 'tr1 not learnt');
  await page.screenshot({ path: shot('smoke-m4.png') });
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
    order: !!document.querySelector('.inspector .tr-order[data-item="copper_ore"]'),
    lines: [...document.querySelectorAll('.inspector .tp-recap .tp-line[data-item]')].map((n) => n.getAttribute('data-item')),
  }));
  console.log(`    recap: ${g.lines.join(',') || 'empty'}${g.linked ? '' : ' (exit not linked)'}`);
  assert(g.pickers === 0, 'the trade post still shows outlet or stream pickers');
  assert(g.recaps === 2, `no cargo / on-its-way recap: ${g.recaps}`);
  assert(g.linked && g.order, `the exit or the copper order is not shown: ${JSON.stringify(g)}`);
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
    for (const [it, n] of [['iron_plate', 4000], ['gear', 800], ['circuit', 400], ['ceramic', 400], ['lens', 40], ['resin_canvas', 60], ['thermal_core', 40]]) sim.grant(it, n);
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

await step('space: a parcel bought past the starting square takes a skydock; a drifter route carries plates between skydocks', async () => {
  const r = await FL(() => {
    const sim = window.FL.app.sim;
    // The parcel three east of the Heart's (ring 3: just past the starting square), bought with
    // the ocelles granted if short (a rig: the land panel's own step buys one by the mouse).
    const p = 32 * 65 + 35, cents = sim.landPrice(p);
    if (sim.credits < cents) sim.grantCredits(cents - sim.credits);
    if (sim.land.holds(p) ? false : sim.buyLand(p) !== null) return { err: 'land not bought' };
    const at = [35 * 16, 32 * 16]; // the parcel's middle tile
    if (!sim.land.covers(at[0], at[1])) return { err: 'parcel not held' };
    // Two skydocks: one by the Hearth, one on the new parcel.
    const find = (cx, cy, rad) => { for (let d = 0; d <= rad; d++) for (let y = cy - d; y <= cy + d; y++) for (let x = cx - d; x <= cx + d; x++) if ((() => { const c = sim.canPlace('skydock', x, y, 0); return c.ok && c.replaces.length === 0; })()) return [x, y]; return null; };
    const pa = find(512 + 6, 512 + 6, 10), pb = find(at[0] - 1, at[1] - 1, 6);
    if (!pa || !pb) return { err: `dock spots ${pa} ${pb}` };
    const a = sim.place('skydock', pa[0], pa[1], 0), b = sim.place('skydock', pb[0], pb[1], 0);
    if (!a.ok || !b.ok) return { err: `docks ${a.reason} ${b.reason}` };
    // Off the starting square it arrives by drone: wait for the build to complete.
    sim.run(Math.max(0, sim.ents.get(b.id).builtAt - sim.tick) + 5);
    return { a: a.id, b: b.id, ws: at };
  });
  assert(!r.err, r.err);
  await FL(({ a, b }) => { window.FL.powerTo(a); window.FL.powerTo(b); }, r);
  const ok = await FL(({ a, b }) => {
    const sim = window.FL.app.sim;
    sim.ensureCompiled();
    if (!sim.buyDrifter(a) || !sim.buyDrifter(a)) return 'buy';
    sim.stores.get(a)[sim.stock.length ? window.FL.itemIndex('iron_plate') : 0] = 800 * 1000;
    return sim.addRoute(a, b, 'iron_plate', 2) > 0 ? 'ok' : 'route';
  }, r);
  assert(ok === 'ok', `route setup: ${ok}`);
  await FL(() => window.FL.tick(1800));
  const got = await FL(({ b }) => window.FL.app.sim.stores.get(b)[window.FL.itemIndex('iron_plate')] / 1000, r);
  console.log(`    delivered ${got.toFixed(1)} plates in 3 min`);
  assert(got > 10, `drifters delivered ${got}`);
  await FL(({ ws }) => window.FL.lookAt(ws[0], ws[1] - 10, 0.55), r);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot('smoke-m5-route.png') });
});

// ── D60: land in parcels ───────────────────────────────────────────────────
await step('land (D60): I opens the land mode over the plan view; a click picks a parcel, the panel shows it, « Acheter » buys it', async () => {
  await FL(() => { window.FL.tool(null); window.FL.category(null); window.FL.close(); window.FL.selected(0); });
  await settleView('iso');
  // A parcel for sale just past the starting square (ring 3: 5 × 5 parcels of 16 tiles round the
  // Heart's), its middle explored; the ocelles granted if short (a rig: the purse of the demo base).
  const pick = await FL(() => {
    const sim = window.FL.app.sim, cols = 65, home = 32;
    for (let r = home - 3; r <= home + 3; r++) for (let c = home - 3; c <= home + 3; c++) {
      if (Math.max(Math.abs(c - home), Math.abs(r - home)) !== 3) continue;
      const p = r * cols + c, at = [c * 16, r * 16];
      if (sim.land.holds(p) || sim.land.sister(p) >= 0 || !sim.revealed(at[0], at[1])) continue;
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

await step('perf: 10 000 items riding ribbons stay above 30 fps', async () => {
  // Ribbons may cross land the claim does not hold, never a sister claim's (D60): the claim buys
  // the sister parcels under the field first (the ocelles granted, and Far Claim, since they do not
  // touch its land: a rig).
  await FL(() => window.FL.unlock('xp_far'));
  const sisters = await FL(() => {
    const sim = window.FL.app.sim, ps = new Set();
    for (let y = 450; y < 550; y++) for (let x = 600; x < 705; x++) ps.add(Math.floor((y + 8) / 16) * 65 + Math.floor((x + 8) / 16));
    let n = 0;
    for (const p of [...ps].sort((a, b) => a - b)) {
      if (sim.land.sister(p) < 0) continue;
      const cents = sim.landPrice(p);
      if (sim.credits < cents) sim.grantCredits(cents - sim.credits);
      if (sim.buyLand(p) === null) n++;
    }
    return n;
  });
  console.log(`    ${sisters} sister parcels bought under the field`);
  const laid = await FL(() => window.FL.ribbonField(600, 450, 100, 105)); // one item per square: 10 500 squares
  const filled = await FL(() => window.FL.fillRibbons('iron_ore'));
  await FL(() => window.FL.lookAt(652, 500, 0.5));
  await page.waitForTimeout(2500);
  const p = await FL(() => window.FL.perf());
  console.log(`    ribbons=${laid} items=${filled} drawn=${p.items} fps=${p.fps} frameMs=${p.frameMs.toFixed(2)}`);
  assert(filled >= 10000, `only ${filled} items`);
  // A throttled browser (machine under load) caps frames at 30: then judge the frame's own cost.
  assert(p.fps > 30 || p.frameMs < 8, `too slow: ${p.fps} fps, ${p.frameMs.toFixed(2)} ms a frame`);
  await page.screenshot({ path: shot('smoke-items.png') });
});

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
  assert(!s.menu && s.cur === 'survey' && s.q === 'crier_calls', `after load: ${JSON.stringify(s)}`);
  await FL(() => window.FL.resume());
  await page.waitForTimeout(1500);
  assert((await FL(() => window.FL.debugSaves().realHash)) === own, 'the player’s base moved while aside');
  const r = await FL(() => window.FL.debugSave('tutorial'));
  console.log(`    tutorial built in ${r.ms} ms, forced ${r.forced.length}, skipped ${r.skipped.length}`);
  assert(r.ok && r.quest === null && r.forced.length === 0, `tutorial: ${JSON.stringify(r)}`);
  await page.screenshot({ path: shot('smoke-debug.png') });
  await FL(() => window.FL.pause());
  await page.click('[data-debug-back]');
  await page.waitForSelector('[data-debug-badge][hidden]', { state: 'attached', timeout: 2000 });
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

await step('quests: CrierBelt has the claim named; the log moves on; rewards pay once', async () => {
  // The demo base starts with the tutorial skipped: the tutorial needs a fresh base. The base
  // persists (M7): a reload would open it again, so start over (a new base, the page reloads).
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), FL(() => window.FL.wipe()).catch(() => null)]);
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
  await FL(() => { if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
  assert((await FL(() => document.querySelectorAll('.bb-tab[data-cat]:not([hidden])').length)) === 0, 'build tabs shown before the tutorial introduces them');
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
  const c0 = await FL(() => window.FL.credits());
  assert((await FL(() => window.FL.completeQuest('field_journal'))) === null, 'completeQuest refused'); // the last quest (D71)
  q = await FL(() => window.FL.quests());
  assert(q.done.length === 11, `done: ${q.done.length}`); // the tutorial's eleven quests (the board quest went with the export streams, D64)
  const c1 = await FL(() => window.FL.credits());
  assert(Math.abs(c1 - c0 - 250) < 0.01, `credits ${c0} → ${c1}`);
  await FL(() => window.FL.completeQuest('field_journal'));
  assert(Math.abs((await FL(() => window.FL.credits())) - c1) < 0.01, 'paid twice');
});

await step('intro (D31): not by itself under automation; FL.intro plays it; the register refuses a sister claim; the landing names the claim and gives it the emblem designed on the form', async () => {
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
  assert((await FL(() => window.FL.intro())).panel === 'name', 'a sister claim name went through');
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

await step('tree (D33): the HUD chip opens the tech tree; one click on a plan unlocks it, paid by the Heart', async () => {
  // This base's quests were forced, which unlocks no plan: Telemetry is still to buy.
  await FL(() => { window.FL.close(); window.FL.pause(); });
  const before = await FL(() => ({ plates: window.FL.stocks().iron_plate ?? 0, on: window.FL.app.sim.unlocked('telemetry') }));
  assert(!before.on, 'Telemetry already unlocked');
  await page.click('[data-hud-tree]');
  await page.waitForSelector('[data-screen="research"][data-open]', { timeout: 3000 });
  await page.click('[data-unlock="telemetry"]');
  await page.waitForSelector('.tr-node[data-id="telemetry"][data-state="done"]', { timeout: 2000 });
  const after = await FL(() => ({ plates: window.FL.stocks().iron_plate ?? 0, on: window.FL.app.sim.unlocked('telemetry') }));
  assert(after.on && Math.abs(before.plates - after.plates - 8) < 0.01, `Telemetry ${after.on}, plates ${before.plates} → ${after.plates}`);
  await page.screenshot({ path: shot('smoke-tree.png') });
  await page.click('.rs-close');
  await FL(() => window.FL.resume());
});

await step('analytics (D41): the tree’s six paths; the ledger brings the Statistics chip and G; no reveal by itself under automation; FL.focusReveal dims the base around the chip, Esc skips it', async () => {
  await FL(() => window.FL.close());
  await page.click('[data-hud-tree]');
  await page.waitForSelector('[data-screen="research"][data-open]', { timeout: 3000 });
  const paths = await page.$$eval('.tr-lane[data-kind="plan"]', (ns) => ns.map((n) => n.getAttribute('data-lane')));
  assert(paths.join() === 'production,logistics,energy,analytics,trade,survey', `paths: ${paths}`);
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
    for (const scr of [null, 'research', 'stats', 'market', 'menu', 'menu:settings', 'menu:about']) {
      if (scr?.startsWith('menu')) await FL((p) => window.FL.menu(true, p || undefined), scr.split(':')[1] ?? '');
      else if (scr) await FL((s) => window.FL.open(s), scr);
      await page.waitForTimeout(350);
      const txt = await page.evaluate(() => document.body.innerText);
      for (const m of txt.match(/⟦[^⟧]*⟧/g) ?? []) missing.push(`${loc}${scr ? `/${scr}` : ''}: ${m}`);
      if (scr?.startsWith('menu')) await FL(() => window.FL.menu(false));
      else if (scr) await FL(() => window.FL.close());
    }
    // The land mode's panel, on a parcel for sale and on the Heart's (D60).
    for (const p of [32 * 65 + 36, 32 * 65 + 32]) {
      await FL((q) => { window.FL.app.build.land(true); window.FL.app.landTool.selected = q; }, p);
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
const PAUSED = `${URL.replace(/\/?$/, '/')}?paused`;
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
