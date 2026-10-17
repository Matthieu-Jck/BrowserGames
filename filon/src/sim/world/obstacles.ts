// obstacles.ts — the lines map 4 draws across the land (D94): the corridors of floor kept from the
// Crown's foot to each guaranteed site, the chasms and the rivers. Each is a polyline of points in
// quarter tiles (a tile's centre at 4x + 2) with a half width per segment; a tile belongs to a line
// when its centre lies within that width of one of its segments (`within`: exact integers, the
// squared distance times the segment's squared length, no division). The generator traces the
// lines once, in its constructor, from the seeds alone (`trace`: a walk of fixed-point steps on the
// integer trig table, its turns chosen by a score the generator gives), then `SegIndex` buckets
// the segments by chunk so a tile only tests the few that can reach it. Pure and integer.
import { COS64, SIN64 } from '@/content/world';
import { CHUNK, WORLD } from '../constants';

/** What a line is: the floor kept to a site, a chasm, a river; `Keep`: a corridor's band grown by what the massifs keep off it (one lookup where a search round the tile would cost nine); `Lake`: a disc of still water (a segment of no length). */
export const LineKind = { Corridor: 0, Chasm: 1, River: 2, Keep: 3, Lake: 4 } as const;
export type LineKind = (typeof LineKind)[keyof typeof LineKind];

/**
 * One segment of a line, in quarter tiles, with its half width (quarter tiles) and, for a river, the
 * way it flows (0 … 7, eighths of a turn from east, clockwise) and, up on a massif, the level its
 * water stands at along it (`lv`: a level a tile from a to b, never rising; absent: the floor's, 0).
 */
export interface Seg {
  readonly ax: number; readonly ay: number; readonly bx: number; readonly by: number;
  readonly hw: number;
  readonly kind: LineKind;
  readonly dir: number;
  readonly lv?: Uint8Array;
}

/** The level a river's water stands at where tile (x, y) lies along segment `s` (its `lv` at the nearest step; 0 without one). Integers only. */
export function levelAlong(s: Seg, x: number, y: number): number {
  const lv = s.lv;
  if (!lv) return 0;
  const vx = s.bx - s.ax, vy = s.by - s.ay, l2 = vx * vx + vy * vy, last = lv.length - 1;
  if (l2 === 0 || last === 0) return lv[0]!;
  const t = (q(x) - s.ax) * vx + (q(y) - s.ay) * vy;
  const k = t <= 0 ? 0 : t >= l2 ? last : Math.floor((t * last + (l2 >> 1)) / l2);
  return lv[k]!;
}

/** A point of a traced line, in quarter tiles, with the half width the line has there. */
export interface LinePt { x: number; y: number; hw: number }

/** A tile's centre in quarter tiles. */
export const q = (t: number): number => 4 * t + 2;

/**
 * Is the point (px, py) — quarter tiles — within `s.hw` of segment `s`? Exact: with v = b − a and
 * w = p − a, past either end the distance is to that end, else d²·|v|² = |w|²·|v|² − (w·v)².
 */
export function within(s: Seg, px: number, py: number, hw = s.hw): boolean {
  const vx = s.bx - s.ax, vy = s.by - s.ay, wx = px - s.ax, wy = py - s.ay;
  const r2 = hw * hw;
  const t = wx * vx + wy * vy, l2 = vx * vx + vy * vy;
  if (t <= 0 || l2 === 0) return wx * wx + wy * wy <= r2;
  if (t >= l2) { const ex = px - s.bx, ey = py - s.by; return ex * ex + ey * ey <= r2; }
  return (wx * wx + wy * wy) * l2 - t * t <= r2 * l2;
}

/** The way a segment runs, in eighths of a turn (0 = east, 2 = south): the nearest of eight, by integer comparisons. */
export function eighth(dx: number, dy: number): number {
  // tan(22.5°) ≈ 0.4142: a side under 0.4142 of the other is no turn off the axis (× 10000, integers).
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ay * 10000 <= ax * 4142) return dx >= 0 ? 0 : 4;
  if (ax * 10000 <= ay * 4142) return dy >= 0 ? 2 : 6;
  return dx >= 0 ? (dy >= 0 ? 1 : 7) : dy >= 0 ? 3 : 5;
}

/** Segments bucketed by the chunks they can reach (their box grown by their half width). */
export class SegIndex {
  private readonly cells = new Map<number, Seg[]>();
  /** Every segment, in the order added. */
  readonly all: Seg[] = [];

