// launch-shots.mjs — the research launch dialog after D128 (told around the outcome: the tokens it
// needs, a bar of where they will come from — the reserve, the free compute, the flow bought, what
// none reaches —, one plain sentence, the end) for visual review, at 1440 × 900 on the « late » debug
// base (the Core at level 5), in its three main cases:
//   · `reserve`: a reserve of 1 303 716 tokens (the owner's screenshot) covers the node: no flow to
//     buy, « Ta réserve couvre tout » ;
//   · `busy`: a project already running in the other lab takes the free compute first: « Le calcul
//     gratuit va d'abord à « … » (en cours) » ;
//   · `buy`: no reserve, nothing running: the free compute is short of the node's pace, a flow is
//     proposed and its price shown.
// Each case asserts what the dialog says and that the bar's parts add up. The base is rigged in the
// sandbox (outside commands): the items granted, the Research Queue learnt so Computing opens, the
// projects cancelled, a second lab placed and wired by the Heart.
// Usage: a server (the dev one on :5183, or a frozen preview build: URL=…), then
// `node scripts/launch-shots.mjs` → scripts/launch-<tag>-<lang>-<case>.png (gitignored).
// Env: URL, CHROME, TAG (a prefix for the files), OUT (a folder for them), LANGS (« fr,en »).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5183';
const TAG = process.env.TAG ?? 'now';
const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('.', import.meta.url));
const LANGS = (process.env.LANGS ?? 'fr,en').split(',');
const VIEW = { width: 1440, height: 900 };
/** The node launched in each case: Cooled Server, Tier 3 (600 000 tokens at an hour's pace). */
const NODE = 'an_cooled';
/** What runs in the other lab in the `busy` case: Data Mining, Tier 3 too. */
const BEFORE = 'an_mining';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
let failed = false;
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed = true; };

for (const lang of LANGS) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, locale: lang === 'fr' ? 'fr-FR' : 'en-GB' });
  const page = await context.newPage();
  page.on('pageerror', (err) => { errors.push(err.message); console.log('pageerror:', err.message); });
  await page.goto(`${URL}/?debug`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 15000 });
  await page.evaluate((l) => { window.FL.setLocale(l); window.FL.intro?.(false); window.FL.menu?.(false); if (window.FL.app.guide) window.FL.app.guide.enabled = false; }, lang);
  const r = await page.evaluate(() => window.FL.debugSave('late'));
  console.log(`[${lang}] late base: ${r.ok ? `${r.ms} ms` : 'refused'}`);
  await page.evaluate(() => { window.FL.menu(false); window.FL.close(); window.FL.pause(); });
  // The rig: every item in the Core, the Research Queue learnt (Computing opens: D128), no project, two labs.
  const rig = await page.evaluate(() => {
    const FL = window.FL, sim = FL.app.sim;
    for (const it of FL.ids().items) sim.grant(it, 3000);
    FL.unlock('an_queue');
    for (const p of [...sim.projects]) sim.cancelResearch(p.id);
    sim.tokenBank = 0;
    sim.grantCredits(50_000_000);
    if (sim.idleLabs().length < 2) {
      const h = sim.ents.get(sim.hearthId);
      const at = FL.freeSpot('observatory', h.x + 12, h.y + 8, 30);
      const placed = at ? FL.place('observatory', at[0], at[1], 0) : { ok: false };
      if (placed.ok) FL.powerTo(placed.id);
    }
    FL.tick(2);
    return { labs: sim.idleLabs().length, slots: sim.mods.slots, block: sim.researchBlock('an_cooled') };
  });
  console.log(`[${lang}] rig: ${JSON.stringify(rig)}`);
  check(rig.labs >= 2 && rig.block === null, `[${lang}] two idle labs, ${NODE} ready to launch`);

  /** Open the tree on the node and its launch dialog; what it says. */
  const dialog = async () => {
    await page.evaluate(() => window.FL.open('research'));
    await page.waitForSelector('[data-screen="research"][data-open]', { timeout: 3000 });
    await page.evaluate((id) => document.querySelector(`.tr-node[data-id="${id}"]`)?.scrollIntoView({ block: 'center', inline: 'center' }), NODE);
    await page.click(`.rs-card[data-id="${NODE}"]`);
    await page.click('.rs-detail .btn.primary');
    await page.waitForSelector('[data-launch]:not([hidden])', { timeout: 2000 });
    await page.waitForTimeout(450);
    return page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const part = (k) => { const s = q(`[data-launch-bar] [data-k="${k}"]`); return s && !s.hidden ? parseFloat(s.style.width) || 0 : 0; };
      return {
        note: q('[data-launch-note]')?.textContent ?? '', eta: q('[data-launch-eta]')?.textContent ?? '',
        buy: !q('[data-launch-buy]')?.hidden, flow: q('[data-launch-flow]')?.value, cost: q('[data-launch-cost]')?.textContent ?? '',
        parts: { bank: part('bank'), free: part('free'), bought: part('bought'), short: part('short') },
      };
    });
  };
  const shoot = async (name) => { await page.locator('[data-launch] .ld').screenshot({ path: join(OUT, `launch-${TAG}-${lang}-${name}.png`) }); };
  const shut = async () => { await page.keyboard.press('Escape'); await page.evaluate(() => window.FL.close()); await page.waitForTimeout(200); };
  const sum = (p) => p.bank + p.free + p.bought + p.short;

  // 1 — the reserve covers it all: nothing to buy.
  await page.evaluate(() => window.FL.bankTokens(1_303_716));
  let d = await dialog();
  console.log(`[${lang}] reserve: ${JSON.stringify(d)}`);
  // The first minute's free compute pays a sliver first (the boundary's order), the reserve the rest.
  check(!d.buy && /réserve|reserve/i.test(d.note) && d.parts.bank > 90 && Math.abs(sum(d.parts) - 100) < 1, `[${lang}] reserve: the reserve pays it all, no flow offered`);
  await shoot('reserve');
  await shut();

  // 2 — the free compute busy: a project in the other lab takes it first.
  await page.evaluate((b) => { const sim = window.FL.app.sim; sim.tokenBank = 0; sim.startResearch(b, 0, 0); window.FL.tick(2); }, BEFORE);
  d = await dialog();
  console.log(`[${lang}] busy: ${JSON.stringify(d)}`);
  check(/d’abord|first/i.test(d.note) && Math.abs(sum(d.parts) - 100) < 1, `[${lang}] busy: the sentence names the project before it, the bar adds up`);
  await shoot('busy');
  await shut();

  // 3 — buying needed: nothing running, no reserve; the free compute short of the node's pace.
  await page.evaluate((b) => { window.FL.app.sim.cancelResearch(b); window.FL.tick(2); }, BEFORE);
  d = await dialog();
  console.log(`[${lang}] buy: ${JSON.stringify(d)}`);
  check(d.buy && Number(d.flow) > 0 && d.parts.bought > 0 && Math.abs(sum(d.parts) - 100) < 1 && !!d.note, `[${lang}] buy: a flow proposed, its part in the bar, a sentence`);
  await shoot('buy');
  await shut();
  await context.close();
}

await browser.close();
if (errors.length) { console.log(`✗ ${errors.length} page errors`); failed = true; }
console.log(`shots in ${OUT} (launch-${TAG}-*.png)`);
if (failed) process.exitCode = 1;
