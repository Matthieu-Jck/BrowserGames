// blueprint-shots.mjs — blueprints (D154) on the late debug base, for visual review, in French and in
// English: the copy tool's box mid-drag (plan), a paste's ghost with pieces that go and pieces that
// do not and its cost against the Core (plan and iso), a paste the Core cannot pay (the chips in
// coral), the library's panel with the copy in hand and three blueprints saved, and the upgrade
// tool's preview over ribbons. Then the browser's side of a big paste: about 200 pieces copied,
// taken down and pasted back, the longest frame after the click (the views rebuilt) against the
// frames before. Usage: a server of this tree (dev on 5183, or a frozen `vite preview`), then
// `URL=http://localhost:5360 node scripts/blueprint-shots.mjs` → scripts/blueprint-*.png (gitignored).
// Env: URL, CHROME, PREFIX (default `blueprint`).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const URL = process.env.URL ?? 'http://localhost:5183';
const PREFIX = process.env.PREFIX ?? 'blueprint';
const shot = (name) => fileURLToPath(new globalThis.URL(`./${PREFIX}-${name}.png`, import.meta.url));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'fr-FR' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => { errors.push(err.message); console.log('pageerror:', err.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('console:', m.text()); } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 20000 });
await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 10000 });
await page.evaluate(() => { if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
const r = await page.evaluate(() => window.FL.debugSave('late'));
console.log(`late base: ${r.ok ? `${r.ms} ms` : 'refused'}`);
await page.evaluate(() => { window.FL.menu(false); window.FL.close(); window.FL.dayPhase('noon'); window.FL.tick(600); });

const FL = (fn, arg) => page.evaluate(fn, arg);
const tileXY = (tx, ty) => FL(([a, b]) => window.FL.tileToScreen(a, b), [tx, ty]);
const settle = async (ms = 900) => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const plan = async () => { await FL(() => window.FL.view('plan')); await page.waitForFunction(() => window.FL.view().t === 1, undefined, { timeout: 4000 }).catch(() => {}); };
const iso = async () => { await FL(() => window.FL.view('iso')); await page.waitForFunction(() => window.FL.view().t === 0, undefined, { timeout: 4000 }).catch(() => {}); };

// The busiest 14 × 10 box of production buildings near the Core: what a player would copy.
const area = await FL(() => {
  const sim = window.FL.app.sim, ids = window.FL.ids().buildings;
  const prod = [...sim.ents.map.values()].filter((e) => /smelter|kiln|mill|workshop|oven|press|furnace|bench/.test(ids[e.def]));
  let best = null;
  for (const e of prod) {
    const x0 = e.x - 2, y0 = e.y - 2, x1 = x0 + 13, y1 = y0 + 9;
    const n = prod.filter((o) => o.x >= x0 && o.y >= y0 && o.x <= x1 && o.y <= y1).length;
    if (!best || n > best.n) best = { n, box: [x0, y0, x1, y1] };
  }
  return best;
});
console.log(`copy box: ${JSON.stringify(area)}`);
const [x0, y0, x1, y1] = area.box;

for (const L of ['fr', 'en']) {
  await FL((l) => window.FL.setLocale(l), L);
  await FL(() => { window.FL.tool(null); window.FL.selected(0); window.FL.app.library.toggle(false); window.FL.category('production'); });
  await plan();
  await FL(([x, y]) => window.FL.lookAt(x, y, 0.85), [(x0 + x1) / 2 + 8, (y0 + y1) / 2 + 2]);
  await settle();
  // 1. The copy tool's box, mid-drag.
  await page.keyboard.press('Control+c');
  const [ax, ay] = await tileXY(x0, y0), [bx, by] = await tileXY(x1, y1);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 8 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: shot(`copy-${L}`) });
  await page.mouse.up();
  const held = await FL(() => window.FL.blueprint());
  console.log(`✓ ${PREFIX}-copy-${L}.png (${held.paste?.pieces} pieces in hand)`);
  // 2. The paste's ghost turned a quarter, half over the copied buildings (refused there), the rest on open ground.
  await page.keyboard.press('r');
  const [px, py] = await tileXY(x1 + 2, (y0 + y1) / 2);
  await page.mouse.move(px, py, { steps: 4 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot(`paste-plan-${L}`) });
  const pl = await FL(() => window.FL.blueprint().plan);
  console.log(`✓ ${PREFIX}-paste-plan-${L}.png (${JSON.stringify(pl)})`);
  if (L === 'fr') {
    // Laid (what it lacks granted for the shot: sandbox), seen in iso — the tools work on the plan side
    // only (D6), so the iso view shows a paste once it stands — then taken back with Ctrl+Z.
    await FL(() => { const sim = window.FL.app.sim; for (let i = 0; i < sim.stock.length; i++) sim.stock[i] = Math.max(sim.stock[i], 500000); });
    await page.waitForTimeout(150);
    await page.mouse.click(px, py);
    const laid = await FL(() => window.FL.toasts().slice(-1)[0]);
    await iso();
    await settle(900);
    await page.screenshot({ path: shot('pasted-iso-fr') });
    console.log(`✓ ${PREFIX}-pasted-iso-fr.png (${laid})`);
    await plan();
    await settle(400);
    await page.screenshot({ path: shot('pasted-plan-fr') });
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    console.log(`✓ ${PREFIX}-pasted-plan-fr.png, undone: ${await FL(() => window.FL.toasts().slice(-1)[0])}`);
  }
  // 3. A paste the Core cannot pay: its plates set aside for the shot (sandbox), the chips in coral.
  const kept = await FL(() => { const sim = window.FL.app.sim, i = window.FL.itemIndex('iron_plate'), v = sim.stock[i]; sim.stock[i] = 0; return v; });
  await page.mouse.move(px + 40, py + 30, { steps: 3 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot(`paste-short-${L}`) });
  await FL((v) => { window.FL.app.sim.stock[window.FL.itemIndex('iron_plate')] = v; }, kept);
  console.log(`✓ ${PREFIX}-paste-short-${L}.png`);
  // 4. The library: three saved (by the Sim's command, as « Enregistrer » does), the copy in hand to save.
  await FL((B) => {
    const sim = window.FL.app.sim;
    if (sim.blueprints.length) return;
    const a = sim.capture(B[0], B[1], B[2], B[3]); if (a) sim.saveBlueprint(a, 'Rangée de fonderies');
    const b = sim.capture(B[0], B[1], B[0] + 5, B[1] + 4); if (b) sim.saveBlueprint(b, 'Petit coin');
    const c = sim.capture(B[0] + 6, B[1], B[2], B[3]); if (c) sim.saveBlueprint(c, 'Moitié est');
  }, area.box);
  await page.keyboard.press('k');
  await page.waitForTimeout(500);
  // The notices' cards (an order of the Crier…) sit over the side panels' corner: set aside for the shot.
  await FL(() => { const n = document.querySelector('.notices'); if (n) n.style.visibility = 'hidden'; });
  await page.screenshot({ path: shot(`library-${L}`) });
  await page.locator('[data-screen="blueprints"]').screenshot({ path: shot(`library-panel-${L}`) });
  console.log(`✓ ${PREFIX}-library-${L}.png`);
  await FL(() => { const n = document.querySelector('.notices'); if (n) n.style.visibility = ''; });
  await page.keyboard.press('k');
  // 5. The upgrade tool over a stretch of ribbons, mid-drag.
  await page.keyboard.press('Escape');
  const rib = await FL(() => {
    const sim = window.FL.app.sim, ids = window.FL.ids().buildings;
    let best = null;
    for (const e of sim.ents.map.values()) {
      if (ids[e.def] !== 'ribbon') continue;
      let n = 0;
      for (const o of sim.ents.map.values()) if (ids[o.def] === 'ribbon' && Math.abs(o.x - e.x) <= 4 && Math.abs(o.y - e.y) <= 3) n++;
      if (!best || n > best.n) best = { n, x: e.x, y: e.y };
      if (best.n > 30) break;
    }
    return best;
  });
  await page.keyboard.press('n');
  const tool = await FL(() => window.FL.tool());
  if (rib && tool?.k === 'upgrade') {
    await FL(([x, y]) => window.FL.lookAt(x, y, 1.1), [rib.x, rib.y]);
    await settle(500);
    const [ux, uy] = await tileXY(rib.x - 4, rib.y - 3), [vx, vy] = await tileXY(rib.x + 4, rib.y + 3);
    await page.mouse.move(ux, uy);
    await page.mouse.down();
    await page.mouse.move(vx, vy, { steps: 6 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot(`upgrade-${L}`) });
    const up = await FL(() => window.FL.blueprint().plan);
    await page.keyboard.press('Escape'); // drop the drag, nothing upgraded
    await page.mouse.up();
    console.log(`✓ ${PREFIX}-upgrade-${L}.png (${JSON.stringify(up)})`);
  } else console.log(`- no upgrade shot: ${JSON.stringify({ rib, tool })}`);
  await page.keyboard.press('Escape');
}

