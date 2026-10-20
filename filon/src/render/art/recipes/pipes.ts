// pipes.ts — the conduits as raised pipes in iso (D145; owner, 2026-10-19: « the conduits are still
// flat in isometric view, is that normal »). A conduit tile is a round steel tube in the conduit's
// colours (pale blue steel, its core shadow, a highlight along its lit crown, inked silhouettes)
// carried a little above the ground, its axis at the water ports' own height (pipe-ports.ts `PIPE`:
// the pump's outlet, a drinker's intake — so pump → pipe → valve is one run), on a saddle at each
// tile's middle (a base plate, a web, a cradle under the tube, a dark strap over it). Every few tiles
// a bolted flange joint; now and then a sight-glass, a glazed band of the water's teal with its
// glint (the stub's own); a bend is a long-radius elbow between two flanged ends; a side inlet a
// tee with a collar at its root; a line's end — at a port, or open — a flange at the stub's mouth
// (`PIPE.tOut` from the edge), where the stub's own flange meets it. Where a line's water is shared
// (D152: a tee, a pipe drawn off its side) a valve stands on the tee's crown: a squat bonnet bolted on
// the tube, its stem and a brass handwheel (`drawPipeValve`) — the ports' own valve, neither turquoise
// (in) nor coral (out): brass, it shares. A pressure gauge (D155: a fitting set into the line) stands on
// its tile's crown: a short stem from a bolted bonnet up to a round dial facing the viewer — a dark steel
// bezel, a cream face, the red, amber and green arcs of its scale (`BAL.pressure`) and ticks
// (`drawPipeGauge`) — its needle a sprite of its own the view turns with the reading
// (`drawGaugeNeedle`: one per state's colour, a brass hub; `gaugeAngle`), so it reads from mid zoom.
//
// Pieces are drawn in world directions on a 1 × 1 frame (no rotation: the light stays top-left),
// each tile's tube cut square at its edges with no ink across the cut, its fill and shading run a
// hair past the edge (`EXT`), so a run of tiles reads as one tube. The atlas bakes every piece a
// conduit can show (`PIPE_PIECES`, `PIPE_BRANCHES`) with its cast shadow (`drawPipeShadow`: the
// same drawing laid on the ground along the reference light, cut to the tile shifted along the
// light so a run's shadows meet without overlapping, and a contact shade right under the tube, wider
// than it, which is what shows below a low pipe); world/water-ports.ts `pipeOf` says which piece
// a tile shows. No lamp anywhere: like the ribbons, a pipe has no lights of its own at night.
//
// The tube is swept along a path (a straight, an arc): discs across it, filled hull by hull; the
// core shadow and the highlight from a light in world space (−x, a little −y, and above), only on
// the half the camera sees (the iso view looks along (−1, −1, −1) in tile terms: a level is half a
// tile); the silhouettes are the hulls' bridge edges, so the cuts carry no ink.
import { BAL } from '@/content/balance';
import { PRESSURE_MAX, type PressureState } from '@/sim/readouts/pressure';
import { C, mix } from '../tokens';
import { ellipsePts, flat, ink, type Ctx, type Pt } from '../ink';
import { hull, rivet } from '../shapes';
import { IsoFrame, ShadowFrame, box, drumIso } from '../iso-shapes';
import { PIPE, valveWheelIso } from '../pipe-ports';

/** A point of a path: local tile x, y and height z (levels). */
export type P3 = readonly [number, number, number];

/**
 * The run's measures (tiles; heights in levels): its axis and radius (the ports' stub's), the
 * flanges' radius and half-thickness, the stub's mouth (a line's end stops there, from the edge),
 * the elbows' bend radius (an elbow's ends are at the mouth from each edge), the saddle's parts, the
 * frames' head room, how far the fill runs past a cut.
 */
export const RUN = {
  z: PIPE.zc, r: PIPE.r, flange: PIPE.flange, fh: 0.022, mouth: PIPE.tOut, bend: 0.5 - PIPE.tOut,
  plate: 0.17, web: 0.045, cradle: 0.145, head: 1.05,
} as const;
let EXT = 0.05;
/** The shadow's contact pass draws the tubes this much wider (`drawPipeShadow`); 1 otherwise. */
let widen = 1;
/** A shadow's fill runs this far past a cut: every tile's shadow is cut to the same tile shifted along the light, which a run's must fill. */
const SHADOW_EXT = 0.4;
/** How much wider than the tube its contact shadow under it is. */
const CONTACT = 1.7;

