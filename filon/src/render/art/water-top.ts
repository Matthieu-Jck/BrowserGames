// water-top.ts — the water on a column's top up on the rock (D63's tarn, D94's streams up on a
// massif, D115's spring), drawn as ONE body however the tiles cut it (D135; owner, 2026-10-18:
// « cascade is still slightly broken here, there's a brown stripe inside the lake »; « it is also a
// bit broken when the water goes straight towards the camera like this »). Each column's sprite
// paints its own tile only, so whatever it draws must be a function of the world, the same seen
// from either side of a seam: a tile reads the 7 × 7 round it (`TopLook.cells`: what each holds at
// its height) and from it
// · the water's outline — the floor's (gaps.ts, paint-kit `march`): samples at the tiles' middles,
//   each the share of water round it (itself 4, its sides 2, its corners 1, in 16), a stream's at
//   least `KEEP` (a stream however thin stays), dry land's at most `DRY` (its middle stays land);
//   marching squares at a half, the saddles joined (a stream stepping on diagonally runs on as one
//   channel). The same outline as the plan's; a stream a tile wide runs in a channel a little
//   narrower than its tile, a lake's corners round off, a stream widens over a tile or two;
// · its depth, as the distance to the nearest bank (`depthColor`: the shallows along the banks,
//   the deep middle), painted as round-capped strokes along the banks (a stroke 2d wide covers the
//   water within d of them): the middle of a stream or a lake is deeper wherever its banks are,
//   across any seam, in any direction; running water's colours over still water's feathered out
//   of the streams' tiles (gaps.ts `FEATHER`): the lake's colour runs on into its outflow;
// · the banks only where water meets land at its height — never across water: the rock's lip
//   inked over a paper glow and, where a bank's inner wall faces the camera (a far bank of running
//   water), a strip of wet rock dropping to it (`BANK`);
// · a mark now and then (`TopLook.mark`, hashed from the world tile: a stream's every third tile
//   along its way, a lake's here and there), not the same mark on every tile;
// · a fall's lip and its sheet as wide as the water there (`lipSpan`): two tiles falling side by
//   side make one sheet. A tile at another height a fall joins to it (`x`: the foot of a stream's
//   fall, the next tile along it below, or a stream pouring into it from above) counts as its own
//   water, so the channel runs straight up to its lip and on from where a fall lands.
// Worker-safe (Canvas2D only).
import { FEATHER, WATER } from './gaps';
import { C, mix, rgba } from './tokens';
import type { Ctx, Pt } from './ink';

/** The neighbourhood a tile reads (`TopLook.cells`): 7 × 7 round it, row by row from (−3, −3). */
export const SPAN = 7;
const R = 3;
/** What a tile of the neighbourhood holds at the tile's height: nothing, still water, deep still water, a stream (its way, the eighth of a turn: 0 = +x … 7), or a tile at another height a fall joins on (the foot of a stream's fall, water or not; a stream pouring in from above). */
export const CELL = { dry: '.', still: 'w', deep: 'd', joined: 'x' } as const;

/** The code of tile (i, j) of the neighbourhood (its middle (0, 0)). */
export const cellAt = (cells: string, i: number, j: number): string => (i < -R || j < -R || i > R || j > R ? '.' : cells[(j + R) * SPAN + i + R] ?? '.');
const wetC = (c: string): boolean => c !== '.';
/** Running water: a stream, or water a fall joins on. */
export const runC = (c: string): boolean => c === 'x' || (c >= '0' && c <= '7');
const stillC = (c: string): boolean => c === 'w' || c === 'd';

/** A stream's sample, at least (paint-kit `march`'s `keep`: the floor's rivers, so plan and iso draw one outline). */
export const KEEP = 0.62;
/** Dry land's sample, at most: a tile of rock in a lake keeps its middle (the floor's ground paint has the rock map over it). */
const DRY = 0.45;
/** How far a tile's water runs on past its edge (tiles): its neighbour's, the same colour, so no hairline between sprites. */
export const BLEED = 0.03;
/** How far past a tile's edge its banks' ink is drawn (tiles): the next tile draws the rest. */
const INK_BLEED = 0.012;
/**
 * The depth (d: tiles from the nearest bank) where each band of colour starts — fine steps near the
 * banks where a stream's channel deepens, longer ones out into a lake — and the colour of each band
 * (`depthColor`): one ramp for still water, one for running water, mixed by how much the water
 * there runs (the feather), so a lake's depth runs on into its outflow's.
 */
