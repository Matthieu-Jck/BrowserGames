// research-shots.mjs — the tech tree's research half after D118 for visual review, in French and in
// English at 1440 × 900: on the « grown » debug base (Tier 1 learnt in part, the Core below level 3)
// the whole tree, the rule between Tier 1 and Tier 2 with Tier 2 padlocked, a Tier 1 node's detail
// (data alone), a locked Tier 2 node's detail (« Cœur niveau 3 requis ») and the whole tree zoomed
// out (the pinned tier names padlocked); on the « late » debug base (the Core at level 5) the launch
// dialog of a Tier 2+ node (a lab freed first), the same with more tokens bought, and the project
// running with its token row, its flows and the flow it buys.
// Usage: a server (the dev one on :5183, or a frozen preview build: URL=…), then
// `node scripts/research-shots.mjs` → scripts/research-<tag>-<lang>-*.png (gitignored).
// Env: URL, CHROME, TAG (a prefix for the files), OUT (a folder for them), LANGS (« fr,en »).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5183';
const TAG = process.env.TAG ?? 'now';
const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('.', import.meta.url));
const LANGS = (process.env.LANGS ?? 'fr,en').split(',');
const VIEW = { width: 1440, height: 900 };

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
let failed = false;
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed = true; };

/** A page at 1440 × 900 in this language, a debug base loaded, the tree open. */
async function open(level, lang) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, locale: lang === 'fr' ? 'fr-FR' : 'en-GB' });
  const page = await context.newPage();
  page.on('pageerror', (err) => { errors.push(err.message); console.log('pageerror:', err.message); });
  await page.goto(`${URL}/?debug`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 15000 });
  await page.evaluate((l) => { window.FL.setLocale(l); window.FL.intro?.(false); window.FL.menu?.(false); if (window.FL.app.guide) window.FL.app.guide.enabled = false; }, lang);
  const r = await page.evaluate((lv) => window.FL.debugSave(lv), level);
  console.log(`[${lang}] ${level} base: ${r.ok ? `${r.ms} ms` : 'refused'}`);
  await page.evaluate(() => { window.FL.menu(false); window.FL.close(); window.FL.pause(); });
  return { page, context, shot: (name) => join(OUT, `research-${TAG}-${lang}-${name}.png`) };
}

async function openTree(page) {
  await page.evaluate(() => window.FL.open('research'));
  await page.waitForSelector('[data-screen="research"][data-open]', { timeout: 3000 });
  await page.waitForTimeout(500);
}

/** The whole canvas: the window made as big as it, the shot taken, the window put back. */
async function whole(page, path) {
  const size = await page.evaluate(() => { const c = document.querySelector('.tr-canvas'); return { w: c.offsetWidth, h: c.offsetHeight }; });
  await page.setViewportSize({ width: size.w + 420, height: size.h + 160 });
  await page.waitForTimeout(400);
  await page.locator('.tr-canvas').screenshot({ path });
  await page.setViewportSize(VIEW);
  await page.waitForTimeout(300);
}

/** Select a node (brought into the middle of the view first): the first match of the first selector that matches (a list, in order of preference). */
async function pick(page, sel) {
  const id = await page.evaluate((list) => {
    const n = list.split(/,\s*/).map((s) => document.querySelector(s)).find(Boolean);
    n?.scrollIntoView({ block: 'center', inline: 'center' });
    return n?.getAttribute('data-id') ?? null;
  }, sel);
  if (!id) return null;
  await page.waitForTimeout(200);
  await page.click(`.tr-node[data-id="${id}"]`);
  await page.waitForTimeout(350);
  return id;
}