/** The tube's steel, its shade, the flanges' pale steel, the saddles' dark steel, the glass's water. */
const STEEL = C.steelL, SHADE = mix(C.steelL, C.ink, 0.36), FLANGE = mix(C.steelL, '#ffffff', 0.18), DARK = C.steelD;
const GLASS = C.deep, GLASS_D = C.deepD;
/** The light, in world tile terms (from −x, a little −y, above), and the way to the camera. */
const L3 = norm([-0.85, -0.3, 1]);
const V3 = norm([1, 1, 1]);

function norm(v: readonly [number, number, number]): [number, number, number] {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** A local direction (dx, dy) as the frame turns it (rotated tile terms). */
function turn(f: IsoFrame, dx: number, dy: number): [number, number] {
  const [ax, ay] = f.r(0, 0), [bx, by] = f.r(dx, dy);
  return [bx - ax, by - ay];
}

interface TubeOpts {
  r?: number;
  col?: string;
  shade?: string;
  /** Run the fill past the first / last point (a cut that meets the next tile's tube). */
  ext0?: boolean;
  ext1?: boolean;
  /** No silhouettes (a strap's band lies over a tube already inked). */
  bare?: boolean;
  /** A fixed axis across the tube (local, horizontal): for a path that bends in a vertical plane. */
  across?: readonly [number, number, number];
  /** The highlight's strength (0: none). */
  glint?: number;
  seed?: number;
}

/**
 * A tube of radius r (tiles) swept along `path` (local x, y, z levels): filled hull by hull, its
 * core shadow and highlight where the camera sees them, its two silhouettes inked — never its ends.
 */
export function tube(ctx: Ctx, f: IsoFrame, path: readonly P3[], o: TubeOpts = {}): void {
  const r = (o.r ?? RUN.r) * widen, K = 36;
  const pts = path.map(([x, y, z]) => [x, y, z / 2] as [number, number, number]); // z in tiles
  const n = pts.length;
  if (n < 2) return;
  const tan = (i: number): [number, number, number] => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(n - 1, i + 1)]!;
    return norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  };
  // The samples: the path, and a hair past each cut that meets another tube.
  const samples: Array<{ c: [number, number, number]; u: [number, number, number]; real: boolean }> = pts.map((c, i) => ({ c, u: tan(i), real: true }));
  if (o.ext0) { const u = samples[0]!.u, c = samples[0]!.c; samples.unshift({ c: [c[0] - u[0] * EXT, c[1] - u[1] * EXT, c[2] - u[2] * EXT], u, real: false }); }
  if (o.ext1) { const u = samples[samples.length - 1]!.u, c = samples[samples.length - 1]!.c; samples.push({ c: [c[0] + u[0] * EXT, c[1] + u[1] * EXT, c[2] + u[2] * EXT], u, real: false }); }
  // Each sample's disc: its points on screen, and per angle whether the camera sees it and how lit it is.
  const discs = samples.map(({ c, u }) => {
    let e1: [number, number, number];
    if (o.across) e1 = norm(o.across as [number, number, number]);
    else { const h = Math.hypot(u[0], u[1]) || 1; e1 = [-u[1] / h, u[0] / h, 0]; }
    const e2: [number, number, number] = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    const [w1x, w1y] = turn(f, e1[0], e1[1]), [w2x, w2y] = turn(f, e2[0], e2[1]);
    const p: Pt[] = [], vis: boolean[] = [], lit: number[] = [];
    for (let k = 0; k < K; k++) {
      const a = (k / K) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const x = c[0] + (e1[0] * ca + e2[0] * sa) * r, y = c[1] + (e1[1] * ca + e2[1] * sa) * r, z = c[2] + (e1[2] * ca + e2[2] * sa) * r;
      p.push(f.p(x, y, z * 2));
      const N: [number, number, number] = [w1x * ca + w2x * sa, w1y * ca + w2y * sa, e1[2] * ca + e2[2] * sa];
      vis.push(N[0] * V3[0] + N[1] * V3[1] + N[2] * V3[2] > -0.02);
      lit.push(N[0] * L3[0] + N[1] * L3[1] + N[2] * L3[2]);
    }
    return { p, vis, lit };
  });
  const col = o.col ?? STEEL, shade = o.shade ?? SHADE;
  // The body, hull by hull.
  for (let i = 0; i + 1 < discs.length; i++) flat(ctx, hull([...discs[i]!.p, ...discs[i + 1]!.p]), col);
  // The core shadow: the seen angles the light does not reach, as one band between each pair of discs.
  for (let i = 0; i + 1 < discs.length; i++) {
    const A = discs[i]!, B = discs[i + 1]!;
    const dark = (k: number): boolean => A.vis[k]! && A.lit[k]! < 0.08;
    let start = -1;
    for (let k = 0; k < K; k++) if (dark(k) && !dark((k + K - 1) % K)) { start = k; break; }
    if (start < 0) continue;
    const run: number[] = [];
    for (let j = 0; j < K && dark((start + j) % K); j++) run.push((start + j) % K);
    if (run.length < 2) continue;
    flat(ctx, [...run.map((k) => A.p[k]!), ...run.slice().reverse().map((k) => B.p[k]!)], shade);
  }
  // The highlight: along the brightest angle the camera sees.
  if ((o.glint ?? 1) > 0) {
    const line: Pt[] = discs.map((d) => {
      let best = -1, bl = -Infinity;
      for (let k = 0; k < K; k++) if (d.vis[k] && d.lit[k]! > bl) { bl = d.lit[k]!; best = k; }
      return d.p[Math.max(0, best)]!;
    });
    ink(ctx, line, { w: Math.max(1.4, r * 17), color: '#ffffff', alpha: 0.55 * (o.glint ?? 1), shade: false, taper: 0, jitter: 0, seed: (o.seed ?? 1) + 7 });
  }
  if (o.bare) return;
  // The silhouettes: each hull's two bridge edges (from one disc to the next), never the ends.
  const sideA: Pt[] = [], sideB: Pt[] = [];
  for (let i = 0; i + 1 < discs.length; i++) {
    if (!samples[i]!.real || !samples[i + 1]!.real) continue;
    const A = new Set(discs[i]!.p), H = hull([...discs[i]!.p, ...discs[i + 1]!.p]);
    for (let j = 0; j < H.length; j++) {
      const a = H[j]!, b = H[(j + 1) % H.length]!;
      const ia = A.has(a), ib = A.has(b);
      if (ia && !ib) sideA.push(a, b);
      else if (!ia && ib) sideB.push(b, a);
    }
  }
  const lowY = (s: Pt[]): number => s.reduce((m, p) => m + p[1], 0) / Math.max(1, s.length);
  const lower = lowY(sideA) > lowY(sideB);
  if (sideA.length > 1) ink(ctx, sideA, { w: lower ? 2.1 : 1.6, shade: false, taper: 0, jitter: 0, seed: (o.seed ?? 1) + 1 });
  if (sideB.length > 1) ink(ctx, sideB, { w: lower ? 1.6 : 2.1, shade: false, taper: 0, jitter: 0, seed: (o.seed ?? 1) + 2 });
}