  add(s: Seg): void {
    this.all.push(s);
    const C = 4 * CHUNK, n = WORLD / CHUNK;
    const x0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - s.hw) / C)), x1 = Math.min(n - 1, Math.floor((Math.max(s.ax, s.bx) + s.hw) / C));
    const y0 = Math.max(0, Math.floor((Math.min(s.ay, s.by) - s.hw) / C)), y1 = Math.min(n - 1, Math.floor((Math.max(s.ay, s.by) + s.hw) / C));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const k = cy * n + cx;
      const l = this.cells.get(k);
      if (l) l.push(s); else this.cells.set(k, [s]);
    }
  }

  /** Add a traced line: a segment between each two points, its half width the mean of theirs (a tapered end narrows). */
  addLine(pts: readonly LinePt[], kind: LineKind): void {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      this.add({ ax: a.x, ay: a.y, bx: b.x, by: b.y, hw: (a.hw + b.hw) >> 1, kind, dir: eighth(b.x - a.x, b.y - a.y) });
    }
  }

  /** The first segment of `kind` (in the order added) whose band holds tile (x, y); null: none. */
  hit(x: number, y: number, kind: LineKind): Seg | null {
    const l = this.cells.get((y >> 5) * (WORLD / CHUNK) + (x >> 5));
    if (!l) return null;
    const px = q(x), py = q(y);
    for (const s of l) {
      if (s.kind !== kind) continue;
      if (within(s, px, py)) return s;
    }
    return null;
  }

  /**
   * The first segment of each kind that matters on the land — a corridor, a chasm, a river, a lake
   * (`out[3]`, the lake's disc) — whose band holds tile (x, y): one pass over the tile's chunk's
   * segments (the generator asks for every tile past the Crown). `out` is filled and returned.
   */
  hits(x: number, y: number, out: Hits): Hits {
    out[0] = out[1] = out[2] = out[3] = null;
    const l = this.cells.get((y >> 5) * (WORLD / CHUNK) + (x >> 5));
    if (!l) return out;
    const px = q(x), py = q(y);
    for (const s of l) {
      const k = s.kind, slot = k === LineKind.Lake ? 3 : k;
      if (k !== LineKind.Keep && !out[slot] && within(s, px, py)) out[slot] = s;
    }
    return out;
  }

  /**
   * Where river bands overlap (a tributary meeting its trunk), the water stands at the lowest of their
   * levels there: the segment whose level at (x, y) is lowest, and that level (`levelAlong`). Null: no river.
   */
  lowestRiver(x: number, y: number): { seg: Seg; level: number } | null {
    const l = this.cells.get((y >> 5) * (WORLD / CHUNK) + (x >> 5));
    if (!l) return null;
    const px = q(x), py = q(y);
    let best: Seg | null = null, lv = 0;
    for (const s of l) {
      if (s.kind !== LineKind.River || !within(s, px, py)) continue;
      const v = levelAlong(s, x, y);
      if (!best || v < lv) { best = s; lv = v; }
    }
    return best ? { seg: best, level: lv } : null;
  }

  /** Is (x, y) within `grow` quarter tiles past the band of any segment of `kind`? (The tracers keep off the corridors so.) Reads the chunks round the tile too. */
  near(x: number, y: number, kind: LineKind, grow: number): boolean {
    const n = WORLD / CHUNK, px = q(x), py = q(y);
    const reach = Math.ceil(grow / (4 * CHUNK)); // a segment is in every chunk its band touches: only those within `grow` more
    const cx = x >> 5, cy = y >> 5;
    for (let j = cy - reach; j <= cy + reach; j++) for (let i = cx - reach; i <= cx + reach; i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const l = this.cells.get(j * n + i);
      if (!l) continue;
      for (const s of l) if (s.kind === kind && within(s, px, py, s.hw + grow)) return true;
    }
    return false;
  }
}

/** `SegIndex.hits`' answer: a corridor, a chasm, a river, a lake (null: none). */
export type Hits = [Seg | null, Seg | null, Seg | null, Seg | null];

/** A walk's state: its point in 1/1024 tiles and its heading in 64ths of a turn. */
export interface Walker { fx: number; fy: number; d: number }

/** The walker's tile. */
export const tileOf = (w: Pick<Walker, 'fx' | 'fy'>): [number, number] => [w.fx >> 10, w.fy >> 10];

/** Where a walker would be after `stride` tiles on heading `d` (fixed point, the trig table's). */
export function ahead(w: Walker, d: number, stride: number): Walker {
  const k = ((d % 64) + 64) % 64;
  return { fx: w.fx + COS64[k]! * stride, fy: w.fy + SIN64[k]! * stride, d: k };
}

/** The nearest heading (64ths of a turn, the trig table's) of a direction, by integer cross and dot products. */
export function headingOf(dx: number, dy: number): number {
  let best = 0, bd = -Infinity;
  for (let k = 0; k < 64; k++) {
    const v = dx * COS64[k]! + dy * SIN64[k]!;
    if (v > bd) { bd = v; best = k; }
  }
  return best;
}

/** A walker's point in quarter tiles. */
export const quarter = (w: Pick<Walker, 'fx' | 'fy'>): [number, number] => [w.fx >> 8, w.fy >> 8];
