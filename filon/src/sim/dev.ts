// dev.ts — developer helpers (debug handle, smoke tests, art review): find a spot for a
// building on a deposit, route a ribbon by BFS between two ports, run a wired line of masts
// from the Hearth's grid to a building (D25: power only goes through wires), and lay out a
// small demo colony in the cirque, fully wired. Not used by gameplay; everything goes through
// commands, so a demo colony replays. Spots must be free ground: `canPlace(...).ok` also
// accepts a placement that would replace what stands there.
// At the end, the layout kit of the scripted debug bases (scenarios.ts): spots read off the map
// as it stands, lines that keep off other buildings' ports, routers branching a laid line; for the
// late base's far works (scenario-late.ts, D66), pylon lines and lines over the mountains.
import { BUILDING_KIND, buildingIdx, itemIdx } from '@/content/registry';
import { PLAN_IDS, planDef } from '@/content/research';
import { CIRQUE } from '@/content/world';
import { CENTER } from './constants';
import { footprint, forTiles, worldPorts, type WorldPort } from './entities';
import { blockDrill, onBlockGrid, oreBlockOf } from './ore-blocks';
import { gap2, isLinkPoint, linkable, linkPoint, wireObstacle, wireSteep } from './power/links';
import { landOf } from './systems/power';
import { DX, DY, opposite, isFloor, isRock, type Ent, type Rot } from './types';
import { inWorld, tileIndex } from './world/grid';
import type { Sim } from './state';

/** Free ground for `def` at (x, y): it fits and replaces nothing. */
const freeSpot = (sim: Sim, def: string, x: number, y: number, rot: Rot): boolean => {
  const c = sim.canPlace(def, x, y, rot);
  return c.ok && c.replaces.length === 0;
};

/**
 * Find a placement for `def` whose footprint lies on `item` deposit tiles near (x, y), covering
 * none of the `avoid` tiles (say, the square another drill hands out to).
 */
export function findSpot(sim: Sim, def: string, item: string, x: number, y: number, rot: Rot, radius = 4, avoid: ReadonlySet<number> = new Set()): [number, number] | null {
  const it = itemIdx(item);
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = x + dx, py = y + dy;
        let ok = true;
        for (let j = 0; j < 2 && ok; j++) for (let i = 0; i < 2 && ok; i++) if (sim.grid.ore(px + i, py + j) !== it || avoid.has(tileIndex(px + i, py + j))) ok = false;
        if (ok && freeSpot(sim, def, px, py, rot)) return [px, py];
      }
    }
  }
  return null;
}

/** BFS a ribbon from tile `from` to tile `to` (inclusive); the last ribbon points `finalDir`. */
export function route(sim: Sim, from: [number, number], to: [number, number], finalDir: Rot, def = 'ribbon', maxLen = 120): Array<[number, number, Rot]> | null {
  const free = (x: number, y: number): boolean =>
    inWorld(x, y) && sim.grid.occ[tileIndex(x, y)] === 0 && isFloor(sim.grid.terrain(x, y)) && sim.revealed(x, y);
  if (!free(from[0], from[1]) || !free(to[0], to[1])) return null;
  const prev = new Map<number, number>();
  const start = tileIndex(from[0], from[1]), goal = tileIndex(to[0], to[1]);
  const q = [start];
  prev.set(start, -1);
  while (q.length) {
    const cur = q.shift()!;
    if (cur === goal) break;
    const cx = cur % 1024, cy = (cur - cx) / 1024;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]!, ny = cy + DY[d]!;
      const n = tileIndex(nx, ny);
      if (prev.has(n) || !free(nx, ny)) continue;
      prev.set(n, cur);
      q.push(n);
    }
    if (prev.size > maxLen * maxLen) return null;
  }
  if (!prev.has(goal)) return null;
  const path: number[] = [];
  for (let t = goal; t !== -1; t = prev.get(t)!) path.push(t);
  path.reverse();
  const out: Array<[number, number, Rot]> = [];
  for (let i = 0; i < path.length; i++) {
    const t = path[i]!, x = t % 1024, y = (t - x) / 1024;
    let dir = finalDir;
    if (i < path.length - 1) {
      const n = path[i + 1]!, nx = n % 1024, ny = (n - nx) / 1024;
      dir = (nx > x ? 1 : nx < x ? 3 : ny > y ? 2 : 0) as Rot;
    }
    out.push([x, y, dir]);
  }
  return out;
}

/**
 * A ribbon line over the land as it is (D45): from tile `from` to one of `goals` (tile → the way
 * its last ribbon must point), on the floor and on rock (ribbons stand on rock), one level up or
 * down at a time — the tile that hands on to the next level is a traction ribbon (`lift`), every
 * other one a plain ribbon — and never two steps in a row (an elevator needs a flat ribbon tile in
 * front of it: placement refuses it, `lift_room`). It keeps off other ports' fronts and routing
 * blocks' sides (`keepOff`), the goals excepted. The tiles with their way and their ribbon, or null.
 */
export function routeOver(sim: Sim, from: readonly [number, number], goals: ReadonlyMap<number, Rot>, maxNodes = 60_000): Array<[number, number, Rot, 'ribbon' | 'traction_ribbon']> | null {
  const avoid = keepOff(sim);
  const W = 1024;
  const lv = (t: number): number => sim.grid.level(t % W, (t - (t % W)) / W);
  const ok = (x: number, y: number): boolean => {
    if (!inWorld(x, y)) return false;
    const t = sim.grid.terrain(x, y);
    return sim.grid.occ[tileIndex(x, y)] === 0 && sim.revealed(x, y) && (isFloor(t) || isRock(t));
  };
  if (!ok(from[0], from[1])) return null;
  // Breadth first over (tile, came in by a step): a step may follow only a flat move.
  const key = (t: number, stepped: boolean): number => t * 2 + (stepped ? 1 : 0);
  const start = key(tileIndex(from[0], from[1]), false);
  const prev = new Map<number, number>([[start, -1]]);
  const q = [start];
  let end = -1;
  for (let h = 0; h < q.length && prev.size < maxNodes; h++) {
    const k = q[h]!, cur = k >> 1, stepped = (k & 1) === 1;
    if (goals.has(cur)) { end = k; break; }
    const cx = cur % W, cy = (cur - cx) / W;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]!, ny = cy + DY[d]!;
      const n = tileIndex(nx, ny);
      if (!ok(nx, ny) || (avoid.has(n) && !goals.has(n))) continue;
      const dl = Math.abs(lv(n) - lv(cur));
      if (dl > 1 || (dl === 1 && stepped)) continue;
      const nk = key(n, dl === 1);
      if (prev.has(nk)) continue;
      prev.set(nk, k);
      q.push(nk);
    }
  }
  if (end < 0) return null;
  const path: number[] = [];
  for (let k = end; k !== -1; k = prev.get(k)!) path.push(k >> 1);
  path.reverse();
  // A tile met twice (once by each kind of move) would cross itself: no such route.
  if (new Set(path).size !== path.length) return null;
  return path.map((t, i) => {
    const x = t % W, y = (t - x) / W;
    if (i === path.length - 1) return [x, y, goals.get(t)!, 'ribbon'];
    const n = path[i + 1]!, nx = n % W, ny = (n - nx) / W;
    const dir = (nx > x ? 1 : nx < x ? 3 : ny > y ? 2 : 0) as Rot;
    return [x, y, dir, lv(n) !== lv(t) ? 'traction_ribbon' : 'ribbon'];
  });
}

