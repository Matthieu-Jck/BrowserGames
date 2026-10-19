// ore-shots.mjs — the ground ores for review (D99; owner, 2026-10-16: « i cannot distinguish copper
// resources from iron on the ground »): the cirque's nearest iron, copper and coal deposits (and
// salt and the quartz face where the land has them) at three zooms (far,
// mid, near), in iso and in plan, by day and by night, each ore's twelve gathered on one contact
// sheet; then, with nothing in hand, the pointer resting on each deposit and its card (D99), cropped
// round the card. Writes scripts/shot-ore-<PREFIX>-*.png (gitignored; PREFIX defaults to `after`).
// Usage: a server on :5183 (or URL=…, SEED=…, DPR=1|2, PREFIX=before|after, ONLY=iron_ore,…), then
// `node scripts/ore-shots.mjs`. It starts the sandbox base over (FL.wipe).
import { chromium } from 'playwright-core';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PREFIX = process.env.PREFIX ?? 'after';
const path = (name) => fileURLToPath(new globalThis.URL(`./shot-ore-${PREFIX}-${name}`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';
const DPR = Number(process.env.DPR ?? 2);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const ZOOMS = [['far', 0.32], ['mid', 0.8], ['near', 2]];
const TIMES = ['noon', 'night'];

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: DPR, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=${process.env.SEED ?? '1'}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
await page.addStyleTag({ content: '.qlog, .guide, .hud, .buildbar, .toasts, [data-screen="quests"] { display: none !important; }' });

const settle = async (ms = 900) => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};

// The deposits: for each ore, the blob nearest the Core (its tiles flooded from the nearest one), its middle.
const sites = await page.evaluate(() => {
  const FL = window.FL, sim = FL.app.sim, g = sim.grid, C = 512;
  const out = {};
  const bigs = new Map();
  const big = (x0, y0, it) => {
    const k0 = `${x0},${y0}`;
    if (bigs.has(k0)) return bigs.get(k0);
    const seen = new Set([k0]), q = [[x0, y0]];
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${y + dy}`;
        if (!seen.has(k) && g.ore(x + dx, y + dy) === it) { seen.add(k); q.push([x + dx, y + dy]); }
      }
    }
    let open = 0;
    for (const k of seen) { const [x, y] = k.split(',').map(Number); if (g.terrain(x, y) < 2 || g.terrain(x, y) > 5) open++; }
    const ok = open >= 16;
    for (const k of seen) bigs.set(k, ok);
    return ok;
  };
  // `copper_field`: the nearest copper deposit with 16 tiles or more on open ground (the cirque's own is a tired vein).
  for (const key of ['iron_ore', 'copper_ore', 'copper_field', 'coal', 'salt', 'quartz']) {
    const id = key === 'copper_field' ? 'copper_ore' : key;
    const it = FL.itemIndex(id);
    let best = null, bd = Infinity;
    for (let y = C - 110; y <= C + 110; y++) for (let x = C - 110; x <= C + 110; x++) {
      if (g.ore(x, y) !== it) continue;
      const rock = g.terrain(x, y) >= 2 && g.terrain(x, y) <= 5; // T.Rock1..4: a hidden vein, unless a face ore
      if (rock && id !== 'quartz') continue;
      if (key === 'copper_field' && !big(x, y, it)) continue;
      const d = (x - C) ** 2 + (y - C) ** 2;
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (!best) continue;
    const seen = new Set([best.join()]), q = [best];
    let sx = 0, sy = 0, n = 0, hi = best, rich = 0;
    while (q.length && n < 400) {
      const [x, y] = q.pop();
      sx += x; sy += y; n++;
      const r = g.capMuPerEpoch(x, y);
      if (r > rich) { rich = r; hi = [x, y]; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${y + dy}`;
        if (!seen.has(k) && g.ore(x + dx, y + dy) === it) { seen.add(k); q.push([x + dx, y + dy]); }
      }
    }
    out[key] = { at: [sx / n, sy / n], tiles: n, rich: hi };
  }
  // No salt flat near the cirque: a review patch of salt flat with its salt (sandbox only, a rig).
  if (!out.salt) {
    const it = FL.itemIndex('salt'), x0 = 498, y0 = 524;
    for (let y = y0; y < y0 + 6; y++) for (let x = x0; x < x0 + 8; x++) {
      if ((x - x0 - 3.5) ** 2 / 16 + (y - y0 - 2.5) ** 2 / 9 > 1.1) continue;
      g.setTerrain(x, y, 8); // T.Salt
      g.setOre(x, y, it, (x - x0 - 3.5) ** 2 + (y - y0 - 2.5) ** 2 < 4 ? 300 : 210);
    }
    out.salt = { at: [x0 + 3.5, y0 + 2.5], tiles: 40, rich: [x0 + 3, y0 + 2] };
  }
  return out;
});
console.log('sites', JSON.stringify(sites));