/** Points along a straight from a to b (local, levels), `n` steps. */
function line(a: P3, b: P3, n = 2): P3[] {
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, a[2] + ((b[2] - a[2]) * i) / n] as P3);
}

/**
 * A ring round the tube at point c, its way (dx, dy) local (a saddle's strap, a tee's collar): the
 * half the camera sees, a dark steel line a little proud of the tube.
 */
function ring(ctx: Ctx, f: IsoFrame, c: P3, dx: number, dy: number, seed: number, k = 1.06, w = 2.6): void {
  const h = Math.hypot(dx, dy) || 1, e1: [number, number] = [-dy / h, dx / h];
  const [wx, wy] = turn(f, e1[0], e1[1]), r = RUN.r * k;
  // Seen where the normal (e1 cos a + up sin a, turned) looks at the camera: from the angle facing
  // most away round to it again, the seen run is one piece.
  const seen = (a: number): number => (wx + wy) * Math.cos(a) * V3[0] + Math.sin(a) * V3[2];
  const a0 = Math.atan2(-V3[2], -(wx + wy) * V3[0]);
  const pts: Pt[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = a0 + (i / 48) * Math.PI * 2;
    if (seen(a) < -0.05) continue;
    pts.push(f.p(c[0] + e1[0] * Math.cos(a) * r, c[1] + e1[1] * Math.cos(a) * r, c[2] + Math.sin(a) * r * 2));
  }
  // The seen half, as one stroke from one silhouette to the other.
  if (pts.length > 1) ink(ctx, pts, { w, color: DARK, shade: false, taper: 0, jitter: 0, seed });
}

