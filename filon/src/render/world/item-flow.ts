// item-flow.ts — the paths items ride across each ribbon tile (render side; no Pixi): straight
// edge to edge, round a bend's corner, a skybridge's leap up onto its deck and down again, a
// junction's hump (`buildPieces`), and a routing block's way through its centre (`viaPiece`).
// Where on those paths each item is comes from the engine's cells (cell-flow.ts, D57).
//
// Junctions are little bridges (owner, 2026-10-13): the north–south line rides over the humped
// deck — its items rise onto it and come down on the far side, at exactly the art's height — and
// the east–west line runs under it. A path's stretch over a bridge is flagged `o` (its items are
// drawn over the bridge's sprite, on the items view's upper layer); the others are drawn beneath
// the buildings, so those passing under the bridge vanish under its deck and show through its
// tunnel's mouth.
import type { Sim } from '@/sim/state';
import { BUILDING_KIND } from '@/content/registry';
import { DX, DY, type Ent, type Rot } from '@/sim/types';
import { tileIndex } from '@/sim/world/grid';
import { WORLD } from '@/sim/constants';
import { JUNCTION, junctionHump } from '../art/recipes/buildings';
import { LH } from '../iso';

/** A junction's crown over the ground (iso px): its deck's running surface, which items ride. */
export const HUMP_Z = JUNCTION.deck * LH;
/**
 * Does a line running this way ride over a junction's bridge (else it runs under it)? The art is
 * drawn once for every rotation (buildings.ts `junctionIso`), so the axes are the world's: the
 * north–south line goes over.
 */
export const overJunction = (dir: Rot): boolean => (dir & 1) === 0;
/**
 * How far before and after a junction (tiles) an item on its deck is drawn over the buildings:
 * where it changes layer its glyph must clear the bridge's sprite (in both views), so the switch
 * never shows.
 */
const OVER_M = 0.35;

/**
 * How an item crosses one tile, from progress s = 0 (entry) to 1 (exit / hand-off): along a
 * straight line A → B (a plain tile edge to edge; a leap on to the target tile's entry edge),
 * around the tile corner (a bend: pivot (px, py), from angle a0 by da), or through a routing
 * block's centre (mx, my). Height (iso px) goes from z0 to z1 over the first `zr` of the way.
 * Over junctions (`hn` of them, side by side between s = h0 and h1) it rides each bridge's hump,
 * `hz` px at the crown; between s = o0 and o1 it is drawn over the bridges (empty when o0 > o1).
 */
export interface Piece {
  bend: boolean;
  x: number; y: number; enter: Rot; exit: Rot;
  ax: number; ay: number; bx: number; by: number;
  z0: number; z1: number; zr: number;
  px: number; py: number; a0: number; da: number;
  mx: number; my: number; via: boolean;
  h0: number; h1: number; hn: number; hz: number;
  o0: number; o1: number;
}

/** A point on a path (tile coords, height px; `o`: 1 on a junction's deck, drawn over the bridge). */
export interface Pt { x: number; y: number; z: number; o: number }

const edge = (x: number, y: number, d: Rot, sign: number): [number, number] => [x + 0.5 + DX[d]! * 0.5 * sign, y + 0.5 + DY[d]! * 0.5 * sign];

/** No junction on the way: no hump, never drawn over. */
const FLAT = { h0: 0, h1: 1, hn: 0, hz: 0, o0: 2, o1: -1 } as const;

/** A tile's piece: straight from the `enter` side's edge to the `exit` edge, or a bend when they differ. */
export function makePiece(x: number, y: number, enter: Rot, exit: Rot, z0 = 0, z1 = 0, zr = 1, to?: [number, number]): Piece {
  const [ax, ay] = edge(x, y, enter, -1);
  const [bx, by] = to ?? edge(x, y, exit, 1);
  const p: Piece = { bend: enter !== exit && !to, x, y, enter, exit, ax, ay, bx, by, z0, z1, zr, px: 0, py: 0, a0: 0, da: 0, mx: 0, my: 0, via: false, ...FLAT };
  if (p.bend) {
    // The bend pivots on the tile corner between the entry and exit edges.
    const cx = x + 0.5, cy = y + 0.5, nx = DX[enter]!, ny = DY[enter]!, ex = DX[exit]!, ey = DY[exit]!;
    p.px = cx - nx * 0.5 + ex * 0.5; p.py = cy - ny * 0.5 + ey * 0.5;
    p.a0 = Math.atan2(cy - ny * 0.5 - p.py, cx - nx * 0.5 - p.px);
    let da = Math.atan2(cy + ey * 0.5 - p.py, cx + ex * 0.5 - p.px) - p.a0;
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    p.da = da;
  }
  return p;
}