/**
 * A line on one level only (D45: a conduit has no lift): from tile `from` to one of `goals` (tile →
 * the way its last tile points), breadth first over free floor and rock of `from`'s level, off other
 * ports' fronts and routing blocks' sides (the goals excepted). With `fall`, a conduit's water may
 * also pour one terrace down at each step (D114), never climb: the line ends lower than it starts.
 */
export function routeLevel(sim: Sim, from: readonly [number, number], goals: ReadonlyMap<number, Rot>, maxNodes = 4000, fall = false): BeltTiles | null {
  const avoid = keepOff(sim), W = 1024, lv = sim.grid.level(from[0], from[1]);
  const ok = (x: number, y: number): boolean => {
    if (!inWorld(x, y) || sim.grid.occ[tileIndex(x, y)] !== 0 || !sim.revealed(x, y) || (!fall && sim.grid.level(x, y) !== lv)) return false;
    const t = sim.grid.terrain(x, y);
    return isFloor(t) || isRock(t);
  };
  // A move keeps the level, or (`fall`) goes one level down.
  const step = (a: number, bx: number, by: number): boolean => {
    const d = sim.grid.level(a % W, (a - (a % W)) / W) - sim.grid.level(bx, by);
    return d === 0 || (fall && d === 1);
  };
  if (!ok(from[0], from[1])) return null;
  const start = tileIndex(from[0], from[1]);
  const prev = new Map<number, number>([[start, -1]]);
  const q = [start];
  let end = -1;
  for (let h = 0; h < q.length && prev.size < maxNodes; h++) {
    const cur = q[h]!;
    if (goals.has(cur)) { end = cur; break; }
    const cx = cur % W, cy = (cur - cx) / W;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]!, ny = cy + DY[d]!, n = tileIndex(nx, ny);
      if (prev.has(n) || !ok(nx, ny) || !step(cur, nx, ny) || (avoid.has(n) && !goals.has(n))) continue;
      prev.set(n, cur);
      q.push(n);
    }
  }
  if (end < 0) return null;
  const path: number[] = [];
  for (let t = end; t !== -1; t = prev.get(t)!) path.push(t);
  path.reverse();
  return path.map((t, i) => {
    const x = t % W, y = (t - x) / W, n = path[i + 1];
    if (n === undefined) return [x, y, goals.get(t)!];
    const nx = n % W, ny = (n - nx) / W;
    return [x, y, (nx > x ? 1 : nx < x ? 3 : ny > y ? 2 : 0) as Rot];
  });
}

/** Connect an entity's output port to another entity's input port with a routed ribbon. */
export function connect(sim: Sim, fromId: number, toId: number, outIdx = -1, inIdx = -1, def = 'ribbon'): number {
  const a = sim.ents.get(fromId), b = sim.ents.get(toId);
  if (!a || !b) return 0;
  const outs = worldPorts(a).filter((p) => p.io === 'out');
  const ins = worldPorts(b).filter((p) => p.io === 'in');
  const oList = outIdx >= 0 ? [outs[outIdx]!] : outs;
  const iList = inIdx >= 0 ? [ins[inIdx]!] : ins;
  // Try the closest port pairs first so ribbons stay short.
  const pairs = oList.flatMap((o) => iList.map((i) => ({ o, i, d: Math.abs(o.fx - i.fx) + Math.abs(o.fy - i.fy) })));
  pairs.sort((a, b) => a.d - b.d);
  for (const { o, i } of pairs) {
    if (!o || !i) continue;
    const path = route(sim, [o.fx, o.fy], [i.fx, i.fy], opposite(i.dir), def);
    if (path) return sim.placeBelts(def, path);
  }
  return 0;
}

/** Everything wired, directly or through others, to the Hearth (a walk over the wires). */
export function hearthNetwork(sim: Sim): Set<number> {
  const seen = new Set<number>([sim.hearthId]);
  const todo = [sim.hearthId];
  while (todo.length) {
    const id = todo.pop()!;
    for (const o of sim.links.of(id)) if (!seen.has(o)) { seen.add(o); todo.push(o); }
  }
  return seen;
}

/**
 * Wire a building into the Hearth's grid (D25): straight from the nearest pillar of that grid
 * (or the Hearth) when one reaches it with a free slot; otherwise a line of poles from the
 * pillar nearest to it: the fewest poles, each within the previous one's reach and strung by the
 * wire rule's land (D45, D78: a pole's wire climbs one terrace and clears a one-terrace rise), the
 * last one reaching the building — found breadth first over free floor and rock around the two. A pole never stands in front of
 * a port (`portFronts`): the breadth-first scan once dropped the demo's on its trade post's
 * outlet, and no ribbon could take the purchases out to the Heart (D43). Paid, logged placements
 * and `link` commands, like a player's. Returns the masts placed.
 */
export function powerLine(sim: Sim, targetId: number, maxMasts = 24): number {
  const t = sim.ents.get(targetId);
  if (!t || !linkable(t.def)) return 0;
  const net = hearthNetwork(sim);
  if (net.has(targetId)) return 0;
  // The grid's link points, nearest to the target first (then by id).
  const points = [...net].map((id) => sim.ents.get(id)).filter((e): e is Ent => !!e && isLinkPoint(e.def))
    .sort((a, b) => gap2(a, t) - gap2(b, t) || a.id - b.id);
  for (const p of points) if (sim.link(p.id, targetId).ok) return 0;
  // Start from the nearest one with a free slot.
  const start = points.find((p) => sim.links.degree(p.id) < (linkPoint(p.def, sim.mods)?.slots ?? 0));
  if (!start) return 0;
  const mast = buildingIdx('mast');
  const range = linkPoint(mast, sim.mods)!.range;
  const land = landOf(sim);
  const startReach = Math.max(range, linkPoint(start.def, sim.mods)?.range ?? 0);
  const pad = 2 * range;
  const bx0 = Math.min(start.x, t.x) - pad, bx1 = Math.max(start.x, t.x) + pad;
  const by0 = Math.min(start.y, t.y) - pad, by1 = Math.max(start.y, t.y) + pad;
  const at = (x: number, y: number): Pick<Ent, 'def' | 'x' | 'y' | 'rot'> => ({ def: mast, x, y, rot: 0 as Rot });
  // The wire rule's land, as `link` will read it: the ends' levels and the land between (D78).
  const fits = (a: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>, b: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>): boolean => !wireSteep(a, b, land) && !wireObstacle(a, b, land);
  const reachesTarget = (x: number, y: number): boolean => gap2(at(x, y), t) <= range * range && fits(at(x, y), t);
  const fronts = portFronts(sim); // poles have no ports: the set holds while the line goes up
  // Breadth first: each layer is one more pole.
  const nodes: Array<{ x: number; y: number; prev: number }> = [];
  const seen = new Set<number>();
  let layer: number[] = [];
  const visit = (x: number, y: number, prev: number, into: number[], from: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>): void => {
    const k = tileIndex(x, y);
    if (seen.has(k)) return;
    if (x < bx0 || x > bx1 || y < by0 || y > by1 || fronts.has(k) || !freeSpot(sim, 'mast', x, y, 0)) { seen.add(k); return; }
    if (!fits(from, at(x, y))) return; // the land keeps it from `from`, not from every pole of the layer: it stays unseen
    seen.add(k);
    nodes.push({ x, y, prev });
    into.push(nodes.length - 1);
  };
  for (let y = start.y - startReach - 1; y <= start.y + startReach + 5; y++) {
    for (let x = start.x - startReach - 1; x <= start.x + startReach + 5; x++) {
      if (gap2(start, at(x, y)) > startReach * startReach) continue;
      visit(x, y, -1, layer, start);
    }
  }
  let found = -1;
  for (let hop = 0; hop < maxMasts && layer.length && found < 0; hop++) {
    const next: number[] = [];
    for (const i of layer) {
      const n = nodes[i]!;
      if (reachesTarget(n.x, n.y)) { found = i; break; }
      const from = at(n.x, n.y);
      for (let y = n.y - range; y <= n.y + range; y++) {
        for (let x = n.x - range; x <= n.x + range; x++) {
          if ((x - n.x) * (x - n.x) + (y - n.y) * (y - n.y) > range * range) continue;
          visit(x, y, i, next, from);
        }
      }
    }
    layer = next;
  }
  if (found < 0) return 0;
  const path: Array<{ x: number; y: number }> = [];
  for (let i = found; i >= 0; i = nodes[i]!.prev) path.push(nodes[i]!);
  path.reverse();
  let cur: Ent = start, n = 0;
  for (const p of path) {
    const r = sim.place('mast', p.x, p.y, 0);
    if (!r.ok) return n;
    n++;
    const m = sim.ents.get(r.id!)!;
    // The new mast wired itself to the nearest pillar; make sure it hangs on this line.
    if (!sim.links.has(cur.id, m.id) && !sim.link(cur.id, m.id).ok && !hearthNetwork(sim).has(m.id)) return n;
    cur = m;
  }
  sim.link(cur.id, targetId);
  return n;
}

