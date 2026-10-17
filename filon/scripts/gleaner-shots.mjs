// gleaner-shots.mjs — the Gleaners (D103) for review, the whole act by night: on the grown debug base
// (its quartz line home crosses the desert floor), the game paused and stepped tick by tick to a try
// the sim really makes — a Gleaner out of the dunes, up to the line, the grab (the item off the belt
// into its hand), the carry-away — at near and mid zoom, and from afar as small moving lights; the
// Logistique view's night marks; a stretch of the line fenced in, with one prowling outside; the
// late base's glazed lines by day and by night, with one tapping the glass; the first-night card and
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

// A try that takes something, stepped through: out of the dunes, up to the line, the grab, the carry-away.
let caught = null;
for (let attempt = 0; attempt < 30 && !caught; attempt++) {
  const g = await page.evaluate(() => window.FL.gleaners());
  const next = g.next.find((t) => t.tick - g.tick > 110);
  if (!next) { await tick(200); continue; }
  const t0 = next.tick;
  await tick(t0 - 100 - (await now()));
  await look([next.x, next.y], 1.7);
  await settle(700);
  await snap('shot-gleaners-seq-1-out.png');
  await tick(t0 - 45 - (await now()));
  await settle(300);
  await snap('shot-gleaners-seq-2-up.png');
  await tick(t0 - (await now()));
  await settle(300);
  await snap('shot-gleaners-seq-3-reach.png');
  await tick(1); // the try itself
  const took = await page.evaluate(([x, y, t]) => { const r = window.FL.app.sim.gleaners.recent; for (let i = 0; i + 2 < r.length; i += 3) if (r[i] === y * 1024 + x && r[i + 2] === t) return window.FL.app.sim.gleaners.recent[i + 1]; return null; }, [next.x, next.y, t0]);
  console.log(`try at ${t0} on ${next.x},${next.y}: ${took === null ? 'nothing taken' : `took item ${took}`}`);
  if (took === null) continue;
  caught = { ...next, item: took };
  await tick(t0 + 4 - (await now()));
  await settle(300);
  await snap('shot-gleaners-seq-4-grab.png');
  await tick(t0 + 30 - (await now()));
  await settle(300);
  await snap('shot-gleaners-seq-5-carry.png');
  await look([next.x, next.y], 0.85);
  await settle(500);
  await snap('shot-gleaners-seq-5-carry-mid.png');
  await look([next.x, next.y], 0.35);
  await settle(500);
  await snap('shot-gleaners-seq-5-carry-far.png');
  await look([next.x, next.y], 1.7);
  await tick(t0 + 65 - (await now()));
  await settle(300);
  await snap('shot-gleaners-seq-6-away.png');
}
if (!caught) console.log('✗ no theft caught in 30 tries');
// The same act at mid zoom: the next try, its approach and (if it takes) its carry.
{
  const g = await page.evaluate(() => window.FL.gleaners());
  const next = g.next.find((t) => t.tick - g.tick > 110);
  if (next) {
    await look([next.x, next.y], 0.85);
    await tick(next.tick - 40 - (await now()));
    await settle(600);
    await snap('shot-gleaners-mid-approach.png');
    await tick(next.tick + 25 - (await now()));
    await settle(300);
    await snap('shot-gleaners-mid-after.png');
  }
}

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
// On to its first tap (70 ticks into its visit), the glint on the glass.
if (tap) { await tick(Math.round(71 - tap[2])); await look(tap, 1.7); }
await settle(800);
console.log('figures by the glass', tap);
await snap('shot-gleaners-glazed-night.png');
await view('plan');
await settle(600);
await snap('shot-gleaners-glazed-plan.png');
await page.evaluate(() => { window.FL.resume(); window.FL.debugSave(null); });
await browser.close();
