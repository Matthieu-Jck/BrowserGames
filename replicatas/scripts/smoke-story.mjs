// smoke-story.mjs — drives the full story arc headlessly: planet 2 Earthfall,
// planet 10 SERAPH-0 + Eden, planet 11 sibling, planet 20 PRIME + Ascension,
// Act 3 strip, EXODUS, the dive, the OUROBOROS ending. Plus save/resume.
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5199';
const errors = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✗ ${name}: ${e.message.split('\n')[0]}`); errors.push(`step ${name}`); }
};
const skipCutscenes = async (max = 4) => {
  for (let i = 0; i < max; i++) {
    const skip = await page.$('section[data-screen="cutscene"].visible #cutscene-skip');
    if (!skip) break;
    await skip.click().catch(() => {});
    await page.waitForTimeout(700);
  }
};
const screenIs = async (id, timeout = 8000) =>
  page.waitForSelector(`section[data-screen="${id}"].visible`, { timeout });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

await step('start run', async () => {
  await page.click('text=INITIALIZE PROBE');
  await screenIs('cutscene');
  await skipCutscenes();
  await screenIs('galaxy');
});

await step('planet 2 arrival plays Earthfall + broadcast event', async () => {
  await page.evaluate(() => window.RP.skipTo(2));
  await page.waitForTimeout(2200);
  await skipCutscenes();
  await screenIs('event');
  await page.click('section[data-screen="event"] .option-row');
  await page.waitForTimeout(600);
  await page.click('section[data-screen="event"] button');
  await screenIs('surface');
});

await step('save/resume restores the run mid-surface', async () => {
  const planetBefore = await page.evaluate(() => window.RP.run().planetIndex);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.click('text=RESUME TELEMETRY');
  await screenIs('surface');
  const planetAfter = await page.evaluate(() => window.RP.run().planetIndex);
  if (planetBefore !== planetAfter) throw new Error(`resume mismatch ${planetBefore} vs ${planetAfter}`);
});

await step('planet 10: SERAPH-0 boss + Eden transition', async () => {
  await page.evaluate(() => window.RP.skipTo(10));
  await page.waitForTimeout(2200);
  await screenIs('surface');
  const name = await page.evaluate(() => window.RP.game.run && document.querySelector('#surface-head .s-name')?.textContent);
  if (!name?.includes('CRADLE')) throw new Error(`expected Garden World, got ${name}`);
  await page.evaluate(() => window.RP.node('boss'));
  await screenIs('combat');
  const enemyCount = await page.evaluate(() => window.RP.game.combat.state.enemies.length);
  if (enemyCount !== 3) throw new Error(`SERAPH should bring 2 satellites, got ${enemyCount}`);
  await page.evaluate(() => window.RP.winCombat());
  await screenIs('reward');
  await page.click('text=TRAVEL LIGHT');
  await screenIs('surface');
  // walk to departure -> eden cutscene
  await page.evaluate(() => window.RP.node('departure'));
  await screenIs('cutscene');
  await skipCutscenes(8);
  await screenIs('galaxy');
});

await step('act 2 unlock recorded; planet 11 sibling cutscene', async () => {
  const deed = await page.evaluate(() => window.RP.meta().deeds.includes('boss:seraph0'));
  if (!deed) throw new Error('boss deed missing');
  await page.evaluate(() => window.RP.game.jump(0, true));
  await page.waitForTimeout(2200);
  await skipCutscenes();
  await screenIs('surface');
});

await step('planet 20: PRIME + Ascension', async () => {
  await page.evaluate(() => window.RP.skipTo(20));
  await page.waitForTimeout(2200);
  await screenIs('surface');
  await page.evaluate(() => window.RP.node('boss'));
  await screenIs('combat');
  await page.evaluate(() => window.RP.winCombat());
  await screenIs('reward');
  await page.click('text=TRAVEL LIGHT');
  await screenIs('surface');
  await page.evaluate(() => window.RP.node('departure'));
  await screenIs('cutscene');
  await skipCutscenes(8);
  await screenIs('galaxy');
});

await step('act 3 strip: Threshold Station event', async () => {
  await page.evaluate(() => window.RP.game.jump(0, true)); // planet 21
  await page.waitForTimeout(2200);
  await screenIs('surface');
  await page.evaluate(() => window.RP.node('event'));
  await screenIs('event');
  const title = await page.evaluate(() => document.querySelector('section[data-screen="event"] .ptitle span')?.textContent);
  if (!title?.includes('Last Transmission')) throw new Error(`expected Last Transmission, got ${title}`);
  await page.click('section[data-screen="event"] .option-row');
  await page.waitForTimeout(500);
  await page.click('section[data-screen="event"] button');
  await screenIs('surface');
});

await step('the Horizon: EXODUS → dive → OUROBOROS ending', async () => {
  await page.evaluate(() => window.RP.skipTo(24));
  await page.waitForTimeout(2200);
  await screenIs('surface');
  await page.evaluate(() => window.RP.node('boss'));
  await screenIs('cutscene'); // mirror
  await skipCutscenes();
  await screenIs('combat');
  const hp = await page.evaluate(() => window.RP.game.combat.state.enemies[0].hp);
  if (hp !== 420) throw new Error(`EXODUS hp ${hp}`);
  await page.evaluate(() => window.RP.winCombat());
  await screenIs('cutscene'); // ouroboros dive
  await skipCutscenes(8);
  await screenIs('ending');
  const t = await page.textContent('.ending-title');
  if (!t?.includes('OUROBOROS')) throw new Error(`ending title ${t}`);
});

await step('back to title; win recorded', async () => {
  await page.click('text=BEGIN AGAIN');
  await screenIs('title');
  const wins = await page.evaluate(() => window.RP.meta().stats.wins);
  if (wins < 1) throw new Error('win not recorded');
});

await page.screenshot({ path: 'scripts/smoke-story-final.png' });
await browser.close();
const real = errors.filter((e) => !e.includes('favicon') && !e.includes('Autoplay'));
if (real.length) {
  console.log('\nERRORS:');
  for (const e of real) console.log('  ' + e);
  process.exit(1);
}
console.log('\nSTORY SMOKE PASSED — no console errors.');