/**
 * Wire a far building into the Heart's grid by pylons (Land Registry, tr4): from the grid's link
 * point nearest it with a free slot, the fewest pylons, each within a pylon's reach of the last
 * (with Reinforced Pylons, 60) and strung by the wire rule's land (D78: three terraces up or down,
 * three above the land between, so the line goes round a mountain), the last reaching the building — found breadth first over a lattice of free tiles (every `step` tiles) in a
 * corridor between the two, off every port's front. Pylons off the claim's land come by kite
 * (their cost ×3, granted by the caller); a neighbouring base's parcel is refused by placement, so the
 * lattice goes round it. Paid, logged placements and `link` commands. Returns the pylons placed
 * (0 when the building already hangs on the grid, or no line was found).
 */
export function pylonLine(sim: Sim, targetId: number, step = 4, maxPylons = 30): number {
  const t = sim.ents.get(targetId);
  if (!t || !linkable(t.def)) return 0;
  const net = hearthNetwork(sim);
  if (net.has(targetId)) return 0;
  const pylon = buildingIdx('pylon');
  const R = linkPoint(pylon, sim.mods)!.range;
  const land = landOf(sim);
  const at = (x: number, y: number): Pick<Ent, 'def' | 'x' | 'y' | 'rot'> => ({ def: pylon, x, y, rot: 0 as Rot });
  const fits = (a: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>, b: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>): boolean => !wireSteep(a, b, land) && !wireObstacle(a, b, land);
  const sources = [...net].map((id) => sim.ents.get(id)).filter((e): e is Ent => !!e && isLinkPoint(e.def) && sim.links.degree(e.id) < (linkPoint(e.def, sim.mods)?.slots ?? 0))
    .sort((a, b) => gap2(a, t) - gap2(b, t) || a.id - b.id);
  const src = sources[0];
  if (!src) return 0;
  // Straight from the source when a pylon's wire reaches (the wire's reach is the longer end's).
  if (gap2(src, t) <= Math.max(R, linkPoint(src.def, sim.mods)!.range) ** 2 && sim.link(src.id, targetId).ok) return 0;
  // The corridor: lattice tiles within R of the segment source → target.
  const ax = src.x, ay = src.y, bx = t.x, by = t.y, sx = bx - ax, sy = by - ay, L2 = Math.max(1, sx * sx + sy * sy);
  const fronts = portFronts(sim);
  const nodes: Array<{ x: number; y: number }> = [];
  const x0 = Math.min(ax, bx) - R, x1 = Math.max(ax, bx) + R, y0 = Math.min(ay, by) - R, y1 = Math.max(ay, by) + R;
  for (let y = y0 - (((y0 % step) + step) % step); y <= y1; y += step) {
    for (let x = x0 - (((x0 % step) + step) % step); x <= x1; x += step) {
      // Squared distance to the segment, in integers: the projection's parameter scaled by L2.
      const k = Math.max(0, Math.min(L2, (x - ax) * sx + (y - ay) * sy));
      const ex = (x - ax) * L2 - k * sx, ey = (y - ay) * L2 - k * sy;
      if (ex * ex + ey * ey > R * R * L2 * L2) continue;
      if (!inWorld(x, y) || fronts.has(tileIndex(x, y)) || !freeSpot(sim, 'pylon', x, y, 0)) continue;
      nodes.push({ x, y });
    }
  }
  // Breadth first from the source: a hop within R that the land lets the wire through.
  const prev = new Int32Array(nodes.length).fill(-2);
  let layer: number[] = [];
  nodes.forEach((n, i) => { if (gap2(src, at(n.x, n.y)) <= R * R && fits(src, at(n.x, n.y))) { prev[i] = -1; layer.push(i); } });
  let found = -1;
  for (let hop = 0; hop < maxPylons && layer.length && found < 0; hop++) {
    const next: number[] = [];
    for (const i of layer) {
      const n = nodes[i]!;
      if (gap2(at(n.x, n.y), t) <= R * R && fits(at(n.x, n.y), t)) { found = i; break; }
      for (let j = 0; j < nodes.length; j++) {
        if (prev[j] !== -2) continue;
        const m = nodes[j]!, dx = m.x - n.x, dy = m.y - n.y;
        if (dx * dx + dy * dy > R * R || !fits(at(n.x, n.y), at(m.x, m.y))) continue;
        prev[j] = i;
        next.push(j);
      }
    }
    layer = next;
  }
  if (found < 0) return 0;
  const path: number[] = [];
  for (let i = found; i >= 0; i = prev[i]!) path.push(i);
  path.reverse();
  let cur: Ent = src, n = 0;
  for (const i of path) {
    const p = nodes[i]!;
    const r = sim.place('pylon', p.x, p.y, 0);
    if (!r.ok) return n;
    n++;
    const m = sim.ents.get(r.id!)!;
    if (!sim.links.has(cur.id, m.id) && !sim.link(cur.id, m.id).ok && !hearthNetwork(sim).has(m.id)) return n;
    cur = m;
  }
  sim.link(cur.id, targetId);
  return n;
}

/**
 * Unlock plans of the tree (D33) through commands, prerequisites first: each plan's cost is
 * granted (a logged `grant`), then it is unlocked (`unlockPlan`), so the stock is left as it was
 * and the log replays. `ids`: the plans wanted (default all); their missing prerequisites come
 * too. Returns the plans unlocked. For the demo base, `FL.unlock` and scripted runs.
 */
export function learnPlans(sim: Sim, ids: readonly string[] = PLAN_IDS): string[] {
  const want = new Set<string>();
  const add = (id: string): void => {
    const p = planDef(id);
    if (!p || want.has(id) || sim.done.has(id)) return;
    want.add(id);
    for (const q of p.prereq) add(q);
  };
  for (const id of ids) add(id);
  const out: string[] = [];
  for (let progress = true; progress;) {
    progress = false;
    for (const id of PLAN_IDS) {
      const p = planDef(id)!;
      if (!want.has(id) || sim.done.has(id) || !p.prereq.every((q) => sim.done.has(q))) continue;
      for (const [it, n] of p.cost) sim.grant(it, n);
      if (sim.unlockPlan(id).ok) { out.push(id); progress = true; }
    }
  }
  return out;
}

