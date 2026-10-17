// gleaner-shots.mjs — the Gleaners (D103, D112) for review, the whole raid by night: on the grown
// debug base (its quartz line home crosses the desert floor), the game paused and stepped tick by
// tick through a raid the sim really makes — the group out of the dunes, waiting at its posts, an arm
// out over the line, the grab (the item off the belt into a hand), the group away with what it took —
// at near and mid zoom, and from afar as small moving lights; the Logistique view's night marks; a
// stretch of the line fenced in, with two pacing outside; the late base's glazed lines by day and by
// night, a few tapping the glass; the first-night card and
// the morning report in French and English; a ribbon's inspector: scripts/shot-gleaners-*.png
// (gitignored). Usage: a server (default :5183; URL=… for another), then `node scripts/gleaner-shots.mjs`.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./${name}`, import.meta.url));
const URL = process.env.URL ?? 'http://localhost:5183';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=1&debug`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
const HIDE = '.qlog, .guide, .hud, .buildbar, .toasts, .nnotice, [data-screen="quests"], [data-screen="night"], [data-screen="gleaners"] { display: none !important; }';
let hidden = null;
const hideUi = async (on = true) => {
  if (hidden) { await hidden.evaluate((n) => n.remove()); hidden = null; }
  if (on) hidden = await page.addStyleTag({ content: HIDE });
};

const settle = async (ms = 900) => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const view = async (mode) => {
  await page.evaluate((m) => window.FL.view(m), mode);
  await page.waitForFunction((m) => { const v = window.FL.view(); return v.mode === m && (m === 'plan' ? v.t === 1 : v.t === 0); }, mode, { timeout: 5000 });
};
const snap = async (name) => { await page.screenshot({ path: shot(name) }); console.log(`✓ ${name}`); };
const look = (at, zoom) => page.evaluate(([x, y, z]) => window.FL.lookAt(x, y, z), [at[0], at[1], zoom]);
const tick = (n) => page.evaluate((k) => { if (k > 0) window.FL.tick(k); }, n);
const now = () => page.evaluate(() => window.FL.app.sim.tick);

// ── the grown base by night ──────────────────────────────────────────────────
const lvl = await page.evaluate(() => window.FL.debugSave('grown'));
console.log('debug base', JSON.stringify({ ok: lvl.ok, ms: lvl.ms }));
await hideUi();
await view('iso');
await page.evaluate(() => { window.FL.pause(); window.FL.dayPhase(null); window.FL.gleaners({ toNight: 2 }); window.FL.tick(400); });

// A raid stepped through (D112), by buildings: a silo placed just behind the band and one just in
// front of it (on the claim's land, granted for the shot) so the depth shows; the band coming in out
// of the empty desert, waiting; every take frame by frame — the hand on the token as it comes, the
// token gone from the belt and in the hand, riding the arm — at near zoom (1.7, some at mid 0.85);
// the band going back out. The view's own check of every take (`FL.gleaners()`: paired, onBelt,
// unforeseen, unseen, late) is printed, and a contact sheet of it all: shot-gleaners-sequence.png.
const both = async (name, at, ms = 300) => {
  await look(at, 1.7); await settle(ms); await snap(`shot-gleaners-seq-${name}.png`);
  await look(at, 0.85); await settle(ms); await snap(`shot-gleaners-seq-${name}-mid.png`);
};
const near = async (name, at, ms = 250) => { await look(at, 1.7); await settle(ms); await snap(`shot-gleaners-seq-${name}.png`); };
const sheet = [];
let caught = null;
for (let attempt = 0; attempt < 10 && !caught; attempt++) {
  // A raid ahead that falls in the night from its arrival to its end, a band of three or more if there is one.
  const raid = await page.evaluate(() => {
    const g = window.FL.gleaners(), sim = window.FL.app.sim;
    const ok = g.raids.filter((r) => r.at - g.tick > 260 && sim.gleanNight(r.at - 200) && sim.gleanNight(r.at + 800));
    return ok.find((r) => r.posts.length >= 3) ?? ok[0] ?? null;
  });
  if (!raid) {
    await page.evaluate(() => { const s = window.FL.app.sim; if (s.gleanNight()) window.FL.tick(1200); else window.FL.gleaners({ toNight: 0.5 }); });
    continue;
  }
  const t0 = raid.at;
  // Two silos by the band: one up the screen (behind it), one down the screen (in front of it).
  const silos = await page.evaluate(([x, y, wat]) => {
    const sim = window.FL.app.sim, v = window.FL.app.gleaners;
    window.FL.unlock('silo');
    for (const [it, n] of [['iron_plate', 600], ['copper_wire', 300], ['glass', 200], ['gear', 200], ['stone', 600], ['brick', 300]]) { try { sim.grant(it, n); } catch { /* not an item here */ } }
    sim.ensureCompiled(); v.rebuild(sim);
    const d = v.describe_().find((r) => r.x === x && r.y === y);
    if (!d) return { err: 'no such raid' };
    // The band's stands, and the tile beyond each (a Gleaner on the line's near side stands 1.8 tiles out: on it).
    const keep = new Set(d.stands.flatMap(([sx, sy]) => [0, 1].map((k) => Math.floor(sy + d.side[1] * k) * 1024 + Math.floor(sx + d.side[0] * k))));
    // Top-left corners whose silo's centre lies 2–4.5 tiles up (or down) the screen from one of the
    // stands and nearly in line with it on screen (so it hides or is hidden by that Gleaner), best first.
    const ring = (sign, wide = 2.5) => {
      const out = [];
      const xs = d.stands.map((p) => p[0]), ys = d.stands.map((p) => p[1]);
      for (let tx = Math.floor(Math.min(...xs)) - 6; tx <= Math.max(...xs) + 5; tx++) {
        for (let ty = Math.floor(Math.min(...ys)) - 6; ty <= Math.max(...ys) + 5; ty++) {
          const cx = tx + 1, cy = ty + 1;
          let best = Infinity;
          for (const [sx, sy] of d.stands) {
            const dz = sign * (cx + cy - sx - sy), dx = Math.abs(cx - cy - (sx - sy));
            if (dz >= 2 && dz <= 4.5 && dx <= wide) best = Math.min(best, dx + Math.abs(dz - 3) * 0.5);
          }
          if (best < Infinity) out.push([tx, ty, best]);
        }
      }
      return out.sort((p, q) => p[2] - q[2] || p[0] - q[0] || p[1] - q[1]).map(([tx, ty]) => [tx, ty]);
    };
    const place = (cands) => {
      for (const [tx, ty] of cands) {
        // Off the band's stands, and a tile clear of any ribbon (touching one would change what is exposed, so the raid).
        let clash = false;
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) if (keep.has((ty + j) * 1024 + tx + i)) clash = true;
        for (let i = -1; i <= 2 && !clash; i++) for (let j = -1; j <= 2; j++) if (/ribbon/.test(window.FL.entityAt(tx + i, ty + j)?.def ?? '')) clash = true;
        if (clash) continue;
        for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) sim.land.granted.add(window.FL.parcelAt(tx + i, ty + j));
        if (sim.place('silo', tx, ty, 0).ok) return [tx, ty];
      }
      return null;
    };
    // Behind the band may be the line and a cliff: then a little to one side of it.
    const back = place(ring(-1)) ?? place(ring(-1, 6.5)), front = place(ring(1));
    sim.ensureCompiled(); v.rebuild(sim);
    // The silos may shift the line's exposure, so its posts: the same raid is the one at the same tick of the window, nearest.
    const e = v.describe_().filter((r) => r.at === wat).sort((p, q) => Math.abs(p.x - x) + Math.abs(p.y - y) - Math.abs(q.x - x) - Math.abs(q.y - y))[0];
    return { back, front, stands: e?.stands, side: e?.side, bearing: e?.bearing, mid: e ? [e.x, e.y] : null };
  }, [raid.x, raid.y, raid.at % 2400]);
  console.log(`raid at ${t0} on ${raid.x},${raid.y}: ${raid.posts.length} posts; silos`, JSON.stringify(silos));
  if (!silos.stands) continue;
  const mid = silos.stands[silos.stands.length >> 1];
  const at = [mid[0], mid[1]];
  const posts = await page.evaluate(([mx, my]) => (window.FL.gleaners().raids.find((r) => r.x === mx && r.y === my)?.posts ?? []).map(([x, y]) => y * 1024 + x), silos.mid ?? [raid.x, raid.y]);
  const count0 = await page.evaluate(() => { const g = window.FL.gleaners(); return { paired: g.paired, onBelt: g.onBelt, unforeseen: g.unforeseen, unseen: g.unseen, late: g.late }; });
  await tick(t0 - 150 - (await now()));
  await both('1-arrive', at, 700); sheet.push(['seq-1-arrive-mid', 'in from the empty desert (mid zoom)']);
  await tick(t0 - 30 - (await now()));
  await near('2-gather', at); sheet.push(['seq-2-gather', 'gathering at the posts']);
  await tick(t0 + 4 - (await now()));
  await both('3-wait', at); sheet.push(['seq-3-wait', 'waiting, a silo behind and one in front']);
  // Every take of the raid, tick by tick: when a post foresees its take on this very tick, the frame
  // before it (the hand on the token), the one after (the token off the belt, in the hand), and four
  // ticks on (rising up the arm); on until every post has taken (the sim's own log) or the raid is over.
  const takenSoFar = () => page.evaluate(([ks, from]) => {
    const r = window.FL.app.sim.gleaners.recent;
    let n = 0;
    for (let i = 0; i + 2 < r.length; i += 3) if (ks.includes(r[i]) && r[i + 2] >= from && r[i + 2] < from + 600) n++;
    return n;
  }, [posts, t0]);
  let k = 0;
  const riding = []; // [tick to shoot, take number, tile]
  while ((await now()) < t0 + 600 && ((await takenSoFar()) < posts.length || riding.length)) {
    const f = await page.evaluate(() => ({ tick: window.FL.app.sim.tick, fore: window.FL.app.gleaners.foreseen_() }));
    const ride = riding.findIndex(([t]) => t === f.tick);
    if (ride >= 0) {
      const [, n, tile] = riding.splice(ride, 1)[0];
      await near(`grab-${n}-c`, [tile & 1023, tile >> 10], 250); sheet.push([`seq-grab-${n}-c`, `take ${n}: rising up the arm`]);
    }
    const due = f.fore.filter(([tile, T]) => T === f.tick && posts.includes(tile));
    if (due.length) {
      const [tile, T, item] = due[0];
      const pt = [tile & 1023, tile >> 10];
      k++;
      await near(`grab-${k}-a`, pt, 300); sheet.push([`seq-grab-${k}-a`, `take ${k}: the hand on the token (tick ${T})`]);
      await tick(1);
      await near(`grab-${k}-b`, pt, 300); sheet.push([`seq-grab-${k}-b`, `take ${k}${due.length > 1 ? ` (+${due.length - 1} beside)` : ''}: off the belt, in the hand (${T + 1})`]);
      const took = await page.evaluate(([tl, tk]) => { const r = window.FL.app.sim.gleaners.recent; for (let i = 0; i + 2 < r.length; i += 3) if (r[i] === tl && r[i + 2] === tk) return r[i + 1]; return -1; }, [tile, T]);
      console.log(`  take ${k} on ${tile & 1023},${tile >> 10} at ${T}: foreseen item ${item}, the sim took ${took}${due.length > 1 ? `; ${due.length - 1} more on the same step` : ''}`);
      if (took !== item) console.log('  ✗ the take foreseen is not the one made');
      riding.push([T + 5, k, tile]);
      caught = { x: tile & 1023, y: tile >> 10, item, T, silos: [silos.back, silos.front].filter(Boolean) };
      continue;
    }
    await tick(1);
    await page.waitForTimeout(40);
  }
  if (!caught) { console.log('  no take this raid'); continue; }
  const count1 = await page.evaluate(() => { const g = window.FL.gleaners(); return { paired: g.paired, onBelt: g.onBelt, unforeseen: g.unforeseen, unseen: g.unseen, late: g.late }; });
  const delta = Object.fromEntries(Object.keys(count1).map((key) => [key, count1[key] - count0[key]]));
  console.log('  takes checked by the view', JSON.stringify(delta));
  if (delta.onBelt || delta.unforeseen || delta.unseen) console.log('  ✗ a grab without its token');
  await both('7-holding', at); sheet.push(['seq-7-holding', 'held up, glowing']);
  console.log('  holding', JSON.stringify(await page.evaluate(() => { const g = window.FL.gleaners(); return { tick: g.tick, night: g.night, figures: g.figures, waiting: g.waiting, carrying: g.carrying, raid: window.FL.app.gleaners.raidAt_, view: window.FL.view() }; })));
  // On to the band leaving: 40 ticks after every post has taken (the view's LINGER), or at the raid's end (600).
  const leaveAt = () => page.evaluate(([ks, from]) => {
    const r = window.FL.app.sim.gleaners.recent, got = new Map();
    for (let i = 0; i + 2 < r.length; i += 3) if (ks.includes(r[i]) && r[i + 2] >= from && r[i + 2] < from + 600) got.set(r[i], r[i + 2]);
    return got.size === ks.length ? Math.max(...got.values()) + 40 : null;
  }, [posts, t0]);
  let leave = await leaveAt();
  while (!leave && (await now()) < t0 + 600) { await tick(10); leave = await leaveAt(); }
  leave ??= t0 + 600;
  console.log(`  leaving at ${leave} (${leave - t0} into the raid), bearing ${silos.bearing.map((v) => v.toFixed(2)).join(',')}`);
  await tick(leave + 45 - (await now()));
  await both('8-leave', at); sheet.push(['seq-8-leave', 'back out into the desert']);
  await tick(70);
  const far = [at[0] + silos.bearing[0] * 4, at[1] + silos.bearing[1] * 4];
  await both('9-away', far); sheet.push(['seq-9-away', 'fading into the empty desert']);
}
if (!caught) console.log('✗ no take caught');
// The contact sheet: every frame above, cropped round its middle.
{
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = fileURLToPath(new globalThis.URL('.', import.meta.url));
  const html = `<html><body style="margin:0;background:#1b1830;font:15px sans-serif;color:#eee">
