// depth-bench.mjs — D130's bench: how the items on the ribbons sort in depth against every piece they
// meet, in iso at near zoom, by day. It wipes the sandbox base and lays, through FL, one small scene per
// piece and per way it can be met — each line a source silo, the ribbons, the piece, the ribbons and a
// sink silo, so the items keep moving: ribbons of every tier (straight and both bends, swift, express,
// traction, glazed, camouflaged); junctions (the line over the deck, the line under it, N/E/S/W; one with
// a silo standing in front); skybridge pairs N/E/S/W over a line, a junction and a gap, and the same with
// the line backed up onto the deck (D121); a rock plateau crossed both ways by four lines (the traction
// lifts up and down each edge, four junctions on the rock); the routing blocks (router, sorters, gates,
// distributor) N/E/S/W with a side outlet; lines into and out of a 2×2 silo, a 3×3 silo and the trade
// post (4 turns), into the Core on each side; four lines into an incinerator (D125); lines passing along
// a silo's four sides. Each scene is shot twice (items moving) and the shots are composed into contact
// sheets, one per family (`sheet-<family>.png`); then the late debug base at a few spots, by day and by
// night (`sheet-late.png`). The Gleaners' hands (D112) are gleaner-shots.mjs's (`ONLY=raid`).
// Usage: a server (URL=…, default :5183), then `OUT=<dir> node scripts/depth-bench.mjs` (OUT default
// scripts/depth/; ONLY=a,b: the families whose name holds one of those; PICK=a,b: the scenes whose name
// holds one of those; NOLATE=1: skip the late base; ZOOM (2); PHASES=noon,night: shoot each scene at
// those moments (default noon); FRAMES (2) a scene; STEP=n: pause the game and step it n ticks between
// frames, so a scene's frames are the same at every run — else they are 260 ms of play apart).
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5183';
const OUT = process.env.OUT ?? fileURLToPath(new globalThis.URL('./depth/', import.meta.url));
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const ZOOM = Number(process.env.ZOOM ?? 2);
const PICK = process.env.PICK ? process.env.PICK.split(',') : null;
const PHASES = (process.env.PHASES ?? 'noon').split(',');
const FRAMES = Number(process.env.FRAMES ?? 2);
const STEP = Number(process.env.STEP ?? 0);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => { errors.push(err.message); console.log('pageerror:', err.message); });
await page.goto(`${URL}/?seed=${process.env.SEED ?? '2'}&debug`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => window.FL.wipe()).catch(() => null)]);
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 30000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); window.FL.dayPhase('noon'); if (window.FL.app.guide) window.FL.app.guide.enabled = false; });
const HIDE = '.qlog, .guide, .hud, .buildbar, .toasts, .nnotice, .perf, [data-screen="quests"], [data-screen="night"], [data-screen="gleaners"] { display: none !important; }';
await page.addStyleTag({ content: HIDE });