/** A small demo colony in the cirque: drills on the starter deposits, a kiln line, a research lab fed by a data collector, wind. */
export function buildDemo(sim: Sim, opt: { kiln?: readonly [number, number, Rot] } = {}): Record<string, number> {
  sim.skipTutorial(); // an advanced base: the whole interface, no tutorial
  learnPlans(sim); // and the whole tree's plans (D33), through commands: the demo replays
  for (const [it, n] of [['iron_plate', 900], ['glass', 300], ['copper_wire', 300], ['gear', 60], ['circuit', 60], ['coal', 200], ['ceramic', 40]] as const) sim.grant(it, n);
  const ids: Record<string, number> = {};
  const hearth = sim.hearthId;
  const at = (dx: number, dy: number): [number, number] => [CENTER + dx, CENTER + dy];
  const dep = (item: string): { dx: number; dy: number } => CIRQUE.deposits.find((d) => d.item === item)!;
  const place = (name: string, def: string, x: number, y: number, rot: Rot): number => {
    const r = sim.place(def, x, y, rot);
    if (r.ok) ids[name] = r.id!;
    return r.id ?? 0;
  };
  const o = dep('iron_ore');
  const s1 = findSpot(sim, 'drill', 'iron_ore', CENTER + o.dx - 2, CENTER + o.dy - 1, 2);
  const s2 = findSpot(sim, 'drill', 'iron_ore', CENTER + o.dx + 1, CENTER + o.dy - 1, 2);
  if (s1) place('drillA', 'drill', s1[0], s1[1], 2);
  if (s2) place('drillB', 'drill', s2[0], s2[1], 2);
  // Sand is the ground (no deposit): a sand collector on bare sand east of the Heart, facing it.
  for (let d = 0; d < 6 && !ids.sand; d++) for (const dy of [0, -1, 1, -2, 2]) {
    if (!ids.sand && freeSpot(sim, 'sand_collector', CENTER + 6 + d, CENTER - 2 + dy, 3)) place('sand', 'sand_collector', CENTER + 6 + d, CENTER - 2 + dy, 3);
  }
  const pd = dep('coal');
  const s4 = findSpot(sim, 'drill', 'coal', CENTER + pd.dx - 1, CENTER + pd.dy - 1, 1);
  if (s4) place('coal', 'drill', s4[0], s4[1], 1);
  // A second coal drill feeds the coal generator (the night's power) by its own short ribbon; it must
  // not stand on the square the first one hands out to.
  const coalOut = new Set(ids.coal ? worldPorts(sim.ents.get(ids.coal)!).filter((p) => p.io === 'out').map((p) => tileIndex(p.fx, p.fy)) : []);
  const s5 = findSpot(sim, 'drill', 'coal', CENTER + pd.dx - 1, CENTER + pd.dy + 1, 1, 4, coalOut);
  if (s5) place('coal2', 'drill', s5[0], s5[1], 1);
  // The smelter against the Heart's west side, between the iron and the coal (inlets west, its
  // outlet one square from the Heart's west inlet); `opt.kiln` tries another spot. Wind flowers
  // and a workshop around.
  const [kx, ky, kr] = opt.kiln ?? [...at(-5, -1), 1 as Rot] as const;
  place('kiln', 'kiln', kx, ky, kr);
  if (ids.kiln) sim.setRecipe(ids.kiln, 'iron_plate');
  place('workshop', 'workshop', ...at(-9, -4), 0);
  if (ids.workshop) sim.setRecipe(ids.workshop, 'circuit');
  place('observatory', 'observatory', ...at(-12, 3), 0);
  // Its data files (D68): a data collector a few tiles south of the lab, facing it (it stands
  // anywhere, no deposit), its ribbon into one of the lab's south inlets.
  for (let d = 3; d < 8 && !ids.collector; d++) for (const dx of [0, -1, 1, -2, 2]) {
    if (!ids.collector && freeSpot(sim, 'data_collector', CENTER - 12 + dx, CENTER + 3 + d, 0)) place('collector', 'data_collector', CENTER - 12 + dx, CENTER + 3 + d, 0);
  }
  place('silo', 'silo', ...at(9, -9), 0);
  // The trade post against the Hearth's south side, turned half round (its entrance against the
  // Heart, its exit opening south, D62): it sells from the Hearth's stock.
  place('trade', 'trade_post', ...at(-4, 3), 2);
  for (const [i, [dx, dy]] of ([[-6, 9], [-3, 9], [0, 9], [3, 9]] as const).entries()) place(`wind${i}`, 'wind_flower', ...at(dx, dy), 0);
  if (s5) {
    // The coal generator a few tiles east of its drill, on free floor.
    for (let d = 3; d < 8 && !ids.brazier; d++) if (freeSpot(sim, 'brazier', s5[0] + 2 + d, s5[1] + 1, 0)) place('brazier', 'brazier', s5[0] + 2 + d, s5[1] + 1, 0);
  }
  // Ribbons.
  const H = hearth;
  if (ids.drillA) connect(sim, ids.drillA, H);
  if (ids.sand) connect(sim, ids.sand, H);
  // The smelter is fed straight by drills (the Heart takes, it never gives): the second iron
  // drill and the coal drill run to it; its plates go to the Heart.
  if (ids.kiln) {
    if (ids.drillB) connect(sim, ids.drillB, ids.kiln, -1, 0);
    if (ids.coal) connect(sim, ids.coal, ids.kiln, -1, 1);
    connect(sim, ids.kiln, H);
  }
  if (ids.coal2 && ids.brazier) connect(sim, ids.coal2, ids.brazier);
  if (ids.collector && ids.observatory) connect(sim, ids.collector, ids.observatory);
  // Power (D25): every building that makes or uses power is wired into the Hearth's grid,
  // through lines of poles where the Hearth's own wires (8 tiles) do not reach.
  for (const k of ['drillA', 'drillB', 'sand', 'coal', 'coal2', 'workshop', 'observatory', 'collector', 'trade', 'brazier', 'wind0', 'wind1', 'wind2', 'wind3']) {
    if (ids[k]) powerLine(sim, ids[k]!);
  }
  return ids;
}

// ── the layout kit of scripted bases (scenarios.ts) ─────────────────────────
// Coordinate-free on purpose: every spot is read off the map as it stands (ore from the tiles,
// floor from the terrain, the claim's land and the fog from `canPlace`), so a scripted base follows the
// content when the cirque changes. Lines keep off every building's ports and every routing
// block's sides (`keepOff`), so two lines never trade items by accident, and cross other lines
// only straight through, on a junction, once its plan is unlocked; placements leave every
// port's front free (`portFronts`), so a line laid later can still reach it.

/** Ribbon tiles, as `placeBelts` takes them and `lay` / `branch` / `join` return them. */
export type BeltTiles = Array<[number, number, Rot]>;

/** The tiles in front of every building's ports: a placement must leave them free. */
export function portFronts(sim: Sim): Set<number> {
  const out = new Set<number>();
  for (const e of sim.ents.map.values()) for (const p of worldPorts(e)) if (inWorld(p.fx, p.fy)) out.add(tileIndex(p.fx, p.fy));
  return out;
}

