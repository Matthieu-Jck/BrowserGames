// links.ts — the colony's power wires (D25). A wire is an explicit, saved, unordered pair of
// entity ids. At least one end is a link point — a pillar (pole, pylon) or the Hearth,
// which is a generator AND a link point — and the other end is a link point or any building
// that makes, uses or stores power. Grids are the connected components of these wires
// (network.ts `buildGrids`): nothing is ever powered by proximity.
//
// Here: the wire table (`PowerLinks`, adjacency kept sorted so every walk is in id order), the
// geometry (footprint edge to edge, integer squared distances) and the one rule that says
// whether two buildings may be wired (`linkCheck`: range, free slots…). The commands that use
// them (link, unlink, the new pillar's auto-link, wires carried over on replacement) are in
// systems/power.ts.
import { buildingDef } from '@/content/registry';
import { footprint } from '../entities';
import type { Mods } from '../research/modifiers';
import type { Ent } from '../types';

/**
 * Why two buildings may not be wired (or 'ok'). `slots`: the first end (the one the player
 * starts from) holds no more wires; `slots_other`: the second end does not.
 */
export type LinkReason =
  | 'ok' | 'missing' | 'self' | 'not_linkable' | 'needs_pillar' | 'already' | 'not_linked'
  | 'range' | 'steep' | 'slots' | 'slots_other';

/** The most two wired ends' levels may differ (D45: a wire climbs one terrace at a time). */
export const WIRE_CLIMB = 1;

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
 * already wired, out of reach, more than a terrace apart (`level`: the land's level a building
 * stands on, D45), `a` full, `b` full.
 */
export function linkCheck(a: Ent | undefined, b: Ent | undefined, links: PowerLinks, mods: Pick<Mods, 'pylonLink'>, level?: (e: Ent) => number): LinkReason {
  if (!a || !b) return 'missing';
  if (a.id === b.id) return 'self';
  if (!linkable(a.def) || !linkable(b.def)) return 'not_linkable';
  const pa = linkPoint(a.def, mods), pb = linkPoint(b.def, mods);
  if (!pa && !pb) return 'needs_pillar';
  if (links.has(a.id, b.id)) return 'already';
  const r = wireReach(pa, pb);
  if (gap2(a, b) > r * r) return 'range';
  if (level && Math.abs(level(a) - level(b)) > WIRE_CLIMB) return 'steep';
  if (pa && links.degree(a.id) >= pa.slots) return 'slots';
  if (pb && links.degree(b.id) >= pb.slots) return 'slots_other';
  return 'ok';
}