<style>figure{margin:6px;display:inline-block}.f{width:560px;height:373px;background-size:1120px 747px;background-position:-280px -187px;border-radius:6px}figcaption{padding:4px 2px}</style>
<div style="padding:8px 10px;font-size:18px">D112 — a raid of the Gleaners by two silos, near zoom (1.7)</div>
${sheet.map(([f, l]) => `<figure><div class="f" style="background-image:url('file://${dir}shot-gleaners-${f}.png')"></div><figcaption>${l}</figcaption></figure>`).join('')}</body></html>`;
  const tmp = `${tmpdir()}/gleaner-sheet-${process.pid}.html`;
  writeFileSync(tmp, html);
  const sp = await context.newPage();
  await sp.setViewportSize({ width: 1752, height: 900 });
  await sp.goto(`file://${tmp}`);
  await sp.waitForTimeout(800);
  await sp.screenshot({ path: shot('shot-gleaners-sequence.png'), fullPage: true });
  await sp.close();
  unlinkSync(tmp);
  console.log('✓ shot-gleaners-sequence.png');
}
if (process.env.ONLY === 'raid') { await browser.close(); process.exit(0); } // the raid alone, for quick looks

// The Logistique view: the night's marks.
const at = caught ? [caught.x, caught.y] : (await page.evaluate(() => window.FL.gleaners().exposedTiles[0]));
await page.evaluate(([x, y]) => { window.FL.lookAt(x, y, 0.9); window.FL.mapView('logistics'); }, at);
await hideUi(false);
await settle(1200);
await snap('shot-gleaners-logistics.png');