/** The tiles in front of every building's outputs (what is laid there gets that building's output). */
function outFronts(sim: Sim): Set<number> {
  const out = new Set<number>();
  for (const e of sim.ents.map.values()) for (const p of worldPorts(e)) if (p.io === 'out' && inWorld(p.fx, p.fy)) out.add(tileIndex(p.fx, p.fy));
  return out;
}

/**
 * Tiles a new ribbon must not cross: in front of a building's port (it would take from it, or
 * hand into it, there) and beside a routing block (it would become one of its outlets, D35).
 */
export function keepOff(sim: Sim): Set<number> {
  const out = portFronts(sim);
  for (const e of sim.ents.map.values()) {
    if (BUILDING_KIND[e.def] !== 'fork') continue;
    forTiles(e, (x, y) => {
      for (let d = 0; d < 4; d++) if (inWorld(x + DX[d]!, y + DY[d]!)) out.add(tileIndex(x + DX[d]!, y + DY[d]!));
    });
  }
  return out;
}

/** Does a routing block stand beside tile (x, y)? */
const besideRouter = (sim: Sim, x: number, y: number): boolean => {
  for (let d = 0; d < 4; d++) {
    const e = sim.entityAt(x + DX[d]!, y + DY[d]!);
    if (e && BUILDING_KIND[e.def] === 'fork') return true;
  }
  return false;
};

const isBeltAt = (sim: Sim, x: number, y: number): boolean => {
  const e = sim.entityAt(x, y);
  return !!e && BUILDING_KIND[e.def] === 'belt';
};

/** Free, revealed rock: the mountains, where a turbine or a pole may stand (D44). */
const openRock = (sim: Sim, x: number, y: number): boolean =>
  inWorld(x, y) && sim.grid.occ[tileIndex(x, y)] === 0 && isRock(sim.grid.terrain(x, y)) && sim.revealed(x, y);

/** Free, revealed floor. */
const openFloor = (sim: Sim, x: number, y: number): boolean =>
  inWorld(x, y) && sim.grid.occ[tileIndex(x, y)] === 0 && isFloor(sim.grid.terrain(x, y)) && sim.revealed(x, y);

/** Do two footprints share an edge (along a side, not only at a corner)? */
function touches(a: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>, b: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>): boolean {
  const [aw, ah] = footprint(a.def, a.rot), [bw, bh] = footprint(b.def, b.rot);
  const ox = Math.min(a.x + aw, b.x + bw) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + ah, b.y + bh) - Math.max(a.y, b.y);
  return (ox === 0 && oy > 0) || (oy === 0 && ox > 0);
}

/** What an ore tile under a non-drill's footprint adds to its distance (doubled tiles, squared: 1024 is about 16 tiles off). */
const ORE_SPOT = 1024;
/** What a drill off the deposits' block grid adds (D104): behind every spot on it within any search's reach (r 30). */
const OFF_GRID = 1 << 16;

/**
 * Where `def` can stand around tile `near` (within `r` tiles), nearest first — by its centre,
 * then by how close its first output's front (else its first port's) lies to `toward`, then y,
 * x, rot: free ground that replaces nothing and covers no building's port front; its outputs open
 * onto free floor no other port faces (whatever is laid there gets its output), its inputs onto
 * free floor no output faces (`inputsFree: false`: anything but an output's front — a trade
 * post on the Heart sells the Heart's stock, it needs no line in); on `item` ore only (its whole
 * footprint, or `orePart` tiles of it at least, the rest bare of other ore) if given, else off the
 * deposits where it can (`ORE_SPOT`); sharing an edge with entity `touch` if given (whose tiles its ports may face).
 */
export function spotsNear(sim: Sim, def: string, near: readonly [number, number], opts: { item?: string; orePart?: number; r?: number; toward?: readonly [number, number]; touch?: number; inputsFree?: boolean; onRock?: boolean } = {}): Array<[number, number, Rot]> {
  const di = buildingIdx(def), it = opts.item ? itemIdx(opts.item) : -1, r = opts.r ?? 12, B = oreBlockOf(sim.grid);
  const fronts = portFronts(sim), outs = outFronts(sim), inputsFree = opts.inputsFree ?? true;
  const toucher = opts.touch ? sim.ents.get(opts.touch) : undefined;
  if (opts.touch && !toucher) return [];
  const [tx, ty] = opts.toward ?? near;
  const out: Array<[number, number, Rot, number, number]> = [];
  // On the mountains (`onRock`), a port opens onto free rock or floor of the building's own level
  // (D45: a port meets only its own level): the potteries on the tarn's peak.
  const open = (x: number, y: number, lv: number): boolean =>
    opts.onRock ? (openRock(sim, x, y) || openFloor(sim, x, y)) && sim.grid.level(x, y) === lv : openFloor(sim, x, y);
  for (let y = near[1] - r; y <= near[1] + r; y++) {
    for (let x = near[0] - r; x <= near[0] + r; x++) {
      for (const rot of [0, 1, 2, 3] as const) {
        const [w, h] = footprint(di, rot);
        let ok = true, onOre = 0;
        for (let j = 0; j < h && ok; j++) {
          for (let i = 0; i < w && ok; i++) {
            const px = x + i, py = y + j, o = sim.grid.ore(px, py);
            if (!(opts.onRock ? openRock(sim, px, py) : openFloor(sim, px, py)) || fronts.has(tileIndex(px, py))) ok = false;
            // On `item`'s ore: every tile, or `orePart` of them at least (the rest no other ore).
            else if (it >= 0) { if (o === it) onOre++; else if (o >= 0 || opts.orePart === undefined) ok = false; }
          }
        }
        if (ok && it >= 0 && onOre < (opts.orePart ?? w * h)) ok = false;
        if (!ok || (toucher && !touches({ def: di, x, y, rot }, toucher))) continue;
        const ports = worldPorts({ def: di, x, y, rot });
        const lv = sim.grid.level(x, y);
        const opens = (p: WorldPort): boolean => {
          if (!inWorld(p.fx, p.fy)) return false;
          const t = tileIndex(p.fx, p.fy);
          if (toucher && sim.grid.occ[t] === toucher.id) return true;
          if (p.io === 'out') return open(p.fx, p.fy, lv) && !fronts.has(t);
          return !outs.has(t) && (!inputsFree || open(p.fx, p.fy, lv));
        };
        if (!ports.every(opens)) continue;
        if (!freeSpot(sim, def, x, y, rot)) continue;
        const p0 = ports.find((p) => p.io === 'out') ?? ports[0];
        // A drill on a deposit of whole blocks (D104) takes the blocks' grid first: off it, it
        // would leave half a block on either side that no drill can then cover whole.
        const ddx = 2 * x + w - 2 * near[0] - 1, ddy = 2 * y + h - 2 * near[1] - 1, off = it >= 0 && blockDrill(di, rot, B) && !onBlockGrid(x, y, B) ? OFF_GRID : 0;
        // Anything but a drill keeps off the deposits where it can (D82): each ore tile it would
        // cover counts as standing some tiles farther off. A drill hands its ore off the deposit
        // where it can: an output onto ore would lay its line across the tiles the next drills
        // want (D104: on a land of blocks, whole blocks lost under a ribbon).
        let ore = 0;
        if (it < 0) {
          for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (sim.grid.ore(x + i, y + j) >= 0) ore++;
        } else if (p0 && sim.grid.ore(p0.fx, p0.fy) >= 0) ore = 1;
        out.push([x, y, rot, ddx * ddx + ddy * ddy + ORE_SPOT * ore + off, p0 ? (p0.fx - tx) * (p0.fx - tx) + (p0.fy - ty) * (p0.fy - ty) : 0]);
      }
    }
  }
  out.sort((a, b) => a[3] - b[3] || a[4] - b[4] || a[1] - b[1] || a[0] - b[0] || a[2] - b[2]);
  return out.map(([x, y, rot]) => [x, y, rot]);
}

