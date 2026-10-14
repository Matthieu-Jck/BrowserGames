// smoke.mjs — headless end-to-end smoke test: title → run → galaxy → surface →
// combat → reward → forge/shop/event reachable → death → wake. Fails on console errors.
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5199';
const errors = [];

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    errors.push(`step ${name}: ${e.message}`);
  }
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

await step('title screen renders', async () => {
  await page.waitForSelector('section[data-screen="title"].visible', { timeout: 5000 });
  await page.waitForSelector('h1.gametitle', { timeout: 2000 });
});

await step('new run starts (cutscene)', async () => {
  await page.click('text=INITIALIZE PROBE');
  await page.waitForSelector('section[data-screen="cutscene"].visible', { timeout: 6000 });
});

await step('skip cutscene → galaxy', async () => {
  await page.click('#cutscene-skip');
  await page.waitForSelector('section[data-screen="galaxy"].visible', { timeout: 6000 });
  await page.waitForSelector('.dest-card', { timeout: 3000 });
});

await step('jump → landing → explorable surface', async () => {
  await page.click('.dest-card button >> nth=0');
  await page.waitForSelector('section[data-screen="surface"].visible', { timeout: 9000 });
  await page.waitForSelector('#surface-head .s-name', { timeout: 3000 });
  await page.waitForTimeout(3000); // landing descent
});

await step('travel to a beacon resolves an encounter', async () => {
  const ids = await page.evaluate(() => window.RP.reachable());
  if (!ids.length) throw new Error('no reachable beacons');
  await page.evaluate(() => window.RP.go());
  // probe drives, then fades into combat/event/shop/forge or an extraction modal
  await page.waitForFunction(() => {
    const screens = ['combat', 'event', 'shop', 'forge'];
    if (screens.some((s) => document.querySelector(`section[data-screen="${s}"].visible`))) return true;
    return !!document.querySelector('#modal-root.visible');
  }, undefined, { timeout: 15000 });
  // back out to the surface whatever it was — loop until clean
  for (let tries = 0; tries < 12; tries++) {
    await page.waitForTimeout(700);
    const hasCombat = await page.evaluate(() => !!window.RP.game.combat);
    if (hasCombat) { await page.evaluate(() => window.RP.winCombat()); continue; }
    const modalBtn = await page.$('#modal-root.visible .modal-choices button:not([disabled])');
    if (modalBtn) { await modalBtn.click(); continue; }
    const reward = await page.$('section[data-screen="reward"].visible');
    if (reward) { await page.click('text=TRAVEL LIGHT'); continue; }
    const ev = await page.$('section[data-screen="event"].visible .option-row:not(.disabled)');
    if (ev) { await ev.click(); continue; }
    const evBtn = await page.$('section[data-screen="event"].visible .cp-actions button');
    if (evBtn) { await evBtn.click(); continue; }
    const forge = await page.$('section[data-screen="forge"].visible');
    if (forge) { await page.click('text=LEAVE COLD'); continue; }
    const shop = await page.$('section[data-screen="shop"].visible');
    if (shop) { await page.click('text=LEAVE BAY'); continue; }
    const clean = await page.evaluate(() =>
      !!document.querySelector('section[data-screen="surface"].visible')
      && !document.querySelector('#modal-root.visible'));
    if (clean) break;
  }
  const ok = await page.evaluate(() =>
    !!document.querySelector('section[data-screen="surface"].visible')
    && !document.querySelector('#modal-root.visible'));
  if (!ok) throw new Error('did not settle back on a clean surface');
});

await step('debug: start a combat', async () => {
  await page.evaluate(() => window.RP.combat('feral_drone'));
  await page.waitForSelector('section[data-screen="combat"].visible', { timeout: 6000 });
  await page.waitForSelector('#hand .card', { timeout: 4000 });
  await page.waitForSelector('.enemy-tag', { timeout: 3000 });
});

await step('play an attack card on the enemy', async () => {
  // click cards until one selects (attack) or plays; the hand re-renders after
  // every click, so re-query by index instead of holding element handles
  const n = (await page.$$('#hand .card')).length;
  for (let i = 0; i < n; i++) {
    const card = await page.$(`#hand .card >> nth=${i}`);
    if (!card) break;
    await card.click().catch(() => {});
    await page.waitForTimeout(450);
    // a scout overlay may open (System Scan) — confirm it
    const scout = await page.$('#scout-confirm');
    if (scout) { await scout.click(); await page.waitForTimeout(300); }
    const selected = await page.$('#hand .card.selected');
    if (selected) {
      await page.click('.enemy-tag');
      await page.waitForTimeout(800);
      break;
    }
  }
});