/** A routing block's path: entry point → its centre → exit point (two straight halves). */
export function viaPiece(ax: number, ay: number, mx: number, my: number, bx: number, by: number): Piece {
  return { bend: false, x: Math.floor(mx), y: Math.floor(my), enter: 0, exit: 0, ax, ay, bx, by, z0: 0, z1: 0, zr: 1, px: 0, py: 0, a0: 0, da: 0, mx, my, via: true, ...FLAT };
}

/** Widen the stretch of a piece drawn over the bridges to [s0, s1] (one span: their hull). */
function drawOver(p: Piece, s0: number, s1: number): void {
  if (p.o0 > p.o1) { p.o0 = s0; p.o1 = s1; } else { p.o0 = Math.min(p.o0, s0); p.o1 = Math.max(p.o1, s1); }
}

/**
 * A straight run of `n` junctions over which the line rides (the over axis), on a piece whose
 * way runs from `a` to `b` along `dir`, the run starting at `j` (coordinates along `dir`) and
 * reached by the piece's s from `s0` on (a routing block's way out: its second half). The item
 * rises onto each bridge and comes down on its far side, and is drawn over them from OVER_M
 * before the run to the piece's end (the next ribbon draws it over for OVER_M more).
 */
function rideOver(p: Piece, a: number, b: number, j: number, n: number, hz: number, s0 = 0): void {
  const L = b - a;
  if (!(n > 0) || !(L > 0)) return;
  p.h0 = s0 + ((1 - s0) * (j - a)) / L; p.h1 = s0 + ((1 - s0) * (j + n - a)) / L;
  p.hn = n; p.hz = hz;
  drawOver(p, s0 + ((1 - s0) * Math.max(0, j - OVER_M - a)) / L, 1);
}

/** Coordinate of a point along a direction (tiles). */
const along = (d: Rot, x: number, y: number): number => DX[d]! * x + DY[d]! * y;

/** Point on a piece at progress s (clamped to [0, 1]), into `out`. */
export function pieceAt(p: Piece, s: number, out: Pt): Pt {
  if (s < 0) s = 0; else if (s > 1) s = 1;
  out.z = p.z0 === p.z1 ? p.z0 : s < p.zr ? p.z0 + ((p.z1 - p.z0) * s) / p.zr : p.z1;
  if (p.hn) {
    // Over junctions: each bridge's hump, the art's own profile.
    const v = ((s - p.h0) / (p.h1 - p.h0)) * p.hn;
    if (v > 0 && v < p.hn) out.z += p.hz * junctionHump(v - Math.floor(v));
  }
  out.o = s >= p.o0 && s <= p.o1 ? 1 : 0;
  if (p.via) {
    if (s < 0.5) { const f = s * 2; out.x = p.ax + (p.mx - p.ax) * f; out.y = p.ay + (p.my - p.ay) * f; }
    else { const f = s * 2 - 1; out.x = p.mx + (p.bx - p.mx) * f; out.y = p.my + (p.by - p.my) * f; }
  } else if (p.bend) {
    const a = p.a0 + p.da * s;
    out.x = p.px + Math.cos(a) * 0.5; out.y = p.py + Math.sin(a) * 0.5;
  } else {
    out.x = p.ax + (p.bx - p.ax) * s; out.y = p.ay + (p.by - p.ay) * s;
  }
  return out;
}

/** Point on a piece at progress s, tile coords, and its height (iso px). */
export function piecePoint(p: Piece, s: number): [number, number, number] {
  const o = pieceAt(p, s, { x: 0, y: 0, z: 0, o: 0 });
  return [o.x, o.y, o.z];
}

/** What a ribbon tile looks like to the items (the views' rule): straight, or a bend fed from one side. */
export type BeltPieceFn = (sim: Sim, e: Ent) => { corner: boolean; rot: Rot };

/** A piece's length along its way (tiles): a quarter circle for a bend. */
export const lengthOf = (p: Piece): number => (p.bend ? Math.PI / 4 : along(p.exit, p.bx, p.by) - along(p.exit, p.ax, p.ay));

/**
 * The skybridge pairs (an end whose graph target is the next end ahead, facing its way: a leap):
 * their start ends' tiles (the items climb onto the deck there) and far ends' (they come down).
 */
