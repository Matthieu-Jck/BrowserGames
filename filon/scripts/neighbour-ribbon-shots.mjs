// neighbour-ribbon-shots.mjs — the neighbouring bases' ribbons and the goods riding them (D110; owner,
// 2026-10-17: « visual glitch where a ribbon from a PNJ base disappears »): on lands 1–3, the three
// bases nearest the Heart framed on their Core (their long lines from far extractors run off the
// view), by day and by night, cropped. In the page it also counts the goods drawn on a tile no drawn
// ribbon covers. Usage: a server (a frozen preview), then
// `URL=… PREFIX=before node scripts/neighbour-ribbon-shots.mjs` → scripts/nbr-<prefix>-*.png (gitignored).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./${name}`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';
const PREFIX = process.env.PREFIX ?? 'now';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (const seed of [1, 2, 3]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'fr-FR' });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('pageerror:', err.message));
  await page.goto(`${URL}/?seed=${seed}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
  await page.addStyleTag({ content: '.qlog, .guide, .toasts, #ui { display: none !important; }' });
  await page.waitForTimeout(500);
  const settle = async (ms = 1200) => {
    await page.waitForTimeout(300);
    await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(ms);
  };
  const bases = await page.evaluate(() => {
    const sim = window.FL.app.sim, out = [];
    sim.explored.push([512, 512, 300]);
    for (let p = 0; p < 45 * 45; p++) {
      const h = sim.neighbours.holdingOf(p);
      if (!h || h.hub !== p || sim.land.neighbour(p) < 0) continue;
      const L = sim.neighbours.layout(h), c = L.structs[L.core >= 0 ? L.core : 0];
      if (!c) continue;
      out.push({ hub: p, at: [c.x + 1.5, c.y + 1.5], d: Math.hypot(c.x - 512, c.y - 512), ribbons: L.ribbons.length, longest: Math.max(...L.ribbons.map((r) => r.tiles.length / 3)) });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 3);
  });
  for (const [k, b] of bases.entries()) {
    for (const phase of ['noon', 'night']) {
      await page.evaluate((x) => window.FL.dayPhase(x), phase);
      await page.evaluate(([x, y]) => window.FL.lookAt(x, y + 2, 1.3), b.at);
      await settle();
      // Goods on screen whose tile no drawn (unculled) ribbon sprite covers.
      const audit = await page.evaluate((hub) => window.FL.app.neighbours.audit?.(hub) ?? null, b.hub);
      const name = `nbr-${PREFIX}-L${seed}-${k + 1}-${phase === 'noon' ? 'day' : 'night'}.png`;
      await page.screenshot({ path: shot(name), clip: { x: 220, y: 100, width: 1000, height: 700 } });
      console.log(`✓ ${name}  base ${b.hub} at ${Math.round(b.d)} tiles, ${b.ribbons} ribbons (longest ${b.longest} tiles)${audit ? `; goods ${audit.goods}, off a ribbon tile ${audit.offTile}, on a culled ribbon ${audit.undrawn}` : ''}`);
    }
  }
  await context.close();
}
await browser.close();
