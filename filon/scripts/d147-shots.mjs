// d147-shots.mjs — D147's review shots (owner, 2026-10-19: « make this mountain in the cirque more
// natural looking, and in an area of the desert around the cirque put lots of very small but tall
// mountains that will seem like big spiky mountains »): the spring's mesa in the cirque from the
// owner's angle (iso near and mid, noon, dusk and night, and in plan), and the field of rock spires
// (map 6) from afar, mid and close, at noon, at night and at dawn, and in plan; then the frame times
// with each in view. Writes <OUT>/d147-<TAG>-<name>.png (OUT defaults to scripts/, gitignored).
// Usage: a server (URL=…, default :5183), then `TAG=after node scripts/d147-shots.mjs`.
// Env: ONLY=name,… (substrings), SEED (the sandbox's, 2), FIELD=x,y (the spire field's middle, for a
// build without one: the "before" of the same ground), PERF=0 to skip the frame times, DPR (1).
// It starts the sandbox base over (FL.wipe: today's map).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const TAG = process.env.TAG ?? 'after';
const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('.', import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const shot = (name) => join(OUT, `d147-${TAG}-${name}.png`);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: Number(process.env.DPR ?? 1), locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=${process.env.SEED ?? '2'}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
await page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts, [data-screen="quests"] { display: none !important; }' });

const settle = async (ms = 1200) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => console.log('  (chunks still missing)'));
  await page.waitForFunction(() => (window.FL.app.relief?.pending ?? 0) === 0, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

// The spots: the spring's summit (map 4 on: its head tile), the spire field's middle (map 6) or the
// ground given in FIELD.
const spots = await page.evaluate((field) => {
  const sim = window.FL.app.sim, src = sim.grid.source, out = { mapV: src.mapV ?? 1 };
  if (src.spring) out.mesa = [src.spring.x, src.spring.y];
  const f = src.spireField;
  if (f) out.field = [f.x, f.y, f.r0, f.r1, f.bearing];
  else if (field) out.field = field;
  if (f && src.spiresIn) {
    const all = src.spiresIn(f.x - 60, f.y - 60, f.x + 60, f.y + 60);
    out.spires = all.length;
    out.tallest = all.reduce((b, s) => (s.level > (b?.level ?? -1) ? s : b), null);
  }
  return out;
}, process.env.FIELD ? process.env.FIELD.split(',').map(Number) : null);
console.log('spots', JSON.stringify(spots));

/** [name, spot, view, phase, dx, dy, zoom]: dx, dy tiles off the spot (the mesa's owner's angle: a little south-west of its head, the stream falling down-left). */
const SHOTS = [
  ['mesa-near-noon', 'mesa', 'iso', 'noon', 1, 4, 1.6],
  ['mesa-near-dusk', 'mesa', 'iso', 'dusk', 1, 4, 1.6],
  ['mesa-near-night', 'mesa', 'iso', 'night', 1, 4, 1.6],
  ['mesa-mid-noon', 'mesa', 'iso', 'noon', 0, 6, 0.7],
  ['mesa-mid-night', 'mesa', 'iso', 'night', 0, 6, 0.7],
  ['mesa-far-noon', 'mesa', 'iso', 'noon', 0, 8, 0.32],
  ['mesa-near-plan', 'mesa', 'plan', 'noon', 1, 4, 1.6],
  ['mesa-mid-plan', 'mesa', 'plan', 'noon', 0, 6, 0.7],
  ['field-far-noon', 'field', 'iso', 'noon', -6, -6, 0.22],
  ['field-far-dawn', 'field', 'iso', 'dawn', -6, -6, 0.22],
  ['field-mid-noon', 'field', 'iso', 'noon', -4, -4, 0.5],
  ['field-mid-dawn', 'field', 'iso', 'dawn', -4, -4, 0.5],
  ['field-mid-dusk', 'field', 'iso', 'dusk', -4, -4, 0.5],
  ['field-mid-night', 'field', 'iso', 'night', -4, -4, 0.5],
  ['field-close-noon', 'field', 'iso', 'noon', -3, -3, 1.4],
  ['field-close-dawn', 'field', 'iso', 'dawn', -3, -3, 1.4],
  ['field-mid-plan', 'field', 'plan', 'noon', 0, 0, 0.5],
  ['field-close-plan', 'field', 'plan', 'noon', 0, 0, 1.4],
  ['field-far-plan', 'field', 'plan', 'noon', 0, 0, 0.22],
  ['heart-start', 'heart', 'iso', 'noon', 0, 0, 0.45],
];

for (const [name, spot, mode, phase, dx, dy, zoom] of SHOTS) {
  if (ONLY && !ONLY.some((o) => name.includes(o))) continue;
  const at = spot === 'heart' ? [512, 512] : spots[spot];
  if (!at) continue;
  await view(mode);
  await page.evaluate((p) => window.FL.dayPhase(p), phase);
  await page.evaluate(([a, b, z]) => window.FL.lookAt(a, b, z), [at[0] + dx, at[1] + dy, zoom]);
  await settle(zoom < 0.3 ? 2200 : 1200);
  await page.screenshot({ path: shot(name) });
  console.log(`✓ d147-${TAG}-${name}.png`);
}

// Frame times with each in view (iso, noon): the median and p95 of the frame's JS time over 3 s, the
// render call, the relief's sprites and baked frames, the atlas pages.
if (process.env.PERF !== '0') {
  await page.evaluate(() => {
    const perf = window.FL.app.perf, orig = perf.frame.bind(perf);
    window.__rb = { on: false, rows: [] };
    perf.frame = (ms, dt) => { if (window.__rb.on) window.__rb.rows.push([ms, perf.stats.renderMs]); orig(ms, dt); };
  });
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] ?? NaN; };
  await view('iso');
  await page.evaluate(() => window.FL.dayPhase('noon'));
  for (const [name, spot, dx, dy, zoom] of [['mesa-mid', 'mesa', 0, 6, 0.7], ['field-far', 'field', -6, -6, 0.22], ['field-mid', 'field', -4, -4, 0.5], ['field-close', 'field', -3, -3, 1.4], ['heart', 'heart', 0, 0, 0.45]]) {
    const at = spot === 'heart' ? [512, 512] : spots[spot];
    if (!at) continue;
    await page.evaluate(([a, b, z]) => window.FL.lookAt(a, b, z), [at[0] + dx, at[1] + dy, zoom]);
    await settle(1500);
    await page.evaluate(() => { window.__rb.rows = []; window.__rb.on = true; });
    await page.waitForTimeout(3000);
    const rows = await page.evaluate(() => { window.__rb.on = false; return window.__rb.rows; });
    const st = await page.evaluate(() => { const p = window.FL.perf(); return { sprites: p.reliefSprites, baked: p.reliefBaked, pages: window.FL.app.relief?.atlas.pages.length, drawCalls: p.drawCalls }; });
    console.log(`perf ${name}: frame p50 ${q(rows.map((r) => r[0]), 0.5).toFixed(2)} ms, p95 ${q(rows.map((r) => r[0]), 0.95).toFixed(2)} ms, render p50 ${q(rows.map((r) => r[1]), 0.5).toFixed(2)} ms, ${rows.length} frames, ${JSON.stringify(st)}`);
  }
}
await browser.close();
