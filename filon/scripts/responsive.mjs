// responsive.mjs — the UI at seven window sizes (D96): the late debug base at each size, with the
// HUD alone, the inspector open, the build bar open, a specialised view's card, the land panel, the
// tech tree, the statistics, the Crier and the main menu. At each step it measures the boxes: every
// cartouche inside the window (the safe area's inset taken off), none of the HUD's over a panel or
// the build bar, the HUD's two sides apart, no page that scrolls sideways, a screen's ✕ in reach,
// and on the touch sizes the hit targets of the HUD and the build bar ≥ 40 px (`pointer: coarse`).
// A failure is printed with the boxes in question; the exit code is 1 when anything failed.
// Usage: a server on URL (default the dev server, :5183), then `node scripts/responsive.mjs`.
// Env: URL, OUT (screenshot folder, default scripts/ — gitignored), SIZES (a comma list of names,
// e.g. `390x844,844x390`), ONLY (a comma list of steps: hud, insp, build, view, land, research,
// stats, market, menu, forecast, touch, quests, stock, purse, tutpurse, expertise), SHOTS=0 (measure only), CHROME. The `quests` step loads the
// « survey » debug base (a quest under way: the tutorial's log on the left) and comes back to the late one.
// On the phone upright (390 × 844) the `touch` step drives real touch events (Chrome's
// Input.dispatchTouchEvent): a tap selects, one finger pans, two pinch, the sheet's grip folds and
// opens, a long press puts the tool in hand away (D96, input/touch.ts).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5183';
const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('.', import.meta.url));
const SHOTS = process.env.SHOTS !== '0';
mkdirSync(OUT, { recursive: true });

/** The sizes D96 targets: desktop, a small laptop, a tablet both ways, a phone both ways. */
const ALL_SIZES = [
  { name: '1920x1080', w: 1920, h: 1080 },
  { name: '1440x900', w: 1440, h: 900 },
  { name: '1280x720', w: 1280, h: 720 },
  { name: '1024x768', w: 1024, h: 768 },
  { name: '768x1024', w: 768, h: 1024, touch: true },
  { name: '390x844', w: 390, h: 844, touch: true },
  { name: '844x390', w: 844, h: 390, touch: true },
];
const SIZES = process.env.SIZES ? ALL_SIZES.filter((s) => process.env.SIZES.split(',').includes(s.name)) : ALL_SIZES;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (step) => !ONLY || ONLY.has(step);

