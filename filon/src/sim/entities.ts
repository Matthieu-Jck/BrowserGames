// entities.ts — placed entities and their geometry: rotated footprints, world positions of
// ports and the tile each port faces. Rotation is integer index swapping (no trig).
import { BUILDING_KIND, buildingDef } from '@/content/registry';
import type { BuildingKind, PortDef } from '@/content/types';
import { DX, DY, sideIndex, type Ent, type Rot } from './types';

/** Footprint size after rotation. */
export function footprint(def: number, rot: Rot): [number, number] {
  const b = buildingDef(def);
  return rot & 1 ? [b.h, b.w] : [b.w, b.h];
}

/** Rotate a tile (px, py) of an unrotated w×h footprint by rot quarter turns clockwise. */
export function rotatePoint(px: number, py: number, w: number, h: number, rot: Rot): [number, number] {
  switch (rot) {
    case 0: return [px, py];
    case 1: return [h - 1 - py, px];
    case 2: return [w - 1 - px, h - 1 - py];
    case 3: return [py, w - 1 - px];
  }
}

export interface WorldPort {
  /** Port index within the building definition. */
  idx: number;
  io: 'in' | 'out';
  /** Tile of the building that carries the port. */
  x: number;
  y: number;
  /** World direction the port opens towards. */
  dir: Rot;
  /** The outside tile it faces. */
  fx: number;
  fy: number;
}

const portCache = new Map<string, WorldPort[]>();

/** Ports of an entity in world coordinates (cached by def/rot, translated per entity). */
export function worldPorts(e: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>): WorldPort[] {
  const key = `${e.def}:${e.rot}`;
  let rel = portCache.get(key);
  if (!rel) {
    const b = buildingDef(e.def);
    rel = b.ports.map((p: PortDef, idx) => {
      const [rx, ry] = rotatePoint(p.x, p.y, b.w, b.h, e.rot);
      const dir = ((sideIndex[p.side] + e.rot) & 3) as Rot;
      return { idx, io: p.io, x: rx, y: ry, dir, fx: rx + DX[dir]!, fy: ry + DY[dir]! };
    });
    portCache.set(key, rel);
  }
  return rel.map((p) => ({ ...p, x: p.x + e.x, y: p.y + e.y, fx: p.fx + e.x, fy: p.fy + e.y }));
}

/** Iterate the tiles of an entity's footprint. */
export function forTiles(e: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>, fn: (x: number, y: number) => void): void {
  const [w, h] = footprint(e.def, e.rot);
  for (let y = e.y; y < e.y + h; y++) for (let x = e.x; x < e.x + w; x++) fn(x, y);
}

/** The entity table: insertion-ordered map + monotonic ids (never reused). */
export class Entities {
  readonly map = new Map<number, Ent>();
  nextId = 1;
  /** `sorted()`'s array, kept until the next add / remove (systems call it every epoch). */
  private order: readonly Ent[] | null = null;
  /** `ofKinds()`'s arrays by kind list, and `defCounts()`'s, dropped with `order`. */
  private kinds = new Map<string, readonly Ent[]>();
  private counts: readonly number[] | null = null;

  add(e: Omit<Ent, 'id'> & { id?: number }): Ent {
    const id = e.id ?? this.nextId++;
    if (id >= this.nextId) this.nextId = id + 1;
    const ent: Ent = { ...e, id } as Ent;
    this.map.set(id, ent);
    this.changed();
    return ent;
  }

  remove(id: number): Ent | undefined {
    const e = this.map.get(id);
    if (this.map.delete(id)) this.changed();
    return e;
  }

  private changed(): void {
    this.order = null;
    this.counts = null;
    if (this.kinds.size) this.kinds.clear();
  }

  get(id: number): Ent | undefined {
    return this.map.get(id);
  }

  /** Entities sorted by id (canonical order for compilation and hashing). Shared: never mutate it. */
  sorted(): readonly Ent[] {
    return (this.order ??= Object.freeze([...this.map.values()].sort((a, b) => a.id - b.id)));
  }

  /**
   * `sorted()` narrowed to some building kinds, in the same id order, cached likewise. A system
   * that looks for a few kinds every epoch (idle excavators) walks those, not the whole base: the
   * offline catch-up calls it at every one of a week's 10 080 boundaries. Safe because an
   * entity's `def` never changes in place (a replacement is a remove and an add). Shared: never mutate it.
   */
  ofKinds(kinds: readonly BuildingKind[]): readonly Ent[] {
    const key = kinds.join();
    let out = this.kinds.get(key);
    if (!out) {
      out = Object.freeze(this.sorted().filter((e) => kinds.includes(BUILDING_KIND[e.def]!)));
      this.kinds.set(key, out);
    }
    return out;
  }

  /** How many entities stand of each building def (indexed by def), cached likewise (the claim's hourly value). Shared: never mutate it. */
  defCounts(): readonly number[] {
    if (!this.counts) {
      const c = new Array<number>(BUILDING_KIND.length).fill(0);
      for (const e of this.map.values()) c[e.def]!++;
      this.counts = c;
    }
    return this.counts;
  }

  get size(): number {
    return this.map.size;
  }
}