const STEPS: readonly number[] = [0.03, 0.055, 0.08, 0.105, 0.13, 0.155, 0.18, 0.21, 0.25, 0.3, 0.37, 0.45, 0.55, 0.67, 0.8, 0.93, 1.05];
/** The colour at depth d of still water (the shallows to the deep heart) and of running water (the stream's blue to its deep middle), and between them by `run` (0 still … 1 running). */
export function depthColor(d: number, run: number): string {
  // Still: the shallows to the lake's middle (`WATER.lakeMid`, the shallows 45 % of the way to the deep) by half a tile in, on towards the deep.
  const still = mix(C.shallow, C.deep, d < 0.45 ? d : 0.45 + 0.35 * Math.min(1, (d - 0.45) / 0.6));
  const mid = mix(C.river, C.riverD, 0.62);
  const running = d < 0.22 ? mix(C.river, mid, d / 0.22) : mix(mid, WATER.riverDeep, Math.min(1, (d - 0.22) / 0.6));
  return run <= 0 ? still : run >= 1 ? running : mix(still, running, run);
}
/** A far bank's inner wall: how far it reaches into the water (tiles), and from how square to the camera a bank shows it. */
const BANK = 0.075, FACING = 0.3;

export type UV = readonly [number, number];
/** A bank, from a to b, the water on its right (u east, v south: east's right is south). */
export interface Bank { readonly a: UV; readonly b: UV }

/** Do any of the neighbourhood's tiles hold water (`wetC`), or run (`runC`), or lie still? */
export const anyOf = (cells: string, f: (c: string) => boolean): boolean => { for (const c of cells) if (f(c)) return true; return false; };

/**
 * The 5 × 5 samples at the tiles' middles round a tile (index (b + 2)·5 + a + 2, the tile (a, b)):
 * the water's (`run`: the running water's, the feather's, with no cap on the land).
 */
export function samples(cells: string, run = false): Float64Array {
  const has = run ? runC : wetC;
  const out = new Float64Array(25);
  for (let b = -2; b <= 2; b++) {
    for (let a = -2; a <= 2; a++) {
      let s = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (has(cellAt(cells, a + di, b + dj))) s += di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1;
      const c = cellAt(cells, a, b), v = s / 16;
      out[(b + 2) * 5 + a + 2] = runC(c) ? Math.max(KEEP, v) : has(c) || run ? v : Math.min(DRY, v);
    }
  }
  return out;
}

interface MPt { u: number; v: number; x: boolean }

/** One dual cell's water (the cell between the middles of tiles (a, b) … (a + 1, b + 1)): its polygons, clockwise, the points on its edges flagged. */
function cellPolys(vals: Float64Array, a: number, b: number, iso: number): MPt[][] {
  const at = (i: number, j: number): number => vals[(j + 2) * 5 + i + 2]!;
  const A = at(a, b), B = at(a + 1, b), Cc = at(a + 1, b + 1), D = at(a, b + 1);
  const code = (A >= iso ? 8 : 0) | (B >= iso ? 4 : 0) | (Cc >= iso ? 2 : 0) | (D >= iso ? 1 : 0);
  if (!code) return [];
  const lerp = (p: number, q: number): number => { const d = q - p; return d === 0 ? 0.5 : (iso - p) / d; };
  const x0 = a + 0.5, x1 = a + 1.5, y0 = b + 0.5, y1 = b + 1.5;
  const T: MPt = { u: x0 + lerp(A, B), v: y0, x: true }, Rr: MPt = { u: x1, v: y0 + lerp(B, Cc), x: true };
  const Bb: MPt = { u: x0 + lerp(D, Cc), v: y1, x: true }, L: MPt = { u: x0, v: y0 + lerp(A, D), x: true };
  const TL: MPt = { u: x0, v: y0, x: false }, TR: MPt = { u: x1, v: y0, x: false }, BR: MPt = { u: x1, v: y1, x: false }, BL: MPt = { u: x0, v: y1, x: false };
  // paint-kit `march`'s table, its polygons clockwise; the saddles (5, 10) joined.
  switch (code) {
    case 15: return [[TL, TR, BR, BL]];
    case 8: return [[TL, T, L]];
    case 4: return [[T, TR, Rr]];
    case 2: return [[Rr, BR, Bb]];
    case 1: return [[L, Bb, BL]];
    case 12: return [[TL, TR, Rr, L]];
    case 6: return [[T, TR, BR, Bb]];
    case 3: return [[L, Rr, BR, BL]];
    case 9: return [[TL, T, Bb, BL]];
    case 14: return [[TL, TR, BR, Bb, L]];
    case 13: return [[TL, TR, Rr, Bb, BL]];
    case 11: return [[TL, T, Rr, BR, BL]];
    case 7: return [[T, TR, BR, BL, L]];
    case 10: return [[TL, T, Rr, BR, Bb, L]];
    default: return [[T, TR, Rr, Bb, BL, L]]; // 5
  }
}