/**
 * Can a new line run straight across (x, y), heading `d`: a ribbon there at right angles, between
 * two plain ribbons of its line (fed from behind, handing on ahead)? A junction joins ribbon to
 * ribbon; a router's ports come from the ribbons beside it, so one next to a junction would lose
 * that side.
 */
export function crossable(sim: Sim, x: number, y: number, d: Rot): boolean {
  const e = sim.entityAt(x, y);
  if (!e || BUILDING_KIND[e.def] !== 'belt' || ((e.rot - d) & 1) === 0) return false;
  const back = sim.entityAt(x - DX[e.rot]!, y - DY[e.rot]!), ahead = sim.entityAt(x + DX[e.rot]!, y + DY[e.rot]!);
  return !!back && BUILDING_KIND[back.def] === 'belt' && back.rot === e.rot && !!ahead && BUILDING_KIND[ahead.def] === 'belt';
}

/**
 * What a step beside another line costs on top of the step itself (a gap leaves room to branch it
 * later), a junction, and a step onto a deposit tile (D82: lines go round the deposits where they
 * can, so the drills laid later find them whole).
 */
const BESIDE_COST = 2, CROSS_COST = 4, ORE_COST = 6;

/**
 * The cheapest ribbon path from any of the `starts` to any of the `goals` (tile → the direction its
 * last ribbon points), over free floor, keeping off `avoid` (but at its ends). A step costs 1,
 * plus `BESIDE_COST` on a tile beside another ribbon — lines keep a gap where they can, so a
 * router can branch them later. With `cross`, it may run straight across another line, one tile
 * at right angles (`CROSS_COST` more): `placeBelts` lays a junction there. A deposit tile costs
 * `ORE_COST` more. A Dijkstra over cost buckets, starts and neighbours in a fixed order: deterministic.
 */
function findPath(sim: Sim, starts: ReadonlyArray<readonly [number, number]>, goals0: ReadonlyMap<number, Rot>, avoid: ReadonlySet<number>, cross: boolean, maxNodes = 14400): BeltTiles | null {
  // Ends beside a routing block are off too: the block would deal into the ribbon there (a
  // router's side takes any ribbon that does not point into it) and split its own line once more.
  const goals = new Map([...goals0].filter(([t]) => !besideRouter(sim, t % 1024, (t - (t % 1024)) / 1024)));
  const free = (x: number, y: number): boolean => openFloor(sim, x, y) && (goals.has(tileIndex(x, y)) || !avoid.has(tileIndex(x, y)));
  const besideMemo = new Map<number, number>();
  const beside = (x: number, y: number): number => {
    const t = tileIndex(x, y);
    let v = besideMemo.get(t);
    if (v === undefined) {
      v = sim.grid.ore(x, y) >= 0 ? ORE_COST : 0;
      for (let d = 0; d < 4; d++) if (isBeltAt(sim, x + DX[d]!, y + DY[d]!)) { v += BESIDE_COST; break; }
      besideMemo.set(t, v);
    }
    return v;
  };
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  /** A tile reached across a line: the junction tile on the way in. */
  const via = new Map<number, number>();
  const buckets: number[][] = [[]];
  for (const [x, y] of starts) {
    const t = tileIndex(x, y);
    if (!openFloor(sim, x, y) || dist.has(t) || besideRouter(sim, x, y)) continue;
    dist.set(t, 0); prev.set(t, -1); buckets[0]!.push(t);
  }
  const reach = (n: number, c: number, p: number, over = -1): void => {
    const old = dist.get(n);
    if (old !== undefined && old <= c) return;
    dist.set(n, c);
    prev.set(n, p);
    if (over >= 0) via.set(n, over); else via.delete(n);
    (buckets[c] ??= []).push(n);
  };
  let goal = -1;
  search: for (let c = 0; c < buckets.length; c++) {
    const bucket = buckets[c];
    if (!bucket) continue;
    for (let i = 0; i < bucket.length; i++) {
      const cur = bucket[i]!;
      if (dist.get(cur) !== c) continue; // reached cheaper since
      if (goals.has(cur)) { goal = cur; break search; }
      if (dist.size > maxNodes) break search;
      const cx = cur % 1024, cy = (cur - cx) / 1024;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d]!, ny = cy + DY[d]!;
        if (!inWorld(nx, ny)) continue;
        if (free(nx, ny)) { reach(tileIndex(nx, ny), c + 1 + beside(nx, ny), cur); continue; }
        if (!cross || !crossable(sim, nx, ny, d as Rot)) continue;
        const mx = nx + DX[d]!, my = ny + DY[d]!;
        if (inWorld(mx, my) && free(mx, my)) reach(tileIndex(mx, my), c + 2 + CROSS_COST + beside(mx, my), cur, tileIndex(nx, ny));
      }
    }
  }
  if (goal < 0) return null;
  const tiles: number[] = [];
  for (let t = goal; t !== -1; t = prev.get(t)!) {
    tiles.push(t);
    const over = via.get(t);
    if (over !== undefined) tiles.push(over);
  }
  tiles.reverse();
  return tiles.map((t, i) => {
    const x = t % 1024, y = (t - x) / 1024, n = tiles[i + 1];
    if (n === undefined) return [x, y, goals.get(goal)!];
    const nx = n % 1024, ny = (n - nx) / 1024;
    return [x, y, (nx > x ? 1 : nx < x ? 3 : ny > y ? 2 : 0) as Rot];
  });
}

/** Port fronts as path goals: each one's tile → the direction a ribbon there points into its port. */
const intoPorts = (ports: readonly WorldPort[]): Map<number, Rot> => {
  const m = new Map<number, Rot>();
  for (const p of ports) if (inWorld(p.fx, p.fy) && !m.has(tileIndex(p.fx, p.fy))) m.set(tileIndex(p.fx, p.fy), opposite(p.dir));
  return m;
};

/** Lay a whole path or nothing: tiles laid on free ground are taken back up if any tile fails (a junction laid stays: it still carries its line). */
function layAll(sim: Sim, path: BeltTiles): boolean {
  const fresh = path.filter(([x, y]) => sim.grid.occ[tileIndex(x, y)] === 0);
  if (sim.placeBelts('ribbon', path) === path.length) return true;
  for (const [x, y] of fresh) if (isBeltAt(sim, x, y)) sim.remove(x, y);
  return false;
}

/**
 * Like `connect`, but the ribbon keeps off other buildings' ports and routing blocks' sides
 * (`keepOff`), so on its way it neither takes nor gives, and crosses other lines on junctions
 * once that plan is unlocked. Port indices among outputs / inputs (-1: the closest pairs first).
 * Returns the tiles laid, or null (nothing laid).
 */
