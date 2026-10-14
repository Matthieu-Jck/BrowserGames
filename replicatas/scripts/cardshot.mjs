import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:5199', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.click('text=INITIALIZE PROBE');
await p.waitForTimeout(1200);
await p.click('#cutscene-skip');
await p.waitForSelector('section[data-screen="galaxy"].visible');
await p.evaluate(() => {
  const r = window.RP;
  r.run().deck = [];
  for (const id of ['lance_of_dawn','railshot','critical_mass','phase_skip','nanite_cloud','salvage_claw','causal_loop','siege_cannon','annihilation_ray','flicker_drive','overclock','glitch']) r.card(id);
});
await p.click('#btn-deck');
await p.waitForTimeout(700);
await p.screenshot({ path: 'scripts/shot-cards.png' });
await b.close();
console.log('done');
