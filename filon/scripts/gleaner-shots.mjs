// gleaner-shots.mjs — the Gleaners (D103, D112) for review, the whole raid by night: on the grown
// debug base (its quartz line home crosses the desert floor), the game paused and stepped tick by
// tick through a raid the sim really makes — the group out of the dunes, waiting at its posts, an arm
// out over the line, the grab (the item off the belt into a hand), the group away with what it took —
// at near and mid zoom, and from afar as small moving lights; the Logistique view's night marks; a
// stretch of the line fenced in, with two pacing outside; the late base's glazed lines by day and by
// night, a few tapping the glass; the first-night card and
// the morning report in French and English; a ribbon's inspector: scripts/shot-gleaners-*.png
// (gitignored). Usage: a server (default :5183; URL=… for another), then `node scripts/gleaner-shots.mjs`.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./${name}`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=1&debug`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
const HIDE = '.qlog, .guide, .hud, .buildbar, .toasts, .nnotice, [data-screen="quests"], [data-screen="night"], [data-screen="gleaners"] { display: none !important; }';
let hidden = null;
const hideUi = async (on = true) => {
  if (hidden) { await hidden.evaluate((n) => n.remove()); hidden = null; }
  if (on) hidden = await page.addStyleTag({ content: HIDE });
};

const settle = async (ms = 900) => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};
const snap = async (name) => { await page.screenshot({ path: shot(name) }); console.log(`✓ ${name}`); };
const look = (at, zoom) => page.evaluate(([x, y, z]) => window.FL.lookAt(x, y, z), [at[0], at[1], zoom]);
const tick = (n) => page.evaluate((k) => { if (k > 0) window.FL.tick(k); }, n);
const now = () => page.evaluate(() => window.FL.app.sim.tick);

// ── the grown base by night ──────────────────────────────────────────────────
const lvl = await page.evaluate(() => window.FL.debugSave('grown'));
console.log('debug base', JSON.stringify({ ok: lvl.ok, ms: lvl.ms }));
await hideUi();
await view('iso');
await page.evaluate(() => { window.FL.pause(); window.FL.dayPhase(null); window.FL.gleaners({ toNight: 2 }); window.FL.tick(400); });

