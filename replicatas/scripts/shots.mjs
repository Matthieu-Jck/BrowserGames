// shots.mjs — capture screenshots of key screens for visual review.
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5199';
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.click('text=INITIALIZE PROBE');
await page.waitForTimeout(1500);
await page.click('#cutscene-skip');
await page.waitForSelector('section[data-screen="galaxy"].visible');
await page.waitForTimeout(900);
await page.screenshot({ path: 'scripts/shot-galaxy.png' });

// galaxy with scanner 2 (3rd candidate + threat rows)
await page.evaluate(() => { window.RP.upgrade('scanner1'); window.RP.upgrade('scanner2'); });
await page.evaluate(() => window.RP.game.setScreen('galaxy', undefined, { noFade: true }));
await page.waitForTimeout(700);
await page.screenshot({ path: 'scripts/shot-galaxy-scan2.png' });

await page.click('.dest-card button >> nth=0');
await page.waitForSelector('section[data-screen="surface"].visible', { timeout: 9000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'scripts/shot-landing.png' });
await page.waitForTimeout(2600);
await page.screenshot({ path: 'scripts/shot-surface.png' });

await page.evaluate(() => window.RP.combat('hive_custodian'));
await page.waitForSelector('#hand .card');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'scripts/shot-combat.png' });
await page.evaluate(() => window.RP.winCombat());
await page.waitForSelector('section[data-screen="reward"].visible', { timeout: 6000 });
await page.waitForTimeout(600);
await page.screenshot({ path: 'scripts/shot-reward.png' });

await browser.close();
console.log('shots saved');
