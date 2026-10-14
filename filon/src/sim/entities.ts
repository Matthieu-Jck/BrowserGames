// entities.ts — placed entities and their geometry: rotated footprints, world positions of
// ports and the tile each port faces. Rotation is integer index swapping (no trig).
import { buildingDef } from '@/content/registry';
import type { PortDef } from '@/content/types';
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

  add(e: Omit<Ent, 'id'> & { id?: number }): Ent {
    const id = e.id ?? this.nextId++;
    if (id >= this.nextId) this.nextId = id + 1;
    const ent: Ent = { ...e, id } as Ent;
    this.map.set(id, ent);
    this.order = null;
    return ent;
  }

  remove(id: number): Ent | undefined {
    const e = this.map.get(id);
    if (this.map.delete(id)) this.order = null;
    return e;
  }

  get(id: number): Ent | undefined {
    return this.map.get(id);
  }

  /** Entities sorted by id (canonical order for compilation and hashing). Shared: never mutate it. */
  sorted(): readonly Ent[] {
    return (this.order ??= Object.freeze([...this.map.values()].sort((a, b) => a.id - b.id)));
  }

  get size(): number {
    return this.map.size;
  }
}