/** The unit way (local) from the tile's middle to edge `side` (0 N, 1 E, 2 S, 3 W). */
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
/** The middle of edge `side`, and the point `t` in from it, at the axis's height. */
const edgeAt = (side: number, t = 0, z: number = RUN.z): P3 => [0.5 + DX[side]! * (0.5 - t), 0.5 + DY[side]! * (0.5 - t), z];
/** Is edge `side` towards the camera (its way has a +x or +y part)? */
const nearSide = (side: number): boolean => side === 1 || side === 2;

/**
 * A flange across a straight run at point c (local, the axis's height), its way along local x or y:
 * a short pale drum, its face the camera sees bolted in brass.
 */
export function flangeIso(ctx: Ctx, f: IsoFrame, c: P3, axis: 'x' | 'y', seed: number, r: number = RUN.flange): void {
  drumIso(ctx, f, c[0], c[1], c[2], r, RUN.fh, axis, FLANGE, seed, { hub: false, shadow: false });
  const [ux, uy] = axis === 'x' ? [1, 0] : [0, 1];
  const near = f.depth(c[0] + ux, c[1] + uy) >= f.depth(c[0] - ux, c[1] - uy) ? 1 : -1;
  const fx = c[0] + ux * RUN.fh * near, fy = c[1] + uy * RUN.fh * near;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2, h = Math.cos(a) * r * 0.78, v = Math.sin(a) * r * 0.78 * 2;
    const p = axis === 'x' ? f.p(fx, fy + h, c[2] + v) : f.p(fx + h, fy, c[2] + v);
    rivet(ctx, p[0], p[1], 1.6, C.brassL);
  }
}

/** A bolted joint: two flanges either side of point c, a dark gasket between. */
function jointIso(ctx: Ctx, f: IsoFrame, c: P3, axis: 'x' | 'y', seed: number): void {
  const [ux, uy] = axis === 'x' ? [1, 0] : [0, 1];
  const d = RUN.fh * 1.25;
  const far: P3 = [c[0] - ux * d, c[1] - uy * d, c[2]], nearP: P3 = [c[0] + ux * d, c[1] + uy * d, c[2]];
  flangeIso(ctx, f, far, axis, seed);
  flangeIso(ctx, f, nearP, axis, seed + 3);
}

/**
 * A saddle under the tube at point c (local), the run along `axis` ('d': a bend's diagonal — a
 * square pedestal): a base plate on the ground, a web up to just under the tube, a cradle whose
 * ends show either side of it. Drawn before the tube.
 */
function saddle(ctx: Ctx, f: IsoFrame, c: P3, axis: 'x' | 'y' | 'd', seed: number): void {
  const z0 = c[2] - RUN.z, bottom = c[2] - RUN.r * 2; // the ground under it, the tube's underside (levels)
  const along = (a: number, b: number, z1: number, z2: number, col: string, s: number): void => {
    // A box `a` along the run, `b` across it.
    const [hx, hy] = axis === 'x' ? [a, b] : axis === 'y' ? [b, a] : [Math.max(a, b) * 0.75, Math.max(a, b) * 0.75];
    box(ctx, f, c[0] - hx, c[1] - hy, c[0] + hx, c[1] + hy, z1, z2, col, seed + s, { outline: 1.4, shadow: false });
  };
  along(0.06, RUN.plate, z0, z0 + 0.06, DARK, 1);
  along(0.03, RUN.web, z0 + 0.06, bottom + 0.06, mix(DARK, C.steel, 0.4), 2);
  along(0.045, RUN.cradle, bottom - 0.04, c[2] - RUN.r * 0.7, DARK, 3);
}

