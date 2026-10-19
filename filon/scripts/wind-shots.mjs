// wind-shots.mjs — the wind (D95) for visual review, on the late debug base: the rare hints on the
// land (gust streaks, sand off the tops) in the Normal view; the Vent view in iso, in plan and far
// out (the zones, the arrows, the turbines' badges, the side card), and farther (map 4's massifs); the inspector on the windiest
// and the least windy turbine, after the Anémométrie plan and before it (no figure about the wind);
// a turbine in hand and what it would give where it stands. Usage: a dev server (default port
// 5183; the scripts import /src), then `node scripts/wind-shots.mjs` → scripts/wind-*.png
// (gitignored). Env: URL, OUT (a folder for the pictures), SHOT_LOCALE (fr-FR), CHROME.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5183';
const LOCALE = process.env.SHOT_LOCALE ?? 'fr-FR';
const shot = (name) => (process.env.OUT ? join(process.env.OUT, `wind-${name}.png`) : fileURLToPath(new globalThis.URL(`./wind-${name}.png`, import.meta.url)));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: LOCALE });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 10000 });
await page.evaluate(() => { if (window.FL.app.guide) window.FL.app.guide.enabled = false; });

const r = await page.evaluate(() => window.FL.debugSave('late'));
console.log(`late base: ${r.ok ? `${r.ms} ms` : 'refused'}`);
await page.evaluate(() => { window.FL.menu(false); window.FL.close(); window.FL.dayPhase('dusk'); }); // the Sough rises at dusk
await page.evaluate(() => window.FL.tick(600));

const settle = async (ms = 1500) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const iso = async () => { await page.evaluate(() => window.FL.view('iso')); await page.waitForFunction(() => window.FL.view().t === 0, undefined, { timeout: 4000 }).catch(() => {}); };
const plan = async () => { await page.evaluate(() => window.FL.view('plan')); await page.waitForFunction(() => window.FL.view().t === 1, undefined, { timeout: 4000 }).catch(() => {}); };

// The turbines, by their exposure over the days: the windiest and the least windy.
const turbines = await page.evaluate(async () => {
  const { BUILDING_KIND } = await import('/src/content/registry.ts');
  const { windSite } = await import('/src/sim/power/network.ts');
  const { meanExposure } = await import('/src/sim/world/wind.ts');
  const sim = window.FL.app.sim;
  return sim.ents.sorted().filter((e) => BUILDING_KIND[e.def] === 'wind' && e.builtAt === 0)
    .map((e) => ({ id: e.id, x: e.x, y: e.y, e: meanExposure(windSite(sim.grid, sim.worldSeed, e)) }))
    .sort((a, b) => b.e - a.e);
});
console.log(`turbines: ${turbines.length}, exposures ${turbines.map((t) => t.e).join(' ')}`);
const best = turbines[0], worst = turbines[turbines.length - 1];

// The windiest hour of the coming day (the world clock's weather): the sim run there, so the hints have wind to show.
const ahead = await page.evaluate(async () => {
  const { windAt } = await import('/src/sim/world/wind.ts');
  const sim = window.FL.app.sim, ep = sim.absEpoch();
  let k = 0, best = -1;
  for (let i = 0; i < 36; i++) { const w = windAt(ep + i, sim.worldSeed, sim.mods.gustVariance); if (w > best) { best = w; k = i; } }
  return { k, wind: best };
});
if (ahead.k > 0) await page.evaluate((k) => window.FL.tick(k * 600 - (window.FL.app.sim.tick % 600)), ahead.k);
console.log(`the windiest hour ahead: +${ahead.k} epochs, wind ×${ahead.wind / 1000}`);