/**
 * The water round a tile, in its own coordinates (the tile is [0, 1]²; the dual cells between the
 * middles of the 5 × 5 round it, reaching 1.5 tiles past it): its polygons (clockwise) and its banks
 * (the polygons' edges inside the cells: where water meets land).
 */
export function contour(vals: Float64Array, iso = 0.5): { polys: UV[][]; banks: Bank[] } {
  const polys: UV[][] = [], banks: Bank[] = [];
  for (let b = -2; b < 2; b++) {
    for (let a = -2; a < 2; a++) {
      for (const p of cellPolys(vals, a, b, iso)) {
        polys.push(p.map((q) => [q.u, q.v] as const));
        for (let i = 0; i < p.length; i++) {
          const s = p[i]!, e = p[(i + 1) % p.length]!;
          if (s.x && e.x && Math.hypot(e.u - s.u, e.v - s.v) > 1e-9) banks.push({ a: [s.u, s.v], b: [e.u, e.v] });
        }
      }
    }
  }
  return { polys, banks };
}

/** The banks linked into lines (each bank's end the next one's start: the cells compute a shared edge's crossing alike), the water on their right. */
export function chains(banks: readonly Bank[]): UV[][] {
  const key = (p: UV): string => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const from = new Map<string, number>();
  banks.forEach((bk, i) => from.set(key(bk.a), i));
  const ends = new Set(banks.map((bk) => key(bk.b)));
  const used = new Uint8Array(banks.length);
  const out: UV[][] = [];
  const walk = (i: number): void => {
    const line: UV[] = [banks[i]!.a];
    let j: number | undefined = i;
    while (j !== undefined && !used[j]) {
      used[j] = 1;
      line.push(banks[j]!.b);
      j = from.get(key(banks[j]!.b));
    }
    out.push(line);
  };
  // Open lines from their starts first (no bank ends there), then the closed ones.
  banks.forEach((bk, i) => { if (!used[i] && !ends.has(key(bk.a))) walk(i); });
  banks.forEach((_, i) => { if (!used[i]) walk(i); });
  return out;
}

/** Is (u, v) — tile coordinates, within a tile and a half of it — in the water? */
export function inWater(vals: Float64Array, u: number, v: number): boolean {
  const a = Math.max(-2, Math.min(1, Math.floor(u - 0.5))), b = Math.max(-2, Math.min(1, Math.floor(v - 0.5)));
  for (const p of cellPolys(vals, a, b, 0.5)) {
    let inside = true;
    for (let i = 0; i < p.length && inside; i++) {
      const s = p[i]!, e = p[(i + 1) % p.length]!;
      // Clockwise (v down): the inside on the right of each edge.
      if ((e.u - s.u) * (v - s.v) - (e.v - s.v) * (u - s.u) < -1e-9) inside = false;
    }
    if (inside) return true;
  }
  return false;
}