// A raid stepped through (D112), shot at near (1.7) and mid (0.85) zoom at each stop: the group
// gliding in out of the dunes, waiting at its posts, an arm out over the line, the grab (the item
// off the belt into a hand, at the tick the sim took it), carrying, and the group going away.
const both = async (name, at, ms = 300) => {
  await look(at, 1.7); await settle(ms); await snap(`shot-gleaners-seq-${name}.png`);
  await look(at, 0.85); await settle(ms); await snap(`shot-gleaners-seq-${name}-mid.png`);
};
let caught = null, reached = false;
for (let attempt = 0; attempt < 10 && !caught; attempt++) {
  // A raid ahead that falls in the night from its arrival to its end, a band of three or more if there is one.
  const raid = await page.evaluate(() => {
    const g = window.FL.gleaners(), sim = window.FL.app.sim;
    const ok = g.raids.filter((r) => r.at - g.tick > 180 && sim.gleanNight(r.at - 200) && sim.gleanNight(r.at + 800));
    return ok.find((r) => r.posts.length >= 3) ?? ok[0] ?? null;
  });
  if (!raid) {
    await page.evaluate(() => { const s = window.FL.app.sim; if (s.gleanNight()) window.FL.tick(1200); else window.FL.gleaners({ toNight: 0.5 }); });
    continue;
  }
  const t0 = raid.at, at = [raid.x, raid.y];
  console.log(`raid at ${t0} on ${raid.x},${raid.y}: ${raid.posts.length} posts`);
  await tick(t0 - 120 - (await now()));
  await both('1-arrive', at, 700);
  await tick(t0 - 30 - (await now()));
  await both('2-gather', at);
  await tick(t0 + 8 - (await now()));
  await both('3-wait', at);
  // On tick by tick to the first take on this raid's posts.
  const keys = raid.posts.map(([x, y]) => y * 1024 + x);
  let take = null;
  for (let k = 0; k < 600 && !take; k += 1) {
    await tick(1);
    take = await page.evaluate(([ks, from]) => { const r = window.FL.app.sim.gleaners.recent; for (let i = 0; i + 2 < r.length; i += 3) if (ks.includes(r[i]) && r[i + 2] >= from) return [r[i], r[i + 1], r[i + 2]]; return null; }, [keys, t0]);
    if (!take && k % 5 === 0) {
      const f = await page.evaluate(() => window.FL.gleaners());
      if (f.reaching > 0 && !reached) { await look(at, 1.7); await settle(250); await snap('shot-gleaners-seq-4-reach.png'); reached = true; }
    }
  }
  if (!take) { console.log('  no take this raid'); continue; }
  const [tile, item, T] = take;
  const tx = tile & 1023, ty = tile >> 10;
  console.log(`  took item ${item} at ${T} on ${tx},${ty}`);
  caught = { x: tx, y: ty, item, T };
  // The grab: the belt's token gone, the item riding the arm back into the hand.
  await tick(T + 2 - (await now()));
  await both('5-grab', [tx, ty], 250);
  await tick(T + 7 - (await now()));
  await both('6-grab', [tx, ty], 250);
  await tick(T + 20 - (await now()));
  await both('7-holding', at, 250);
  // On to the band leaving: 40 ticks after every post has taken (the view's LINGER), or at the raid's end (600).
  const leaveAt = () => page.evaluate(([ks, from]) => {
    const r = window.FL.app.sim.gleaners.recent, got = new Map();
    for (let i = 0; i + 2 < r.length; i += 3) if (ks.includes(r[i]) && r[i + 2] >= from && r[i + 2] < from + 600) got.set(r[i], r[i + 2]);
    return got.size === ks.length ? Math.max(...got.values()) + 40 : null;
  }, [keys, t0]);
  let leave = await leaveAt();
  while (!leave && (await now()) < t0 + 600) { await tick(10); leave = await leaveAt(); }
  leave ??= t0 + 600;
  console.log(`  leaving at ${leave} (${leave - t0} into the raid)`);
  await tick(leave - (await now()));
  await tick(25);
  await both('8-leave', at, 300);
  await tick(75);
  await both('9-away', at, 300);
  await look(at, 0.35); await settle(400); await snap('shot-gleaners-seq-9-away-far.png');
}
if (!caught) console.log('✗ no take caught');
if (process.env.ONLY === 'raid') { await browser.close(); process.exit(0); } // the raid alone, for quick looks

// The Logistique view: the night's marks.
const at = caught ? [caught.x, caught.y] : (await page.evaluate(() => window.FL.gleaners().exposedTiles[0]));
await page.evaluate(([x, y]) => { window.FL.lookAt(x, y, 0.9); window.FL.mapView('logistics'); }, at);
await hideUi(false);
await settle(1200);
await snap('shot-gleaners-logistics.png');

// A stretch of the line fenced in: a box round it, two tiles off each side, the ribbon its gate; one prowls outside.
const box = await page.evaluate(([x, y]) => {
  const sim = window.FL.app.sim;
  window.FL.unlock('xp_guard');
  sim.grant('iron_plate', 200);
  const e = sim.entityAt(x, y);
  const along = e && (e.rot & 1) === 0 ? 'y' : 'x';
  const [x0, x1, y0, y1] = along === 'y' ? [x - 3, x + 3, y - 5, y + 5] : [x - 5, x + 5, y - 3, y + 3];
  let n = 0;
  for (let i = x0; i <= x1; i++) for (const j of [y0, y1]) if (sim.place('fence', i, j, 0).ok) n++;
  for (let j = y0 + 1; j < y1; j++) for (const i of [x0, x1]) if (sim.place('fence', i, j, 0).ok) n++;
  sim.ensureCompiled();
  return { n, exposed: sim.graph.glean.exposed.length, guarded: sim.graph.glean.guarded.length, prowl: sim.graph.glean.prowl.length };
}, at);
console.log('fenced', JSON.stringify(box));
await tick(2);
await settle(1000);
await snap('shot-gleaners-fenced-logistics.png');
await page.evaluate(() => window.FL.mapView('normal'));
await hideUi();
await look(at, 1.2);
await look(at, 0.8);
// A prowler at the start of its visit ([x, y, phase]), then on into its pacing along the fence.
let prowl = null;
for (let k = 0; k < 300 && !prowl; k++) {
  await tick(17); await page.waitForTimeout(40);
  const p = await page.evaluate(() => window.FL.app.gleaners.prowlAt_);
  if (p && p[2] < 40) prowl = p;
}
if (prowl) { await tick(Math.round(120 - prowl[2])); await look(prowl, 1.5); }
await settle(800);
console.log('figures by the fence', prowl);
await snap('shot-gleaners-fenced-night.png');
await page.evaluate(() => window.FL.dayPhase('noon'));
await settle(800);
await snap('shot-gleaners-fenced-day.png');
await page.evaluate(() => window.FL.dayPhase(null));