/** A straight across the tile along `axis`, from edge `a` to edge `b` (a: the far one), its ends cut or flanged. */
function straight(ctx: Ctx, f: IsoFrame, axis: 'x' | 'y', fullA: boolean, fullB: boolean, mark: '' | 'j' | 'g', seed: number): void {
  const sa = axis === 'x' ? 3 : 0, sb = axis === 'x' ? 1 : 2; // the far edge (W, N) and the near one (E, S)
  const A = edgeAt(sa, fullA ? 0 : RUN.mouth), B = edgeAt(sb, fullB ? 0 : RUN.mouth);
  const at = (t: number): P3 => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, RUN.z];
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const mid: P3 = [0.5, 0.5, RUN.z];
  saddle(ctx, f, mid, axis, seed + 40);
  if (!fullA) flangeIso(ctx, f, at(RUN.fh / len), axis, seed + 10); // just inside the mouth: the stub's own flange is outside it
  if (mark === 'j') {
    // The joint just inside the far edge.
    const tj = 0.085 / len;
    tube(ctx, f, line(A, at(tj - 0.05 / len)), { ext0: fullA, seed });
    jointIso(ctx, f, at(tj), axis, seed + 20);
    tube(ctx, f, line(at(tj + 0.05 / len), B, 6), { ext1: fullB, seed: seed + 1 });
  } else if (mark === 'g') {
    // The sight-glass on the near half: the water's teal in a glazed band, a collar either side.
    const g0 = 0.6, g1 = 0.84;
    tube(ctx, f, line(A, at(g0), 6), { ext0: fullA, seed });
    drumIso(ctx, f, ...at(g0 + 0.01), RUN.r * 1.13, 0.014, axis, C.steel, seed + 30, { hub: false, shadow: false });
    tube(ctx, f, line(at(g0 + 0.02), at(g1 - 0.02)), { r: RUN.r * 1.02, col: GLASS, shade: GLASS_D, glint: 1.4, seed: seed + 31 });
    drumIso(ctx, f, ...at(g1 - 0.01), RUN.r * 1.13, 0.014, axis, C.steel, seed + 32, { hub: false, shadow: false });
    tube(ctx, f, line(at(g1), B), { ext1: fullB, seed: seed + 2 });
  } else tube(ctx, f, line(A, B, 6), { ext0: fullA, ext1: fullB, seed });
  ring(ctx, f, mid, axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, seed + 50);
  if (!fullB) flangeIso(ctx, f, at(1 - RUN.fh / len), axis, seed + 11);
}

/**
 * An elbow between edges a and b (adjacent): a straight from each full edge to the mouth, a
 * flange there, the long-radius bend between (`RUN.bend` about the tile's middle's corner); a short
 * edge ends at the bend's flange. Drawn far to near: the parts on the far edges' side first.
 */
function elbow(ctx: Ctx, f: IsoFrame, a: number, b: number, fullA: boolean, fullB: boolean, seed: number): void {
  const R = RUN.bend;
  // The bend's centre: from the tile's middle, R towards both edges.
  const cx = 0.5 + (DX[a]! + DX[b]!) * R, cy = 0.5 + (DY[a]! + DY[b]!) * R;
  const pa = edgeAt(a, RUN.mouth), pb = edgeAt(b, RUN.mouth);
  const a0 = Math.atan2(pa[1] - cy, pa[0] - cx), a1 = Math.atan2(pb[1] - cy, pb[0] - cx);
  let da = a1 - a0;
  if (da > Math.PI) da -= Math.PI * 2;
  if (da < -Math.PI) da += Math.PI * 2;
  const arc: P3[] = Array.from({ length: 13 }, (_, i) => { const t = a0 + (da * i) / 12; return [cx + Math.cos(t) * R, cy + Math.sin(t) * R, RUN.z] as P3; });
  const axisOf = (s: number): 'x' | 'y' => (s === 1 || s === 3 ? 'x' : 'y');
  // Each end: a joint where a straight bit runs on to the edge, else the flange just inside the mouth.
  const end = (s: number, full: boolean, p: P3, k: number): { far: boolean; draw: () => void; flange: () => void } => ({
    far: !nearSide(s),
    draw: () => { if (full) tube(ctx, f, line(edgeAt(s, 0), p), { ext0: true, seed: seed + k }); },
    flange: () => (full ? jointIso(ctx, f, p, axisOf(s), seed + 10 + k) : flangeIso(ctx, f, edgeAt(s, RUN.mouth + RUN.fh), axisOf(s), seed + 10 + k)),
  });
  const ea = end(a, fullA, pa, 1), eb = end(b, fullB, pb, 2);
  const m = arc[6]!;
  saddle(ctx, f, [m[0], m[1], RUN.z], 'd', seed + 40);
  const ends = [ea, eb];
  for (const e of ends) if (e.far) { e.draw(); e.flange(); }
  tube(ctx, f, arc, { seed });
  for (const e of ends) if (!e.far) { e.flange(); e.draw(); }
}