export function lay(sim: Sim, fromId: number, toId: number, outIdx = -1, inIdx = -1): BeltTiles | null {
  const a = sim.ents.get(fromId), b = sim.ents.get(toId);
  if (!a || !b) return null;
  const outs = worldPorts(a).filter((p) => p.io === 'out');
  const ins = worldPorts(b).filter((p) => p.io === 'in');
  const oList = outIdx >= 0 ? outs.slice(outIdx, outIdx + 1) : outs;
  const iList = inIdx >= 0 ? ins.slice(inIdx, inIdx + 1) : ins;
  const path = findPath(sim, oList.map((o) => [o.fx, o.fy] as const), intoPorts(iList), keepOff(sim), sim.unlocked('junction'));
  return path && layAll(sim, path) ? path : null;
}

/** A ribbon from any of the `starts` tiles into one of `toId`'s inputs (`inIdx` -1: any). Returns the tiles laid, or null. */
export function layFrom(sim: Sim, starts: ReadonlyArray<readonly [number, number]>, toId: number, inIdx = -1): BeltTiles | null {
  const b = sim.ents.get(toId);
  if (!b) return null;
  const ins = worldPorts(b).filter((p) => p.io === 'in');
  const path = findPath(sim, starts, intoPorts(inIdx >= 0 ? ins.slice(inIdx, inIdx + 1) : ins), keepOff(sim), sim.unlocked('junction'));
  return path && layAll(sim, path) ? path : null;
}

/**
 * A ribbon from `fromId`'s outputs (`outIdx` -1: any) to one of `goals` (tile → the way its last
 * ribbon points): into a drawn plan's entry, say (`maxNodes`: the search's bound, `findPath`'s).
 * Returns the tiles laid, or null.
 */
export function layTo(sim: Sim, fromId: number, goals: ReadonlyMap<number, Rot>, outIdx = -1, maxNodes?: number): BeltTiles | null {
  const a = sim.ents.get(fromId);
  if (!a) return null;
  const outs = worldPorts(a).filter((p) => p.io === 'out');
  const path = findPath(sim, (outIdx >= 0 ? outs.slice(outIdx, outIdx + 1) : outs).map((o) => [o.fx, o.fy] as const), goals, keepOff(sim), sim.unlocked('junction'), maxNodes);
  return path && layAll(sim, path) ? path : null;
}

/** Is tile (x, y) free floor beside a routing block (a ribbon laid there would be one of its outlets)? */
export const besideRoutingBlock = (sim: Sim, x: number, y: number): boolean => openFloor(sim, x, y) && besideRouter(sim, x, y);

/**
 * A ribbon from `fromId`'s output into the side of a laid line (its first tiles first), so both
 * sources feed what the line feeds (two sand collectors, one smelter input). Returns the tiles
 * laid, or null.
 */
export function join(sim: Sim, fromId: number, line: BeltTiles): BeltTiles | null {
  const a = sim.ents.get(fromId);
  if (!a) return null;
  const outs = worldPorts(a).filter((p) => p.io === 'out');
  const avoid = keepOff(sim);
  const path = findPath(sim, outs.map((o) => [o.fx, o.fy] as const), sideGoals(sim, line, avoid), avoid, sim.unlocked('junction'));
  return path && layAll(sim, path) ? path : null;
}

/**
 * The ways into the side of a laid line (all its tiles but the last, first tiles first): each free
 * floor tile beside one, and the direction from it into the line — goals for a ribbon that merges
 * there (`join`, or `branch`'s `onto`).
 */
export function sideGoals(sim: Sim, line: BeltTiles, avoid: ReadonlySet<number> = keepOff(sim)): Map<number, Rot> {
  const goals = new Map<number, Rot>();
  for (let j = 0; j < line.length - 1; j++) {
    const [lx, ly] = line[j]!;
    if (!isBeltAt(sim, lx, ly)) continue;
    for (let d = 0; d < 4; d++) {
      const nx = lx + DX[d]!, ny = ly + DY[d]!;
      if (openFloor(sim, nx, ny) && !avoid.has(tileIndex(nx, ny)) && !goals.has(tileIndex(nx, ny))) goals.set(tileIndex(nx, ny), opposite(d as Rot));
    }
  }
  return goals;
}

/**
 * The ways into the side of a laid line on any level (`sideGoals` on the mountains too): each free
 * floor or rock tile beside one of its plain ribbons (not a traction ribbon's lift, not its last
 * tile), on that ribbon's level, with the direction into it — goals for `routeOver`.
 */
export function sideGoalsOver(sim: Sim, line: BeltTiles, avoid: ReadonlySet<number> = keepOff(sim)): Map<number, Rot> {
  const goals = new Map<number, Rot>();
  const plain = buildingIdx('ribbon');
  for (let j = 0; j < line.length - 1; j++) {
    const [lx, ly] = line[j]!;
    if (sim.entityAt(lx, ly)?.def !== plain) continue;
    const lv = sim.grid.level(lx, ly);
    for (let d = 0; d < 4; d++) {
      const nx = lx + DX[d]!, ny = ly + DY[d]!, t = tileIndex(nx, ny);
      if (!inWorld(nx, ny) || sim.grid.occ[t] !== 0 || !sim.revealed(nx, ny) || sim.grid.level(nx, ny) !== lv || avoid.has(t) || goals.has(t)) continue;
      const tt = sim.grid.terrain(nx, ny);
      if (isFloor(tt) || isRock(tt)) goals.set(t, opposite(d as Rot));
    }
  }
  return goals;
}

/**
 * Split a laid line into another building, Mindustry's way: a router on one of its straight
 * tiles — fed from its back (D35), the line going on out of its front — and a ribbon from its
 * side into `toId`'s input `inIdx` (-1: any; the side ribbon may be a single tile onto it), over
 * any of the `lines`' straight tiles: the cheapest branch wins. A router whose other side holds a
 * ribbon (it would feed that line too) or the target's input is never placed. `onto` gives the
 * side ribbon's goals instead (a stub already leading into the target: the tile behind its tail →
 * the way into it). Returns the router's id and the side ribbon, or null (nothing placed).
 */