// ── the cards: the first night, the morning report; French then English ─────
await hideUi(false);
await page.evaluate(() => { window.FL.selected(0); window.FL.gleaners({ card: 'night' }); });
await page.waitForTimeout(600);
await snap('shot-gleaners-card-night.png');
await page.evaluate(() => window.FL.gleaners({ card: 'dawn' }));
await page.waitForTimeout(600);
await snap('shot-gleaners-card-dawn.png');
await page.evaluate(() => { window.FL.setLocale('en'); window.FL.gleaners({ card: 'dawn' }); });
await page.waitForTimeout(600);
await snap('shot-gleaners-card-dawn-en.png');
await page.evaluate(() => window.FL.gleaners({ card: 'night' }));
await page.waitForTimeout(600);
await snap('shot-gleaners-card-night-en.png');
await page.evaluate(() => { window.FL.gleaners({ card: null }); window.FL.setLocale('fr'); });

// The ribbon's inspector: « Exposé la nuit ».
const rib = await page.evaluate(() => window.FL.gleaners().exposedTiles[0]);
if (rib) {
  await page.evaluate(([x, y]) => { const e = window.FL.entityAt(x, y); if (e) window.FL.selected(e.id); window.FL.lookAt(x, y, 1.4); }, rib);
  await settle(800);
  await snap('shot-gleaners-inspector.png');
  await page.evaluate(() => window.FL.selected(0));
}

// ── the late base: its desert lines under glass, by day; by night one taps the glass ────
const late = await page.evaluate(() => window.FL.debugSave('late'));
console.log('late', JSON.stringify({ ok: late.ok, ms: late.ms }));
await hideUi();
await page.evaluate(() => window.FL.pause());
const lg = await page.evaluate(() => window.FL.gleaners());
console.log('late gleaners', JSON.stringify({ exposed: lg.exposed, guarded: lg.guarded }));
const glass = lg.guardedTiles[Math.floor(lg.guardedTiles.length / 2)] ?? [512, 512];
await view('iso');
await page.evaluate(() => window.FL.dayPhase('noon'));
await look(glass, 2.0);
await settle(1200);
await snap('shot-gleaners-glazed-day.png');
await page.evaluate(() => { window.FL.dayPhase(null); window.FL.gleaners({ toNight: 1 }); });
await look(glass, 1.3);
let tap = null;
await look(glass, 0.8);
for (let k = 0; k < 300 && !tap; k++) {
  await tick(17); await page.waitForTimeout(40);
  const p = await page.evaluate(() => window.FL.app.gleaners.tapAt_);
  if (p && p[2] < 50) tap = p;
}
// On to the first tap (75 ticks into the visit), the glint on the glass.
if (tap) { await tick(Math.round(76 - tap[2])); await look(tap, 1.7); }
await settle(800);
console.log('figures by the glass', tap);
await snap('shot-gleaners-glazed-night.png');
await view('plan');
await settle(600);
await snap('shot-gleaners-glazed-plan.png');
await page.evaluate(() => { window.FL.resume(); window.FL.debugSave(null); });
await browser.close();