for (const lang of LANGS) {
  // ── grown: Tier 1 only, the Core below level 3 ──
  {
    const { page, context, shot } = await open('grown', lang);
    const lv = await page.evaluate(() => window.FL.app.sim.hearthLevel);
    console.log(`[${lang}] grown: Core level ${lv}`);
    await openTree(page);
    await whole(page, shot('grown-whole'));
    const t2 = await page.evaluate(() => ({
      head: document.querySelector('.tr-tierhead[data-tier="2"]')?.hasAttribute('data-locked'),
      band: document.querySelector('.tr-tiercol[data-tier="2"]')?.hasAttribute('data-locked'),
      text: document.querySelector('.tr-tierhead[data-tier="2"] .tr-tiertitle')?.textContent,
    }));
    check(t2.head && t2.band, `Tier 2 padlocked below Core level 3 (${t2.text})`);
    // The rule between Tier 1 and Tier 2, in the middle of the view.
    await page.evaluate(() => document.querySelector('.tr-tierrule')?.scrollIntoView({ block: 'start', inline: 'center' }));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    await page.screenshot({ path: shot('grown-boundary') });
    const t1 = await pick(page, '.tr-node[data-tier="1"][data-state="ready"], .tr-node[data-tier="1"]:not([data-state="done"])');
    const t1info = await page.evaluate(() => ({
      tok: !!document.querySelector('.rs-detail .rs-rcosts li[data-k="tok"]'),
      clock: !!document.querySelector('.rs-detail .tr-mark-clock, .tr-node .tr-time'),
    }));
    check(t1 && !t1info.tok && !t1info.clock, `Tier 1 node ${t1}: data alone, no tokens, no time`);
    await page.screenshot({ path: shot('grown-t1-detail') });
    const t2id = await pick(page, '.tr-node[data-tier="2"]');
    const why = await page.evaluate(() => document.querySelector('.rs-detail .rs-why[data-why="core"]')?.textContent ?? null);
    check(!!why, `locked Tier 2 node ${t2id}: « ${why} »`);
    await page.screenshot({ path: shot('grown-t2-detail') });
    await page.click('[data-tree-zoom="fit"]');
    await page.waitForTimeout(400);
    const pin = await page.evaluate(() => document.querySelector('.tr-pin[data-kind="tier"][data-tier="2"]')?.hasAttribute('data-locked'));
    check(pin, 'the pinned Tier 2 name padlocked');
    await page.screenshot({ path: shot('grown-fit') });
    await context.close();
  }

  // ── late: the Core at level 5, the launch dialog ──
  {
    const { page, context, shot } = await open('late', lang);
    // Two samples a game half-minute apart: the statistics' production rates for the data estimate.
    for (let k = 0; k < 3; k++) { await page.evaluate(() => window.FL.tick(300)); await page.waitForTimeout(250); }
    const st = await page.evaluate(() => {
      const sim = window.FL.app.sim;
      // A lab freed: the youngest project cancelled if none is idle.
      if (!sim.idleLabs().length && sim.projects.length) sim.cancelResearch(sim.projects[sim.projects.length - 1].id);
      // What the base has made of each kind of data so far (the dialog's estimate reads its rate).
      const made = Object.fromEntries(['journal_1', 'journal_2', 'atlas', 'codex'].map((k) => [k, Math.round(window.FL.produced(k))]));
      return { lv: sim.hearthLevel, idle: sim.idleLabs().length, projects: sim.projects.map((p) => p.id), credits: sim.credits / 100, made };
    });
    console.log(`[${lang}] late: ${JSON.stringify(st)}`);
    await openTree(page);
    // A Tier 2 project under way is cancelled, so a Tier 2 node is there to launch (the late base has learnt the rest of Tier 2).
    const freed = await page.evaluate(() => {
      const sim = window.FL.app.sim;
      const p = sim.projects.find((q) => document.querySelector(`.tr-node[data-id="${q.id}"]`)?.getAttribute('data-tier') === '2');
      if (p) sim.cancelResearch(p.id);
      return p?.id ?? null;
    });
    if (freed) { console.log(`[${lang}] late: ${freed} cancelled, to launch it again`); await page.waitForTimeout(500); }
    const id = await pick(page, '.tr-node[data-kind="research"][data-state="ready"][data-tier="2"], .tr-node[data-kind="research"][data-state="ready"]:not([data-tier="1"])');
    if (!id) {
      const states = await page.evaluate(() => [...document.querySelectorAll('.tr-node[data-kind="research"]')].map((n) => `${n.dataset.id}:${n.dataset.state}`).join(' '));
      check(false, `a Tier 2+ node ready to launch (${states})`);
    } else {
      await page.click('.rs-detail .rs-actions .btn.primary');
      await page.waitForTimeout(300);
      const shown = await page.evaluate(() => !document.querySelector('[data-launch]')?.hasAttribute('hidden'));
      check(shown, `« Lancer » on ${id} opens the launch dialog`);
      const read = () => page.evaluate(() => ({
        flow: document.querySelector('[data-launch-flow]')?.value,
        cost: document.querySelector('[data-launch-cost]')?.textContent,
        eta: document.querySelector('[data-launch-eta]')?.textContent,
        parts: [...document.querySelectorAll('.ld-part')].map((p) => p.textContent).join(' | '),
      }));
      console.log(`[${lang}] dialog: ${JSON.stringify(await read())}`);
      await page.screenshot({ path: shot('late-launch') });
      await page.focus('[data-launch-flow]');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
      console.log(`[${lang}] dialog, two steps up: ${JSON.stringify(await read())}`);
      await page.screenshot({ path: shot('late-launch-more') });
      // Esc cancels; « Lancer » again, then launch.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      const gone = await page.evaluate(() => document.querySelector('[data-launch]')?.hasAttribute('hidden'));
      const still = await page.evaluate(() => !!document.querySelector('[data-screen="research"][data-open]'));
      check(gone && still, 'Esc closes the dialog, the tree stays');
      await page.click('.rs-detail .rs-actions .btn.primary');
      await page.waitForTimeout(200);
      await page.click('[data-launch-go]');
      await page.waitForTimeout(300);
      const run = await page.evaluate((nid) => window.FL.app.sim.projects.find((p) => p.id === nid) ?? null, id);
      check(!!run, `launched ${id}: ${run ? `${run.tokens} tokens, buying ${run.buy}/min` : 'not running'}`);
      // A game minute: the tokens of its first boundary in.
      await page.evaluate(() => window.FL.tick(600));
      await page.waitForTimeout(600);
      await page.screenshot({ path: shot('late-running') });
      const prog = await page.evaluate(() => ({
        tok: document.querySelector('.rs-prow[data-k="tok"] small')?.textContent,
        now: document.querySelector('.rs-toknow')?.textContent,
        flow: document.querySelector('[data-rs-flow-v]')?.textContent,
        live: document.querySelector('.rs-live')?.textContent,
      }));
      console.log(`[${lang}] running: ${JSON.stringify(prog)}`);
      check(!!prog.tok, 'the running project shows its token row');
    }
    await context.close();
  }
}

await browser.close();
if (errors.length) { console.log(`✗ ${errors.length} page errors`); failed = true; }
if (failed) process.exitCode = 1;
console.log(`shots in ${OUT} (research-${TAG}-*.png)`);
