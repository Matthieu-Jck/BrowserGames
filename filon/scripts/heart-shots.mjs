// heart-shots.mjs — the Core at each level (D86; level 5, D118), iso and plan, by day, and the
// first and last two levels by night: shot-heart-<view>-<level>.png (gitignored), in scripts/ or
// in $OUT. Usage: a dev server on :5183, then `node scripts/heart-shots.mjs`; another server with
// `URL=http://localhost:<port>`. `LEVELS`: the top level (5: `BAL.hearthUpgrades` + the landing's).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('.', import.meta.url));
mkdirSync(OUT, { recursive: true });
const shot = (name) => join(OUT, name);
const URL = process.env.URL ?? 'http://localhost:5183';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 15000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); });
await page.addStyleTag({ content: '.qlog, .guide, .hud, .build-bar, .toasts { display: none !important; }' });
await page.waitForTimeout(600);
const top = Number(process.env.LEVELS ?? 5);

/** The Core's box on screen (its centre tile ± a margin; the top reaches the level-5 mast's tip), for a close crop. */
const clip = async () => {
  const [x, y] = await page.evaluate(() => window.FL.tileToScreen(512, 512));
  return { x: Math.max(0, x - 330), y: Math.max(0, y - 310), width: 660, height: 490 };
};
const settle = async (ms = 900) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
/** The Heart to a level, outside commands (a review rig): its art follows at the next rebuild. */
const level = (n) => page.evaluate((n) => {
  const sim = window.FL.app.sim;
  sim.hearthLevel = n; sim.dirty = true; sim.events.push({ k: 'structure' });
}, n);

for (let n = 1; n <= top; n++) {
  await level(n);
  await page.evaluate(() => { window.FL.view('iso'); window.FL.lookAt(512, 511, 3.2); });
  await settle();
  await page.screenshot({ path: shot(`shot-heart-iso-${n}.png`), clip: await clip() });
  await page.evaluate(() => { window.FL.view('plan'); });
  await page.waitForFunction(() => window.FL.view().t === 1).catch(() => {});
  await settle(500);
  await page.screenshot({ path: shot(`shot-heart-plan-${n}.png`), clip: await clip() });
  console.log(`✓ level ${n}`);
}
await page.evaluate(() => { window.FL.view('iso'); window.FL.dayPhase('night'); });
for (const n of [1, top - 1, top]) {
  await level(n);
  await settle(1200);
  await page.screenshot({ path: shot(`shot-heart-iso-${n}-night.png`), clip: await clip() });
}
console.log(`✓ night → ${OUT}`);
await browser.close();
