// desert-shots.mjs — map 4's open desert (D94; owner, 2026-10-17: « la carte devrait contenir un
// petit peu plus de grands déserts ouverts, plats, assez vides de ressources, sans eau ni crevasse
// ni montagne »; « le cirque notamment devrait être entouré de pas mal de sable, hormis le quartz et
// les rares ressources aux alentours »): the cirque and the two rings of parcels round its starting
// square at far zoom, then the land out to the sixth ring further off, in plan and in iso, by day:
// scripts/shot-desert-<TAG>-*.png (gitignored; TAG=before|after). Usage: a server on :5183 (or
// URL=…, SEED=…, default 1), then `TAG=after node scripts/desert-shots.mjs`. It starts the sandbox
// base over (FL.wipe: map 4) and lifts the fog out to the sixth ring (a review rig: `sim.explored`).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const TAG = process.env.TAG ?? 'after';
const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-desert-${TAG}-${name}.png`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=${process.env.SEED ?? '1'}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
await page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts, [data-screen="quests"] { display: none !important; }' });

const settle = async (ms = 2500) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

const mapV = await page.evaluate(() => { const sim = window.FL.app.sim; sim.explored.push([512, 512, 220]); return sim.grid.source.mapV; });
if (mapV !== 4) throw new Error(`map ${mapV}: the open desert is map 4's`);

// The cirque and the rings round its starting square; then out to the sixth ring.
for (const [name, z] of [['cirque', 0.2], ['wide', 0.12]]) {
  for (const mode of ['plan', 'iso']) {
    await view(mode);
    await page.evaluate((zz) => window.FL.lookAt(512, 512, zz), z);
    await settle();
    await page.screenshot({ path: shot(`${name}-${mode}`) });
    console.log(`✓ shot-desert-${TAG}-${name}-${mode}.png (zoom ${await page.evaluate(() => window.FL.view().zoom ?? '?')})`);
  }
}
await browser.close();
