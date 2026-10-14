// smoke.mjs — headless end-to-end smoke test. Drives the whole journey through the
// window.AG debug API: every chapter's blunt verdict must fire on a wrong guess and agree
// with the engine on the right one; the auction must converge; the fishery must collapse
// under open access and survive under a quota; the report card must render. Fails on any
// console / page error. Modelled on replicatas/overtime smoke scripts.
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5176';
const errors = [];

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('response', (res) => {
  if (!res.ok() && !res.url().includes('favicon')) errors.push(`http ${res.status()}: ${res.url()}`);
});

const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✗ ${name}: ${e.message}`); errors.push(`step ${name}: ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

await step('boots: intro + window.AG', async () => {
  await page.waitForSelector('[data-screen="intro"]', { timeout: 6000 });
  await page.waitForSelector('.intro .title', { timeout: 2000 });
  await page.waitForFunction(() => !!window.AG, undefined, { timeout: 5000 });
});

// Chapter sizes (beats per chapter).
const beatsOf = { 1: 5, 2: 5, 3: 6, 4: 4, 5: 6 };

for (const ch of [1, 2, 3, 4, 5]) {
  await step(`chapter ${ch}: blunt feedback fires and the engine agrees`, async () => {
    await page.evaluate((c) => window.AG.goToChapter(c), ch);
    await page.waitForSelector(`[data-screen="beat"]`, { timeout: 5000 });
    for (let b = 0; b < beatsOf[ch]; b++) {
      await page.evaluate((a) => window.AG.goToBeat(a.ch, a.b), { ch, b });
      const s = await page.evaluate(() => window.AG.state());
      if (s.kind === 'predict') {
        await page.evaluate(() => window.AG.predict(999999)); // deliberately absurd
        const wrong = await page.evaluate(() => window.AG.verdict()?.severity);
        assert(wrong === 'wrong' || wrong === 'catastrophic', `${s.beatId} wrong guess should be harsh, got ${wrong}`);
        await page.evaluate(() => window.AG.solve()); // the engine's correct answer
        const right = await page.evaluate(() => window.AG.verdict()?.severity);
        assert(right === 'nailed', `${s.beatId} correct answer should be nailed, got ${right}`);
      } else if (s.kind === 'challenge') {
        await page.evaluate(() => window.AG.solve());
        const v = await page.evaluate(() => window.AG.verdict());
        assert(v && v.severity === 'nailed', `${s.beatId} solved challenge should be nailed, got ${v?.severity}`);
      }
    }
    await page.screenshot({ path: `scripts/smoke-ch${ch}.png` });
  });
}

await step('the double auction converges to equilibrium', async () => {
  await page.evaluate(() => window.AG.goToBeat(2, 2));
  await page.evaluate(() => window.AG.runSim());
  const r = await page.evaluate(() => window.AG.result());
  assert(Math.abs(r.finalMeanPrice - r.equilibrium.priceStar) / r.equilibrium.priceStar < 0.08,
    `auction did not converge: ${r.finalMeanPrice} vs ${r.equilibrium.priceStar}`);
  assert(r.efficiency > 0.9, `auction efficiency too low: ${r.efficiency}`);
});

await step('the commons collapses under open access', async () => {
  await page.evaluate(() => window.AG.goToBeat(5, 1)); // open access, 16 boats
  await page.evaluate(() => window.AG.runSim());
  const r = await page.evaluate(() => window.AG.result());
  assert(r.collapsed === true, 'open-access fishery should collapse');
});

await step('a quota saves the fishery', async () => {
  await page.evaluate(() => window.AG.goToBeat(5, 3)); // quota challenge
  await page.evaluate(() => window.AG.setSandbox('quota', 95));
  await page.evaluate(() => window.AG.runSim());
  const r = await page.evaluate(() => window.AG.result());
  assert(r.collapsed === false, 'quota fishery should survive');
});

await step('renders live frames', async () => {
  await page.waitForTimeout(700);
  const fps = await page.evaluate(() => window.AG.fps());
  assert(fps > 30, `fps too low: ${fps}`);
});

await step('reaches the report card', async () => {
  await page.evaluate(() => window.AG.complete());
  await page.waitForSelector('[data-screen="report-card"]', { timeout: 5000 });
});

await page.screenshot({ path: 'scripts/smoke-final.png' });
await browser.close();

const realErrors = errors.filter((e) => !e.includes('favicon') && !e.includes('Autoplay'));
if (realErrors.length) {
  console.log('\nERRORS:');
  for (const e of realErrors) console.log('  ' + e);
  process.exit(1);
}
console.log('\nSMOKE TEST PASSED — all five laws, both flagship sims, no console errors.');
