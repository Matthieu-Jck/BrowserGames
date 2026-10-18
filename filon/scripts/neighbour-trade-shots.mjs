// neighbour-trade-shots.mjs — neighbouring bases of three trades, up close, by day and by night, and one
// at mid zoom (D110, fifth pass, and D134; owner, 2026-10-17: « les bases de PNJ n'ont aucun sens… rien
// n'est jamais envoyé par trade post… c'est tout petit », then 2026-10-18: « Elle commande de la pierre,
// la transforme en minerai de fer et la revend ? »). On lands 1–3 of map 4 it picks, for three
// different trades, the base with the most machines, frames it on its buildings, and prints what it
// makes: each machine and its recipe, the lines its card tells (mine to post), the line into the
// trade post — and anything handed out of the post (there should be none: a base buys nothing).
// Usage: a server (a frozen preview), then `URL=… [PROFILES=wind,ember] [NAMES='Seven Horns']
// [HUBS=3:794,2:947] [SEEDS=1,2,3] [PREFIX=before] [CARD=1] [MID=1] [LOCALE=en-GB] node
// scripts/neighbour-trade-shots.mjs` → scripts/nbt-[prefix-]*.png (gitignored). NAMES picks bases by
// their colony's English name (the first of each found on SEEDS), HUBS by land and hub parcel (SEEDS
// must hold their lands), PROFILES by trade; CARD adds each base's card by day, MID its band
// at mid zoom; LOCALE the browser's language (French by default), its two letters in the file names.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./${name}`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';
const PREFIX = process.env.PREFIX ? `${process.env.PREFIX}-` : '';
const SEEDS = (process.env.SEEDS ?? '1,2,3').split(',').map(Number);
const NAMES = process.env.NAMES ? process.env.NAMES.split(',') : null;
const HUBS = process.env.HUBS ? process.env.HUBS.split(',').map((q) => q.split(':').map(Number)) : null;
const LOCALE = process.env.LOCALE ?? 'fr-FR';
const LANG = process.env.LOCALE ? `-${LOCALE.slice(0, 2)}` : '';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const open = async (seed) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: LOCALE });
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
for (const seed of SEEDS) {
  const { context, page } = await open(seed);
  const found = await page.evaluate(() => {
    const sim = window.FL.app.sim, out = [], cs = sim.market.snapshot().colonies;
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
      const post = L.structs.findIndex((s) => s.role === 'post');
      const sold = L.ribbons.find((r) => r.to === post);
      const handed = L.ribbons.filter((r) => r.from === post);
      out.push({
        hub: p, profile: h.profile, name: (cs.find((c) => c.idx === h.colony) ?? cs[h.colony])?.name?.en ?? '', story: L.story ? L.story.map(item).join(' → ') : '', parcels: h.parcels.length, machines: machines.length, makers: machines.filter((s) => s.role === 'make').length,
        at: [(x0 + x1) / 2, (y0 + y1) / 2], span: Math.max(x1 - x0, y1 - y0),
        note: `${h.profile} (${h.parcels.length} parcels) ${(L.lines ?? []).map((l) => `[${l.map(item).join(' → ')}]`).join(' ')} sells ${L.products.map(item).join(', ') || 'nothing'}: ${[...count].map(([k, n]) => `${n}× ${k}`).join('; ')}${handed.length ? `; HANDS OUT OF ITS TRADE POST: ${handed.map((r) => r.items.map(item).join('+')).join(', ')}` : ''}; its store → trade post: ${sold ? sold.items.map(item).join('+') : 'none'}`,
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
if (HUBS) for (const [seed, hub] of HUBS) { const b = all.find((q) => q.seed === seed && q.hub === hub); if (b) picks.push(b); else console.log(`no base at ${hub} on land ${seed}`); }
else if (NAMES) for (const n of NAMES) { const b = all.find((q) => q.name === n); if (b) picks.push(b); else console.log(`no base named ${n} on lands ${SEEDS}`); }
else for (const b of [...all].sort((a, b) => b.makers - a.makers || b.machines - a.machines || a.seed - b.seed || a.hub - b.hub)) {
  if (WANT && !WANT.includes(b.profile)) continue;
  if (picks.length < (WANT ? WANT.length : 3) && !picks.some((p) => p.profile === b.profile)) picks.push(b);
}
for (const [k, b] of picks.entries()) {
  const { context, page } = await open(b.seed);
  await page.evaluate(([x, y]) => window.FL.app.sim.explored.push([Math.round(x), Math.round(y), 60]), b.at);
  const zoom = Math.max(0.75, Math.min(1.1, 30 / Math.max(14, b.span)));
  for (const phase of ['noon', 'night']) {
    await page.evaluate((x) => window.FL.dayPhase(x), phase);
    await page.evaluate(([x, y, z]) => window.FL.lookAt(x, y, z), [b.at[0], b.at[1], zoom]);
    await settle(page);
    const name = `nbt-${PREFIX}${NAMES || HUBS ? b.name.replace(/\W+/g, '_') : WANT ? 'x' : k + 1}-${b.profile}-${phase === 'noon' ? 'day' : 'night'}${LANG}.png`;
    await page.screenshot({ path: shot(name) });
    console.log(`✓ ${name}  ${b.name}, land ${b.seed}, base ${b.hub}, zoom ${zoom.toFixed(2)}`);
    // By day, its card too (what it does, mine to post), as a click on it shows it.
    if (phase === 'noon' && process.env.CARD) {
      const ok = await page.evaluate((hub) => { const app = window.FL.app; if (!app.neighbourCard) return false; app.neighbourCard.show(app.sim, hub, 1100, 160); return true; }, b.hub);
      if (ok) {
        await page.waitForTimeout(200);
        const box = await page.evaluate(() => { const r = document.querySelector('[data-neighbour-card]')?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height] : null; });
        const card = name.replace('.png', '-card.png');
        if (box) await page.screenshot({ path: shot(card), clip: { x: Math.max(0, box[0] - 8), y: Math.max(0, box[1] - 8), width: box[2] + 16, height: box[3] + 16 } });
        await page.evaluate(() => window.FL.app.neighbourCard.hide());
        console.log(`✓ ${card}`);
      }
    }
  }
  if ((k === 0 && !WANT && !NAMES && !HUBS) || process.env.MID) {
    await page.evaluate((x) => window.FL.dayPhase(x), 'noon');
    await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 0.55), b.at);
    await settle(page);
    const mid = `nbt-${PREFIX}mid-${NAMES || HUBS ? b.name.replace(/\W+/g, '_') : b.profile}${LANG}.png`;
    await page.screenshot({ path: shot(mid) });
    console.log(`✓ ${mid}  mid zoom`);
  }
  console.log(`  ${b.note}`);
  await context.close();
}
console.log(`bases seen: ${all.length}; machines a base: ${(all.reduce((s, b) => s + b.machines, 0) / Math.max(1, all.length)).toFixed(1)}`);
await browser.close();