/** A tee's branch from the main tube to edge `side` (to the mouth, flanged, when short), a collar at its root. */
function branch(ctx: Ctx, f: IsoFrame, side: number, full: boolean, seed: number): void {
  const axis = side === 1 || side === 3 ? 'x' : 'y';
  const root = edgeAt(side, 0.5 - RUN.r * 0.6), out = edgeAt(side, full ? 0 : RUN.mouth);
  const collar = edgeAt(side, 0.5 - RUN.r * 1.1);
  const near = nearSide(side);
  if (!near && !full) flangeIso(ctx, f, edgeAt(side, RUN.mouth + RUN.fh), axis, seed + 10);
  tube(ctx, f, near ? line(root, out, 4) : line(out, root, 4), near ? { ext1: full, seed } : { ext0: full, seed });
  ring(ctx, f, collar, DX[side]!, DY[side]!, seed + 20, 1.14, 3);
  if (near && !full) flangeIso(ctx, f, edgeAt(side, RUN.mouth + RUN.fh), axis, seed + 11);
}

/**
 * What a tile's pipe is (world/water-ports.ts `pipeOf`): each edge's state — '0' nothing, '1' the
 * tube runs to the edge (another tube meets it there), '2' it stops at the stub's mouth with a
 * flange (a port, or a line's open end) — for N, E, S, W; a straight's mark (a joint, a sight-glass).
 */
export type PipeMark = '' | 'j' | 'g';

/** The main pieces the atlas bakes: every straight and elbow with each end full or short, the marks on a full straight. */
export const PIPE_PIECES: ReadonlyArray<{ arms: string; mark: PipeMark }> = (() => {
  const out: Array<{ arms: string; mark: PipeMark }> = [];
  const pairs: Array<[number, number]> = [[1, 3], [0, 2], [0, 1], [1, 2], [2, 3], [3, 0]];
  for (const [a, b] of pairs) for (const sa of ['1', '2']) for (const sb of ['1', '2']) {
    const arms = ['0', '0', '0', '0'];
    arms[a] = sa; arms[b] = sb;
    out.push({ arms: arms.join(''), mark: '' });
  }
  for (const arms of ['0101', '1010']) for (const mark of ['j', 'g'] as const) out.push({ arms, mark });
  return out;
})();
/** The tee branches the atlas bakes: a side, full or short. */
export const PIPE_BRANCHES: ReadonlyArray<{ side: number; full: boolean }> = [0, 1, 2, 3].flatMap((side) => [{ side, full: true }, { side, full: false }]);

/** The frame a pipe piece is drawn on (a tile, at the tile's top). */
export const pipeFrame = (): IsoFrame => new IsoFrame(1, 1, 0, RUN.head);

/** Draw a main piece (`arms`: N E S W states; `mark` on a full straight) into frame `f`. */
export function drawPipe(ctx: Ctx, f: IsoFrame, arms: string, mark: PipeMark = '', seed = 71): void {
  const on = [0, 1, 2, 3].filter((s) => arms[s] !== '0');
  if (on.length !== 2) return;
  const [a, b] = on as [number, number];
  const full = (s: number): boolean => arms[s] === '1';
  if (b - a === 2) straight(ctx, f, a === 1 || b === 3 ? 'x' : 'y', full(a === 1 ? 3 : 0), full(a === 1 ? 1 : 2), mark, seed);
  else elbow(ctx, f, a, b, full(a), full(b), seed);
}

/** Draw a tee's branch into frame `f`. */
export function drawPipeBranch(ctx: Ctx, f: IsoFrame, side: number, full: boolean, seed = 83): void {
  branch(ctx, f, side, full, seed);
}

/** The frame a tee's sharing valve is drawn on (D152): a tile, taller than a pipe's (its handwheel stands over the crown). */
export const valveFrame = (): IsoFrame => new IsoFrame(1, 1, 0, 1.5);

/**
 * A tee's sharing valve (D152) into frame `f` (`valveFrame`), over the tee's pieces: a squat pale
 * bonnet on the crown at the tile's middle, bolted, then the stem and the brass handwheel.
 */
export function drawPipeValve(ctx: Ctx, f: IsoFrame, seed = 97): void {
  const top = RUN.z + RUN.r * 2, b = 0.075, h = 0.12;
  box(ctx, f, 0.5 - b, 0.5 - b, 0.5 + b, 0.5 + b, top - 0.06, top + h, { top: FLANGE, left: SHADE, right: mix(FLANGE, C.ink, 0.12) }, seed, { outline: 1.4, shadow: false });
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const p = f.p(0.5 + dx * b * 0.62, 0.5 + dy * b * 0.62, top + h);
    rivet(ctx, p[0], p[1], 1.4, C.brassL);
  }
  valveWheelIso(ctx, f, 0.5, 0.5, top + h, top + h + PIPE.wheelUp * 0.85, C.brass, seed + 5);
}

