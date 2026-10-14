// links.ts — the colony's power wires (D25). A wire is an explicit, saved, unordered pair of
// entity ids. At least one end is a link point — a pillar (pole, pylon) or the Hearth,
// which is a generator AND a link point — and the other end is a link point or any building
// that makes, uses or stores power. Grids are the connected components of these wires
// (network.ts `buildGrids`): nothing is ever powered by proximity.
//
// Here: the wire table (`PowerLinks`, adjacency kept sorted so every walk is in id order), the
// geometry (footprint edge to edge, integer squared distances) and the one rule that says
// whether two buildings may be wired (`linkCheck`: range, the land, free slots…). The commands
// that use them (link, unlink, the new pillar's auto-link, wires carried over on replacement)
// are in systems/power.ts.
//
// The land (D45, D78): a wire is as tolerant as its taller end (content `pole.climb`: a pole and
// the Hearth 1 level, a pylon 3; any other building 0). Its two ends may stand at most that many
// levels apart (`wireSteep`), and it rides that many levels above the straight line joining their
// grounds, so no tile it passes over may rise above that (`wireObstacle`): two poles on the floor
// may wire across a one-terrace ridge but not a two-terrace one; two pylons on the floor clear
// three terraces, never a mountain.
import { buildingDef } from '@/content/registry';
import { fdiv } from '@/core/fixed';
import { footprint } from '../entities';
import type { Mods } from '../research/modifiers';
import type { Ent } from '../types';

/**
 * Why two buildings may not be wired (or 'ok'). `slots`: the first end (the one the player
 * starts from) holds no more wires; `slots_other`: the second end does not.
 */
export type LinkReason =
  | 'ok' | 'missing' | 'self' | 'not_linkable' | 'needs_pillar' | 'already' | 'not_linked'
  | 'range' | 'steep' | 'blocked' | 'slots' | 'slots_other';

/** The land's level of a tile (`grid.level`): the wire rule reads the land through it. */
export type LandLevel = (x: number, y: number) => number;

const NONE: readonly number[] = [];

/** Insert v into a sorted array (no duplicates). */
function insertSorted(arr: number[], v: number): void {
  let i = arr.length;
  while (i > 0 && arr[i - 1]! > v) i--;
  arr.splice(i, 0, v);
}

/** The wires: per entity, the ids it is wired to (ascending). Saved and hashed as `pairs()`. */
export class PowerLinks {
  private readonly adj = new Map<number, number[]>();
  private count = 0;
  /** Bumped on every change: the views redraw the wires when it moves. */
  version = 0;

  /** How many wires. */
  get size(): number { return this.count; }

  has(a: number, b: number): boolean {
    const l = this.adj.get(a);
    return !!l && l.includes(b);
  }

  /** The ids `id` is wired to (ascending; do not mutate). */
  of(id: number): readonly number[] {
    return this.adj.get(id) ?? NONE;
  }

  degree(id: number): number {
    return this.adj.get(id)?.length ?? 0;
  }

  /** Add a wire (no checks: callers go through `linkCheck`). False if it was already there. */
  add(a: number, b: number): boolean {
    if (a === b || this.has(a, b)) return false;
    for (const [x, y] of [[a, b], [b, a]] as const) {
      let l = this.adj.get(x);
      if (!l) this.adj.set(x, (l = []));
      insertSorted(l, y);
    }
    this.count++;
    this.version++;
    return true;
  }

  /** Cut one wire. False if there was none. */
  remove(a: number, b: number): boolean {
    if (!this.has(a, b)) return false;
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const l = this.adj.get(x)!;
      l.splice(l.indexOf(y), 1);
      if (!l.length) this.adj.delete(x);
    }
    this.count--;
    this.version++;
    return true;
  }

  /** Cut every wire of `id`; returns the other ends (ascending). */
  drop(id: number): number[] {
    const l = this.adj.get(id);
    if (!l) return [];
    const out = l.slice();
    for (const o of out) this.remove(id, o);
    return out;
  }

  /** Cut the wires of every entity that fails `alive` (whatever path removed it). Returns how many went. */
  prune(alive: (id: number) => boolean): number {
    const dead = [...this.adj.keys()].filter((id) => !alive(id)).sort((x, y) => x - y);
    let n = 0;
    for (const id of dead) n += this.drop(id).length;
    return n;
  }

  /** Every wire once, as [low id, high id], in ascending order: the canonical form (hash, save). */
  pairs(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const a of [...this.adj.keys()].sort((x, y) => x - y)) {
      for (const b of this.adj.get(a)!) if (b > a) out.push([a, b]);
    }
    return out;
  }

  clear(): void {
    if (!this.count) return;
    this.adj.clear();
    this.count = 0;
    this.version++;
  }
}

/** A link point's wire range (tiles) and how many wires it holds. */
export interface LinkPoint { readonly range: number; readonly slots: number }

/** A pillar or the Hearth (content `pole`). */
export const isLinkPoint = (def: number): boolean => !!buildingDef(def).pole;

