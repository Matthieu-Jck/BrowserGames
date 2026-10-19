// d148-shots.mjs — D148's review shots (owner, 2026-10-19: « make it so that there's no fog of war
// anywhere »): a fresh base zoomed out, in iso and in plan, at noon and at night, with no fog
// anywhere; far land with the nearest neighbouring base and the deposits round it (iso and plan, mid
// zoom); and the deposit card on a deposit 250 tiles out or more (nothing built near it, no rig).
// Writes <OUT>/d148-<TAG>-<name>.png (OUT defaults to scripts/, gitignored).
// Usage: a server (URL=…, default :5183), then `node scripts/d148-shots.mjs`. Env: TAG (after),
// SEED (the sandbox's, 1), OUT. It starts the sandbox base over (FL.wipe: today's map).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5183';
const SEED = process.env.SEED ?? '1';
const TAG = process.env.TAG ?? 'after';
const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('.', import.meta.url));
const shot = (name) => join(OUT, `d148-${TAG}-${name}.png`);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=${SEED}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => {
  window.FL.intro?.(false); window.FL.menu?.(false); window.FL.pause();
  if (window.FL.app.guide) window.FL.app.guide.enabled = false;
});
await page.addStyleTag({ content: '.qlog, .guide, [data-screen="quests"] { display: none !important; }' });

/** Everything in view painted and laid: the ground chunks, the relief sprites, the neighbouring bases. */
const settle = async (ms = 700) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0 && !(window.FL.app.relief?.pending > 0) && !(window.FL.app.neighbours?.queued > 0), undefined, { timeout: 30000 })
    .catch(() => console.log('  (not settled)'));
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

// 1. The fresh base zoomed out: iso and plan, noon and night.
for (const time of ['noon', 'night']) {
  await page.evaluate((t) => window.FL.dayPhase(t), time);
  for (const mode of ['iso', 'plan']) {
    await view(mode);
    await page.evaluate(() => window.FL.lookAt(512, 512, 0.16));
    await settle(1200);
    await page.screenshot({ path: shot(`fresh-far-${mode}-${time}`) });
    console.log('fresh far', mode, time, JSON.stringify(await page.evaluate(() => ({ laid: window.FL.app.neighbours.count, chunks: window.FL.perf().chunks }))));
  }
}
await page.evaluate(() => window.FL.dayPhase('noon'));

// 2. Far land: the nearest neighbouring base (its lift pad) and the deposits round it.
const nb = await page.evaluate(() => {
  const sim = window.FL.app.sim;
  let best = null;
  for (let p = 0; p < 45 * 45; p++) {
    const h = sim.neighbours.holdingOf(p);
    if (!h || h.hub !== p || sim.land.neighbour(p) < 0) continue;
    const L = sim.neighbours.layout(h), pad = L.structs[0];
    if (!pad) continue;
    const d = (pad.x - 512) ** 2 + (pad.y - 512) ** 2;
    if (!best || d < best.d) best = { d, hub: p, at: [pad.x + 2, pad.y + 2] };
  }
  if (!best) return null;
  // Deposit tiles within 40 tiles of it, by ore.
  const g = sim.grid, ores = {};
  for (let y = best.at[1] - 40; y <= best.at[1] + 40; y++) for (let x = best.at[0] - 40; x <= best.at[0] + 40; x++) {
    const o = g.ore(x, y);
    if (o >= 0) { const id = window.FL.ids().items[o]; ores[id] = (ores[id] ?? 0) + 1; }
  }
  return { ...best, dist: Math.round(Math.sqrt(best.d)), ores };
});
console.log('nearest neighbouring base', JSON.stringify(nb));
if (nb) {
  for (const mode of ['iso', 'plan']) {
    await view(mode);
    await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 0.55), nb.at);
    await settle(1200);
    await page.screenshot({ path: shot(`neighbour-${mode}`) });
  }
}

// 3. The deposit card on a deposit 250 tiles out or more, the pointer resting on it.
await view('iso');
const far = await page.evaluate(() => {
  const sim = window.FL.app.sim, g = sim.grid;
  for (let r = 250; r < 420; r++) for (let k = 0; k < 8 * r; k++) {
    const side = Math.floor(k / (2 * r)), o = (k % (2 * r)) - r;
    const [x, y] = [[512 + o, 512 - r], [512 + r, 512 + o], [512 - o, 512 + r], [512 - r, 512 - o]][side];
    if (x < 2 || y < 2 || x > 1020 || y > 1020) continue;
    const ore = g.ore(x, y), t = g.terrain(x, y);
    if (ore < 0 || !(t < 2 || t > 5) || t === 13 || t === 14 || sim.entityAt(x, y) || sim.land.neighbour(window.FL.parcelAt(x, y)) >= 0) continue;
    if (g.ore(x + 1, y) !== ore || g.ore(x, y + 1) !== ore || g.ore(x - 1, y) !== ore || g.ore(x, y - 1) !== ore) continue;
    return { at: [x, y], ore: window.FL.ids().items[ore], r };
  }
  return null;
});
console.log('far deposit', JSON.stringify(far));
if (far) {
  await page.evaluate(([x, y]) => window.FL.lookAt(x + 0.5, y + 0.5, 1.1), far.at);
  await settle(800);
  const [sx, sy] = await page.evaluate(([x, y]) => window.FL.tileToScreen(x, y), far.at);
  await page.mouse.move(sx + 30, sy + 30);
  await page.mouse.move(sx, sy, { steps: 4 });
  await page.waitForTimeout(900);
  const card = await page.evaluate(() => { const n = document.querySelector('[data-deposit-card]'); return n && !n.hidden ? n.innerText.replace(/\s+/g, ' ') : null; });
  console.log('card:', card);
  await page.screenshot({ path: shot('far-deposit-card') });
}
await browser.close();
