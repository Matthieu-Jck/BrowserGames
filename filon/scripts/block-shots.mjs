// block-shots.mjs — map 4's deposits in whole 2 × 2 blocks (D104; owner, 2026-10-17: « les
// ressources disponibles ne sont pas des multiples de la taille des machines qui les extraient »):
// the cirque's deposits bare, then a drill laid on every block of them (the tired copper vein left
// bare for the ghost), in plan and iso, the whole floor and up close; then a drill held over the
// copper with the cursor on an odd tile, its ghost snapped onto the blocks' grid (plan: build mode):
// scripts/shot-blocks-*.png (gitignored). Usage: a server on :5183 (or URL=…, SEED=…), then
// `node scripts/block-shots.mjs`. It starts the sandbox base over (FL.wipe: map 4).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./shot-blocks-${name}.png`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=${process.env.SEED ?? '1'}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
await page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts, [data-screen="quests"] { display: none !important; }' });

const settle = async (ms = 1200) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

// The cirque's ore by 2 × 2 block (every one whole on map 4), and the tired vein's.
const cirque = await page.evaluate(() => {
  const sim = window.FL.app.sim, g = sim.grid, C = 512;
  const blocks = [];
  let broken = 0;
  for (let y = C - 26; y < C + 26; y += 2) for (let x = C - 26; x < C + 26; x += 2) {
    const o = g.ore(x, y);
    const all = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].map(([a, b]) => g.ore(a, b));
    if (all.every((v) => v < 0)) continue;
    if (all.some((v) => v !== o)) { broken++; continue; }
    blocks.push([x, y, o]);
  }
  // The tired vein: the block nearest the template's (4, 15) from the centre.
  const near = blocks.slice().sort((p, q) => ((p[0] - 516) ** 2 + (p[1] - 527) ** 2) - ((q[0] - 516) ** 2 + (q[1] - 527) ** 2))[0];
  return { blocks, broken, mapV: g.source.mapV, block: g.source.oreBlock ?? 1, copper: near ? near[2] : -1 };
});
console.log(`map ${cirque.mapV}, blocks of ${cirque.block}: ${cirque.blocks.length} whole blocks in the cirque, ${cirque.broken} broken`);
const copperBlocks = cirque.blocks.filter((b) => b[2] === cirque.copper);
const vein = copperBlocks.length ? [copperBlocks[0][0] + 1, copperBlocks[0][1] + 1] : [516, 527];

const shots = async (tag) => {
  for (const mode of ['plan', 'iso']) {
    await view(mode);
    await page.evaluate(() => window.FL.lookAt(506, 509, 0.95));
    await settle();
    await page.screenshot({ path: shot(`${tag}-cirque-${mode}`) });
    console.log(`✓ shot-blocks-${tag}-cirque-${mode}.png`);
    await page.evaluate(() => window.FL.lookAt(497, 510, 2.4));
    await settle();
    await page.screenshot({ path: shot(`${tag}-near-${mode}`) });
    console.log(`✓ shot-blocks-${tag}-near-${mode}.png`);
  }
};

await shots('bare');

// A drill on every block but the tired vein's, its output towards the Heart where it can.
const laid = await page.evaluate(({ blocks, copper }) => {
  const sim = window.FL.app.sim;
  let n = 0, refused = {};
  for (const [x, y, o] of blocks) {
    if (o === copper) continue;
    sim.grant('iron_plate', 10);
    sim.grant('glass', 2);
    let ok = false;
    for (const rot of [x + 1 < 512 ? 1 : 3, y + 1 < 512 ? 2 : 0, 0, 1, 2, 3]) {
      const r = sim.place('drill', x, y, rot);
      if (r.ok) { ok = true; break; }
      refused[r.reason] = (refused[r.reason] ?? 0) + 1;
    }
    if (ok) n++;
  }
  window.FL.tick(30);
  return { n, refused };
}, cirque);
console.log('drills laid', JSON.stringify(laid));
await shots('drills');

// A drill in hand over the tired vein, the cursor on an odd tile: its ghost on the grid (build
// mode shows the plan view).
{
  await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 3), vein);
  await settle();
  // The pointer on an odd tile of the vein (the tile's middle, as the camera shows it now).
  const at = [vein[0] | 1, vein[1] | 1];
  const [sx, sy] = await page.evaluate(([x, y]) => { window.FL.tool('drill'); return window.FL.tileToScreen(x, y); }, at);
  await page.mouse.move(sx, sy);
  await page.waitForTimeout(400);
  const held = await page.evaluate(() => {
    const p = window.FL.app.tools.preview();
    return { hover: window.FL.app.tools.hover, piece: p?.pieces?.[0] ? [p.pieces[0].x, p.pieces[0].y, p.pieces[0].ok] : null };
  });
  console.log('ghost', JSON.stringify({ at, ...held }));
  await page.screenshot({ path: shot('ghost') });
  console.log('✓ shot-blocks-ghost.png');
}
await browser.close();
