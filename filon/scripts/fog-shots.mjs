// fog-shots.mjs — the fog without the survey beacon (D117) for review: a new base's edge of the
// clear, then a pole line walked out east from the Heart, each pole lifting the next stretch (plan
// and iso); then the same base exported, forged into a version-16 save holding two survey beacons
// far out (the fog they lifted with them), an unloader holding plates and both plans, imported: the
// report the player is shown on loading (the buildings that came down, refunded), and the land with
// the beacons' fog still lifted and the beacons gone. → shot-fog-*.png (gitignored).
// Usage: a server (the dev one on :5183, or a frozen preview build: URL=…), then
// `node scripts/fog-shots.mjs`. It starts the sandbox base over (FL.wipe). Env: URL, CHROME, OUT (a folder).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5183';
const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('.', import.meta.url));
const shot = (name) => join(OUT, `shot-fog-${name}.png`);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1, locale: 'fr-FR' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => { errors.push(err.message); console.log('pageerror:', err.message); });
const ready = async () => {
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
};
await page.goto(`${URL}/?seed=1`, { waitUntil: 'networkidle' });
await ready();
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await ready();
await page.evaluate(() => window.FL.pause());
const hide = '.qlog, .guide, .toasts, [data-screen="quests"] { display: none !important; }';
await page.addStyleTag({ content: hide });

const settle = async (ms = 900) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};
const C = 512;

// ── 1. a pole line walks the fog back ───────────────────────────────────────
await view('plan');
await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 0.3), [C, C]);
await settle();
await page.screenshot({ path: shot('poles-before-plan') });
// From the Heart out along each way in turn (a river or a chasm may stop a line: the next way is
// tried), a pole as far as a wire reaches (6 tiles) on revealed land, near the Heart's row or
// column: the farthest that places and wires to the last one. The first way that walks 30 tiles
// past the founding's clear is kept.
const walk = await page.evaluate((C) => {
  const sim = window.FL.app.sim;
  for (const [it, n] of [['iron_plate', 400], ['copper_wire', 200]]) sim.grant(it, n);
  const ways = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const out = [];
  for (const [ux, uy] of ways) {
    const edge = () => { let d = 0; while (sim.revealed(C + ux * d, C + uy * d)) d++; return d; };
    const before = edge(), discs = sim.explored.length;
    let last = null, a = 2, b = 0; // along the way, across it
    let poles = 0;
    for (let k = 0; k < 18; k++) {
      let ok = null;
      for (let da = 6; da >= 2 && !ok; da--) {
        for (const db of [0, 1, -1, 2, -2, 3, -3]) {
          const na = a + da, nb = b + db, x = C + ux * na - uy * nb, y = C + uy * na + ux * nb;
          if (Math.abs(nb) > 6 || da * da + db * db > 36 || !sim.revealed(x, y)) continue;
          const c = sim.canPlace('mast', x, y, 0);
          if (!c.ok || c.replaces.length) continue;
          const r = window.FL.place('mast', x, y, 0);
          if (!r.ok) continue;
          if (last && !sim.links.has(last, r.id) && !sim.link(last, r.id).ok) { sim.remove(x, y); continue; }
          ok = r; a = na; b = nb;
          break;
        }
      }
      if (!ok) break;
      last = ok.id;
      poles++;
    }
    out.push({ way: [ux, uy], before, after: edge(), poles, discs: sim.explored.length - discs });
    if (edge() >= before + 30) break;
  }
  return out;
}, C);
console.log('pole lines:', JSON.stringify(walk));
const won = walk.at(-1);
if (won.after < won.before + 30) throw new Error(`no pole line walked the fog back: ${JSON.stringify(walk)}`);
await settle();
await page.screenshot({ path: shot('poles-after-plan') });
const [ux, uy] = won.way;
await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 0.6), [C + ux * (won.before + 15), C + uy * (won.before + 15)]);
await settle();
await page.screenshot({ path: shot('poles-after-plan-near') });
await view('iso');
await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 0.8), [C + ux * (won.before + 15), C + uy * (won.before + 15)]);
await settle();
await page.screenshot({ path: shot('poles-after-iso') });

// ── 2. a save of before, with beacons and an unloader, loaded ───────────────
const text = await page.evaluate(() => window.FL.exportText());
const before = await page.evaluate(() => window.FL.stocks());
const forged = await page.evaluate(async ([text, C]) => {
  const o = JSON.parse(text);
  const bin = atob(o.payload);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const d = JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  const def = (id) => { let i = d.content.buildings.indexOf(id); if (i < 0) { i = d.content.buildings.length; d.content.buildings.push(id); } return i; };
  const put = (id, x, y) => { const e = d.nextId++; d.ents.push(e, def(id), x, y, 0, 0, 0); return e; };
  // Two beacons far out, each with the 40 tiles of fog it lifted; an unloader by the Heart holding 3 plates.
  for (const [x, y] of [[C - 80, C + 20], [C + 10, C - 85]]) { put('beacon', x, y); d.explored.push([x, y, 40]); }
  const u = put('unloader', C + 6, C - 6);
  d.nodes.push([u, { item: d.content.items.indexOf('iron_plate'), mu: 3000, turn: 0 }]);
  d.done = [...d.done, 'beacon', 'unloader'].sort();
  d.v = 16;
  const gz = new Uint8Array(await new Response(new Blob([JSON.stringify(d)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let h = 0x811c9dc5;
  for (let i = 0; i < gz.length; i++) h = Math.imul(h ^ gz[i], 0x01000193) >>> 0;
  let b = '';
  for (let i = 0; i < gz.length; i += 0x8000) b += String.fromCharCode(...gz.subarray(i, i + 0x8000));
  return JSON.stringify({ ...o, version: 16, payload: btoa(b), checksum: h });
}, [text, C]);
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate((t) => window.FL.importText(t), forged)]);
await ready();
await page.evaluate(() => window.FL.pause());
await page.addStyleTag({ content: hide });
const after = await page.evaluate(() => ({ stocks: window.FL.stocks(), changes: window.FL.app.changes, done: [...window.FL.app.sim.done] }));
console.log('changes:', JSON.stringify(after.changes));
for (const id of ['iron_plate', 'glass', 'copper_wire']) console.log(`${id}: ${before[id] ?? 0} → ${after.stocks[id] ?? 0}`);
if (after.done.includes('beacon') || after.done.includes('unloader')) throw new Error('a retired plan is still held');
await page.evaluate(() => window.FL.absence(true));
await page.waitForTimeout(800);
await page.screenshot({ path: shot('save-report') });
await page.evaluate(() => window.FL.absence(false));
await view('plan');
await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 0.32), [C - 20, C - 20]);
await settle();
await page.screenshot({ path: shot('save-land-plan') });

console.log(errors.length ? `${errors.length} page errors` : 'no page errors');
await browser.close();
