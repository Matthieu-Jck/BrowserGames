// neighbour-trade-shots.mjs — neighbouring bases of three trades, up close, by day and by night, and one
// at mid zoom (D110, fifth pass; owner, 2026-10-17: « les bases de PNJ n'ont aucun sens… rien n'est
// jamais envoyé par trade post… c'est tout petit »). On lands 1–3 of map 4 it picks, for three
// different trades, the base with the most machines, frames it on its buildings, and prints what it
// makes: each machine and its recipe, what it buys, the line into the trade post. Usage: a server (a
// frozen preview), then `URL=… [PROFILES=wind,ember] node scripts/neighbour-trade-shots.mjs` → scripts/nbt-*.png (gitignored).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./${name}`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const open = async (seed) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'fr-FR' });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('pageerror:', err.message));
  await page.goto(`${URL}/?seed=${seed}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
  await page.addStyleTag({ content: '.qlog, .guide, .toasts, #ui { display: none !important; }' });
  await page.waitForTimeout(500);
  return { context, page };
};
const settle = async (page, ms = 1500) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(ms);
};

// Every base of lands 1–3: its trade, its machines, its frame and its note.
const all = [];
for (const seed of [1, 2, 3]) {
  const { context, page } = await open(seed);
  const found = await page.evaluate(() => {
    const sim = window.FL.app.sim, out = [];
    const { buildings: B, items: I } = window.FL.ids();
    for (let p = 0; p < 45 * 45; p++) {
      const h = sim.neighbours.holdingOf(p);
      if (!h || h.hub !== p) continue;
      const L = sim.neighbours.layout(h);
      const machines = L.structs.filter((s) => s.role === 'make' || s.role === 'extract');
      if (!machines.length) continue;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const s of L.structs) if (s.role !== 'mast' && s.role !== 'power' && s.role !== 'extra') { x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + 3); y1 = Math.max(y1, s.y + 3); }
      const name = (d) => (B ? B[d] : String(d)), item = (i) => (I ? I[i] : String(i));
      const count = new Map();
      for (const s of machines) { const k = `${name(s.def)}${s.recipe ? ` (${s.recipe})` : ''} → ${(s.items ?? []).map(item).join('+')}`; count.set(k, (count.get(k) ?? 0) + 1); }
      const depot = L.structs.find((s) => s.role === 'depot');
      const post = L.structs.findIndex((s) => s.role === 'post');
      const sold = L.ribbons.find((r) => r.to === post);
      out.push({
        hub: p, profile: h.profile, parcels: h.parcels.length, machines: machines.length, makers: machines.filter((s) => s.role === 'make').length,
        at: [(x0 + x1) / 2, (y0 + y1) / 2], span: Math.max(x1 - x0, y1 - y0),
        note: `${h.profile} (${h.parcels.length} parcels) sells ${L.products.map(item).join(', ') || 'nothing'}: ${[...count].map(([k, n]) => `${n}× ${k}`).join('; ')}${depot ? `; buys ${(depot.items ?? []).map(item).join('+')} at its trade post, into a depot` : L.ribbons.some((r) => r.from === post) ? '; buys at its trade post' : ''}; its store → trade post: ${sold ? sold.items.map(item).join('+') : 'none'}`,
      });
    }
    return out;
  });
  for (const b of found) all.push({ ...b, seed });
  await context.close();
}

// Three trades (or those of PROFILES=wind,ember…), each its richest base (most makers, then machines).
const WANT = process.env.PROFILES ? process.env.PROFILES.split(',') : null;
const picks = [];
for (const b of [...all].sort((a, b) => b.makers - a.makers || b.machines - a.machines || a.seed - b.seed || a.hub - b.hub)) {
  if (WANT && !WANT.includes(b.profile)) continue;
  if (picks.length < (WANT ? WANT.length : 3) && !picks.some((p) => p.profile === b.profile)) picks.push(b);
}
for (const [k, b] of picks.entries()) {
  const { context, page } = await open(b.seed);
  await page.evaluate(([x, y]) => window.FL.app.sim.explored.push([Math.round(x), Math.round(y), 60]), b.at);
  const zoom = Math.max(0.75, Math.min(1.4, 30 / Math.max(14, b.span)));
  for (const phase of ['noon', 'night']) {
    await page.evaluate((x) => window.FL.dayPhase(x), phase);
    await page.evaluate(([x, y, z]) => window.FL.lookAt(x, y, z), [b.at[0], b.at[1], zoom]);
    await settle(page);
    const name = `nbt-${WANT ? 'x' : k + 1}-${b.profile}-${phase === 'noon' ? 'day' : 'night'}.png`;
    await page.screenshot({ path: shot(name) });
    console.log(`✓ ${name}  land ${b.seed}, base ${b.hub}, zoom ${zoom.toFixed(2)}`);
  }
  if (k === 0 && !WANT) {
    await page.evaluate((x) => window.FL.dayPhase(x), 'noon');
    await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 0.55), b.at);
    await settle(page);
    await page.screenshot({ path: shot(`nbt-mid-${b.profile}.png`) });
    console.log(`✓ nbt-mid-${b.profile}.png  mid zoom`);
  }
  console.log(`  ${b.note}`);
  await context.close();
}
console.log(`bases seen: ${all.length}; machines a base: ${(all.reduce((s, b) => s + b.machines, 0) / Math.max(1, all.length)).toFixed(1)}`);
await browser.close();
