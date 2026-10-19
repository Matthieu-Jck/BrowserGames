// scenario-steam.ts — « La vapeur » in the debug bases (D114: water's first use, from Tier 1), as a
// player answers it after « La verrerie »: the Steam plan (after the turbine's, D143), a pump at
// the water nearest the Core (readouts/water.ts: on any level — map 4's spring pool at the floor's
// edge, D115; the tarn up on the Crown on maps 2–3, whose water pours down the terraces in its
// conduit, D114; map 1's lake), on that water's far shore from the Core and the boiler beyond it
// (the tutorial's lines, the trade post's and the lab's ring the Core: the near side is theirs), a
// conduit between them, and the boiler's coal from a drill of its own on the cirque's coal, its line
// laid by the layout kit (across other lines on junctions). Everything wired into the Core's grid
// pole by pole. Each water spot and each boiler spot tried whole, taken back up when a part fails.
import { buildingIdx } from '@/content/registry';
import { checkpoint, crossable, keepOff, rollback, routeLevel, spotsNear, type BeltTiles } from './dev';
import { worldPorts, type WorldPort } from './entities';
import { waterSpots } from './readouts/water';
import { toward } from './scenario-late';
import type { Builder } from './scenarios';
import { CENTER } from './constants';
import { DX, DY, isFloor, opposite, type Rot } from './types';
import { inWorld, tileIndex } from './world/grid';

/** Water spots tried, nearest the Core first. */
const WATER_TRIES = 12;
/** Boiler spots tried for each pump, and in all (a land where it fails must not cost the build seconds). */
const BOILER_TRIES = 8, BOILER_BUDGET = 24;
/** Coal drill spots weighed for each boiler: the deposit's outermost. */
const DRILL_TRIES = 6;
/** How far the conduit's search may spread (tiles). */
const CONDUIT_SEARCH = 6000;
/**
 * Where the boiler is looked for: water up on the Crown, this many tiles from it toward the Core —
 * below the peak, on the cirque's floor at its foot (the floor's rim lies 23 tiles out, the tarn 30);
 * water on the floor, `BEYOND` tiles past it, away from the Core.
 */
const BELOW = 10, BEYOND = 3;
/** The water nearest the Core: its spots on the nearest one's level within this many tiles of it (one pool, one stretch of stream). */
const BODY = 8;

/**
 * The boiler's coal line keeps to the floor's rim where it can (`rimRoute`): a tile nearer the
 * Core than `RIM` tiles costs `INNER` steps more. The middle of the cirque is the tutorial's — the
 * trade post's starter line, the lab, the quartz and circuit lines come after « La vapeur » (D114:
 * a line straight across took their room on lands 1–2).
 */
const RIM = 20, INNER = 6;
/** What running straight across another line costs on top of its two tiles (a junction there, laid by `placeBelts`). */
const CROSS = 6;
/** The rim route's search, in tiles settled. */
const RIM_SEARCH = 12_000;

/** The roles this step lays (taken back when a water spot fails). */
const ROLES = ['boiler', 'boilerPump', 'coalB'] as const;

/** 5 · « La vapeur »: a pump at the water, the boiler below it fed by a conduit, its coal led in, wired; the quest met. */
export function steamPower(b: Builder): void {
  b.plan('wind_flower', 'steam');
  const sim = b.sim;
  b.affordAll(['steam_boiler', 1], ['pump', 1], ['conduit', 40], ['drill', 1]);
  let done = false;
  const budget = { boilers: BOILER_BUDGET };
  // The nearest water's spots, its far shore first; then the rest, nearest the Core first.
  const all = waterSpots(sim), first = all[0];
  const d2 = (p: readonly [number, number], q: readonly [number, number]): number => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
  const lv0 = first ? sim.grid.level(first[0], first[1]) : 0;
  const body = first ? all.filter((p) => d2(p, first) <= BODY * BODY && sim.grid.level(p[0], p[1]) === lv0) : [];
  const order = [...body.map((p, k) => [p, k] as const).sort((a, c) => d2(c[0], b.heart) - d2(a[0], b.heart) || a[1] - c[1]).map(([p]) => p), ...all.filter((p) => !body.includes(p))];
  for (const [px, py] of order.slice(0, WATER_TRIES)) {
    if (budget.boilers <= 0) break;
    const cp = checkpoint(sim), skips = b.report.skipped.length;
    if (steamAt(b, px, py, budget)) { done = true; break; }
    rollback(sim, cp);
    b.report.skipped.length = skips;
    for (const r of ROLES) { delete b.ids[r]; delete b.lines[r]; }
    delete b.lines.water;
  }
  if (!done) { b.skip('steam'); return; }
  b.wire('boiler', 'boilerPump', 'coalB');
  b.until('steam_power');
}