/** A link point's range (with the Reinforced Pylons research) and slots; null for an ordinary building. */
export function linkPoint(def: number, mods: Pick<Mods, 'pylonLink'>): LinkPoint | null {
  const p = buildingDef(def).pole;
  if (!p) return null;
  return { range: p.range + (p.tall ? mods.pylonLink : 0), slots: p.slots };
}

/** Does a building take part in a grid at all: carries wires, or makes, uses or stores power? */
export function linkable(def: number): boolean {
  const b = buildingDef(def);
  return !!b.pole || (b.kw ?? 0) > 0 || (b.idleKw ?? 0) > 0 || !!b.gen || !!b.accumulator;
}

/** How many levels a wire from this building may climb, and rides above the land (content `pole.climb`; 0 off the pillars). */
export const climbOf = (def: number): number => buildingDef(def).pole?.climb ?? 0;

/** A wire's tolerance (levels): its taller end's, as its reach is its longer end's. */
export const wireClimb = (a: Pick<Ent, 'def'>, b: Pick<Ent, 'def'>): number => Math.max(climbOf(a.def), climbOf(b.def));

/** Do a wire's ends stand further apart in level than it tolerates? (A footprint is level ground: its first tile's level, D45.) */
export function wireSteep(a: Pick<Ent, 'def' | 'x' | 'y'>, b: Pick<Ent, 'def' | 'x' | 'y'>, level: LandLevel): boolean {
  return Math.abs(level(a.x, a.y) - level(b.x, b.y)) > wireClimb(a, b);
}

/** Is tile (x, y) under a footprint? */
const under = (e: Pick<Ent, 'x' | 'y'>, w: number, h: number, x: number, y: number): boolean => x >= e.x && x < e.x + w && y >= e.y && y < e.y + h;

/**
 * The first tile, walking from `a`, that rises above the wire `a`–`b` (null: none): the wire runs
 * straight from footprint centre to footprint centre, `wireClimb` levels above the line joining
 * the two ends' grounds, and a tile it passes over (outside both footprints) may stand as high as
 * the wire there, no higher. Integers only: centres in half tiles, a sample every quarter tile
 * along the longer axis, the wire's height at sample i of N compared times N.
 */
export function wireObstacle(a: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>, b: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>, level: LandLevel): [number, number] | null {
  const [aw, ah] = footprint(a.def, a.rot), [bw, bh] = footprint(b.def, b.rot);
  const ax = 2 * a.x + aw, ay = 2 * a.y + ah, dx = 2 * b.x + bw - ax, dy = 2 * b.y + bh - ay;
  const n = 2 * Math.max(Math.abs(dx), Math.abs(dy));
  if (n === 0) return null;
  const la = level(a.x, a.y), lb = level(b.x, b.y), top = (la + wireClimb(a, b)) * n;
  let px = -1, py = -1;
  for (let i = 1; i < n; i++) {
    const x = fdiv(ax * n + dx * i, 2 * n), y = fdiv(ay * n + dy * i, 2 * n);
    if ((x === px && y === py) || under(a, aw, ah, x, y) || under(b, bw, bh, x, y)) continue;
    px = x; py = y;
    if (level(x, y) * n > top + (lb - la) * i) return [x, y];
  }
  return null;
}

/** Squared gap between two footprints, edge to edge, in tiles (0 when they touch or overlap). */
export function gap2(a: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>, b: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>): number {
  const [aw, ah] = footprint(a.def, a.rot), [bw, bh] = footprint(b.def, b.rot);
  const gx = Math.max(0, b.x - (a.x + aw), a.x - (b.x + bw));
  const gy = Math.max(0, b.y - (a.y + ah), a.y - (b.y + bh));
  return gx * gx + gy * gy;
}

/** How long a wire between two ends may be: the longer of their ranges (either end reaching is enough, as in Mindustry). */
export const wireReach = (a: LinkPoint | null, b: LinkPoint | null): number => Math.max(a?.range ?? 0, b?.range ?? 0);

/**
 * May `a` and `b` be wired now? 'ok', or the first reason not, in this order: an end is
 * missing, the same building, an end takes no part in power, neither end is a link point,
 * already wired, out of reach, its ends too many levels apart, the land rising above it in
 * between (`level`: the land, D45/D78; without it the land is not read), `a` full, `b` full.
 */
export function linkCheck(a: Ent | undefined, b: Ent | undefined, links: PowerLinks, mods: Pick<Mods, 'pylonLink'>, level?: LandLevel): LinkReason {
  if (!a || !b) return 'missing';
  if (a.id === b.id) return 'self';
  if (!linkable(a.def) || !linkable(b.def)) return 'not_linkable';
  const pa = linkPoint(a.def, mods), pb = linkPoint(b.def, mods);
  if (!pa && !pb) return 'needs_pillar';
  if (links.has(a.id, b.id)) return 'already';
  const r = wireReach(pa, pb);
  if (gap2(a, b) > r * r) return 'range';
  if (level && wireSteep(a, b, level)) return 'steep';
  if (level && wireObstacle(a, b, level)) return 'blocked';
  if (pa && links.degree(a.id) >= pa.slots) return 'slots';
  if (pb && links.degree(b.id) >= pb.slots) return 'slots_other';
  return 'ok';
}
