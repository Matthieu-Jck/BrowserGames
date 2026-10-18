// post-entrance-shots.mjs — a trade post's two stores (D131) for visual review, in French and in
// English at 1440 × 900, on the late debug base: the item its first post's entrance is fed is found, the post is set to
// import that very item (a standing order, its exit already led into the Core), the game runs a few
// minutes, and the post's inspector is shot — « À vendre » (what its entrance brought, sold at the
// minute's end) and « Livré, attend la sortie » (the purchases for its exit), the same item in both.
// When nothing feeds its entrance on this build, a line from a silo of copper ore is laid to it.
// Usage: a server (the dev one on :5183, or a frozen preview build: URL=…), then
// `node scripts/post-entrance-shots.mjs` → scripts/post-entrance-<tag>-<lang>.png (gitignored).
// Env: URL, CHROME, TAG (a prefix for the files), OUT (a folder for them), LANGS (« fr,en »).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5183';
const TAG = process.env.TAG ?? 'now';
const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('.', import.meta.url));
const LANGS = (process.env.LANGS ?? 'fr,en').split(',');

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let failed = false;
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed = true; };

for (const lang of LANGS) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: lang === 'fr' ? 'fr-FR' : 'en-GB' });
  const page = await context.newPage();
  page.on('pageerror', (err) => { failed = true; console.log('pageerror:', err.message); });
  await page.goto(`${URL}/?debug`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 15000 });
  const FL = (fn, arg) => page.evaluate(fn, arg);
  await FL(() => { if (window.FL.app.guide) window.FL.app.guide.enabled = false; window.FL.pause(); });
  const r = await FL(() => window.FL.debugSave('late'));
  check(r.ok, `${lang}: the late base`);
  await FL(() => { window.FL.menu(false); window.FL.close(); window.FL.resume(); });
  const post = await FL(() => window.FL.tradePost());
  check(post > 0, `${lang}: its first post`);
  // A few minutes: what reaches its entrance?
  await FL(() => window.FL.tick(1800));
  let item = await FL((p) => {
    const sim = window.FL.app.sim, st = sim.selling.get(p), sold = sim.trade.soldTotal;
    let best = -1;
    for (let i = 0; i < sold.length; i++) if ((sold[i] > 0 || (st?.[i] ?? 0) > 0) && (best < 0 || sold[i] > sold[best])) best = i;
    return best;
  }, post);
  if (item < 0) {
    // Nothing feeds it: a silo of copper ore by the Core, a line from it into the post's entrance.
    item = await FL((p) => {
      const sim = window.FL.app.sim, e = sim.ents.get(p);
      for (let dy = 8; dy < 20; dy++) for (let dx = -6; dx < 8; dx++) {
        const r = sim.place('silo', e.x + dx, e.y + dy, 0);
        if (!r.ok) continue;
        sim.ensureCompiled();
        const it = window.FL.itemIndex('copper_ore');
        sim.stores.get(r.id)[it] = 2000 * 1000;
        sim.graph.nodeByEnt.get(r.id).locked = it;
        if (window.FL.connect(r.id, p) > 0) return it;
        sim.remove(e.x + dx, e.y + dy);
      }
      return -1;
    }, post);
  }
  check(item >= 0, `${lang}: an item its entrance is fed`);
  // Import that very item; its exit into the Core.
  // Its id, then an order for that very item at three times its ask; its exit led into the Core if it leads nowhere.
  const itemName = await FL((it) => { for (const id of ['iron_ore', 'copper_ore', 'glass', 'iron_plate', 'sand', 'coal', 'stone', 'quartz', 'copper_wire', 'gear', 'circuit']) if (window.FL.itemIndex(id) === it) return id; return null; }, item);
  check(!!itemName, `${lang}: the item (${itemName})`);
  const oid = await FL(([p, id, it]) => {
    const sim = window.FL.app.sim;
    sim.grantCredits(2_000_000);
    sim.ensureCompiled();
    if (!sim.graph.nodeByEnt.get(p).outE.length) window.FL.connect(p, sim.hearthId);
    return sim.addImport(p, id, 10, Math.max(1, Math.round(sim.prices.ask[it] * 3)));
  }, [post, itemName, item]);
  check(typeof oid === 'number', `${lang}: an order for ${itemName} (${oid})`);
  // Until a delivery is in its container while its entrance still brings the same: both cards filled.
  let both = false;
  for (let k = 0; k < 30 && !both; k++) {
    await FL(() => window.FL.tick(150));
    both = await FL(([p, it]) => { const s = window.FL.app.sim; return (s.stores.get(p)?.[it] ?? 0) >= 1000 && (s.selling.get(p)?.[it] ?? 0) >= 1000; }, [post, item]);
  }
  check(both, `${lang}: the same item to sell and delivered`);
  await FL((p) => { const e = window.FL.app.sim.ents.get(p); window.FL.lookAt(e.x + 2.5, e.y + 2.5, 1.5); window.FL.selected(p); }, post);
  await page.waitForSelector('.inspector:not([hidden]) [data-tp="sell"]', { timeout: 3000 });
  await page.waitForTimeout(700);
  const cards = await FL(() => ['sell', 'cargo'].map((k) => document.querySelectorAll(`.inspector [data-tp="${k}"] .tp-line[data-item]`).length));
  check(cards[0] > 0 && cards[1] > 0, `${lang}: « à vendre » ${cards[0]} line(s), « livré » ${cards[1]}`);
  await page.screenshot({ path: join(OUT, `post-entrance-${TAG}-${lang}.png`) });
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