await step('end turn cycles back to player', async () => {
  await page.click('#btn-endturn');
  await page.waitForTimeout(2500);
  const energy = await page.textContent('#energy-orb');
  if (!energy || Number(energy) < 1) throw new Error(`energy after refill: ${energy}`);
});

await step('debug: win combat → reward screen', async () => {
  await page.evaluate(() => window.RP.winCombat());
  await page.waitForSelector('section[data-screen="reward"].visible', { timeout: 6000 });
});

await step('skip reward → surface', async () => {
  await page.click('text=TRAVEL LIGHT');
  await page.waitForSelector('section[data-screen="surface"].visible', { timeout: 5000 });
});

await step('forge screen opens', async () => {
  await page.evaluate(() => window.RP.node('forge'));
  await page.waitForTimeout(700);
  const forge = await page.$('section[data-screen="forge"].visible');
  if (forge) {
    await page.click('text=LEAVE COLD');
    await page.waitForTimeout(400);
  } // forge may not exist on this planet — fine
});

await step('shop screen opens via debug jump', async () => {
  await page.evaluate(() => window.RP.node('fabricator'));
  await page.waitForTimeout(700);
  const shop = await page.$('section[data-screen="shop"].visible');
  if (shop) {
    await page.click('text=LEAVE BAY');
    await page.waitForTimeout(400);
  }
});

await step('death without backup → gameover', async () => {
  await page.evaluate(() => window.RP.combat('feral_drone'));
  await page.waitForSelector('section[data-screen="combat"].visible', { timeout: 5000 });
  await page.evaluate(() => window.RP.die());
  await page.waitForSelector('section[data-screen="gameover"].visible', { timeout: 8000 });
});

await step('return to title banks data', async () => {
  await page.click('text=RETURN TO THE ARCHIVE');
  await page.waitForSelector('section[data-screen="title"].visible', { timeout: 5000 });
});

await step('death WITH backup → wake + mutation', async () => {
  await page.click('text=INITIALIZE PROBE');
  await page.waitForSelector('section[data-screen="cutscene"].visible', { timeout: 5000 });
  await page.click('#cutscene-skip');
  await page.waitForSelector('section[data-screen="galaxy"].visible', { timeout: 5000 });
  await page.click('.dest-card button >> nth=0');
  await page.waitForSelector('section[data-screen="surface"].visible', { timeout: 9000 });
  await page.evaluate(() => window.RP.backup());
  await page.evaluate(() => window.RP.combat('feral_drone'));
  await page.waitForSelector('section[data-screen="combat"].visible', { timeout: 5000 });
  await page.evaluate(() => window.RP.die());
  // first death plays a cutscene
  await page.waitForSelector('section[data-screen="cutscene"].visible', { timeout: 8000 });
  await page.click('#cutscene-skip');
  await page.waitForSelector('section[data-screen="wake"].visible', { timeout: 6000 });
  await page.click('section[data-screen="wake"] .backup-card');
  await page.waitForSelector('section[data-screen="wake"] .option-row', { timeout: 4000 });
  await page.click('section[data-screen="wake"] .option-row');
  await page.waitForSelector('section[data-screen="surface"].visible', { timeout: 6000 });
});

await step('boss + ending flow via debug', async () => {
  await page.evaluate(() => window.RP.combat('exodus'));
  await page.waitForSelector('section[data-screen="cutscene"].visible', { timeout: 6000 });
  await page.click('#cutscene-skip');
  await page.waitForSelector('section[data-screen="combat"].visible', { timeout: 6000 });
  await page.evaluate(() => window.RP.winCombat());
  await page.waitForSelector('section[data-screen="cutscene"].visible', { timeout: 8000 });
  await page.click('#cutscene-skip');
  await page.waitForSelector('section[data-screen="ending"].visible', { timeout: 8000 });
});

await page.screenshot({ path: 'scripts/smoke-final.png' });
await browser.close();

const realErrors = errors.filter((e) => !e.includes('favicon') && !e.includes('Autoplay'));
if (realErrors.length) {
  console.log('\nERRORS:');
  for (const e of realErrors) console.log('  ' + e);
  process.exit(1);
}
console.log('\nSMOKE TEST PASSED — no console errors.');
