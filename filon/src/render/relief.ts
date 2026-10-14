// relief.ts — the tiered relief of rock, shared by the terrain worker (painted into the ground,
// for far zooms) and the relief sprites (near zooms, depth-sorted with the buildings). Each
// rock tile is a column one terrace high per level of the land — the sim's own level (D45,
// `grid.level`), the very one placement, ribbons and wires obey — so what is drawn is what the
// rules read (owner, 2026-10-13: buildings on the mountains did not sit on their rock: the relief
// was drawn from a smoothed height of its own that only roughly agreed with the levels). Only
// the +x and +y walls ever face the camera. Pure maths: no DOM, no Pixi.
import { T } from '@/sim/types';
import { LH, TH } from './iso';

/** World px per relief level (one building height unit). */
export const LEVEL_PX = LH;
/** Levels per terrace step: each terrace is a full tile height (a cube's wall). */
export const STEP_LEVELS = 2;
/** Terraces of the highest rock: the sim's highest level (mapgen's mountains reach 5). */
export const MAX_TERRACE = 5;
export const MAX_LEVEL = MAX_TERRACE * STEP_LEVELS;
/** Ground-plane shift (tiles, along −x and −y) that lifts a point by one level on screen. */
export const SHIFT = LEVEL_PX / TH;
/** The ring (tiles) a paint window's levels leave out at its edge (its columns' neighbours are read from there). */
export const SMOOTH = 2;

export const isRockT = (t: number): boolean => t >= T.Rock1 && t <= T.Rock4;

/**
 * Relief level of a tile (0 = floor or water; rock: one terrace — `STEP_LEVELS` levels — per
 * level of the land, at least one): from its terrain class and the land's level there.
 */
export function levelOf(terrain: number, level: number): number {
  if (!isRockT(terrain)) return 0;
  return (level < 1 ? 1 : level > MAX_TERRACE ? MAX_TERRACE : level) * STEP_LEVELS;
}

/** What the relief reads of the land (a Grid, or a test field): terrain and level per tile. */
export interface ReliefLand {
  terrain(x: number, y: number): number;
  level(x: number, y: number): number;
}

/**
 * THE height of a tile's top (relief levels: 1 level = `LEVEL_PX` px up in iso; 0 = the floor):
 * where whatever stands on that tile stands. Every lift reads it — buildings on the mountains and
 * their moving parts, shadows, night lights, wire anchors, the build ghost, the iso picking
 * (world/stand.ts) — so they all move together when it changes. It is the land's own level
 * (`grid.level`, D45) as terraces (`levelOf`), the level the relief sprites and the painted relief
 * are drawn at: a footprint the rules call level ground (`uneven`) is drawn flat, and a lifted
 * building meets its rock top at any zoom.
 */
export function tileTop(land: ReliefLand, x: number, y: number): number {
  return levelOf(land.terrain(x, y), land.level(x, y));
}

/**
 * The tile a view ray meets first, from its ground point (px, py) — where it crosses z = 0. A
 * point `lv` levels up on the same ray lies `lv·SHIFT` tiles further along +x +y, towards the
 * viewer (in iso, and for the volumes through the whole morph), so walking down from the highest
 * relief, the first tile whose top (`tileTop`) reaches the ray is the rock top or the cliff it
 * hits; else the ground tile. Picking reads it (what a click lands on when it hits no sprite).
 */
export function surfaceTile(land: ReliefLand, px: number, py: number): [number, number] {
  for (let lv = MAX_LEVEL; lv > 0; lv--) {
    const tx = Math.floor(px + lv * SHIFT), ty = Math.floor(py + lv * SHIFT);
    if (tileTop(land, tx, ty) >= lv) return [tx, ty];
  }
  return [Math.floor(px), Math.floor(py)];
}

/** Mask bits: sides that drop to a lower level, and diagonal neighbours standing as high. */
export const M_E = 1, M_S = 2, M_W = 4, M_N = 8, M_NE = 16, M_SE = 32, M_SW = 64, M_NW = 128;