try { await fetch(URL); } catch {
  console.log(`✗ no server at ${URL}`);
  process.exit(2);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const failures = [];

/**
 * Measure the page as it stands (runs in the page). `panels` and `bars` are the other boxes the
 * HUD must stay clear of; every box listed must sit inside the window. Returns the problems.
 */
function measure({ step, coarse, screenStep }) {
  const W = window.innerWidth, H = window.innerHeight;
  const vis = (n) => {
    if (!n) return false;
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !n.closest('[hidden]');
  };
  const boxes = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((n) => {
    const r = n.getBoundingClientRect();
    return { sel, cls: n.className && typeof n.className === 'string' ? n.className.split(' ').slice(0, 2).join('.') : n.tagName, x: r.left, y: r.top, r: r.right, b: r.bottom, n };
  });
  const fmt = (b) => `${b.cls}[${Math.round(b.x)},${Math.round(b.y)} → ${Math.round(b.r)},${Math.round(b.b)}]`;
  const hit = (a, b) => a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1;
  const out = [];
  // The HUD's cartouches: the left groups, the research row's chips, the right group's buttons.
  let hudL = boxes('.hud-left .hud-grp, .hud-left .hud-rs, .hud-left .hud-fold, .dbg-badge');
  const hudR = boxes('.hud-right > *:not(.hud-views), .hud-views .vbar');
  const hud = [...hudL, ...hudR];
  const panels = boxes('.inspector, .vpanel, .land, .qlog, .stockp, .purse');
  const bars = boxes('.bb-tabs, .bb-tray, .bb-hint');
  const screen = boxes('#screens > [data-open], .menu');
  // A full screen covers the rest: only it is measured (and the page's width).
  if (screenStep) { hud.length = 0; panels.length = 0; bars.length = 0; hudL.length = 0; hudR.length = 0; }
  // Everything inside the window (the deposit card too, when one is up: D99).
  const cards = boxes('.dcard');
  for (const b of [...hud, ...panels, ...bars, ...cards]) {
    if (b.x < -1 || b.y < -1 || b.r > W + 1 || b.b > H + 1) out.push(`outside the window: ${fmt(b)}`);
  }
  // The HUD's two sides apart, and the HUD clear of the panels and the bar.
  for (const a of hudL) for (const b of hudR) if (hit(a, b)) out.push(`HUD left over right: ${fmt(a)} × ${fmt(b)}`);
  for (const a of hud) for (const b of [...panels, ...bars]) if (hit(a, b)) out.push(`HUD over a panel: ${fmt(a)} × ${fmt(b)}`);
  for (const a of panels) for (const b of bars) if (hit(a, b)) out.push(`panel over the build bar: ${fmt(a)} × ${fmt(b)}`);
  // Panels apart (the inspector over a view's card is by design: the card hides).
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
    if (hit(panels[i], panels[j])) out.push(`panels overlap: ${fmt(panels[i])} × ${fmt(panels[j])}`);
  }
  // No page that scrolls sideways.
  const de = document.documentElement;
  if (de.scrollWidth > W + 1) out.push(`the page scrolls sideways: ${de.scrollWidth} > ${W}`);
  // A screen: its box in the window, its close button (✕ or « Jouer ») in reach.
  for (const s of screen) {
    if (s.r > W + 1 || s.x < -1) out.push(`screen wider than the window: ${fmt(s)}`);
    const x = [...s.n.querySelectorAll('.rs-close, .st-close, .cr-close, .scr-close, [data-close], .menu-btn')].filter(vis)[0];
    if (x) {
      const r = x.getBoundingClientRect();
      if (r.right > W + 1 || r.bottom > H + 1 || r.left < -1 || r.top < -1) out.push(`its close button is out of reach: ${x.className} [${Math.round(r.left)},${Math.round(r.top)}]`);
    }
  }
  // Touch: the HUD's and the build bar's hit targets at least 40 px both ways (a 2 px slack).
  if (coarse) {
    const targets = screenStep ? [] : boxes('.hud button, .hud [data-hud-purse], .bb-tab, .bb-slot, .bb-tray .btn, .vbar-btn, .insp-x, .vp-x, .land .insp-x');
    for (const b of targets) {
      const w = b.r - b.x, h = b.b - b.y;
      if (w < 38 || h < 38) out.push(`hit target under 40 px: ${fmt(b)} (${Math.round(w)}×${Math.round(h)})`);
    }
  }
  return { step, W, H, problems: [...new Set(out)] };
}