// ── the rigs, laid in the page ────────────────────────────────────────────────────────────────────
const rig = await page.evaluate((only) => {
  const FL = window.FL, sim = FL.app.sim, W = 1024;
  FL.unlock();
  for (const id of ['xp_swift', 'xp_express', 'xp_guard', 'xp_camo', 'xp_distrib', 'xp_bigsilo']) FL.unlock(id);
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0], NAME = 'NESW';
  const ITEMS = FL.ids().items;
  const ITEM = ITEMS.includes('copper_plate') ? 'copper_plate' : 'iron_plate';
  const log = [];
  const regrant = () => { for (const it of ['iron_plate', 'glass', 'copper_wire', 'gear', 'circuit', 'steel', 'ceramic', 'copper_plate', 'sand']) if (ITEMS.includes(it) && sim.stock[ITEMS.indexOf(it)] < 2e6) sim.grant(it, 4000); };
  const put = (def, x, y, rot = 0) => { regrant(); const r = sim.place(def, x, y, rot); if (!r.ok) log.push(`${def}@${x},${y} r${rot}: ${r.reason}`); return r; };
  const sources = [];
  const occ = (x, y) => sim.grid.occ[y * W + x] !== 0;
  /** Lay ribbons along `tiles` ([x, y, rot]), in runs, skipping the tiles already built on. */
  const lay = (def, tiles) => {
    let run = [];
    const flush = () => { if (!run.length) return; regrant(); const n = sim.placeBelts(def, run); if (n < run.length) log.push(`${def} run at ${run[0][0]},${run[0][1]}: ${n}/${run.length}`); run = []; };
    for (const t of tiles) { if (occ(t[0], t[1])) { flush(); continue; } run.push(t); }
    flush();
  };
  const srcAt = (x, y, d) => [[x, y + 1], [x - 2, y], [x, y - 2], [x + 1, y]][d];
  const sinkAt = (x, y, d) => [[x, y - 2], [x + 1, y], [x, y + 1], [x - 2, y]][d];
  const source = (x, y, d) => { const [sx, sy] = srcAt(x, y, d); const r = put('silo', sx, sy, d); if (r.ok) sources.push(r.id); };
  const sink = (x, y, d) => { const [sx, sy] = sinkAt(x, y, d); put('silo', sx, sy, d); };
  /** A straight line from (x, y) running `d`, `n` tiles, a source silo behind it and a sink past it (`sink: false`: a dead end). */
  const line = (x, y, d, n, o = {}) => {
    const tiles = Array.from({ length: n }, (_, k) => [x + DX[d] * k, y + DY[d] * k, d]);
    if (o.src !== false) source(x, y, d);
    if (o.sink !== false) sink(tiles[n - 1][0], tiles[n - 1][1], d);
    lay(o.def ?? 'ribbon', tiles.filter((_, k) => !(o.skip ?? []).includes(k)));
    return tiles;
  };
  /** A winding line: `moves` (N/E/S/W a tile), each tile turned the way it leaves. */
  const wind = (x, y, moves, def) => {
    const tiles = [];
    let cx = x, cy = y;
    for (const m of moves) { const d = NAME.indexOf(m); tiles.push([cx, cy, d]); cx += DX[d]; cy += DY[d]; }
    source(x, y, tiles[0][2]);
    const last = tiles[tiles.length - 1];
    sink(last[0], last[1], last[2]);
    lay(def, tiles);
    return tiles;
  };

  // ── room: boxes of free floor round the Core, explored and granted ──
  const core = sim.ents.get(sim.hearthId);
  const C0 = [core.x + 2, core.y + 2];
  const used = new Uint8Array(W * W);
  for (let y = core.y - 6; y < core.y + 11; y++) for (let x = core.x - 6; x < core.x + 11; x++) used[y * W + x] = 1; // the Core and its lines
  const floor = (x, y) => x > 2 && y > 2 && x < W - 3 && y < W - 3 && !used[y * W + x] && sim.grid.level(x, y) < 1 && sim.grid.terrain(x, y) <= 1 && !occ(x, y);
  const cands = [];
  for (let y = C0[1] - 160; y <= C0[1] + 160; y += 2) for (let x = C0[0] - 160; x <= C0[0] + 160; x += 2) cands.push([x, y]);
  const box = (w, h) => {
    const order = cands.map(([x, y]) => [x, y, (x + w / 2 - C0[0]) ** 2 + (y + h / 2 - C0[1]) ** 2]).sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
    outer: for (const [x, y] of order) {
      for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) if (!floor(x + i, y + j)) continue outer;
      sim.explored.push([x + (w >> 1), y + (h >> 1), Math.ceil(Math.hypot(w, h) / 2) + 6]);
      for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) {
        used[(y + j) * W + x + i] = 1;
        const p = FL.parcelAt(x + i, y + j);
        if (!sim.land.holds(p)) sim.land.granted.add(p);
      }
      return [x, y];
    }
    log.push(`no room for ${w}×${h}`);
    return null;
  };
  const want = (fam) => !only || only.some((o) => fam.includes(o));
  const shots = []; // { fam, name, x, y, zoom? }
  const shot = (fam, name, x, y, zoom) => shots.push({ fam, name, x, y, zoom });

  // ── ribbons of every tier: a winding line (both bends) ──
  if (want('ribbons')) for (const def of ['ribbon', 'swift_ribbon', 'express_ribbon', 'traction_ribbon', 'glazed_ribbon', 'camo_ribbon']) {
    const b = box(9, 9); if (!b) continue;
    const [x, y] = [b[0] + 2, b[1]];
    wind(x, y, 'EEEESSSWWWWSSSEEEE', def);
    shot('ribbons', def, x + 2, y + 3);
  }

  // ── junctions: a line over the deck (N or S) and one under it (E or W); one with a silo in front ──
  if (want('junctions')) for (const [over, under, silo] of [[0, 1, false], [2, 3, false], [0, 1, true], [2, 3, true]]) {
    const b = box(13, 13); if (!b) continue;
    const cx = b[0] + 6, cy = b[1] + 6;
    put('crossing', cx, cy, 0);
    line(cx - DX[over] * 3, cy - DY[over] * 3, over, 7);
    line(cx - DX[under] * 3, cy - DY[under] * 3, under, 7);
    if (silo) put('silo', cx + 1, cy + 1, 0);
    shot('junctions', `over ${NAME[over]} under ${NAME[under]}${silo ? ' +silo SE' : ''}`, cx + 0.5, cy + 0.5);
  }

  // ── skybridges: over a line, an empty square and a junction; and a line backed up onto the deck ──
  if (want('skybridges')) for (const wait of [false, true]) for (let d = 0; d < 4; d++) {
    const b = box(17, 17); if (!b) continue;
    const cx = b[0] + 8, cy = b[1] + 8;
    // The line: 2 ribbons, the start (index 2), the gap (3, 4, 5), the far end (6), 2 ribbons.
    const x0 = cx - DX[d] * 4, y0 = cy - DY[d] * 4;
    const at = (k) => [x0 + DX[d] * k, y0 + DY[d] * k];
    const r = (d + 1) & 3, l = (d + 3) & 3;
    // Under the gap: a line across its first square (running right), a junction on its last with a line through it (running left).
    const [ax, ay] = at(3), [jx, jy] = at(5);
    if (!wait) {
      line(ax - DX[r] * 2, ay - DY[r] * 2, r, 5);
      put('crossing', jx, jy, 0);
      line(jx - DX[l] * 2, jy - DY[l] * 2, l, 5);
    } else {
      const [mx, my] = at(4);
      line(mx - DX[r] * 2, my - DY[r] * 2, r, 5);
    }
    put('skybridge', ...at(2), d);
    put('skybridge', ...at(6), d);
    line(x0, y0, d, 9, { skip: [2, 3, 4, 5, 6], sink: !wait });
    shot('skybridges', `${wait ? 'waiting' : 'flowing'} ${NAME[d]}`, cx + 0.5, cy + 0.5);
  }

  // ── a rock plateau (8 × 8, one terrace up): four lines across it, the lifts up and down its edges, junctions on top ──
  if (want('rock')) {
    const b = box(20, 20);
    if (b) {
      const px = b[0] + 6, py = b[1] + 6;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { sim.grid.setTerrain(px + i, py + j, 2); sim.grid.setLevel(px + i, py + j, 1); }
      for (const [i, j] of [[2, 2], [5, 2], [2, 5], [5, 5]]) put('crossing', px + i, py + j, 0);
      line(px + 2, py + 10, 0, 14); // north, up the south wall, down the north one
      line(px + 5, py - 3, 2, 14); // south
      line(px - 3, py + 2, 1, 14); // east
      line(px + 10, py + 5, 3, 14); // west
      put('router', px + 3, py + 7, 0); // (lone, on the rock's front edge)
      shot('rock', 'plateau', px + 4, py + 4, 1.2);
      shot('rock', 'up S wall (N-going)', px + 2.5, py + 7.5);
      shot('rock', 'down S wall (S-going)', px + 5.5, py + 7.5);
      shot('rock', 'down N wall (N-going)', px + 2.5, py + 0.5);
      shot('rock', 'up N wall (S-going)', px + 5.5, py + 0.5);
      shot('rock', 'up W wall (E-going)', px + 0.5, py + 2.5);
      shot('rock', 'down E wall (E-going)', px + 7.5, py + 2.5);
      shot('rock', 'junctions on rock', px + 3.5, py + 3.5);
      shot('rock', 'junctions on rock (front)', px + 5.5, py + 5.5);
    }
  }

  // ── routing blocks: a line through, a side outlet to the right (each with its sink) ──
  if (want('blocks')) for (const def of ['router', 'sorter', 'inverted_sorter', 'overflow_gate', 'underflow_gate']) for (let d = 0; d < 4; d++) {
    const b = box(11, 11); if (!b) continue;
    const cx = b[0] + 5, cy = b[1] + 5, r = (d + 1) & 3;
    put(def, cx, cy, d);
    line(cx - DX[d] * 2, cy - DY[d] * 2, d, 5, { skip: [2] });
    line(cx + DX[r], cy + DY[r], r, 2, { src: false });
    shot('blocks', `${def} ${NAME[d]}`, cx + 0.5, cy + 0.5);
  }
  if (want('blocks')) for (let d = 0; d < 4; d++) {
    const b = box(13, 13); if (!b) continue;
    const cx = b[0] + 5, cy = b[1] + 5, r = (d + 1) & 3;
    // The distributor's 2 × 2 on the line's tiles 2–3 and the column to their right.
    const tx = cx + Math.min(0, DX[r]) + Math.min(0, DX[d]), ty = cy + Math.min(0, DY[r]) + Math.min(0, DY[d]);
    put('distributor', tx, ty, d);
    line(cx - DX[d] * 2, cy - DY[d] * 2, d, 6, { skip: [2, 3] });
    const sx = cx + DX[d] + DX[r] * 2, sy = cy + DY[d] + DY[r] * 2;
    line(sx, sy, r, 2, { src: false });
    shot('blocks', `distributor ${NAME[d]}`, cx + 0.5 + DX[d] * 0.5 + DX[r] * 0.5, cy + 0.5 + DY[d] * 0.5 + DY[r] * 0.5);
  }

  // ── ports: a line into a building's back and out of its front, for each turn ──
  if (want('ports')) for (const [def, s] of [['silo', 2], ['big_silo', 3], ['trade_post', 5]]) for (let d = 0; d < 4; d++) {
    const L = 2 + 3 + s + 3 + 2;
    const b = box(L + 2, L + 2); if (!b) continue;
    const m = s >> 1;
    // The building's origin on a line running d through its middle column (or row).
    const lx0 = b[0] + 1 + (d & 1 ? 2 : m), ly0 = b[1] + 1 + (d & 1 ? m : 2);
    // In: 3 ribbons ending at its back; out: 3 ribbons from its front.
    let ox, oy, inX, inY, outX, outY;
    if (d === 0) { ox = lx0 - m; oy = ly0 + 3 + 2; inX = lx0; inY = oy + s + 2; outX = lx0; outY = oy - 1; }
    if (d === 2) { ox = lx0 - m; oy = ly0 + 3; inX = lx0; inY = oy - 3; outX = lx0; outY = oy + s; }
    if (d === 1) { ox = lx0 + 3; oy = ly0 - m; inX = ox - 3; inY = ly0; outX = ox + s; outY = ly0; }
    if (d === 3) { ox = lx0 + 3 + 2; oy = ly0 - m; inX = ox + s + 2; inY = ly0; outX = ox - 1; outY = ly0; }
    const r = put(def, ox, oy, d);
    line(inX, inY, d, 3, { sink: false });
    line(outX, outY, d, 3, { src: false });
    if (r.ok && def !== 'trade_post') sources.push(r.id);
    const cx = ox + s / 2, cy = oy + s / 2;
    shot('ports', `${def} ${NAME[d]} (back)`, cx - DX[d] * (s / 2 + 0.5), cy - DY[d] * (s / 2 + 0.5));
    shot('ports', `${def} ${NAME[d]} (front)`, cx + DX[d] * (s / 2 + 0.5), cy + DY[d] * (s / 2 + 0.5));
  }
  // Into the Core, on each side's middle.
  if (want('ports')) for (let d = 0; d < 4; d++) {
    const e = (d + 2) & 3; // the line runs towards the Core
    const mx = core.x + 2 + DX[d] * 4, my = core.y + 2 + DY[d] * 4; // the tile just off the side's middle… then 3 more out
    const x0 = mx + DX[d] * 2, y0 = my + DY[d] * 2;
    sim.explored.push([mx, my, 8]);
    line(x0, y0, e, 3, { sink: false });
    shot('ports', `Core from ${NAME[d]}`, mx + 0.5 - DX[d] * 0.5, my + 0.5 - DY[d] * 0.5);
  }

  // ── an incinerator fed from its four sides ──
  if (want('pit')) {
    const b = box(13, 13);
    if (b) {
      const cx = b[0] + 6, cy = b[1] + 6;
      put('incinerator', cx, cy, 0);
      for (let d = 0; d < 4; d++) { const o = (d + 2) & 3; line(cx + DX[o] * 3, cy + DY[o] * 3, d, 3, { sink: false }); }
      shot('pit', 'incinerator ×4', cx + 0.5, cy + 0.5);
      shot('pit', 'incinerator from S/E', cx + 1, cy + 1);
    }
  }

  // ── lines passing along a tall building's sides (not into it) ──
  if (want('pass')) for (const axis of [1, 0]) {
    const b = box(14, 14); if (!b) continue;
    const bx = b[0] + 6, by = b[1] + 6;
    put('silo', bx, by, 0);
    if (axis === 1) { line(bx - 2, by - 1, 1, 6); line(bx + 3, by + 2, 3, 6); }
    else { line(bx - 1, by + 3, 0, 6); line(bx + 2, by - 2, 2, 6); }
    shot('pass', axis === 1 ? 'along N and S sides' : 'along W and E sides', bx + 1, by + 1);
  }

  for (const e of sim.ents.map.values()) if (e.builtAt !== 0) e.builtAt = 0;
  sim.markDirty();
  sim.ensureCompiled();
  const it = ITEMS.indexOf(ITEM);
  for (const id of sources) {
    const st = sim.stores.get(id), nd = sim.graph.nodeByEnt.get(id);
    if (st) st[it] = 1e6; else log.push(`no store for source ${id}`);
    if (nd) nd.locked = it; // a single-item store hands out its lock (set from its stock when compiled)
  }
  return { shots, log, sources: sources.length, ents: sim.ents.map.size };
}, ONLY);
console.log(`rig: ${rig.shots.length} shots, ${rig.sources} sources, ${rig.ents} entities`);
for (const l of rig.log) console.log('  !', l);