/**
 * The neighbourhood that shapes a column. Diagonal bits are kept only where they matter (at
 * a convex corner), so equal-looking columns share one sprite.
 */
export function maskAt(level: (x: number, y: number) => number, x: number, y: number, at?: number): number {
  const l = at ?? level(x, y);
  if (!l || level(x, y) < l) return 0;
  const E = level(x + 1, y) < l, S = level(x, y + 1) < l, W = level(x - 1, y) < l, N = level(x, y - 1) < l;
  let m = (E ? M_E : 0) | (S ? M_S : 0) | (W ? M_W : 0) | (N ? M_N : 0);
  const back = N && W, right = N && E, front = E && S, left = S && W;
  if ((back || front) && level(x + 1, y - 1) >= l) m |= M_NE;
  if ((back || front) && level(x - 1, y + 1) >= l) m |= M_SW;
  if ((right || left) && level(x - 1, y - 1) >= l) m |= M_NW;
  if ((right || left) && level(x + 1, y + 1) >= l) m |= M_SE;
  return m;
}

/**
 * A column as a stack of terrace slabs: one mask per step (thresholds STEP_LEVELS, 2·STEP…,
 * level), so a column only erodes down to its neighbours' height, never to the ground.
 */
export function masksAt(level: (x: number, y: number) => number, x: number, y: number): number[] {
  const l = level(x, y);
  const out: number[] = [];
  for (let k = STEP_LEVELS; k <= l; k += STEP_LEVELS) out.push(maskAt(level, x, y, k));
  return out;
}

export interface OutlinePt {
  u: number;
  v: number;
  /** Is the segment leaving this point a silhouette (the land beyond it is lower)? */
  sil: boolean;
}

/** A chamfer: the line a→b cuts off the tile corner (cu, cv). */
interface Cut { au: number; av: number; bu: number; bv: number; cu: number; cv: number }

/**
 * Chamfers of one terrace step. A convex corner (both sides drop) is cut a little way along
 * each side, or all the way to the next corner where a diagonal neighbour carries the edge on —
 * so diagonal fronts become straight walls instead of staircases.
 */
function cutsOf(mask: number): Cut[] {
  const E = !!(mask & M_E), S = !!(mask & M_S), W = !!(mask & M_W), N = !!(mask & M_N);
  const NE = !!(mask & M_NE), SE = !!(mask & M_SE), SW = !!(mask & M_SW), NW = !!(mask & M_NW);
  const out: Cut[] = [];
  const L = (b: boolean): number => (b ? 1 : 0.38);
  if (N && W) out.push({ au: 0, av: L(SW), bu: L(NE), bv: 0, cu: 0, cv: 0 });
  if (N && E) out.push({ au: 1 - L(NW), av: 0, bu: 1, bv: L(SE), cu: 1, cv: 0 });
  if (E && S) out.push({ au: 1, av: 1 - L(NE), bu: 1 - L(SW), bv: 1, cu: 1, cv: 1 });
  if (S && W) out.push({ au: L(SE), av: 1, bu: 0, bv: 1 - L(NW), cu: 0, cv: 1 });
  return out;
}

/** Clip a convex polygon by the half-plane that excludes the cut's corner. */
function clip(poly: Array<{ u: number; v: number }>, c: Cut): Array<{ u: number; v: number }> {
  const side = (u: number, v: number): number => (c.bu - c.au) * (v - c.av) - (c.bv - c.av) * (u - c.au);
  const sc = side(c.cu, c.cv);
  const keep = (u: number, v: number): number => -side(u, v) * Math.sign(sc);
  const out: Array<{ u: number; v: number }> = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const kp = keep(p.u, p.v), kq = keep(q.u, q.v);
    if (kp >= -1e-9) out.push(p);
    if ((kp > 1e-9 && kq < -1e-9) || (kp < -1e-9 && kq > 1e-9)) {
      const t = kp / (kp - kq);
      out.push({ u: p.u + (q.u - p.u) * t, v: p.v + (q.v - p.v) * t });
    }
  }
  return out;
}

