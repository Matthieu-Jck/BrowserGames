// view-shots.mjs — the specialised views (D88) and the HUD on the late debug base, for visual review:
// the base in the Normal view, then Électricité, Logistique, Production and Terrain, each in iso
// and in plan, the Électricité view with a grid's building inspected, the HUD alone and building
// open (the build bar). Usage: start the dev server (port 5183), then `node scripts/view-shots.mjs`
// → scripts/view-*.png (gitignored).
// Env: URL, SHOT_LOCALE (fr-FR), PREFIX (file prefix, default `view`: `PREFIX=before` keeps a set to
// compare), CHROME.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const URL = process.env.URL ?? 'http://localhost:5183';
const LOCALE = process.env.SHOT_LOCALE ?? 'fr-FR';
const PREFIX = process.env.PREFIX ?? 'view';
/** Screenshots land next to this script, whatever the working directory. */
const shot = (name) => fileURLToPath(new globalThis.URL(`./${PREFIX}-${name}.png`, import.meta.url));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: LOCALE });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 20000 });
await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 10000 });
await page.evaluate(() => { if (window.FL.app.guide) window.FL.app.guide.enabled = false; });

const r = await page.evaluate(() => window.FL.debugSave('late'));
console.log(`late base: ${r.ok ? `${r.ms} ms` : 'refused'}`);
await page.evaluate(() => { window.FL.menu(false); window.FL.close(); window.FL.dayPhase('noon'); });
// A few game minutes so the rates, the grids and the ribbons' throughput have something to say.
await page.evaluate(() => window.FL.tick(1200));
await page.waitForTimeout(600);

const settle = async (ms = 1500) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const hasViews = await page.evaluate(() => typeof window.FL.mapView === 'function');
/** Turn a view on (the FL hook, or before D88 the keys that existed: P the power overlay, I the land mode). */
async function view(v) {
  if (hasViews) { await page.evaluate((x) => window.FL.mapView(x), v); return; }
  await page.evaluate(() => { window.FL.app.overlays.powerOn = false; window.FL.app.build.land(false); });
  if (v === 'power') await page.evaluate(() => { window.FL.app.overlays.powerOn = true; });
  if (v === 'land') await page.evaluate(() => window.FL.app.build.land(true));
}
const iso = async () => { await page.evaluate(() => window.FL.view('iso')); await page.waitForFunction(() => window.FL.view().t === 0, undefined, { timeout: 4000 }).catch(() => {}); };
const plan = async () => { await page.evaluate(() => window.FL.view('plan')); await page.waitForFunction(() => window.FL.view().t === 1, undefined, { timeout: 4000 }).catch(() => {}); };

await page.evaluate(() => window.FL.lookAt(512, 512, 0.62));
await settle(2500);
await page.screenshot({ path: shot('normal') });
await page.locator('.hud').screenshot({ path: shot('hud') });
console.log(`✓ ${PREFIX}-normal.png, ${PREFIX}-hud.png`);

for (const v of ['power', 'logistics', 'production']) {
  await view(v);
  await iso();
  await settle();
  await page.screenshot({ path: shot(`${v}-iso`) });
  await plan();
  await settle(800);
  await page.screenshot({ path: shot(`${v}-plan`) });
  console.log(`✓ ${PREFIX}-${v}-iso.png, ${PREFIX}-${v}-plan.png`);
  if (!hasViews && v === 'power') break; // before D88 only the power overlay existed
}
// Électricité, close up, with a wind turbine inspected (the inspector on its power facet).
await view('power');
await iso();
const wind = await page.evaluate(async () => {
  const { BUILDING_IDS } = await import('/src/content/registry.ts');
  const sim = window.FL.app.sim;
  const e = sim.ents.sorted().find((x) => BUILDING_IDS[x.def] === 'wind_flower' && x.builtAt === 0);
  return e ? { id: e.id, x: e.x, y: e.y } : null;
});
await page.evaluate(() => window.FL.lookAt(512, 512, 1.05));
await settle();
await page.screenshot({ path: shot('power-close') });
if (wind) {
  await page.evaluate((w) => { window.FL.lookAt(w.x, w.y, 1.05); window.FL.selected(w.id); }, wind);
  await settle(800);
  await page.screenshot({ path: shot('power-inspect') });
  await page.evaluate(() => window.FL.selected(0));
}
console.log(`✓ ${PREFIX}-power-close.png, ${PREFIX}-power-inspect.png`);
// Night: the solar gone from the 24 h curve's now.
await page.evaluate(() => window.FL.dayPhase('night'));
await page.evaluate(() => window.FL.lookAt(512, 512, 0.62));
await settle();
await page.screenshot({ path: shot('power-night') });
await page.evaluate(() => window.FL.dayPhase('noon'));
console.log(`✓ ${PREFIX}-power-night.png`);

await view('land');
await settle(1200);
await page.screenshot({ path: shot('land') });
console.log(`✓ ${PREFIX}-land.png`);

await view('normal');
await iso();
await page.evaluate(() => window.FL.category('production'));
await settle(800);
await page.screenshot({ path: shot('build') });
await page.evaluate(() => window.FL.category(null));
console.log(`✓ ${PREFIX}-build.png`);

await browser.close();