const segDist = (u: number, v: number, a: UV, b: UV): number => {
  const du = b[0] - a[0], dv = b[1] - a[1], l2 = du * du + dv * dv;
  const t = l2 ? Math.max(0, Math.min(1, ((u - a[0]) * du + (v - a[1]) * dv) / l2)) : 0;
  return Math.hypot(u - a[0] - du * t, v - a[1] - dv * t);
};

/** How far (u, v) lies from the nearest bank (tiles; 0 off the water), as the bands read it — within a tile and a half of the tile, the same from any tile round it. */
export function depthAt(cells: string, u: number, v: number): number {
  const vals = samples(cells);
  if (!inWater(vals, u, v)) return 0;
  let d = Infinity;
  for (const bk of contour(vals).banks) d = Math.min(d, segDist(u, v, bk.a, bk.b));
  return d;
}

/** Does any of the water, or its banks' ink, reach into the tile ([0, 1]² and a hair round it)? A rock tile beside water has a top of its own only then. */
export function reaches(cells: string): boolean {
  if (!anyOf(cells, wetC)) return false;
  const vals = samples(cells);
  for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) if (inWater(vals, -0.02 + (i / 8) * 1.04, -0.02 + (j / 8) * 1.04)) return true;
  const m = 0.04;
  for (const bk of contour(vals).banks) {
    // A bank within the tile, or crossing its rim (its ink's half on this side).
    for (let s = 0; s <= 8; s++) {
      const u = bk.a[0] + ((bk.b[0] - bk.a[0]) * s) / 8, v = bk.a[1] + ((bk.b[1] - bk.a[1]) * s) / 8;
      if (u > -m && u < 1 + m && v > -m && v < 1 + m) return true;
    }
  }
  return false;
}

/**
 * The stretch of a side (p → q, tile coordinates on the top's outline) the water reaches, inside
 * the side: [fa, fb] (fractions along it), and whether the water runs on past either end (into the
 * next tile's: its sheet carries on, no veil there); null where it does not touch the side.
 */
export function lipSpan(cells: string, p: UV, q: UV): { fa: number; fb: number; openA: boolean; openB: boolean } | null {
  const vals = samples(cells), du = q[0] - p[0], dv = q[1] - p[1], len = Math.hypot(du, dv) || 1;
  // A hair inside the top (the inward normal of a clockwise outline: right of p → q).
  const iu = (-dv / len) * 0.03, iv = (du / len) * 0.03;
  const N = 64;
  let fa = -1, fb = -1;
  for (let s = 0; s <= N; s++) {
    const f = s / N;
    if (inWater(vals, p[0] + du * f + iu, p[1] + dv * f + iv)) { if (fa < 0) fa = f; fb = f; }
  }
  if (fa < 0 || fb - fa < 1e-6) return null;
  const past = (f: number): boolean => inWater(vals, p[0] + du * f + iu, p[1] + dv * f + iv);
  return { fa, fb, openA: fa === 0 && past(-0.05 / len), openB: fb === 1 && past(1 + 0.05 / len) };
}

/** A tile-local unit vector for a stream's way (the eighth of a turn, 0 = +x). */
export const wayVec = (flow: number): [number, number] => { const a = (flow * Math.PI) / 4; return [Math.cos(a), Math.sin(a)]; };

/** What the painter needs of the column: its detail and line unit (rock.ts `ColumnOpts`). */
export interface WaterOpts { readonly detail: 0 | 1 | 2; readonly k: number }
/** The top's water as rock.ts `TopLook` carries it. */
export interface WaterLook { readonly kind: 'water' | 'ground' | 'rock' | 'river'; readonly cells: string; readonly flow?: number; readonly fall?: number; readonly from?: number; readonly mark?: number }

/** The 3 × 3 bit of each side's neighbour (N, E, S, W) and the side's corners (tile-local), clockwise. */
const SIDES: ReadonlyArray<readonly [number, UV, UV]> = [[1, [0, 0], [1, 0]], [5, [1, 0], [1, 1]], [7, [1, 1], [0, 1]], [3, [0, 1], [0, 0]]];