// The contact sheet: rows the zooms, columns iso / plan by day then by night.
const sheet = async (ore, cells) => {
  const html = `<html><body style="margin:0;background:#222;font:14px sans-serif;color:#eee">
    <div style="padding:6px 10px">${ore} · ${PREFIX}</div>
    <div style="display:grid;grid-template-columns:repeat(4,600px);gap:4px;padding:4px">
    ${cells.map((c) => `<div style="position:relative"><img src="${pathToFileURL(c.file)}" style="width:600px;height:400px;display:block"><span style="position:absolute;left:6px;top:4px;background:#000a;padding:1px 5px">${c.label}</span></div>`).join('')}
    </div></body></html>`;
  const f = join(tmpdir(), `shot-ore-${PREFIX}-${ore}-sheet.html`); // the page only lays the sheet out
  writeFileSync(f, html);
  const p2 = await context.newPage();
  await p2.setViewportSize({ width: 2420, height: 1260 });
  await p2.goto(pathToFileURL(f).href);
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: path(`${ore}-sheet.png`), fullPage: true });
  await p2.close();
  console.log(`✓ shot-ore-${PREFIX}-${ore}-sheet.png`);
};

for (const [ore, s] of Object.entries(sites)) {
  if (ONLY && !ONLY.includes(ore)) continue;
  const cells = [];
  for (const [zn, z] of ZOOMS) {
    for (const time of TIMES) {
      await page.evaluate((t) => window.FL.dayPhase(t), time);
      for (const mode of ['iso', 'plan']) {
        await view(mode);
        await page.evaluate(([x, y, zz]) => window.FL.lookAt(x, y, zz), [s.at[0] + 0.5, s.at[1] + 0.5, z]);
        await settle();
        const file = path(`${ore}-${zn}-${mode}-${time}.png`);
        await page.screenshot({ path: file });
        cells.push({ file, label: `${zn} · ${mode} · ${time}` });
      }
    }
  }
  // Sheet order: per zoom row — iso day, plan day, iso night, plan night.
  const order = [];
  for (let r = 0; r < 3; r++) {
    const row = cells.slice(r * 4, r * 4 + 4);
    order.push(row[0], row[1], row[2], row[3]);
  }
  await sheet(ore, order);
}

// The deposit card (D99): nothing in hand, the pointer resting on the richest tile of each deposit.
await page.evaluate(() => window.FL.dayPhase('noon'));
await page.addStyleTag({ content: '.hud { display: none !important; }' });
const hasCard = await page.evaluate(() => !!document.querySelector('.dcard'));
if (hasCard || process.env.CARD) {
  for (const mode of ['plan', 'iso']) {
    await view(mode);
    for (const [ore, s] of Object.entries(sites)) {
      if (ONLY && !ONLY.includes(ore)) continue;
      await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 1.1), [s.rich[0] + 0.5, s.rich[1] + 0.5]);
      await settle(400);
      const [px, py] = await page.evaluate(([x, y]) => window.FL.app.picker.tileToScreen(x, y), [s.rich[0], s.rich[1]]);
      await page.mouse.move(px + 30, py + 30);
      await page.mouse.move(px, py, { steps: 4 });
      await page.waitForTimeout(900);
      const box = await page.evaluate(() => { const n = document.querySelector('.dcard'); if (!n || n.hidden) return null; const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      if (!box) { console.log(`✗ no card on ${ore} (${mode})`); continue; }
      const clip = { x: Math.max(0, Math.min(box.x, px) - 60), y: Math.max(0, Math.min(box.y, py) - 60) };
      clip.width = Math.min(1200 - clip.x, Math.max(box.x + box.w, px) - clip.x + 60);
      clip.height = Math.min(800 - clip.y, Math.max(box.y + box.h, py) - clip.y + 60);
      await page.screenshot({ path: path(`card-${ore}-${mode}.png`), clip });
      console.log(`✓ shot-ore-${PREFIX}-card-${ore}-${mode}.png`);
    }
  }
  // English, once (the copper field in plan).
  const cu = sites.copper_field ?? sites.copper_ore;
  if (cu) {
    await page.evaluate(() => window.FL.setLocale('en'));
    await view('plan');
    await page.evaluate(([x, y]) => window.FL.lookAt(x, y, 1.1), [cu.rich[0] + 0.5, cu.rich[1] + 0.5]);
    await settle(400);
    const [px, py] = await page.evaluate(([x, y]) => window.FL.app.picker.tileToScreen(x, y), [cu.rich[0], cu.rich[1]]);
    await page.mouse.move(px + 30, py + 30);
    await page.mouse.move(px, py, { steps: 4 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path('card-en.png'), clip: { x: Math.max(0, px - 60), y: Math.max(0, py - 60), width: 380, height: 300 } });
    console.log(`✓ shot-ore-${PREFIX}-card-en.png`);
    await page.evaluate(() => window.FL.setLocale('fr'));
  }
}
await browser.close();