/**
 * The top outline of one terrace slab in tile-local coords (u, v ∈ [0, 1]), clockwise from the
 * back corner: the tile clipped by every chamfer of this step and the steps below it, so
 * slabs nest (rock only erodes, and never outside its own tile).
 */
export function slabOutline(masks: readonly number[], t: number): OutlinePt[] {
  let poly = [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }, { u: 0, v: 1 }];
  for (let k = 0; k <= t; k++) for (const c of cutsOf(masks[k]!)) poly = clip(poly, c);
  const pts: Array<{ u: number; v: number }> = [];
  for (const p of poly) {
    const q = pts[pts.length - 1];
    if (!q || Math.abs(q.u - p.u) + Math.abs(q.v - p.v) > 1e-6) pts.push(p);
  }
  while (pts.length > 1 && Math.abs(pts[0]!.u - pts[pts.length - 1]!.u) + Math.abs(pts[0]!.v - pts[pts.length - 1]!.v) <= 1e-6) pts.pop();
  const m = masks[t]!;
  const E = !!(m & M_E), S = !!(m & M_S), W = !!(m & M_W), N = !!(m & M_N);
  // Silhouette flag of each segment: a side's own flag, or always for a chamfer.
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    const mu = (p.u + q.u) / 2, mv = (p.v + q.v) / 2;
    const sil = mv < 1e-6 ? N : mu > 1 - 1e-6 ? E : mv > 1 - 1e-6 ? S : mu < 1e-6 ? W : true;
    return { u: p.u, v: p.v, sil };
  });
}

/** The outline of a single-step column. */
export const outline = (mask: number): OutlinePt[] => slabOutline([mask], 0);

/** Does a vertical wall with outward normal angle `a` face the camera (which sits at +x+y)? */
export const facesCamera = (a: number): boolean => Math.cos(a) + Math.sin(a) > 1e-6;

/** 0 = fully lit (the +y face), 1 = fully shaded (the +x face), for a wall normal angle. */
export function shadeOf(a: number): number {
  const c = Math.cos(a), s = Math.sin(a);
  // Light from screen top-left = from tile −x: +x faces darkest, +y faces mid.
  const t = (c - s + 1) / 2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** A visible wall: a polyline of the outline (with each segment's normal angle at its end). */
export interface WallRun {
  pts: Array<{ u: number; v: number; a: number }>;
  /** Does the wall stop against open air at its start / end (a silhouette vertical)? */
  openStart: boolean;
  openEnd: boolean;
}

/**
 * Visible wall pieces: consecutive silhouette segments that face the camera. Each piece is
 * extruded from z = 0 to the column's level.
 */
export function wallRuns(pts: readonly OutlinePt[]): WallRun[] {
  const n = pts.length;
  const seg = pts.map((p, k) => {
    const q = pts[(k + 1) % n]!;
    const du = q.u - p.u, dv = q.v - p.v;
    const a = Math.atan2(-du, dv); // outward normal of a clockwise edge: (dv, −du)
    return { p, q, a, sil: p.sil, vis: p.sil && facesCamera(a) };
  });
  // Start the walk on a segment that is not visible, so no run wraps around the array end.
  const start = seg.findIndex((s) => !s.vis);
  if (start < 0) return [];
  const runs: WallRun[] = [];
  let cur: WallRun | null = null;
  for (let t = 1; t <= n; t++) {
    const k = (start + t) % n;
    const s = seg[k]!;
    if (s.vis) {
      if (!cur) {
        const prev = seg[(k + n - 1) % n]!;
        cur = { pts: [{ u: s.p.u, v: s.p.v, a: s.a }], openStart: prev.sil, openEnd: false };
        runs.push(cur);
      }
      cur.pts.push({ u: s.q.u, v: s.q.v, a: s.a });
    } else if (cur) {
      cur.openEnd = s.sil;
      cur = null;
    }
  }
  return runs;
}