const settle = async (ms = 700) => {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
await page.evaluate(() => window.FL.view('iso'));
// Let the lines fill (a few seconds of play) before shooting.
await page.waitForTimeout(Number(process.env.FILL_MS ?? 9000));

const W2 = 400, H2 = 330;
const clipAt = (zoom) => (zoom && zoom < ZOOM ? { x: 600 - 300, y: 400 - 240, width: 600, height: 480 } : { x: 600 - W2 / 2, y: 400 - H2 / 2 - 20, width: W2, height: H2 });
const done = new Map(); // family → [{ name, files }]
let n = 0;
for (const s of rig.shots) {
  if (PICK && !PICK.some((p) => s.name.includes(p))) continue;
  for (const phase of PHASES) {
    await page.evaluate((p) => window.FL.dayPhase(p), phase);
    await page.evaluate(({ x, y, z }) => window.FL.lookAt(x, y, z), { x: s.x, y: s.y, z: s.zoom ?? ZOOM });
    await settle();
    if (STEP) await page.evaluate(() => window.FL.pause());
    const files = [];
    for (let k = 0; k < FRAMES; k++) {
      const f = join(OUT, `${s.fam}-${String(n).padStart(3, '0')}${PHASES.length > 1 ? `-${phase}` : ''}-${k}.png`);
      await page.screenshot({ path: f, clip: clipAt(s.zoom) });
      files.push(f);
      if (STEP) { await page.evaluate((t) => window.FL.tick(t), STEP); await page.waitForTimeout(120); }
      else await page.waitForTimeout(260);
    }
    if (STEP) await page.evaluate(() => window.FL.resume());
    if (!done.has(s.fam)) done.set(s.fam, []);
    done.get(s.fam).push({ name: PHASES.length > 1 ? `${s.name} · ${phase}` : s.name, files });
  }
  n++;
}

// ── the late debug base at a few spots, by day and by night ──
if (!process.env.NOLATE && (!ONLY || ONLY.some((o) => 'late'.includes(o)))) {
  const lv = await page.evaluate(() => window.FL.debugSave('late'));
  console.log('late base', lv?.ok);
  await page.waitForTimeout(1500);
  const spots = await page.evaluate(() => {
    const sim = window.FL.app.sim, out = [];
    const kinds = { crossing: 'junction', skybridge: 'skybridge', router: 'router', sorter: 'sorter', incinerator: 'incinerator', trade_post: 'trade post', traction_ribbon: 'traction' };
    const ids = window.FL.ids().buildings;
    const seen = new Map();
    // Spots with lines that carry items: a tile whose chain holds some.
    const busy = (x, y) => { let n = 0; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const c = sim.chainAt?.(x + i, y + j); if (c) for (let k = 0; k < c.length; k++) if (c.itemAt(k) >= 0) n++; } return n; };
    for (const e of [...sim.ents.map.values()].sort((a, b) => a.id - b.id)) {
      const id = ids[e.def], name = kinds[id];
      if (!name || (seen.get(name) ?? 0) >= 2) continue;
      const b = busy(e.x, e.y);
      if (b < 3) continue;
      seen.set(name, (seen.get(name) ?? 0) + 1);
      out.push({ name: `${name} @${e.x},${e.y}`, x: e.x + 0.5, y: e.y + 0.5 });
    }
    return out;
  });
  const fam = 'late';
  done.set(fam, []);
  for (const s of spots) {
    const files = [];
    for (const phase of ['noon', 'night']) {
      await page.evaluate((p) => window.FL.dayPhase(p), phase);
      await page.evaluate(({ x, y, z }) => window.FL.lookAt(x, y, z), { x: s.x, y: s.y, z: 1.6 });
      await settle(900);
      const f = join(OUT, `late-${String(n++).padStart(3, '0')}-${phase}.png`);
      await page.screenshot({ path: f, clip: clipAt() });
      files.push(f);
    }
    done.get(fam).push({ name: s.name, files });
  }
}