export function branch(sim: Sim, lines: readonly BeltTiles[], toId: number, inIdx = -1, onto?: ReadonlyMap<number, Rot>): { router: number; path: BeltTiles } | null {
  const b = sim.ents.get(toId);
  if (!b) return null;
  const ins = worldPorts(b).filter((p) => p.io === 'in');
  const targets = inIdx >= 0 ? ins.slice(inIdx, inIdx + 1) : ins;
  if (!targets.length && !onto) return null;
  // `onto`: the goals given (a stub of ribbon already leading into the target: the tile behind its tail).
  const goals = onto ?? intoPorts(targets);
  const fronts = new Set(goals.keys());
  const at: Array<[number, number, Rot]> = [];
  for (const line of lines) {
    for (let k = 0; k < line.length; k++) {
      const [x, y, d] = line[k]!;
      const e = sim.entityAt(x, y);
      if (!e || BUILDING_KIND[e.def] !== 'belt' || e.rot !== d) continue; // no longer this line's plain ribbon
      // Fed from right behind: by the line's previous tile (whole items), or — its first tile — by a
      // machine's output (whole crafts). Not by a drill's: a drill hands on a trickle, a router
      // straight behind it deals parts of items, and a short side ribbon can choke on a part.
      const bx = x - DX[d]!, by = y - DY[d]!;
      const back = k > 0 ? line[k - 1]! : null;
      const behind = sim.entityAt(bx, by), ahead = sim.entityAt(x + DX[d]!, y + DY[d]!);
      const fedStraight = back
        ? back[2] === d && back[0] === bx && back[1] === by && !!behind && BUILDING_KIND[behind.def] === 'belt'
        : !!behind && BUILDING_KIND[behind.def] === 'machine' && worldPorts(behind).some((p) => p.io === 'out' && p.fx === x && p.fy === y && p.dir === d);
      // A router hands on to the ribbons beside it, never across a junction: none ahead of it.
      if (fedStraight && !(ahead && BUILDING_KIND[ahead.def] === 'crossing')) at.push([x, y, d]);
    }
  }
  // One search from every usable side tile at once (each start remembers its router spot): the
  // cheapest branch wins. A start is free floor off the kept tiles (or a target's input itself);
  // the router's other side must stay clear — no ribbon there, no target input — and no branch
  // may run past it (it would become one of the router's outlets).
  const avoid = keepOff(sim), cross = sim.unlocked('junction');
  const starts: Array<readonly [number, number]> = [];
  const routerAt = new Map<number, readonly [number, number, Rot]>();
  const others = new Set<number>();
  for (const [x, y, d] of at) {
    for (const s of [((d + 1) & 3) as Rot, ((d + 3) & 3) as Rot]) {
      const sx = x + DX[s]!, sy = y + DY[s]!, o = opposite(s), ox = x + DX[o]!, oy = y + DY[o]!;
      if (!openFloor(sim, sx, sy) || (avoid.has(tileIndex(sx, sy)) && !fronts.has(tileIndex(sx, sy)))) continue;
      if (isBeltAt(sim, ox, oy) || (inWorld(ox, oy) && fronts.has(tileIndex(ox, oy)))) continue;
      if (routerAt.has(tileIndex(sx, sy))) continue;
      routerAt.set(tileIndex(sx, sy), [x, y, d]);
      starts.push([sx, sy]);
      if (inWorld(ox, oy)) others.add(tileIndex(ox, oy));
    }
  }
  if (!starts.length) return null;
  const av = new Set(avoid);
  for (const t of others) if (!routerAt.has(t)) av.add(t);
  const path = findPath(sim, starts, goals, av, cross);
  if (!path) return null;
  const [x, y, d] = routerAt.get(tileIndex(path[0]![0], path[0]![1]))!;
  // The path must not pass beside its own router but at its start (another start's tile may be).
  for (let i = 1; i < path.length; i++) if (Math.abs(path[i]![0] - x) + Math.abs(path[i]![1] - y) === 1) return null;
  const r = sim.place('router', x, y, d);
  if (!r.ok) return null;
  if (layAll(sim, path)) return { router: r.id!, path };
  sim.remove(x, y); // the router goes, the line's ribbon comes back
  sim.placeBelts('ribbon', [[x, y, d]]);
  return null;
}

/** A building's feed: a source's output (its id), or a router on one of some laid lines (`branch`). */
export type Feed = number | { lines: readonly BeltTiles[] };

/**
 * A building of `def` around `near`, with its lines: from each feed into its inputs in port
 * order (a source's output, or a router on a laid line) and from its output on to `to` (null:
 * no line out; its output faces `to` where it can). Tries the nearest `tries` spots, taking a
 * spot's building, lines and routers back up when one cannot be laid. Returns its id, its lines
 * in (by feed), its line out and the routers it put down, or null.
 */
export function placeFed(sim: Sim, def: string, near: readonly [number, number], feeds: readonly Feed[], to: number | null, opts: { r?: number; tries?: number } = {}): { id: number; lines: BeltTiles[]; out: BeltTiles | null; routers: number[] } | null {
  // Direct lines first, branches last: a router is the hardest part to take back up.
  const order = feeds.map((_, k) => k).sort((p, q) => (typeof feeds[p] === 'number' ? 0 : 1) - (typeof feeds[q] === 'number' ? 0 : 1) || p - q);
  const dest = to !== null ? sim.ents.get(to) : undefined;
  const toward: [number, number] | undefined = dest ? [dest.x + (footprint(dest.def, dest.rot)[0] >> 1), dest.y + (footprint(dest.def, dest.rot)[1] >> 1)] : undefined;
  for (const [x, y, rot] of spotsNear(sim, def, near, { r: opts.r ?? 12, toward }).slice(0, opts.tries ?? 40)) {
    const cp = checkpoint(sim);
    const placed = sim.place(def, x, y, rot);
    if (!placed.ok) continue;
    const id = placed.id!;
    const lines: BeltTiles[] = [];
    const routers: number[] = [];
    let ok = true;
    for (const k of order) {
      const f = feeds[k]!;
      if (typeof f === 'number') {
        const l = lay(sim, f, id, -1, k);
        if (!l) { ok = false; break; }
        lines[k] = l;
      } else {
        const br = branch(sim, f.lines, id, k);
        if (!br) { ok = false; break; }
        routers.push(br.router);
        lines[k] = br.path;
      }
    }
    const out = ok && to !== null ? lay(sim, id, to) : null;
    if (ok && (to === null || out)) return { id, lines, out, routers };
    rollback(sim, cp);
  }
  return null;
}

/** Where a scripted build stands: what `rollback` takes it back to. */
export interface Checkpoint { mark: number; belts: Map<number, Rot> }

export function checkpoint(sim: Sim): Checkpoint {
  const belts = new Map<number, Rot>();
  for (const e of sim.ents.map.values()) if (BUILDING_KIND[e.def] === 'belt') belts.set(tileIndex(e.x, e.y), e.rot);
  return { mark: sim.ents.nextId, belts };
}

/**
 * Take back up everything placed since `cp` (logged removals: full refunds), newest first; a tile
 * that held a line's ribbon at `cp` (a router or a junction laid on it since, or the ribbon an
 * inner rollback gave back) gets that ribbon back. Removals made since are not undone.
 */
export function rollback(sim: Sim, cp: Checkpoint): void {
  for (const e of sim.ents.sorted().filter((q) => q.id >= cp.mark).reverse()) {
    if (!sim.ents.get(e.id)) continue;
    sim.remove(e.x, e.y);
    const was = cp.belts.get(tileIndex(e.x, e.y));
    if (was !== undefined) sim.placeBelts('ribbon', [[e.x, e.y, was]]);
  }
}

/**
 * A source of `def` (a drill, a collector…) around `near` whose own line can be laid: into
 * entity `into` (any of its inputs) or, given a laid line, joining it from the side. Spots as
 * `spotsNear` gives them (`item`: on that ore; its output faces the target), the nearest `tries`
 * in turn; a spot whose line cannot be laid is taken back up. Returns its id and its line, or null.
 */
export function placeFeeding(sim: Sim, def: string, near: readonly [number, number], into: number | BeltTiles, opts: { item?: string; orePart?: number; r?: number; tries?: number } = {}): { id: number; line: BeltTiles } | null {
  const dest = typeof into === 'number' ? sim.ents.get(into) : undefined;
  if (typeof into === 'number' && !dest) return null;
  const end = typeof into === 'number' ? null : into[0];
  const toward: [number, number] = dest ? [dest.x + (footprint(dest.def, dest.rot)[0] >> 1), dest.y + (footprint(dest.def, dest.rot)[1] >> 1)] : end ? [end[0], end[1]] : [near[0], near[1]];
  for (const [x, y, rot] of spotsNear(sim, def, near, { item: opts.item, orePart: opts.orePart, r: opts.r ?? 12, toward }).slice(0, opts.tries ?? 40)) {
    const placed = sim.place(def, x, y, rot);
    if (!placed.ok) continue;
    const line = typeof into === 'number' ? lay(sim, placed.id!, into) : join(sim, placed.id!, into);
    if (line) return { id: placed.id!, line };
    sim.remove(x, y);
  }
  return null;
}