export function skyLeaps(sim: Sim): { starts: Set<number>; landing: Set<number> } {
  const starts = new Set<number>(), landing = new Set<number>();
  for (const [t, g] of sim.graph?.jumps ?? []) {
    const tx = t % WORLD, gx = g % WORLD;
    const e = sim.entityAt(tx, (t - tx) / WORLD), o = sim.entityAt(gx, (g - gx) / WORLD);
    if (e && o && BUILDING_KIND[e.def] === 'bridge' && BUILDING_KIND[o.def] === 'bridge' && o.rot === e.rot) { starts.add(t); landing.add(g); }
  }
  return { starts, landing };
}

/**
 * A piece entering over a bridge's far edge (the ribbon right past a junction on the over axis,
 * or past a skybridge's far end): its item is still drawn over the bridge for its first OVER_M,
 * so it changes layer clear of the bridge's sprite.
 */
function pastBridge(sim: Sim, p: Piece, landing: ReadonlySet<number>): void {
  const d = p.enter, bx = p.x - DX[d]!, by = p.y - DY[d]!;
  const sky = bx >= 0 && by >= 0 && bx < WORLD && by < WORLD && landing.has(tileIndex(bx, by)) && sim.entityAt(bx, by)?.rot === d;
  if (!sky && !(overJunction(d) && junctionAt(sim, bx, by))) return;
  const len = lengthOf(p);
  if (len > 0) drawOver(p, 0, Math.min(1, OVER_M / len));
}

/**
 * Every ribbon tile's piece. A tile in `graph.jumps` leaps on to the entry edge of the tile it
 * hands to: a skybridge's far end (rising to `deckZ` on the start, coming down on the far end:
 * the whole way drawn over the bridge, as are the last OVER_M before it and the first after it),
 * or past junctions — over their bridges (the north–south line: a hump `humpZ` px high on each)
 * or under them (the east–west line: flat, drawn beneath them).
 */
export function buildPieces(sim: Sim, beltPiece: BeltPieceFn, deckZ: number, humpZ = HUMP_Z): Map<number, Piece> {
  const pieces = new Map<number, Piece>();
  sim.ensureCompiled();
  const jumps = sim.graph?.jumps ?? new Map<number, number>();
  const { starts, landing } = skyLeaps(sim);
  for (const e of sim.ents.map.values()) {
    const k = BUILDING_KIND[e.def];
    if (k !== 'belt' && k !== 'conduit' && k !== 'bridge') continue;
    const t = tileIndex(e.x, e.y);
    const bridge = k === 'bridge';
    const p = bridge ? { corner: false, rot: e.rot } : beltPiece(sim, e);
    const enter = p.corner ? p.rot : e.rot;
    const to = jumps.get(t);
    const leap = starts.has(t);
    let zr = 1, at: [number, number] | undefined, n = 0;
    if (to !== undefined) {
      const gx = to % WORLD, gy = (to - gx) / WORLD;
      at = edge(gx, gy, e.rot, -1);
      n = Math.abs(gx - e.x) + Math.abs(gy - e.y) - 1;
      zr = 1 / (n + 1);
    }
    const piece = makePiece(e.x, e.y, enter, e.rot, landing.has(t) ? deckZ : 0, leap ? deckZ : 0, zr, at);
    // Past junctions (not a skybridge's leap over them): over their bridges, or under them.
    if (n > 0 && !leap && overJunction(e.rot)) {
      const [jx, jy] = edge(e.x, e.y, e.rot, 1);
      rideOver(piece, along(e.rot, piece.ax, piece.ay), along(e.rot, piece.bx, piece.by), along(e.rot, jx, jy), n, humpZ);
    }
    // A skybridge: up its start, across, down its far end, all over the buildings; and the last
    // stretch into a start (the next tile, or past junctions).
    if (leap || landing.has(t)) drawOver(piece, 0, 1);
    const nx = e.x + DX[e.rot]!, ny = e.y + DY[e.rot]!;
    const ahead = to ?? (nx >= 0 && ny >= 0 && nx < WORLD && ny < WORLD ? tileIndex(nx, ny) : -1);
    if (!leap && starts.has(ahead)) {
      const ax = ahead % WORLD, len = lengthOf(piece);
      if (sim.entityAt(ax, (ahead - ax) / WORLD)?.rot === e.rot && len > 0) drawOver(piece, Math.max(0, 1 - OVER_M / len), 1);
    }
    pastBridge(sim, piece, landing);
    pieces.set(t, piece);
  }
  return pieces;
}

/** Does a built junction stand on tile (x, y)? */
const junctionAt = (sim: Sim, x: number, y: number): boolean => {
  const o = sim.entityAt(x, y);
  return !!o && o.builtAt === 0 && BUILDING_KIND[o.def] === 'crossing';
};