/** What the column tells the painter: its far banks' rock colour, and which of its sides (bits N, E, S, W) drop to lower ground (a fall's lip can only be there). */
export interface WaterColumn { readonly wall: string; readonly drops: number }

/**
 * Paint a column's top's water (its part of the body round it) at height z through P, inside
 * `clip` (the top's outline, screen points) or, when null, the tile and a hair round it (`BLEED`:
 * the next tile's water runs on under it, the same colour).
 */
export function paintWaterTop(ctx: Ctx, P: (u: number, v: number, z: number) => Pt, z: number, top: WaterLook, o: WaterOpts, rnd: (n: number) => number, cls: WaterColumn, clip: readonly Pt[] | null): void {
  const cells = top.cells;
  if (!anyOf(cells, wetC)) return;
  const vals = samples(cells), { polys, banks } = contour(vals);
  const lines = chains(banks);
  const k = o.k;
  const path = (pts: readonly UV[]): void => { pts.forEach(([u, v], i) => { const [x, y] = P(u, v, z); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); };
  const square = (m: number): void => { ctx.beginPath(); path([[-m, -m], [1 + m, -m], [1 + m, 1 + m], [-m, 1 + m]]); ctx.closePath(); };
  const region = (ps: readonly UV[][]): void => { ctx.beginPath(); for (const p of ps) { path(p); ctx.closePath(); } };
  // The tile's own affine frame (P is affine: the sprites' iso, the paint's oblique, the tests'):
  // the depth bands are strokes in tile units, so a band d wide is d tiles from its bank.
  const o0 = P(0, 0, z), pu = P(1, 0, z), pv = P(0, 1, z);
  const frame = (): void => ctx.transform(pu[0] - o0[0], pu[1] - o0[1], pv[0] - o0[0], pv[1] - o0[1], o0[0], o0[1]);
  const strokeLines = (ls: readonly UV[][]): void => {
    ctx.beginPath();
    for (const l of ls) l.forEach(([u, v], i) => (i ? ctx.lineTo(u, v) : ctx.moveTo(u, v)));
    ctx.stroke();
  };
  /** The water's depth (`depthColor` at `run`): the deepest colour, then the bands from the banks in — opaque, so a feathered pass covers the one under it. */
  const depth = (run: number): void => {
    const steps = o.detail >= 1 ? STEPS : STEPS.filter((_, i) => i % 3 === 2);
    ctx.fillStyle = depthColor(steps[steps.length - 1]!, run);
    region(polys);
    ctx.fill();
    if (!lines.length) return;
    ctx.save();
    frame();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = steps.length - 1; i >= 0; i--) {
      ctx.strokeStyle = depthColor(i ? steps[i - 1]! : 0, run);
      ctx.lineWidth = 2 * steps[i]!;
      strokeLines(lines);
    }
    ctx.restore();
  };

  ctx.save();
  if (clip) { ctx.beginPath(); clip.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
  else square(BLEED);
  ctx.clip();
  if (polys.length) {
    ctx.save();
    region(polys);
    ctx.clip();
    const run = anyOf(cells, runC), still = anyOf(cells, stillC);
    // Out of a lake (or into one): the running water's share feathered out of the streams' own
    // tiles as on the floor (gaps.ts `FEATHER`: seven bands, a seventh more each) — each band the
    // whole depth again in the colours of its share, so a lake's colour and depth run on into its
    // outflow's with no seam.
    const rv = run && still ? samples(cells, true) : null;
    depth(run && !still ? 1 : 0);
    if (rv) {
      FEATHER.forEach(([iso], b) => {
        const rp = contour(rv, iso).polys;
        if (!rp.length) return;
        ctx.save();
        region(rp);
        ctx.clip();
        depth((b + 1) / FEATHER.length);
        ctx.restore();
      });
    }
    // A stream's far banks (never a lake's: where still water lies in reach, only within the
    // streams' own share of it).
    if (run && o.detail >= 1) {
      ctx.save();
      if (rv) { region(contour(rv, 0.35).polys); ctx.clip(); }
      farBanks(ctx, frame, lines, cls.wall);
      ctx.restore();
    }
    if (o.detail >= 1) {
      marks(ctx, P, z, top, k);
      if (top.from) landing(ctx, P, z, top, k, rnd);
      if (top.fall) lipFoam(ctx, P, z, top, k, rnd, cls.drops);
    }
    ctx.restore();
  }
  // The banks' ink: the rock's lip over a paper glow, as the floor's shores — within the tile (and
  // a hair: the next tile inks the rest of a bank on its edge).
  if (lines.length) {
    ctx.save();
    square(INK_BLEED);
    ctx.clip();
    const ink = (color: string, w: number, a: number): void => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha *= a;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const l of lines) path(l);
      ctx.stroke();
      ctx.restore();
    };
    ink(C.paper, 3 * k, 0.7);
    ink(C.ink, (o.detail >= 2 ? 1.8 : 1.3) * k, 0.95);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The far banks of running water (D115): where a bank's inner wall faces the camera (its inward
 * normal towards +u +v), a strip of the rock dropping to the water along it, its foot dark and wet,
 * a glint on the water at its foot — along the banks only (never across water), the same strip
 * whichever tile draws it. Clipped to the water (the caller's clip).
 */
function farBanks(ctx: Ctx, frame: () => void, lines: readonly UV[][], wall: string): void {
  // The runs of each line whose inner wall faces the camera.
  const runs: UV[][] = [];
  for (const l of lines) {
    let cur: UV[] | null = null;
    for (let i = 0; i + 1 < l.length; i++) {
      const [au, av] = l[i]!, [bu, bv] = l[i + 1]!, len = Math.hypot(bu - au, bv - av) || 1;
      const facing = (-(bv - av) + (bu - au)) / len / Math.SQRT2;
      if (facing > FACING) {
        if (!cur) { cur = [l[i]!]; runs.push(cur); }
        cur.push(l[i + 1]!);
      } else cur = null;
    }
  }
  if (!runs.length) return;
  ctx.save();
  frame();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  const stroke = (color: string, w: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (const r of runs) r.forEach(([u, v], i) => (i ? ctx.lineTo(u, v) : ctx.moveTo(u, v)));
    ctx.stroke();
  };
  stroke(rgba('#ffffff', 0.4), 2 * (BANK + 0.03));
  stroke(mix(C.ink, C.riverD, 0.45), 2 * (BANK + 0.016));
  stroke(mix(wall, C.riverD, 0.18), 2 * BANK);
  ctx.restore();
}

/** A stream's or a lake's mark on this tile (`TopLook.mark`, 1 … 3; 0 none): a current's strokes along its way, or a ripple. */
function marks(ctx: Ctx, P: (u: number, v: number, z: number) => Pt, z: number, top: WaterLook, k: number): void {
  const m = top.mark ?? 0;
  if (!m) return;
  const line = (pts: Pt[], color: string, w: number): void => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
  };
  if (top.kind !== 'river') {
    // A short ripple on still water, here or there.
    const u = 0.22 + (m - 1) * 0.17, v = 0.62 - (m - 1) * 0.12;
    line([P(u, v, z), P(u + 0.12, v - 0.05, z), P(u + 0.24, v, z)], 'rgba(255,255,255,0.75)', 1.1 * k);
    return;
  }
  // Along the way it runs, off the middle a little; a paper-white hooked stroke and the river's dark
  // one beside it, by the mark's variant.
  const [fx, fy] = wayVec(top.flow ?? 0);
  const stroke = (along: number, side: number, len: number, bend: number): Pt[] => {
    const pts: Pt[] = [];
    for (let e = 0; e <= 6; e++) {
      const s = e / 6 - 0.5, b = Math.sin((e / 6) * Math.PI) * bend;
      const a = along + s * len, w = side + b;
      pts.push(P(0.5 + fx * a - fy * w, 0.5 + fy * a + fx * w, z));
    }
    return pts;
  };
  const along = (m - 2) * 0.1, side = ((m * 7) % 3 - 1) * 0.035;
  if (m !== 3) line(stroke(along, side, m === 2 ? 0.42 : 0.32, 0.06), 'rgba(255,255,255,0.8)', 1.3 * k);
  if (m !== 2) line(stroke(along + 0.12, side - 0.07, 0.24, 0.04), rgba(C.riverD, 0.6), 1 * k);
}

