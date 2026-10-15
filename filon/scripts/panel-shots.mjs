// panel-shots.mjs — the panels on the late debug base, for visual review (D89): the inspector on a
// kiln (smelter), a drill, a wind turbine, the trade post, a research lab and the Core; the building
// card over the build tray; the Crier, the statistics and the absence report. Usage: start the dev
// server (port 5183), then `node scripts/panel-shots.mjs` → scripts/panel-*.png (gitignored).
// Env: URL, SHOT_LOCALE (fr-FR), PREFIX (file prefix, default `panel`: `PREFIX=before` keeps a
// set to compare), ONLY (a comma list of parts: insp, card, crier, stats, menu, settings, forecast,
// absence; default all), CHROME.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const URL = process.env.URL ?? 'http://localhost:5183';
const LOCALE = process.env.SHOT_LOCALE ?? 'fr-FR';
const PREFIX = process.env.PREFIX ?? 'panel';
/** Screenshots land next to this script, whatever the working directory. */
const shot = (name) => fileURLToPath(new globalThis.URL(`./${PREFIX}-${name}.png`, import.meta.url));
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (part) => !ONLY || ONLY.has(part);

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
// A few game minutes so the rates, the grids and the market have something to say.
await page.evaluate(() => window.FL.tick(1200));
await page.waitForTimeout(800);

/** The first built entity of a building id (ties: the one nearest the Heart), selected and framed. */
async function inspect(def, name) {
  const id = await page.evaluate(async (d) => {
    const { BUILDING_IDS } = await import('/src/content/registry.ts'); // the dev server serves the modules
    const sim = window.FL.app.sim;
    let best = 0, bd = Infinity;
    for (const e of sim.ents.sorted()) {
      if (BUILDING_IDS[e.def] !== d || e.builtAt !== 0) continue;
      const dd = (e.x - 512) ** 2 + (e.y - 512) ** 2;
      if (dd < bd) { bd = dd; best = e.id; }
    }
    return best;
  }, def);
  if (!id) { console.log(`✗ no ${def}`); return; }
  await page.evaluate((i) => { const e = window.FL.app.sim.ents.get(i); window.FL.lookAt(e.x, e.y, 1.1); window.FL.selected(i); }, id);
  await page.waitForSelector('.inspector:not([hidden])', { timeout: 3000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot(`insp-${name}`) });
  await page.locator('.inspector').screenshot({ path: shot(`insp-${name}-panel`) });
  console.log(`✓ ${PREFIX}-insp-${name}.png (${def} #${id})`);
}

if (want('insp')) {
  for (const [def, name] of [['kiln', 'smelter'], ['drill', 'drill'], ['wind_flower', 'wind'], ['trade_post', 'trade'], ['observatory', 'lab'], ['hearth', 'core']]) await inspect(def, name);
  await page.evaluate(() => window.FL.selected(0));
}

// The building card: the Production tray, the pointer resting on the kiln's slot.
if (want('card')) {
  // The build bar shows in build mode only (D88): « Construire » first.
  if (!(await page.isVisible('.bb-tab'))) await page.click('.hud-build').catch(() => {});
  await page.waitForTimeout(500);
  for (const [def, cat] of [['kiln', 'production'], ['router', 'distribution'], ['wind_flower', 'energy']]) {
    // A tab opens its tray (a click on the open one would close it).
    if (!(await page.isVisible(`.bb-slot[data-def="${def}"]`))) await page.click(`.bb-tab[data-cat="${cat}"]`).catch(() => {});
    await page.waitForTimeout(300);
    const slot = page.locator(`.bb-slot[data-def="${def}"]`);
    if (!(await slot.count())) continue;
    await slot.hover();
    await page.waitForSelector('[data-screen="building-card"]:not([hidden])', { timeout: 3000 });
    await page.waitForTimeout(400);
    const name = def === 'kiln' ? 'card' : `card-${def}`;
    await page.screenshot({ path: shot(name) });
    await page.locator('[data-screen="building-card"]').screenshot({ path: shot(`${name}-panel`) });
    console.log(`✓ ${PREFIX}-${name}.png`);
  }
  await page.mouse.move(700, 300);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

for (const [scr, name] of [['market', 'crier'], ['stats', 'stats']]) {
  if (!want(name)) continue;
  await page.evaluate((s) => window.FL.open(s), scr);
  await page.waitForSelector(`[data-screen="${scr}"][data-open]`, { timeout: 3000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: shot(name) });
  console.log(`✓ ${PREFIX}-${name}.png`);
  await page.evaluate(() => window.FL.close());
}
// The Crier's other tabs.
if (want('crier')) {
  await page.evaluate(() => window.FL.open('market'));
  await page.waitForSelector('[data-screen="market"][data-open]', { timeout: 3000 });
  for (const tab of ['trade', 'board']) {
    const b = page.locator(`[data-screen="market"] [data-crier-tab="${tab}"]`);
    if (await b.count()) {
      await b.first().click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: shot(`crier-${tab}`) });
      console.log(`✓ ${PREFIX}-crier-${tab}.png`);
    }
  }
  await page.evaluate(() => window.FL.close());
}

// The main menu, its settings page and « Avant de partir ».
if (want('menu')) {
  await page.evaluate(() => window.FL.menu(true));
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot('menu') });
  console.log(`✓ ${PREFIX}-menu.png`);
  await page.evaluate(() => window.FL.menu(false));
}
if (want('settings')) {
  await page.evaluate(() => window.FL.menu(true, 'settings'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot('settings') });
  console.log(`✓ ${PREFIX}-settings.png`);
  await page.evaluate(() => window.FL.menu(false));
}
if (want('forecast')) {
  await page.evaluate(() => window.FL.menu(true, 'forecast'));
  await page.waitForTimeout(400);
  const b = page.locator('[data-forecast-hours="8"]');
  if (await b.count()) await b.first().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: shot('forecast') });
  console.log(`✓ ${PREFIX}-forecast.png`);
  await page.evaluate(() => window.FL.menu(false));
}

if (!want('absence')) { await page.evaluate(() => window.FL.debugSave(null)); await browser.close(); process.exit(0); }
// The absence report: it runs on the player's own base (the shell sets a debug base aside first),
// so give that one the demo line and eight hours away.
await page.evaluate(() => { window.FL.debugSave(null); window.FL.demo(); });
await page.evaluate(() => window.FL.simulateAbsence(8));
await page.waitForSelector('[data-screen="absence"] [data-absence-panel]', { timeout: 30000 });
await page.waitForTimeout(600);
await page.screenshot({ path: shot('absence') });
console.log(`✓ ${PREFIX}-absence.png`);
await page.evaluate(() => window.FL.absence(false));
await browser.close();
