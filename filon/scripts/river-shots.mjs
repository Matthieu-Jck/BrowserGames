// river-shots.mjs — map 4's rivers (D94; owner, 2026-10-16: « de petits ruisseaux qui partent de
// grandes montagnes au début, puis se rejoindre pour devenir un grand courant en bas… une mer, loin
// quelque part »): the network from the cirque down to the sea at far zoom (plan and iso), a
// confluence, a fall where a stream steps down off a massif, and the sea's coast (FL.sea):
// scripts/shot-river-*.png (gitignored). Usage: a server on :5183 (or URL=…, SEED=…), then
// `node scripts/river-shots.mjs`. It starts the sandbox base over (FL.wipe: map 4) and lifts the fog
// out to the sea (a review rig).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-river-${name}.png`, import.meta.url));
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
await page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts, [data-screen="quests"] { display: none !important; }' });

const settle = async (ms = 1500) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

// The sea's coast, the fog lifted out to it; a confluence and a fall on the way.
const spots = await page.evaluate(() => {
  const sim = window.FL.app.sim, g = sim.grid, C = 512;
  sim.explored.push([C, C, 460]);
  const sea = window.FL.sea();
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
  const flow = (x, y) => { const c = g.chunkAt(x >> 5, y >> 5).biome[(y & 31) * 32 + (x & 31)] - 16; return c >= 0 && c < 8 ? c : -1; };
  let confluence = null, fall = null;
  for (let r = 40; r < 260 && (!confluence || !fall); r += 2) {
    for (let a = 0; a < 360 && (!confluence || !fall); a += 2) {
      const x = Math.round(C + r * Math.cos((a * Math.PI) / 180)), y = Math.round(C + r * Math.sin((a * Math.PI) / 180));
      if (g.terrain(x, y) !== 14) continue;
      const f = flow(x, y);
      if (!fall && g.level(x, y) > 0) {
        const nx = x + DX[f], ny = y + DY[f];
        if (g.level(nx, ny) < g.level(x, y)) fall = [x, y, g.level(x, y), g.level(nx, ny)];
      }
      if (!confluence) {
        const ways = new Set();
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (g.terrain(x + dx, y + dy) === 14 && g.level(x + dx, y + dy) === 0) ways.add(flow(x + dx, y + dy));
        if (ways.size >= 4) confluence = [x, y];
      }
    }
  }
  return { sea, confluence, fall };
});
console.log('spots', JSON.stringify(spots));

// The network: from the cirque to the sea, far zoom.
const mid = spots.sea ? [Math.round((512 + spots.sea[0]) / 2), Math.round((512 + spots.sea[1]) / 2)] : [512, 512];
for (const mode of ['plan', 'iso']) {
  await view(mode);
  await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 0.125), mid);
  await settle(3000);
  await page.screenshot({ path: shot(`network-${mode}`) });
  console.log(`✓ shot-river-network-${mode}.png`);
}
if (spots.confluence) {
  await view('iso');
  await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 0.55), spots.confluence);
  await settle();
  await page.screenshot({ path: shot('confluence-iso') });
  console.log('✓ shot-river-confluence-iso.png');
}
if (spots.fall) {
  for (const mode of ['iso', 'plan']) {
    await view(mode);
    await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 1.6), spots.fall);
    await settle();
    await page.screenshot({ path: shot(`fall-${mode}`) });
    console.log(`✓ shot-river-fall-${mode}.png`);
  }
}
if (spots.sea) {
  for (const mode of ['iso', 'plan']) {
    await view(mode);
    await page.evaluate(() => window.FL.sea(0.4));
    await settle(2000);
    await page.screenshot({ path: shot(`sea-${mode}`) });
    console.log(`✓ shot-river-sea-${mode}.png`);
  }
}
await browser.close();
