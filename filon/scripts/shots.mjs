// shots.mjs — art-review captures through window.FL: the full artboard, the demo base, the
// base under the Crown (hero), the cirque from afar and a Crown close-up. Usage: start the dev/preview server (port 5183),
// then `node scripts/shots.mjs` → scripts/shot-*.png (gitignored).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

/** Screenshots land next to this script, whatever the working directory. */
const shot = (name) => fileURLToPath(new globalThis.URL(`./${name}`, import.meta.url)); // (URL is shadowed below)

const URL = process.env.URL ?? 'http://localhost:5183';
const SEED = process.env.SEED ?? '1';
const LOCALE = process.env.SHOT_LOCALE ?? 'fr-FR';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: LOCALE });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=${SEED}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 15000 });
await page.waitForTimeout(600);

const settle = async (ms = 2500) => {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};

await page.evaluate(() => window.FL.demo());
await page.evaluate(() => window.FL.lookAt(512, 509, 1.1));
await settle();
await page.screenshot({ path: shot('shot-base.png') });
console.log('✓ shot-base.png');

await page.evaluate(() => window.FL.lookAt(497, 497, 0.55));
await settle();
await page.screenshot({ path: shot('shot-hero.png') });
console.log('✓ shot-hero.png');

await page.evaluate(() => window.FL.lookAt(512, 512, 0.42));
await settle();
await page.screenshot({ path: shot('shot-cirque.png') });
console.log('✓ shot-cirque.png');

await page.evaluate(() => window.FL.lookAt(533, 495, 0.8));
await settle();
await page.screenshot({ path: shot('shot-crown.png') });
console.log('✓ shot-crown.png');

// Build mode: the plan view, a drill in hand over a free deposit spot, and the morph halfway.
await page.evaluate(() => window.FL.lookAt(512, 506, 1.1));
await settle(800);
await page.click('.bb-tab[data-cat="extraction"]');
await page.waitForTimeout(250);
await page.screenshot({ path: shot('shot-morph.png') });
console.log('✓ shot-morph.png');
await page.waitForFunction(() => window.FL.view().t === 1);
await page.click('.bb-slot[data-def="drill"]');
const spot = await page.evaluate(() => {
  const sim = window.FL.app.sim;
  for (let r = 0; r < 40; r++) for (let y = 506 - r; y <= 506 + r; y++) for (let x = 512 - r; x <= 512 + r; x++) {
    if (Math.max(Math.abs(x - 512), Math.abs(y - 506)) === r && (() => { const c = sim.canPlace('drill', x, y, 0); return c.ok && c.replaces.length === 0; })()) return [x, y];
  }
  return [512, 500];
});
const [hx, hy] = await page.evaluate(([x, y]) => window.FL.tileToScreen(x, y), spot);
await page.mouse.move(hx, hy);
await settle(600);
await page.screenshot({ path: shot('shot-plan.png') });
console.log('✓ shot-plan.png');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.FL.view().t === 0);
// Inspecting in the iso view.
await page.evaluate(() => window.FL.lookAt(512, 509, 1.25));
await settle(600);
const [kx, ky] = await page.evaluate(() => window.FL.tileToScreen(520, 516));
await page.mouse.click(kx, ky - 20);
await page.waitForTimeout(400);
await page.screenshot({ path: shot('shot-inspect.png') });
console.log('✓ shot-inspect.png');
await page.keyboard.press('Escape');

// The land mode (D60): the parcels over the plan view, a parcel past the starting square picked.
await page.evaluate(() => window.FL.lookAt(512 + 36, 512, 1));
await page.keyboard.press('i');
await page.waitForFunction(() => window.FL.view().t === 1);
await page.evaluate(() => { window.FL.app.landTool.selected = 32 * 65 + 35; }); // 3 E of the Heart's parcel
const [lx, ly] = await page.evaluate(() => window.FL.tileToScreen(512 + 3 * 16, 512 + 16));
await page.mouse.move(lx, ly);
await settle(1200);
await page.screenshot({ path: shot('shot-land.png') });
console.log('✓ shot-land.png');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.FL.view().t === 0);

// The Crier: half an hour of trade from the demo's post (bulbs and plates sold in the Port-Écume
// shortage, copper ore bought and handed out by the post's one exit into the Heart, D62), then
// the screen — the orbital view while cargo pods fly — and a lift-off over the post in the world.
const post = await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim, id = FL.tradePost();
  if (!id) return null;
  if (sim.tick < 600 * 45) FL.tick(600 * 45 - sim.tick);
  sim.spotTrade('glass', 'sell', 40); // a post sells what its entrance brings (D64): a spot sale from the Heart instead
  sim.spotTrade('iron_plate', 'sell', 40);
  FL.connect(id, sim.hearthId); // an order buys only while the exit can hand its goods out
  sim.addImport(id, 'copper_ore', 10, Math.round(FL.price('copper_ore').ask * 200));
  FL.tick(600 * 30);
  const e = sim.ents.get(id);
  return [e.x, e.y];
});
if (post) {
  await page.evaluate(() => window.FL.open('market'));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.FL.tick(600 - (window.FL.app.sim.tick % 600)));
  await page.waitForTimeout(1700);
  await page.screenshot({ path: shot('shot-crier.png') });
  console.log('✓ shot-crier.png');
  await page.evaluate(() => window.FL.close());
  await page.evaluate(([x, y]) => window.FL.lookAt(x + 2.5, y - 0.5, 1.3), post); // above the 5 × 5 post's deck, where the drone climbs
  await settle(600);
  await page.evaluate(() => window.FL.tick(600 - (window.FL.app.sim.tick % 600)));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot('shot-cargo.png') });
  console.log('✓ shot-cargo.png');
} else console.log('· no trade post in the demo: shot-crier / shot-cargo skipped');

// Research and statistics screens (a few nodes learnt, one running).
await page.evaluate(() => {
  const sim = window.FL.app.sim;
  for (const id of ['tr1', 'tr2', 'en1', 'en2', 'en3', 'dn1']) sim.done.add(id);
  sim.rebuildDerived();
  window.FL.feedLab('data_file', 80);
  window.FL.research('ex1');
  window.FL.tick(400);
});
await page.waitForTimeout(400);
await page.keyboard.press('t');
await page.waitForTimeout(500);
await page.click('.rs-card[data-id="en4"]');
await page.waitForTimeout(300);
await page.screenshot({ path: shot('shot-research.png') });
console.log('✓ shot-research.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(2500);
await page.keyboard.press('g');
await page.waitForTimeout(800);
await page.screenshot({ path: shot('shot-stats.png') });
console.log('✓ shot-stats.png');
await page.keyboard.press('Escape');

await page.evaluate(() => {
  window.FL.open('artboard');
  document.documentElement.style.overflow = 'visible';
  document.body.style.overflow = 'visible';
  const a = document.querySelector('.artboard');
  document.body.append(a); // out of the fixed #screens layer so the page can grow
  for (const id of ['stage', 'ui', 'screens']) document.getElementById(id).style.display = 'none';
  a.style.position = 'absolute';
  a.style.inset = 'auto';
  a.style.left = '0';
  a.style.top = '0';
  a.style.width = '1440px';
  a.style.height = 'auto';
  a.style.overflow = 'visible';
});
await page.waitForTimeout(800);
await page.screenshot({ path: shot('shot-artboard.png'), fullPage: true });
console.log('✓ shot-artboard.png');

await browser.close();