// 1 · The hints: the Normal view on the windiest turbine's crest, the game running until a few are up.
await iso();
await page.evaluate(({ x, y }) => window.FL.lookAt(x, y, 0.85), best);
await settle(500);
// The hints are rare by design (at most four up, only in clearly strong wind): more tries a second for the shot, never more up.
await page.evaluate(() => { window.FL.app.windHints.boost = 8; });
const up = await page.waitForFunction(() => window.FL.app.windHints.count >= 2, undefined, { timeout: 25000, polling: 100 }).then(() => true, () => false);
await page.screenshot({ path: shot('hints') });
await page.evaluate(() => { window.FL.app.windHints.boost = 1; });
console.log(`✓ wind-hints.png (${up ? 'hints up' : 'few hints'}: ${await page.evaluate(() => window.FL.app.windHints.count)})`);

// 2 · The Vent view: iso, plan, far out.
await page.evaluate(() => window.FL.mapView('wind'));
await page.evaluate(() => window.FL.lookAt(512, 512, 0.55));
await settle(2500);
await page.screenshot({ path: shot('view-iso') });
await plan();
await settle(2000);
await page.screenshot({ path: shot('view-plan') });
await iso();
await page.evaluate(() => window.FL.lookAt(512, 512, 0.3));
await settle(4000);
await page.screenshot({ path: shot('view-far') });
// Farther (sandbox): the land past the Crown — map 4's massifs, their lees and passes.
await page.evaluate(() => { window.FL.lookAt(512, 512, 0.2); });
await settle(6000);
await page.screenshot({ path: shot('view-land') });
console.log('✓ wind-view-iso.png, wind-view-plan.png, wind-view-far.png, wind-view-land.png');

// 3 · The inspector on the windiest and the least windy turbine, the reasons unfolded.
async function inspect(t, name) {
  await page.evaluate(({ x, y }) => window.FL.lookAt(x, y, 0.9), t);
  await page.evaluate((id) => window.FL.selected(id), t.id);
  await page.waitForTimeout(700);
  await page.locator('.pw-coef').first().click().catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot(name) });
  const panel = page.locator('.inspector, [data-screen="inspector"], .insp').first();
  await panel.screenshot({ path: shot(`${name}-panel`) }).catch(() => {});
  await page.evaluate(() => window.FL.selected(0));
}
await page.evaluate(() => window.FL.mapView('normal'));
await inspect(best, 'insp-good');
await inspect(worst, 'insp-bad');
// Before the Anémométrie plan: what its blades give, nothing about the wind (sandbox: the plan taken back).
await page.evaluate(() => { const sim = window.FL.app.sim; sim.done.delete('anemometry'); sim.rebuildDerived(); });
await inspect(worst, 'insp-hidden');
await page.evaluate(() => { const sim = window.FL.app.sim; sim.done.add('anemometry'); sim.rebuildDerived(); });
console.log('✓ wind-insp-good.png, wind-insp-bad.png, wind-insp-hidden.png (+ -panel)');

// 4 · A turbine in hand over a windy spot: what it would give there.
await page.evaluate(() => window.FL.category('energy'));
await plan();
const spot = await page.evaluate(async () => {
  const { windiest } = await import('/src/sim/readouts/wind.ts');
  const s = windiest(window.FL.app.sim, 'wind_flower', 512, 512, 40, 1, true)[0];
  return s ? { x: s[0], y: s[1] } : null;
});
if (spot) {
  await page.evaluate(({ x, y }) => window.FL.lookAt(x, y + 6, 1.1), spot); // the spot above the build bar
  await settle(800);
  await page.evaluate(() => window.FL.tool('wind_flower'));
  const [sx, sy] = await page.evaluate(({ x, y }) => window.FL.tileToScreen(x + 0.5, y + 0.5), spot);
  await page.mouse.move(sx, sy);
  await page.waitForTimeout(500);
  await page.mouse.move(sx + 1, sy + 1);
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('place') });
  console.log(`✓ wind-place.png (${await page.evaluate(() => document.querySelector('.tip-wind')?.getAttribute('title') ?? 'no figure')})`);
}
await browser.close();