/**
 * Where a fall lands on a stream (D115: « the falls flowing into the next segment »), along the side
 * it comes over: the water churned white — a band of foam, bubbles — and rings spreading on (clipped
 * to the water by the caller).
 */
function landing(ctx: Ctx, P: (u: number, v: number, z: number) => Pt, z: number, top: WaterLook, k: number, rnd: (n: number) => number): void {
  const from = top.from ?? 0;
  for (let side = 0; side < 4; side++) {
    const [bit, [au, av], [bu, bv]] = SIDES[side]!;
    if (!(from & (1 << bit))) continue;
    const nu = side === 1 ? -1 : side === 3 ? 1 : 0, nv = side === 0 ? 1 : side === 2 ? -1 : 0;
    const at = (f: number, d: number): Pt => P(au + (bu - au) * f + nu * d, av + (bv - av) * f + nv * d, z);
    ctx.fillStyle = 'rgba(235,248,252,0.62)';
    ctx.beginPath();
    [at(-0.05, 0), at(1.05, 0), at(1.05, 0.16), at(0.75, 0.24), at(0.5, 0.2), at(0.25, 0.26), at(-0.05, 0.18)].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    for (let q = 0; q < 9; q++) {
      const [x, y] = at(0.08 + rnd(9500 + side * 31 + q) * 0.84, 0.02 + rnd(9520 + side * 31 + q) * 0.2);
      ctx.beginPath(); ctx.ellipse(x, y, (1.6 + rnd(9540 + side * 31 + q) * 2.2) * k, (1 + rnd(9560 + side * 31 + q) * 1.2) * k, 0, 0, Math.PI * 2); ctx.fill();
    }
    for (let q = 0; q < 2; q++) {
      const d = 0.34 + q * 0.2, pts: Pt[] = [];
      for (let e = 0; e <= 8; e++) pts.push(at(0.2 + (e / 8) * 0.6, d + Math.sin((e / 8) * Math.PI) * 0.06));
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${0.55 - q * 0.2})`;
      ctx.lineWidth = (1.2 - q * 0.3) * k;
      ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** The sides a stream falls over (they face the way it runs, as rock.ts `fallsDown`): N, E, S, W. */
export const fallSides = (flow: number): number[] => {
  const [fx, fy] = wayVec(flow);
  return [[0, -1], [1, 0], [0, 1], [-1, 0]].flatMap(([nx, ny], s) => (nx! * fx + ny! * fy > 0.55 ? [s] : []));
};

/** Foam at a fall's lip: along each side it pours over (facing its way, dropping: `drops`), across the water there (`lipSpan`), and bubbles behind it. */
function lipFoam(ctx: Ctx, P: (u: number, v: number, z: number) => Pt, z: number, top: WaterLook, k: number, rnd: (n: number) => number, drops: number): void {
  for (const s of fallSides(top.flow ?? 0)) {
    if (!(drops & (1 << s))) continue;
    const [, a, b] = SIDES[s]!, span = lipSpan(top.cells, a, b);
    if (!span) continue;
    const nu = s === 1 ? -1 : s === 3 ? 1 : 0, nv = s === 0 ? 1 : s === 2 ? -1 : 0;
    const at = (f: number, d: number): Pt => P(a[0] + (b[0] - a[0]) * f + nu * d, a[1] + (b[1] - a[1]) * f + nv * d, z);
    const f0 = span.openA ? -0.05 : span.fa, f1 = span.openB ? 1.05 : span.fb;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2.4 * k;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let e = 0; e <= 8; e++) { const [x, y] = at(f0 + ((f1 - f0) * e) / 8, 0.07); if (e) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let q = 0; q < 4; q++) {
      const [x, y] = at(span.fa + (0.1 + rnd(510 + s * 7 + q) * 0.8) * (span.fb - span.fa), 0.12 + rnd(520 + s * 7 + q) * 0.12);
      ctx.beginPath(); ctx.ellipse(x, y, (1.2 + rnd(530 + q) * 1.4) * k, (0.8 + rnd(540 + q)) * k, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
}