/** The way into an input port: its front tile, and the way a line there must point. */
const into = (p: WorldPort): Map<number, Rot> => new Map([[tileIndex(p.fx, p.fy), opposite(p.dir)]]);

/** A pump on (px, py), the boiler below it fed by a conduit, its coal led in: whether all of it stands. */
function steamAt(b: Builder, px: number, py: number, budget: { boilers: number }): boolean {
  const sim = b.sim, lv = sim.grid.level(px, py), pumpDef = buildingIdx('pump');
  for (const rot of [0, 1, 2, 3] as const) {
    const out = worldPorts({ def: pumpDef, x: px, y: py, rot })[0]!;
    // Its outlet onto free ground of its own level (a port meets only its level, D45).
    if (!inWorld(out.fx, out.fy) || sim.grid.occ[tileIndex(out.fx, out.fy)] !== 0 || sim.grid.level(out.fx, out.fy) !== lv) continue;
    const c = sim.canPlace('pump', px, py, rot);
    if (!c.ok || c.replaces.length) continue;
    const pump = sim.place('pump', px, py, rot);
    if (!pump.ok) continue;
    if (boilerBelow(b, out, [px, py], budget)) { b.ids.boilerPump = pump.id!; return true; }
    sim.remove(px, py);
  }
  return false;
}

/** The boiler on the floor below the water, its water down a conduit from the pump's outlet `out`, its coal by ribbon. */
function boilerBelow(b: Builder, out: WorldPort, water: readonly [number, number], budget: { boilers: number }): boolean {
  const sim = b.sim;
  const near: [number, number] = sim.grid.level(water[0], water[1]) > 0 ? toward(water, b.heart, BELOW) : toward(water, b.heart, -BEYOND);
  const spots = spotsNear(sim, 'steam_boiler', near, { r: 8, toward: b.deposit('coal') }).slice(0, BOILER_TRIES);
  for (const [x, y, rot] of spots) {
    if (budget.boilers-- <= 0) return false;
    const cp = checkpoint(sim);
    const r = sim.place('steam_boiler', x, y, rot);
    if (!r.ok) continue;
    // The water into the intake nearer the pump; the layout kit leads the coal into the other.
    const ins = worldPorts(sim.ents.get(r.id!)!).filter((p) => p.io === 'in');
    const d2 = (p: WorldPort): number => (p.fx - out.fx) ** 2 + (p.fy - out.fy) ** 2;
    const wet = d2(ins[0]!) <= d2(ins[1]!) ? ins[0]! : ins[1]!;
    const path = routeLevel(sim, [out.fx, out.fy], into(wet), CONDUIT_SEARCH, true);
    const laid = !!path && sim.placeBelts('conduit', path) === path.length;
    if (laid) {
      b.ids.boiler = r.id!;
      b.lines.water = path!;
      // Its coal: a drill of its own on the cirque's coal, its line round the floor's rim into the free intake.
      if (coalFor(b, ins.find((p) => p !== wet)!)) return true;
      delete b.ids.boiler;
      delete b.lines.water;
    }
    rollback(sim, cp);
  }
  return false;
}

/** A coal drill of the boiler's own on the cirque's coal, its ribbon round the floor's rim into the intake `dry`. */
function coalFor(b: Builder, dry: WorldPort): boolean {
  const sim = b.sim;
  b.affordAll(['drill', 1]);
  b.junctions(); // across the tutorial's lines, as a player would
  b.crossings();
  // Of the deposit's outermost spots (a line from there starts near the rim, clear of what comes in
  // past the deposit later: the quartz workshop's lines; a spot on its inner or southern side took
  // their room on lands 1–2), the one whose line to the boiler is shortest.
  const far = (x: number, y: number): number => (x - b.heart[0]) ** 2 + (y - b.heart[1]) ** 2;
  const drills = spotsNear(sim, 'drill', b.deposit('coal'), { item: 'coal', r: 12, toward: [dry.fx, dry.fy] })
    .map((p, k) => [p, k] as const).sort((a, c) => far(c[0][0], c[0][1]) - far(a[0][0], a[0][1]) || a[1] - c[1]).map(([p]) => p)
    .slice(0, DRILL_TRIES);
  const scored: Array<[number, number, Rot, number]> = [];
  for (const [x, y, rot] of drills) {
    const cp = checkpoint(sim);
    const d = sim.place('drill', x, y, rot);
    if (d.ok) {
      const o = worldPorts(sim.ents.get(d.id!)!).find((p) => p.io === 'out')!;
      const path = rimRoute(b, [o.fx, o.fy], into(dry));
      if (path) scored.push([x, y, rot, path.length]);
    }
    rollback(sim, cp);
  }
  scored.sort((p, q) => p[3] - q[3] || p[1] - q[1] || p[0] - q[0]);
  for (const [x, y, rot] of scored) {
    const cp = checkpoint(sim);
    const d = sim.place('drill', x, y, rot);
    if (!d.ok) continue;
    const o = worldPorts(sim.ents.get(d.id!)!).find((p) => p.io === 'out')!;
    const path = rimRoute(b, [o.fx, o.fy], into(dry));
    if (path && sim.placeBelts('ribbon', path) === path.length) {
      b.ids.coalB = d.id!;
      b.lines.coalB = path;
      return true;
    }
    rollback(sim, cp); // the drill, its ribbons, a crossed line's ribbon back under a junction
  }
  return false;
}