// ── contact sheets: one per family, each scene's two frames side by side, labelled ──
const sheetPage = await context.newPage();
const PER = 12; // scenes a sheet
for (const [fam, all] of done) for (let p = 0; p * PER < all.length; p++) {
  const rows = all.slice(p * PER, (p + 1) * PER);
  const cell = (r) => `<figure><figcaption>${r.name}</figcaption><div>${r.files.map((f) => `<img src="data:image/png;base64,${readFileSync(f).toString('base64')}">`).join('')}</div></figure>`;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 8px; background: #222; font: 13px/1.2 system-ui, sans-serif; color: #eee; display: flex; flex-wrap: wrap; gap: 8px; width: 1700px; }
    figure { margin: 0; background: #333; padding: 4px; } figcaption { padding: 2px 4px 4px; }
    div { display: flex; gap: 3px; } img { width: 260px; display: block; }
  </style>${rows.map(cell).join('')}`;
  await sheetPage.setViewportSize({ width: 1716, height: 800 });
  await sheetPage.setContent(html);
  await sheetPage.waitForTimeout(300);
  const f = join(OUT, `sheet-${fam}${all.length > PER ? `-${p + 1}` : ''}.png`);
  await sheetPage.screenshot({ path: f, fullPage: true, timeout: 120000 });
  console.log(`✓ ${f}`);
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify([...done].map(([fam, rows]) => ({ fam, rows })), null, 1));
if (errors.length) console.log(`${errors.length} page errors`);
await browser.close();