// ── the pressure gauge (D155) ────────────────────────────────────────────────

/**
 * The dial's measures (bake px, the iso frames' 2× scale): its radius, how far its middle stands over
 * the pipe's crown, the needle's length (× R); its sweep in canvas radians, from the lower left
 * clockwise over the top to the lower right.
 */
export const GAUGE = { R: 26, rise: 40, needle: 0.74, a0: Math.PI * 0.75, sweep: Math.PI * 1.5 } as const;
/** The colour each state shows (its needle, the Logistique view's water lines, the inspector's dial). */
export const PRESSURE_COL: Readonly<Record<PressureState, string>> = {
  ok: mix(C.turq, C.ledGreen, 0.45), tight: C.hazard, low: C.coral, dry: C.coralD, idle: C.steel,
};
/** The scale's arcs: each state's colour from where its range starts on the dial (fractions of the sweep). */
const ARCS: ReadonlyArray<readonly [number, number, string]> = [
  [0, BAL.pressure.tight / PRESSURE_MAX, C.coral],
  [BAL.pressure.tight / PRESSURE_MAX, BAL.pressure.ok / PRESSURE_MAX, C.hazard],
  [BAL.pressure.ok / PRESSURE_MAX, 1, mix(C.turq, C.ledGreen, 0.45)],
];

/** The needle's way for a pressure ‰ (canvas radians, clamped to the dial). */
export function gaugeAngle(pressure: number): number {
  return GAUGE.a0 + GAUGE.sweep * Math.max(0, Math.min(1, pressure / PRESSURE_MAX));
}

/** The frame a gauge is drawn on: a tile, tall enough for its dial over the crown. */
export const gaugeFrame = (): IsoFrame => new IsoFrame(1, 1, 0, 2.4);

/** The dial's middle in frame `f` (bake px): over the tile's middle, `GAUGE.rise` above the pipe's crown. */
export function gaugeCentre(f: IsoFrame): Pt {
  const [x, y] = f.p(0.5, 0.5, RUN.z + RUN.r * 2);
  return [x, y - GAUGE.rise];
}

/**
 * A dial at (cx, cy) of radius R (px) facing the viewer: a soft shadow, the dark steel bezel with its
 * lit rim, the cream face, the scale's arcs (`ARCS`), a tick each eighth of the sweep, inked. No needle.
 */
export function drawDial(ctx: Ctx, cx: number, cy: number, R: number, seed: number, shadow = true): void {
  const ring = (r: number): Pt[] => ellipsePts(cx, cy, r, r, seed, 0, 40);
  if (shadow) flat(ctx, ellipsePts(cx + R * 0.12, cy + R * 0.16, R * 1.06, R * 1.06, seed, 0, 40), C.ink, 0.22);
  flat(ctx, ring(R), C.steelD);
  ink(ctx, ring(R).filter(([x, y]) => x < cx + R * 0.3 && y < cy + R * 0.3).sort((a, b) => a[0] - b[0]), { w: Math.max(1.2, R * 0.07), color: mix(C.steelL, '#ffffff', 0.4), alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: seed + 1 });
  flat(ctx, ring(R * 0.8), mix(C.paper, '#ffffff', 0.35));
  // The scale: a band of each state's colour along the face's edge.
  const band = (f0: number, f1: number, col: string): void => {
    const pts: Pt[] = [], n = 18, r0 = R * 0.56, r1 = R * 0.76;
    for (let i = 0; i <= n; i++) { const a = GAUGE.a0 + GAUGE.sweep * (f0 + ((f1 - f0) * i) / n); pts.push([cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]); }
    for (let i = n; i >= 0; i--) { const a = GAUGE.a0 + GAUGE.sweep * (f0 + ((f1 - f0) * i) / n); pts.push([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0]); }
    flat(ctx, pts, col);
  };
  for (const [f0, f1, col] of ARCS) band(f0, f1, col);
  for (let k = 0; k <= 8; k++) {
    const a = GAUGE.a0 + (GAUGE.sweep * k) / 8, r0 = k % 4 === 0 ? R * 0.42 : R * 0.5;
    ink(ctx, [[cx + Math.cos(a) * r0, cy + Math.sin(a) * r0], [cx + Math.cos(a) * R * 0.77, cy + Math.sin(a) * R * 0.77]], { w: Math.max(1, R * (k % 4 === 0 ? 0.08 : 0.05)), shade: false, taper: 0, jitter: 0, seed: seed + 3 + k });
  }
  ink(ctx, ring(R * 0.8), { closed: true, w: Math.max(1, R * 0.05), color: C.steelD, shade: false, taper: 0, jitter: 0, seed: seed + 14 });
  ink(ctx, ring(R), { closed: true, w: Math.max(1.4, R * 0.09), shade: false, taper: 0, jitter: 0, seed: seed + 15 });
}