/**
 * A ribbon line on the floor from tile `from` to one of `goals` (tile → the way its last ribbon
 * points), the cheapest by a step a tile and `INNER` more for a tile within `RIM` of the Core: it
 * keeps to the cirque's rim where it can. Free floor of `from`'s level only, off other ports' fronts
 * and routing blocks' sides (the goals excepted); it runs straight across another line where that
 * line's tile is `crossable` (`CROSS` more: `placeBelts` lays a junction there, once its plan is in).
 * Costs are small integers: a bucket queue, settled in tile order within a bucket (deterministic).
 */
function rimRoute(b: Builder, from: readonly [number, number], goals: ReadonlyMap<number, Rot>): BeltTiles | null {
  const sim = b.sim, avoid = keepOff(sim), W = 1024, lv = sim.grid.level(from[0], from[1]);
  const ok = (x: number, y: number): boolean => inWorld(x, y) && sim.grid.occ[tileIndex(x, y)] === 0
    && sim.grid.level(x, y) === lv && isFloor(sim.grid.terrain(x, y));
  if (!ok(from[0], from[1])) return null;
  const cost = (x: number, y: number): number => 1 + ((x - CENTER) ** 2 + (y - CENTER) ** 2 < RIM * RIM ? INNER : 0);
  const start = tileIndex(from[0], from[1]);
  const dist = new Map<number, number>([[start, 0]]), prev = new Map<number, number>([[start, -1]]);
  const via = new Map<number, number>(); // a tile reached across a line → the crossed tile
  const cross = sim.unlocked('junction');
  const buckets: number[][] = [[start]];
  let end = -1, settled = 0;
  for (let c = 0; c < buckets.length && end < 0 && settled < RIM_SEARCH; c++) {
    const bucket = buckets[c];
    if (!bucket) continue;
    bucket.sort((p, q) => p - q);
    for (const cur of bucket) {
      if (dist.get(cur) !== c) continue; // a cheaper way settled it already
      settled++;
      if (goals.has(cur)) { end = cur; break; }
      const cx = cur % W, cy = (cur - cx) / W;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d]!, ny = cy + DY[d]!, n = tileIndex(nx, ny);
        if (ok(nx, ny) && (!avoid.has(n) || goals.has(n))) {
          const nc = c + cost(nx, ny);
          if ((dist.get(n) ?? Infinity) <= nc) continue;
          dist.set(n, nc);
          prev.set(n, cur);
          via.delete(n);
          (buckets[nc] ??= []).push(n);
          continue;
        }
        // Straight across a line, onto the free tile past it.
        const fx = nx + DX[d]!, fy = ny + DY[d]!, f = tileIndex(fx, fy);
        if (!cross || !crossable(sim, nx, ny, d as Rot) || !ok(fx, fy) || (avoid.has(f) && !goals.has(f))) continue;
        const fc = c + cost(nx, ny) + cost(fx, fy) + CROSS;
        if ((dist.get(f) ?? Infinity) <= fc) continue;
        dist.set(f, fc);
        prev.set(f, cur);
        via.set(f, n);
        (buckets[fc] ??= []).push(f);
      }
    }
  }
  if (end < 0) return null;
  const path: number[] = [];
  for (let t = end; t !== -1; t = prev.get(t)!) { path.push(t); const v = via.get(t); if (v !== undefined) path.push(v); }
  path.reverse();
  return path.map((t, i) => {
    const x = t % W, y = (t - x) / W, n = path[i + 1];
    if (n === undefined) return [x, y, goals.get(t)!];
    const nx = n % W, ny = (n - nx) / W;
    return [x, y, (nx > x ? 1 : nx < x ? 3 : ny > y ? 2 : 0) as Rot];
  });
}