// The browser's side of a big paste: ~200 pieces copied, taken down (refunded) and pasted back.
await FL(() => { window.FL.setLocale('fr'); window.FL.tool(null); window.FL.app.library.toggle(false); });
const big = await FL(() => {
  const sim = window.FL.app.sim;
  let B = null;
  for (let r = 6; r < 60 && !B; r++) {
    const ids = new Set();
    for (let y = 512 - r; y <= 512 + r; y++) for (let x = 512 - r; x <= 512 + r; x++) { const e = sim.entityAt(x, y); if (e && e.id !== sim.hearthId) ids.add(e.id); }
    if (ids.size >= 200) B = [512 - r, 512 - r, 512 + r, 512 + r];
  }
  const bp = sim.capture(...B);
  const ents = [];
  for (let y = B[1]; y <= B[3]; y++) for (let x = B[0]; x <= B[2]; x++) { const e = sim.entityAt(x, y); if (e && e.id !== sim.hearthId && !ents.includes(e)) ents.push(e); }
  const ox = Math.min(...ents.map((e) => e.x)), oy = Math.min(...ents.map((e) => e.y));
  for (const e of ents) sim.remove(e.x, e.y);
  return { n: bp.pieces.length, cx: ox + Math.floor((bp.w - 1) / 2), cy: oy + Math.floor((bp.h - 1) / 2), box: B, w: bp.w, h: bp.h, bp };
});
await FL(() => window.FL.category('production'));
await plan();
await FL(([x, y]) => window.FL.lookAt(x, y, 0.55), [big.cx, big.cy]);
await FL(() => window.FL.clock && window.FL.clock('live'));
await settle(1200);
const perf = await FL(async () => {
  const out = []; let last = performance.now();
  for (let i = 0; i < 30; i++) { await new Promise((res) => requestAnimationFrame(res)); const now = performance.now(); out.push(now - last); last = now; }
  return { before: out };
});
// Take the blueprint in hand, let the ghost settle on the spot, then click.
await FL((bp) => { window.FL.app.tools.clipboard = bp; window.FL.app.build.paste(bp); }, big.bp);
const [gx, gy] = await tileXY(big.cx, big.cy);
await page.mouse.move(gx, gy, { steps: 3 });
await page.waitForTimeout(600);
const ghost = await FL(async () => {
  const out = []; let last = performance.now();
  for (let i = 0; i < 20; i++) { await new Promise((res) => requestAnimationFrame(res)); const now = performance.now(); out.push(now - last); last = now; }
  return out;
});
await page.screenshot({ path: shot('big-ghost') });
const after = await FL(async ([x, y]) => {
  const app = window.FL.app;
  const t0 = performance.now();
  const res = app.tools.down(x, y, 0);
  app.build.report(res);
  const click = performance.now() - t0;
  const out = []; let last = performance.now();
  for (let i = 0; i < 30; i++) { await new Promise((r) => requestAnimationFrame(r)); const now = performance.now(); out.push(now - last); last = now; }
  return { res, click, frames: out };
}, [big.cx, big.cy]);
await page.waitForTimeout(500);
await page.screenshot({ path: shot('big-pasted') });
const max = (a) => Math.max(...a).toFixed(1), med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1].toFixed(1);
console.log(`big paste: ${big.n} pieces · ${JSON.stringify(after.res)} · the click's own work ${after.click.toFixed(1)} ms · frames before: median ${med(perf.before)} ms, max ${max(perf.before)} · ghost in hand: median ${med(ghost)}, max ${max(ghost)} · after the click: median ${med(after.frames)}, max ${max(after.frames)} (first ${after.frames[0].toFixed(1)}, second ${after.frames[1].toFixed(1)})`);
console.log(errors.length ? `✗ ${errors.length} page errors` : '✓ no page error');
await browser.close();