// The silos set for the raid go (nothing lost: the Heart takes them back), so the fence has its room.
if (caught && caught.silos) await page.evaluate((list) => { for (const [x, y] of list) window.FL.app.sim.remove(x, y); }, caught.silos);
// A stretch of the line fenced in: a box round it, two tiles off each side, the ribbon its gate; two pace outside.
const box = await page.evaluate(([x, y]) => {
  const sim = window.FL.app.sim;
  window.FL.unlock('xp_guard');
  sim.grant('iron_plate', 200);
  const e = sim.entityAt(x, y);
  const along = e && (e.rot & 1) === 0 ? 'y' : 'x';
  const [x0, x1, y0, y1] = along === 'y' ? [x - 3, x + 3, y - 5, y + 5] : [x - 5, x + 5, y - 3, y + 3];
  let n = 0;
  for (let i = x0; i <= x1; i++) for (const j of [y0, y1]) if (sim.place('fence', i, j, 0).ok) n++;
  for (let j = y0 + 1; j < y1; j++) for (const i of [x0, x1]) if (sim.place('fence', i, j, 0).ok) n++;
  sim.ensureCompiled();
  return { n, exposed: sim.graph.glean.exposed.length, guarded: sim.graph.glean.guarded.length, prowl: sim.graph.glean.prowl.length };
}, at);
console.log('fenced', JSON.stringify(box));
await tick(2);
await settle(1000);
await snap('shot-gleaners-fenced-logistics.png');
await page.evaluate(() => window.FL.mapView('normal'));
await hideUi();
await look(at, 1.2);
await look(at, 0.8);
// A prowler at the start of its visit ([x, y, phase]), then on into its pacing along the fence — at
// night (the raid may have run the night out: on to the next one).
await page.evaluate(() => { if (!window.FL.app.sim.gleanNight(window.FL.app.sim.tick + 400)) window.FL.gleaners({ toNight: 0.3 }); });
let prowl = null;
for (let k = 0; k < 300 && !prowl; k++) {
  await tick(17); await page.waitForTimeout(40);
  const p = await page.evaluate(() => window.FL.app.gleaners.prowlAt_);
  if (p && p[2] < 40) prowl = p;
}
if (prowl) { await tick(Math.round(120 - prowl[2])); await look(prowl, 1.5); }
await settle(800);
console.log('figures by the fence', prowl, JSON.stringify(await page.evaluate(() => { const v = window.FL.app.gleaners, sim = window.FL.app.sim; v.rebuild(sim); return { tick: sim.tick, night: sim.gleanNight(), visits: v.prowls.map((w) => [w.x, w.y, (w.h + sim.tick) % 2400]) }; })));
await snap('shot-gleaners-fenced-night.png');
await page.evaluate(() => window.FL.dayPhase('noon'));
await settle(800);
await snap('shot-gleaners-fenced-day.png');
await page.evaluate(() => window.FL.dayPhase(null));