/** Real fingers on the canvas (CDP touch events become pointer events of type touch). */
async function touchStep(page, size, context) {
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const tag = `${size.name} touch`;
  const fail = (m) => { console.log(`✗ ${tag}: ${m}`); failures.push(`${tag}: ${m}`); };
  const cam = () => page.evaluate(() => window.FL.camera());
  // A tap on a kiln selects it (the inspector opens as a sheet).
  const at = await page.evaluate(() => {
    const sim = window.FL.app.sim;
    for (const e of sim.ents.sorted()) {
      const d = window.FL.entityAt(e.x, e.y);
      if (d && d.def === 'kiln' && e.builtAt === 0) { window.FL.lookAt(e.x, e.y, 1.2); return { id: e.id, x: e.x, y: e.y }; }
    }
    return null;
  });
  if (!at) return fail('no kiln');
  await page.waitForTimeout(500);
  const [sx, sy] = await page.evaluate(({ x, y }) => window.FL.tileToScreen(x + 1, y + 1), at);
  await touch('touchStart', [[sx, sy]]); await touch('touchEnd', []);
  await page.waitForTimeout(400);
  const sel = await page.evaluate(() => window.FL.selected());
  if (sel !== at.id) fail(`a tap selected #${sel}, not the kiln #${at.id}`);
  // The sheet's grip: a tap folds it to its header, another opens it half-way.
  const sheet = () => page.evaluate(() => document.querySelector('.inspector')?.getAttribute('data-sheet'));
  const gripAt = () => page.evaluate(() => { const r = document.querySelector('.inspector .sheet-grip')?.getBoundingClientRect(); return r && r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; });
  const grip = await gripAt();
  if (!grip) fail('no grip on the inspector');
  else {
    await touch('touchStart', [grip]); await touch('touchEnd', []);
    await page.waitForTimeout(300);
    if ((await sheet()) !== 'peek') fail(`a tap on the grip left the sheet ${await sheet()}`);
    if (SHOTS) await page.screenshot({ path: join(OUT, `resp-${size.name}-sheet-peek.png`) });
    await touch('touchStart', [await gripAt()]); await touch('touchEnd', []); // folded, the grip is lower
    await page.waitForTimeout(300);
    if ((await sheet()) !== 'half') fail(`a second tap left the sheet ${await sheet()}`);
    // Pulled up to the HUD: full height, still under the HUD.
    const g2 = await gripAt();
    await touch('touchStart', [g2]);
    for (let k = 1; k <= 10; k++) { await touch('touchMove', [[g2[0], Math.max(4, g2[1] - k * 60)]]); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
    await page.waitForTimeout(350);
    if ((await sheet()) !== 'full') fail(`pulled up, the sheet is ${await sheet()}`);
    const clear = await page.evaluate(() => document.querySelector('.inspector').getBoundingClientRect().top >= document.querySelector('.hud').getBoundingClientRect().bottom);
    if (!clear) fail('the full sheet covers the HUD');
    if (SHOTS) await page.screenshot({ path: join(OUT, `resp-${size.name}-sheet-full.png`) });
  }
  await page.evaluate(() => window.FL.selected(0));
  // One finger pans.
  const c0 = await cam();
  await touch('touchStart', [[200, 600]]);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', [[200 - k * 12, 600 - k * 8]]); await page.waitForTimeout(16); }
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  const c1 = await cam();
  if (Math.abs(c1.tx - c0.tx) + Math.abs(c1.ty - c0.ty) < 0.5) fail(`one finger did not pan (${JSON.stringify(c0)} → ${JSON.stringify(c1)})`);
  if (await page.evaluate(() => window.FL.selected())) fail('a pan selected something');
  // Two fingers spread: the camera zooms in.
  await touch('touchStart', [[150, 500], [240, 500]]);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', [[150 - k * 10, 500], [240 + k * 10, 500]]); await page.waitForTimeout(16); }
  await touch('touchEnd', []);
  await page.waitForTimeout(500);
  const c2 = await cam();
  if (!(c2.zoom > c1.zoom * 1.3)) fail(`a pinch did not zoom in (${c1.zoom} → ${c2.zoom})`);
  // A long press is the right button: the building in hand is put away.
  await page.evaluate(() => { window.FL.category('production'); });
  await page.waitForTimeout(700); // the morph to the plan view
  await page.evaluate(() => window.FL.tool('kiln'));
  await touch('touchStart', [[195, 420]]);
  await page.waitForTimeout(700);
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  const tool = await page.evaluate(() => window.FL.tool());
  if (tool) fail(`a long press left ${JSON.stringify(tool)} in hand`);
  await page.evaluate(() => { window.FL.category(null); window.FL.selected(0); });
  if (!failures.some((f) => f.startsWith(tag))) console.log(`✓ ${tag}`);
}

for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, locale: 'fr-FR',
    hasTouch: !!size.touch, isMobile: !!size.touch,
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => failures.push(`${size.name}: pageerror ${err.message}`));
  // ?debug: the debug bases on a production build too (app/screens.ts).
  await page.goto(`${URL}${URL.includes('?') ? '&' : '?'}debug`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 15000 });
  await page.evaluate(() => { if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
  const r = await page.evaluate(() => window.FL.debugSave('late'));
  if (!r.ok) { failures.push(`${size.name}: the late base refused (${JSON.stringify(r)})`); await context.close(); continue; }
  await page.evaluate(() => { window.FL.menu(false); window.FL.close(); window.FL.dayPhase('noon'); window.FL.tick(600); });
  await page.waitForTimeout(700);
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);

  const check = async (step, screenStep = false) => {
    await page.waitForTimeout(450); // two 4 Hz refreshes
    const m = await page.evaluate(measure, { step, coarse, screenStep });
    const tag = `${size.name} ${step}`;
    if (m.problems.length) {
      console.log(`✗ ${tag}`);
      for (const p of m.problems) { console.log(`    ${p}`); failures.push(`${tag}: ${p}`); }
    } else console.log(`✓ ${tag}`);
    if (SHOTS) await page.screenshot({ path: join(OUT, `resp-${size.name}-${step}.png`) });
  };
  const reset = async () => {
    await page.evaluate(() => { window.FL.close(); window.FL.selected(0); window.FL.mapView('normal'); window.FL.category(null); window.FL.view('iso'); });
    await page.waitForTimeout(300);
  };

  if (want('hud')) {
    await check('hud');
    // Narrow windows: the research row and the views fold under one button each; open, they drop down inside the window.
    for (const f of ['research', 'views']) {
      const btn = page.locator(`[data-hud-fold="${f}"]`);
      if (!(await btn.isVisible())) continue;
      await btn.click();
      await page.waitForTimeout(250);
      const box = await page.evaluate((k) => {
        const n = document.querySelector(k === 'research' ? '.hud-research' : '.hud-views .vbar');
        const r = n?.getBoundingClientRect();
        return r && r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom, W: innerWidth, H: innerHeight, open: document.querySelector('.hud')?.getAttribute('data-fold') } : null;
      }, f);
      const tag = `${size.name} fold:${f}`;
      if (!box) { console.log(`✗ ${tag}: nothing dropped down`); failures.push(`${tag}: nothing dropped down`); }
      else if (box.l < -1 || box.t < -1 || box.r > box.W + 1 || box.b > box.H + 1) { console.log(`✗ ${tag}: outside the window ${JSON.stringify(box)}`); failures.push(`${tag}: outside the window`); }
      else console.log(`✓ ${tag}`);
      if (SHOTS) await page.screenshot({ path: join(OUT, `resp-${size.name}-fold-${f}.png`) });
      await page.mouse.click(5, Math.round(size.h * 0.6)); // a tap elsewhere closes it
      await page.waitForTimeout(200);
      if (await page.evaluate(() => document.querySelector('.hud')?.hasAttribute('data-fold'))) { console.log(`✗ ${tag}: a tap elsewhere left it open`); failures.push(`${tag}: stays open`); }
      await page.evaluate(() => window.FL.selected(0));
    }
  }
  if (want('stock')) {
    // The Heart's stock behind its button (D96): closed by default; a click (a tap on touch) opens the panel, Esc closes it.
    const closed = await page.evaluate(() => document.querySelector('[data-screen="stock"]')?.hasAttribute('hidden'));
    if (!closed) { console.log(`✗ ${size.name} stock: the panel is open by default`); failures.push(`${size.name} stock: open by default`); }
    if (size.touch) await page.tap('[data-hud-stock]'); else await page.click('[data-hud-stock]');
    await check('stock');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    if (!(await page.evaluate(() => document.querySelector('[data-screen="stock"]')?.hasAttribute('hidden')))) { console.log(`✗ ${size.name} stock: Esc left it open`); failures.push(`${size.name} stock: Esc`); }
  }
  if (want('purse')) {
    // What the purse's ◉/h is made of (D102): a lease rented first (the late base has orders and research), then the card by a click (a tap), Esc closes it.
    await page.evaluate(() => {
      const sim = window.FL.app.sim;
      if (sim.land.leases.size) return;
      for (const [dx, dy] of [[2, 0], [0, 2], [-2, 0], [0, -2], [2, 2]]) { const p = window.FL.parcel(dx, dy).p; if (sim.rentLand(p) === null) return; }
    });
    // Ten game minutes one at a time: the HUD samples the purse's journal each minute.
    for (let m = 0; m < 10; m++) { await page.evaluate(() => window.FL.tick(600)); await page.waitForTimeout(120); }
    if (size.touch) await page.tap('[data-hud-purse]'); else await page.click('[data-hud-purse]');
    await check('purse');
    // The tokens' line goes to the tree, on the running project: its tokens now (a minute, ◉, the servers' share).
    if (await page.isVisible('.purse-line[data-flow="tokens"]')) {
      await page.click('.purse-line[data-flow="tokens"]');
      await page.waitForTimeout(500);
      const ok = await page.evaluate(() => window.FL.screen() === 'research' && !!document.querySelector('.rs-detail .rs-toknow'));
      if (!ok) { console.log(`✗ ${size.name} purse: the tokens' line did not open the tree on a running project`); failures.push(`${size.name} purse: tokens line`); }
      if (SHOTS) await page.screenshot({ path: join(OUT, `resp-${size.name}-tree-tokens.png`) });
      // The Compute Plan's comparison beside its switch (the plan learnt in a rig: shots only).
      await page.evaluate(() => { const sim = window.FL.app.sim; sim.done.add('cm_plan'); sim.rebuildDerived(); });
      await page.waitForTimeout(500);
      if (SHOTS) await page.screenshot({ path: join(OUT, `resp-${size.name}-tree-plan.png`) });
      await page.evaluate(() => window.FL.close());
      if (size.touch) await page.tap('[data-hud-purse]'); else await page.click('[data-hud-purse]');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    if (!(await page.evaluate(() => document.querySelector('[data-screen="purse"]')?.hasAttribute('hidden')))) { console.log(`✗ ${size.name} purse: Esc left it open`); failures.push(`${size.name} purse: Esc`); }
  }
  if (want('tutpurse')) {
    // The purse on a tutorial-stage base (D102): the « tutorial » debug base, a standing order and a
    // research running (made so if it has none), half an hour of play minute by minute (the HUD
    // samples the purse's journal each minute), then the card.
    const setup = await page.evaluate(() => {
      window.FL.debugSave('tutorial'); window.FL.menu(false); window.FL.close();
      const sim = window.FL.app.sim;
      const post = sim.tradePosts()[0];
      if (post && !sim.trade.orders.length) sim.addImport(post.id, 'copper_ore', 4, 100_000);
      return { post: post?.id ?? 0, orders: sim.trade.orders.length };
    });
    // A research ready in the tree, started if none runs.
    if (!(await page.evaluate(() => window.FL.app.sim.projects.length))) {
      await page.evaluate(() => window.FL.open('research'));
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        for (const n of document.querySelectorAll('.tr-node[data-kind="research"][data-state="ready"]')) if (window.FL.research(n.getAttribute('data-id')).ok) break;
        window.FL.close();
      });
    }
    setup.projects = await page.evaluate(() => window.FL.app.sim.projects.map((p) => p.id));
    console.log(`    tutorial base: ${JSON.stringify(setup)}`);
    for (let m = 0; m < 30; m++) { await page.evaluate(() => window.FL.tick(600)); await page.waitForTimeout(120); }
    if (size.touch) await page.tap('[data-hud-purse]'); else await page.click('[data-hud-purse]');
    await check('tutpurse');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.FL.debugSave('late'); window.FL.menu(false); window.FL.close(); });
    await page.waitForTimeout(300);
  }
  if (want('insp')) {
    // The kiln nearest the Heart, framed and selected.
    await page.evaluate(() => {
      const sim = window.FL.app.sim;
      let best = 0, bd = Infinity;
      for (const e of sim.ents.sorted()) {
        const d = window.FL.entityAt(e.x, e.y);
        if (!d || d.def !== 'kiln' || e.builtAt !== 0) continue;
        const dd = (e.x - 512) ** 2 + (e.y - 512) ** 2;
        if (dd < bd) { bd = dd; best = e.id; }
      }
      const e = sim.ents.get(best);
      if (e) { window.FL.lookAt(e.x, e.y, 1.1); window.FL.selected(best); }
    });
    await check('insp');
    await reset();
  }
  if (want('build')) {
    await page.evaluate(() => window.FL.category('production'));
    await check('build');
    await reset();
  }
  if (want('view')) {
    await page.evaluate(() => window.FL.mapView('power'));
    await check('view');
    await reset();
  }
  if (want('land')) {
    await page.evaluate(() => window.FL.mapView('land'));
    await check('land');
    await reset();
  }
  for (const s of ['research', 'stats', 'market', 'expertise']) {
    if (!want(s)) continue;
    await page.evaluate((id) => window.FL.open(id), s);
    await page.waitForTimeout(400);
    await check(s, true);
    await reset();
  }
  if (want('touch') && size.touch && size.name === '390x844') await touchStep(page, size, context);
  if (want('quests')) {
    await page.evaluate(() => { window.FL.debugSave('survey'); window.FL.menu(false); window.FL.close(); });
    await page.waitForTimeout(600);
    await check('quests');
    await page.evaluate(() => {
      const sim = window.FL.app.sim;
      const e = sim.ents.sorted().find((x) => window.FL.entityAt(x.x, x.y)?.def === 'drill');
      if (e) { window.FL.lookAt(e.x, e.y, 1.2); window.FL.selected(e.id); }
    });
    await check('quests-insp');
    await page.evaluate(() => { window.FL.selected(0); window.FL.debugSave('late'); window.FL.menu(false); window.FL.close(); });
    await page.waitForTimeout(400);
  }
  if (want('menu')) {
    await page.evaluate(() => window.FL.menu(true, 'settings'));
    await check('menu', true);
    await page.evaluate(() => window.FL.menu(false));
  }
  if (want('forecast')) {
    // « Avant de partir » (a menu page): its 1 h run computed on a copy, then measured.
    await page.evaluate(() => window.FL.menu(true, 'forecast'));
    await page.waitForTimeout(1500);
    await check('forecast', true);
    await page.evaluate(() => window.FL.menu(false));
  }
  await context.close();
}

await browser.close();
if (failures.length) console.log(`\n${failures.length} problem(s):\n  ${failures.join('\n  ')}`);
else console.log('\nall sizes clean');
process.exit(failures.length ? 1 : 0);