/**
 * A pressure gauge on the tile's crown in frame `f` (`gaugeFrame`): a squat bonnet bolted on the pipe, a
 * dark stem up to the dial, the dial (`drawDial`) at `gaugeCentre`. Its needle is the view's own sprite.
 */
export function drawPipeGauge(ctx: Ctx, f: IsoFrame, seed = 101): void {
  const top = RUN.z + RUN.r * 2, b = 0.07;
  box(ctx, f, 0.5 - b, 0.5 - b, 0.5 + b, 0.5 + b, top - 0.06, top + 0.08, { top: FLANGE, left: SHADE, right: mix(FLANGE, C.ink, 0.12) }, seed, { outline: 1.4, shadow: false });
  const foot = f.p(0.5, 0.5, top + 0.08), [cx, cy] = gaugeCentre(f);
  ink(ctx, [foot, [cx, cy + GAUGE.R * 0.9]], { w: 5.2, color: C.ink, shade: false, taper: 0, jitter: 0, seed: seed + 1 });
  ink(ctx, [foot, [cx, cy + GAUGE.R * 0.9]], { w: 2.8, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: seed + 2 });
  rivet(ctx, foot[0], foot[1], 2, C.brassL);
  drawDial(ctx, cx, cy, GAUGE.R, seed + 5);
}

/** A needle pointing up from (cx, cy), `R` its dial's radius: a tapered blade in `col`, inked, a counterweight tail, a brass hub. */
export function drawGaugeNeedle(ctx: Ctx, cx: number, cy: number, R: number, col: string, seed = 7): void {
  const L = R * GAUGE.needle, w = R * 0.11;
  const blade: Pt[] = [[cx, cy - L], [cx + w, cy], [cx + w * 0.7, cy + R * 0.2], [cx - w * 0.7, cy + R * 0.2], [cx - w, cy]];
  flat(ctx, blade, col);
  ink(ctx, [...blade, blade[0]!], { w: Math.max(1, R * 0.05), shade: false, taper: 0, jitter: 0, seed });
  const hub = ellipsePts(cx, cy, R * 0.13, R * 0.13, seed, 0, 20);
  flat(ctx, hub, C.brass);
  ink(ctx, hub, { closed: true, w: Math.max(1, R * 0.05), shade: false, taper: 0, jitter: 0, seed: seed + 1 });
  rivet(ctx, cx, cy, Math.max(1, R * 0.05), C.brassL);
}

/** A piece's shadow frame: the reference light's lay (world/cast-shadows.ts `SHADOW_DX`, `SHADOW_DY`). */
export const pipeShadowFrame = (dx: number, dy: number): ShadowFrame => new ShadowFrame(1, 1, 0, RUN.head, dx, dy);

/**
 * A piece's cast shadow (main or branch: `draw` paints it into the frame it is given), laid on the
 * ground along the reference light into `ctx` (a silhouette context), cut to the tile shifted by the
 * axis's own lay — so the shadows of a run's tiles meet edge to edge, never doubling.
 */
export function drawPipeShadow(ctx: Ctx, f: ShadowFrame, draw: (ctx: Ctx, f: IsoFrame) => void): void {
  // Both passes cut to the tile shifted along the light by the axis's lay: a run's tiles' shadows
  // then meet edge to edge, never doubling (the layer's sprites darken where they overlap).
  const c = f.dx * RUN.z, d = f.dy * RUN.z;
  const q = [f.p(c, d, 0), f.p(1 + c, d, 0), f.p(1 + c, 1 + d, 0), f.p(c, 1 + d, 0)];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(q[0]![0], q[0]![1]);
  for (const p of q) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.clip();
  const pass = (g: IsoFrame, k: number): void => {
    widen = k; EXT = SHADOW_EXT;
    try { draw(ctx, g); } finally { widen = 1; EXT = 0.05; }
  };
  // Cast along the light (a low tube's falls mostly under it, seen from the camera)…
  pass(f, 1);
  // …and the contact shade on the ground right under it, wider than the tube: what shows below it.
  pass(new ShadowFrame(1, 1, 0, RUN.head, 0, 0), CONTACT);
  ctx.restore();
}