// ── the cards: the first night, the morning report; French then English ─────
await hideUi(false);
await page.evaluate(() => { window.FL.selected(0); window.FL.gleaners({ card: 'night' }); });
await page.waitForTimeout(600);
await snap('shot-gleaners-card-night.png');
await page.evaluate(() => window.FL.gleaners({ card: 'dawn' }));
await page.waitForTimeout(600);
await snap('shot-gleaners-card-dawn.png');
await page.evaluate(() => { window.FL.setLocale('en'); window.FL.gleaners({ card: 'dawn' }); });
await page.waitForTimeout(600);
await snap('shot-gleaners-card-dawn-en.png');
await page.evaluate(() => window.FL.gleaners({ card: 'night' }));
await page.waitForTimeout(600);
await snap('shot-gleaners-card-night-en.png');
await page.evaluate(() => { window.FL.gleaners({ card: null }); window.FL.setLocale('fr'); });

// The ribbon's inspector: « Exposé la nuit ».
const rib = await page.evaluate(() => window.FL.gleaners().exposedTiles[0]);
if (rib) {
  await page.evaluate(([x, y]) => { const e = window.FL.entityAt(x, y); if (e) window.FL.selected(e.id); window.FL.lookAt(x, y, 1.4); }, rib);
  await settle(800);
  await snap('shot-gleaners-inspector.png');
  await page.evaluate(() => window.FL.selected(0));
}

// ── the late base: its desert lines under glass, by day; by night one taps the glass ────
const late = await page.evaluate(() => window.FL.debugSave('late'));
console.log('late', JSON.stringify({ ok: late.ok, ms: late.ms }));
await hideUi();
await page.evaluate(() => window.FL.pause());
const lg = await page.evaluate(() => window.FL.gleaners());
console.log('late gleaners', JSON.stringify({ exposed: lg.exposed, guarded: lg.guarded }));
const glass = lg.guardedTiles[Math.floor(lg.guardedTiles.length / 2)] ?? [512, 512];
await view('iso');
await page.evaluate(() => window.FL.dayPhase('noon'));
await look(glass, 2.0);
await settle(1200);
await snap('shot-gleaners-glazed-day.png');
await page.evaluate(() => { window.FL.dayPhase(null); window.FL.gleaners({ toNight: 1 }); });
await look(glass, 1.3);
let tap = null;
await look(glass, 0.8);
for (let k = 0; k < 300 && !tap; k++) {
  await tick(17); await page.waitForTimeout(40);
  const p = await page.evaluate(() => window.FL.app.gleaners.tapAt_);
  if (p && p[2] < 50) tap = p;
}
// On to the first tap (75 ticks into the visit), the glint on the glass.
if (tap) { await tick(Math.round(76 - tap[2])); await look(tap, 1.7); }
await settle(800);
console.log('figures by the glass', tap);
await snap('shot-gleaners-glazed-night.png');
await view('plan');
await settle(600);
await snap('shot-gleaners-glazed-plan.png');
await page.evaluate(() => { window.FL.resume(); window.FL.debugSave(null); });
await browser.close();
