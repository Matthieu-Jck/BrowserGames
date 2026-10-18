// rock.ts — inks one rock column (a tile of relief) as a stack of terrace slabs, in the manner of
// Moebius's desert mesas (owner, 2026-10-16: « les montagnes ne sont pas très belles, il faut faire
// mieux »: the cliffs read like crates). One painter serves the relief sprites (iso, full detail)
// and the terrain worker (oblique projection into the ground texture, lighter detail), so far and
// near zooms agree: the same seed gives the same shape at every detail (`columnSeed`).
// · The rock is layered, not boxed. Its strata are one table of beds by absolute height (`BEDS`),
//   the same under every tile, so a bed runs on from tile to tile at its height and a cliff of many
//   tiles reads as one face; a slab whose wall carries on the wall below draws no crease between
//   them. Each bed has its own tone (flat fills, no gradient), the colours deepen with height and
//   the shaded faces lean violet (Moebius's cool shadows).
// · The hardness (H1–H4, which the excavator's research reads) shows in the texture as much as in
//   the colour: soft sandstone shows every thin bed, cross-bedding and weathering pits; the red-bed
//   thicker beds broken by joints; the sienna rock massive beds split by long vertical fractures;
//   the heartrock dark plum, faceted, its veins glowing.
// · A lip open to the sky has a caprock over a shadowed overhang, a jittered rim with rounded
//   corners and now and then a notch with its gully down the face: the outline breaks the tile grid
//   while the tops stay exactly where the rules put them (the jitter only ever bites inwards, and
//   is nil where a tile meets the next, so the rim runs on across tiles). Desert varnish streaks,
//   grooves, fallen-block scars and hatching in the shade vary the face along a wall.
// · Tops carry slabs, cracks, sand pockets, pebbles and boulders, paler and cooler higher up
//   (aerial perspective); a top at the foot of a higher neighbour's wall gets its talus.
// A column of water up on the rock (the Crown's tarn, D63) is the rock round it with the water for
// its top (`ColumnOpts.top`): each tile draws its part of the pool, cut by marching squares over its
// corners so the shore runs on from tile to tile, inked like the floor's water, deep at its heart;
// reclaimed ground is fill. A column whose rock holds a face ore (D87: quartz set in the cliff,
// `ColumnOpts.vein`) wears it: a milky seam across its camera-facing walls with clusters of rock
// crystal erupting from it, and a few points poking up along the lip of its top (`crystal`, the
// one crystal drawing the plan's seam and the machines share).
// Worker-safe (Canvas2D only).
import { hash32, hashUnit } from '@/core/hash';
import { facesCamera, MAX_LEVEL, MOUNTAIN_TERRACE, slabOutline, shadeOf, STEP_LEVELS, type OutlinePt } from '../relief';
import { C, mix, rgba } from './tokens';
import { ink, type Ctx, type Pt } from './ink';

/** Projection of a column-local point (u, v ∈ [0, 1], z in levels) to canvas px. */
export type Proj = (u: number, v: number, z: number) => Pt;

// ── palette ─────────────────────────────────────────────────────────────────────────────────────

export interface RockLook {
  /** A terrace top at the foot of the range (paler and cooler higher up: `topColor`). */
  readonly top: string;
  /** The wall turned to the light (the +y face) and the one turned from it (+x), low down (deeper higher up: `wallColor`). */
  readonly lit: string;
  readonly dark: string;
  /** Strata, joints and cracks. */
  readonly line: string;
  /** The lit lip, caprock and ledges. */
  readonly rim: string;
  /** The finest bed it shows (`BEDS` rank): soft rock every thin bed, hard rock only the thick ones. */
  readonly minRank: 0 | 1 | 2;
  /** Its caprock's thickness (levels). */
  readonly cap: number;
}
/** Index 0..3 = hardness H1..H4: one warm desert family, deeper and redder as the rock hardens (the Crown's ochres and terracottas below, plum heartrock at the far crests). */
export const ROCK: readonly RockLook[] = [
  { top: '#f1d0a6', lit: '#e8a97f', dark: '#ad6b5d', line: '#8b4b3c', rim: '#fff0da', minRank: 0, cap: 0.16 }, // H1 soft sandstone: pale ochre, thin beds
  { top: '#e8b993', lit: '#da916a', dark: '#975762', line: '#733a34', rim: '#fbe1ca', minRank: 1, cap: 0.22 }, // H2 red-bed: terracotta, blocky beds
  { top: '#d6a58c', lit: '#c57a62', dark: '#7a475e', line: '#582c37', rim: '#f4d6c7', minRank: 2, cap: 0.26 }, // H3 sienna: massive, columnar fractures
  { top: '#a9858f', lit: '#9c6169', dark: '#55314f', line: '#371c33', rim: '#e5c7cf', minRank: 2, cap: 0.3 }, // H4 heartrock: plum umber, glowing veins
];
/** What the tops pale towards with height: a cool, pale haze (aerial perspective, never another material). */
const HAZE = '#eee8ea';
/** What the walls deepen towards with height: the lit face redder, the shaded one a deep violet umber. */
const DEEP_LIT = '#b0544a', DEEP_DARK = '#4a2747';
/** A sand pocket's sand (the plan's too: terrain.ts). */
export const SAND_POCKET = '#f5e2c3';

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** A terrace top's colour: its hardness, paler and cooler a step higher (clearly enough that the plan view, which sees only tops, tells the levels apart: owner, 2026-10-14). */
export const topColor = (cls: number, level: number): string => mix(ROCK[cls]!.top, HAZE, Math.min(0.32, Math.max(0, (level - 2) * 0.045)));

/**
 * A wall's colour: its hardness, by how it faces the light (`shade`: 0 lit … 1 shaded), deeper
 * with its height `z` (levels; richer high up), and a bed's `tone` (−1 … 1: a darker or a paler bed).
 */
export function wallColor(cls: number, shade: number, z = 0, tone = 0): string {
  const r = ROCK[cls]!, h = clamp01(z / (MOUNTAIN_TERRACE * STEP_LEVELS));
  const c = mix(mix(r.lit, DEEP_LIT, h * 0.24), mix(r.dark, DEEP_DARK, h * 0.22), shade);
  return tone > 0 ? mix(c, r.rim, tone * 0.22 * (1 - shade * 0.45)) : tone < 0 ? mix(c, r.line, -tone * 0.2) : c;
}

// ── the strata ──────────────────────────────────────────────────────────────────────────────────

/** A bedding plane: its height (levels above the floor), its rank (0 a thin bed, 1 a bed, 2 a thick one's base), the tone of the bed above it. */
export interface Bed { readonly z: number; readonly rank: 0 | 1 | 2; readonly tone: number }

/**
 * The strata, one table by absolute height for every column: a bed carries on from a tile to the
 * next at its height, whatever the tiles' looks. Thin beds of uneven thickness, a bed every half a
 * level or so, a thick bed's base every one to two levels; each thick bed paler or darker than the
 * last, its thin beds varying round that.
 */
export const BEDS: readonly Bed[] = (() => {
  const out: Bed[] = [];
  let z = 0, sinceMajor = 0, sinceMid = 0, nextMajor = 0.8, nextMid = 0.45, base = -0.3;
  for (let i = 0; z < MAX_LEVEL + 1; i++) {
    const h = (n: number): number => hashUnit(0xbed5, i, n);
    const step = 0.16 + h(1) * 0.3;
    z += step; sinceMajor += step; sinceMid += step;
    let rank: 0 | 1 | 2 = 0;
    if (sinceMajor >= nextMajor) {
      rank = 2;
      sinceMajor = sinceMid = 0;
      nextMajor = 0.9 + h(2) * 1.1;
      nextMid = 0.38 + h(3) * 0.35;
      base = (base > 0 ? -1 : 1) * (0.35 + h(4) * 0.65);
    } else if (sinceMid >= nextMid) {
      rank = 1;
      sinceMid = 0;
      nextMid = 0.38 + h(3) * 0.35;
    }
    out.push({ z, rank, tone: Math.max(-1, Math.min(1, base + (h(5) - 0.5) * 0.55)) });
  }
  return out;
})();
/** The tone of the bed at the floor, under the first plane. */
const BED0 = -0.35;

/** The beds a class shows at a detail (the far paint only the thicker ones). */
const rankOf = (cls: number, detail: number): number => Math.max(ROCK[cls]!.minRank, detail === 0 ? 2 : detail === 1 ? 1 : 0);

/** Indices of the planes of rank ≥ `rank` strictly inside (z0, z1). */
function bedsIn(rank: number, z0: number, z1: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < BEDS.length; i++) {
    const b = BEDS[i]!;
    if (b.z >= z1 - 0.04) break;
    if (b.z > z0 + 0.04 && b.rank >= rank) out.push(i);
  }
  return out;
}

/** The tone of the bed at height z, for planes of rank ≥ `rank`. */
function toneAt(rank: number, z: number): number {
  let t = BED0;
  for (const b of BEDS) {
    if (b.z > z) break;
    if (b.rank >= rank) t = b.tone;
  }
  return t;
}

// ── a column's identity ─────────────────────────────────────────────────────────────────────────

/**
 * Where a higher neighbour's wall rises from a column's top (`drawFoot`): along its north side
 * (v = 0) from u = n[0] to n[1], along its west side (u = 0) from v = w[0] to w[1] — the
 * neighbour's own outline there (its chamfers take the wall off the edge), so the talus lies at the
 * very foot of the wall. The sides facing away from the camera are never seen: no talus there.
 */
export interface Foot { readonly n: readonly [number, number] | null; readonly w: readonly [number, number] | null }

/** A foot's key, for the sprite atlas. */
export const footKey = (f: Foot): string => {
  const r = (x: readonly [number, number] | null): string => (x ? `${x[0].toFixed(2)}-${x[1].toFixed(2)}` : '');
  return `${r(f.n)}.${r(f.w)}`;
};

/**
 * Which look a column takes (one of two), hashed from the world tile: the same for the sprites and
 * the far paint. (Three for a plateau's inner tiles cost a quarter more atlas for little: their
 * marks are few and kept off the tile's edges.)
 */
export const columnVariant = (x: number, y: number): number => hash32(x, y, 0x77) & 1;

/** The seed of a column's marks and shape, from what its sprite's key holds: sprites and paint draw the same rim. */
export const columnSeed = (cls: number, masks: readonly number[], variant: number): number =>
  hash32(cls, masks.length * STEP_LEVELS, masks[masks.length - 1] ?? 0, variant + 0x51);

/**
 * The top of a column up on the rock that is water, a stream, reclaimed ground, or rock beside
 * water at its height (D63: the Crown's tarn; D94: a stream up on a massif): `kind`, what the tile
 * itself is; `wet` and `deep`, which tiles of its 3×3 (bit 3·(dy + 1) + dx + 1, the tile itself
 * bit 4) hold water / deep water at its height; `run`, some of that water runs (a stream's colour);
 * a stream's `flow` (the eighth of a turn it runs to, 0 = +x, 2 = +y), `fall` (relief levels
 * down to the next tile along it: its waterfall) and `from` (which tiles of its 3×3 pour into it
 * from higher up: the falls it takes, whose water lands on it — its side there is no bank).
 */
export interface TopLook {
  readonly kind: 'water' | 'ground' | 'rock' | 'river';
  readonly wet: number;
  readonly deep: number;
  readonly run?: boolean;
  readonly flow?: number;
  readonly fall?: number;
  readonly from?: number;
}

/** A top look's key, for the sprite atlas. */
export const topKey = (t: TopLook | null | undefined): string =>
  (t ? `${t.kind[0]}${t.wet}.${t.deep}${t.run ? 'r' : ''}${t.kind === 'river' ? `.${t.flow ?? 0}.${t.fall ?? 0}.${t.from ?? 0}` : ''}` : '');

export interface ColumnOpts {
  /** 0 = flat (far terrain), 1 = light (terrain worker), 2 = full (sprites). */
  detail: 0 | 1 | 2;
  /** Seed for the column's shape and marks (`columnSeed`). */
  seed: number;
  /** Line width unit (px per 1 at sprite scale). */
  k: number;
  /** Its top, when it is not rock (water up on the rock, ground reclaimed from it). */
  top?: TopLook | null;
  /** Its rock holds a face ore (D87: quartz in the cliff): a crystal seam on its walls, points on its lip. */
  vein?: boolean;
  /** The rock of each step (terrain.ts `layersOf`: the hardness of the land at its height; default its own `cls` throughout). */
  layers?: readonly number[] | null;
  /** Only these slabs (first, last; default all): a column whose lower terrace shows in front of the upper one is drawn in parts, each shaded by the sun at its own height (world/relief-view.ts). */
  slabs?: readonly [number, number];
}

function poly(ctx: Ctx, pts: readonly Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.closePath();
}

function fillPoly(ctx: Ctx, pts: readonly Pt[], color: string): void {
  if (pts.length < 3) return;
  ctx.fillStyle = color;
  poly(ctx, pts);
  ctx.fill();
}

function line(ctx: Ctx, pts: readonly Pt[], color: string, w: number, alpha = 1): void {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha *= alpha;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.stroke();
  ctx.restore();
}

/**
 * Cast shadow of a column on the ground: its footprint swept by (sx, sy) tiles along the light (by
 * default a short fall along +x, the artboard's; the world's follows the sun: terrain.ts
 * `paintSunShadows`). Opaque fills: callers paint all shadows as one union, then show it once.
 */
export function columnShadow(ctx: Ctx, P: Proj, level: number, mask: number, sx = 0.25 + level * 0.07, sy = 0): void {
  // The footprint, and where the sweep along the light ends (tiles on the ground), joined side by side.
  const out = slabOutline([mask], 0);
  const base = out.map((p) => P(p.u, p.v, 0));
  const moved = out.map((p) => P(p.u + sx, p.v + sy, 0));
  poly(ctx, base); ctx.fill();
  poly(ctx, moved); ctx.fill();
  for (let i = 0; i < out.length; i++) {
    const j = (i + 1) % out.length;
    poly(ctx, [base[i]!, base[j]!, moved[j]!, moved[i]!]);
    ctx.fill();
  }
}

// ── a slab's outline, its lips and its rim ─────────────────────────────────────────────────────

/** How far a lip's corners are rounded off (tiles), and how deep the rim's knee is (levels: a notch bites the lip down to there). */
const ROUND = 0.07, KNEE = 0.45;
/** How far a wall runs on past a tile's edge where the next tile's wall carries it on (tiles): no hairline between sprites. */
const OVERRUN = 0.014;

/** A lip's irregularity: a small wander, and maybe a notch. */
interface LipShape { readonly fa: number; readonly fb: number; readonly amp: number; readonly m: number; readonly ph: number; readonly notch: { g: number; w: number; d: number } | null }

/** One side of a slab's outline, and what its painter needs to know. */
interface Side {
  readonly p: OutlinePt;
  readonly q: OutlinePt;
  readonly len: number;
  /** Outward normal angle, and how shaded a wall facing it is. */
  readonly a: number;
  readonly sh: number;
  readonly sil: boolean;
  /** A silhouette facing the camera: its wall is drawn. */
  readonly vis: boolean;
  /** Inward unit normal (tile-local). */
  readonly iu: number;
  readonly iv: number;
  /** The stretches (fractions along it) where its top is a lip open to the sky, not carried on up by the slab above. */
  readonly lips: LipShape[];
  /** Does it stand all along on the wall of the slab below (one face with it: no crease at its foot)? */
  readonly flush: boolean;
  /** Fractions of it cut off its ends by the rounded corners. */
  c0: number;
  c1: number;
  /** Fractions along it of its rim's samples, and the rim there (u, v). */
  fs: number[];
  rim: Array<readonly [number, number]>;
}

/** Fractions of p→q that run along a silhouette side of `other` (collinear with it). */
function along(p: OutlinePt, q: OutlinePt, other: readonly OutlinePt[]): Array<[number, number]> {
  const du = q.u - p.u, dv = q.v - p.v, L2 = du * du + dv * dv;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < other.length; i++) {
    const a = other[i]!, b = other[(i + 1) % other.length]!;
    if (!a.sil) continue;
    if (Math.abs(du * (a.v - p.v) - dv * (a.u - p.u)) > 1e-6 || Math.abs(du * (b.v - p.v) - dv * (b.u - p.u)) > 1e-6) continue;
    const fa = ((a.u - p.u) * du + (a.v - p.v) * dv) / L2, fb = ((b.u - p.u) * du + (b.v - p.v) * dv) / L2;
    const lo = Math.max(0, Math.min(fa, fb)), hi = Math.min(1, Math.max(fa, fb));
    if (hi - lo > 1e-6) out.push([lo, hi]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/** [0, 1] less the stretches given. */
function rest(cov: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let f = 0;
  for (const [a, b] of cov) {
    if (a - f > 1e-4) out.push([f, a]);
    f = Math.max(f, b);
  }
  if (1 - f > 1e-4) out.push([f, 1]);
  return out;
}

/** How far the rim of a lip bites inwards at g (0 … 1 along the lip): nil at both ends, so the rim meets the next tile's. */
function bite(s: LipShape, g: number): number {
  let d = Math.sin(Math.PI * g) * s.amp * (0.5 + 0.5 * Math.sin(2 * Math.PI * s.m * g + s.ph));
  if (s.notch) d += s.notch.d * Math.max(0, 1 - Math.abs(g - s.notch.g) / s.notch.w) ** 1.4;
  return d;
}

/** The rim of a side at fraction f (tile-local u, v): bitten inwards along its lips. */
function rimAt(s: Side, f: number): readonly [number, number] {
  let d = 0;
  for (const l of s.lips) if (f >= l.fa - 1e-6 && f <= l.fb + 1e-6) { d = bite(l, (f - l.fa) / (l.fb - l.fa || 1)); break; }
  return [s.p.u + (s.q.u - s.p.u) * f + s.iu * d, s.p.v + (s.q.v - s.p.v) * f + s.iv * d];
}

const onLip = (s: Side, f: number): boolean => s.lips.some((l) => f >= l.fa - 1e-6 && f <= l.fb + 1e-6);

/**
 * The sides of a slab's outline: which drop and face the camera, where its top is a lip (not
 * carried on up by the slab above, `above`), whether its wall stands on the wall below (`below`),
 * and its rim sampled every `step` tiles — bitten (`jitter`) and its corners rounded off where
 * both sides meeting there are lips. Nothing moves where a side meets the next tile's.
 */
function sidesOf(pts: readonly OutlinePt[], below: readonly OutlinePt[] | null, above: readonly OutlinePt[] | null, rnd: (n: number) => number, step: number, jitter: boolean): Side[] {
  const n = pts.length;
  const sides: Side[] = pts.map((p, i) => {
    const q = pts[(i + 1) % n]!;
    const du = q.u - p.u, dv = q.v - p.v, len = Math.hypot(du, dv) || 1e-9;
    const a = Math.atan2(-du, dv);
    const spans = !p.sil ? [] : above ? rest(along(p, q, above)) : [[0, 1] as [number, number]];
    const lips = spans.map(([fa, fb], j): LipShape => {
      const h = (k: number): number => rnd(2000 + i * 53 + j * 11 + k);
      const lenT = (fb - fa) * len;
      let notch: LipShape['notch'] = null;
      if (jitter && lenT > 0.32 && h(3) < 0.55) {
        const g = 0.3 + h(4) * 0.4, w = (0.06 + h(5) * 0.06) / lenT;
        notch = { g, w: Math.min(w, g * 0.85, (1 - g) * 0.85), d: 0.06 + h(6) * 0.09 };
      }
      return { fa, fb, amp: jitter ? 0.02 + h(0) * 0.025 : 0, m: 1 + Math.floor(h(1) * 3), ph: h(2) * 6.283, notch };
    });
    const cov = below && p.sil ? along(p, q, below) : [];
    const flush = cov.length > 0 && rest(cov).length === 0;
    return { p, q, len, a, sh: shadeOf(a), sil: p.sil, vis: p.sil && facesCamera(a), iu: -dv / len, iv: du / len, lips, flush, c0: 0, c1: 0, fs: [], rim: [] };
  });
  // Round off the corners between two lips (the outline is convex: every corner sticks out).
  if (jitter) {
    for (let i = 0; i < n; i++) {
      const A = sides[(i + n - 1) % n]!, B = sides[i]!;
      const la = A.lips[A.lips.length - 1], lb = B.lips[0];
      if (!A.sil || !B.sil || !la || !lb || la.fb < 1 - 1e-6 || lb.fa > 1e-6) continue;
      const r = Math.min(ROUND, A.len * 0.3, B.len * 0.3);
      A.c1 = r / A.len;
      B.c0 = r / B.len;
    }
  }
  for (const s of sides) {
    const f0 = s.c0, f1 = 1 - s.c1;
    const fs: number[] = [];
    const m = Math.max(1, Math.ceil((s.len * (f1 - f0)) / step));
    for (let k = 0; k <= m; k++) fs.push(f0 + ((f1 - f0) * k) / m);
    for (const l of s.lips) {
      fs.push(l.fa, l.fb);
      if (l.notch) for (const dg of [-1, -0.5, 0, 0.5, 1]) fs.push(l.fa + (l.notch.g + dg * l.notch.w) * (l.fb - l.fa));
    }
    fs.sort((x, y) => x - y);
    s.fs = fs.filter((f, k) => f >= f0 - 1e-9 && f <= f1 + 1e-9 && (k === 0 || f - fs[k - 1]! > 1e-4));
    s.rim = s.fs.map((f) => rimAt(s, f));
  }
  return sides;
}

/**
 * The top's outline with its rim bitten and its corners rounded; `sil` on the side leaving each
 * point: a lip open to the sky (a side the slab above carries on up is no silhouette: no ink at a
 * terrace's join where the wall runs on, the crates' seam).
 */
function topOutline(sides: readonly Side[]): OutlinePt[] {
  const out: OutlinePt[] = [];
  for (const s of sides) {
    const last = s.fs.length - 1;
    for (let k = 0; k < last; k++) out.push({ u: s.rim[k]![0], v: s.rim[k]![1], sil: s.sil && onLip(s, (s.fs[k]! + s.fs[k + 1]!) / 2) });
    // A rounded corner: the cut from this side's end to the next side's start is silhouette.
    if (s.c1 > 0) out.push({ u: s.rim[last]![0], v: s.rim[last]![1], sil: true });
  }
  return out;
}

/**
 * The top of step t of a column as `drawColumn` draws it (tests, review): its outline bitten and
 * rounded along its lips, `sil` only on the lips — the sides the step above carries on up are no
 * silhouette. Inside the tile always: the rim only ever bites inwards.
 */
export function slabTop(masks: readonly number[], t: number, seed: number): OutlinePt[] {
  const rnd = (n: number): number => hashUnit(seed, n, 0x6f + t * 977);
  return topOutline(sidesOf(slabOutline(masks, t), t > 0 ? slabOutline(masks, t - 1) : null, t + 1 < masks.length ? slabOutline(masks, t + 1) : null, rnd, 0.06, true));
}

/** A point of a wall: its foot (straight, on the tile's outline) and its rim (bitten); which side it is on, and whether its top is a lip. */
interface Station { fu: number; fv: number; ru: number; rv: number; s: number; lip: boolean }

/** A run of camera-facing walls, its stations and, per side, the stations its wall spans (the corner between two sides goes with the later one). */
interface Run { sts: Station[]; core: Station[]; spans: Array<{ s: number; from: number; to: number }>; openStart: boolean; openEnd: boolean }

/** The camera-facing wall runs of a slab: consecutive visible sides, each with open-air ends or not. */
function runsOf(sides: readonly Side[]): Run[] {
  const n = sides.length;
  const start = sides.findIndex((s) => !s.vis);
  if (start < 0) return [];
  const groups: Array<{ ids: number[]; openStart: boolean; openEnd: boolean }> = [];
  let cur: (typeof groups)[number] | null = null;
  for (let t = 1; t <= n; t++) {
    const i = (start + t) % n, s = sides[i]!;
    if (s.vis) {
      if (!cur) { cur = { ids: [], openStart: sides[(i + n - 1) % n]!.sil, openEnd: false }; groups.push(cur); }
      cur.ids.push(i);
    } else if (cur) { cur.openEnd = s.sil; cur = null; }
  }
  return groups.map(({ ids, openStart, openEnd }) => {
    const core: Station[] = [];
    const bounds: Array<[number, number, number]> = [];
    for (const i of ids) {
      const s = sides[i]!, last = s.fs.length - 1, from = core.length;
      s.fs.forEach((f, k) => {
        const g = k === 0 ? 0 : k === last ? 1 : f;
        core.push({ fu: s.p.u + (s.q.u - s.p.u) * g, fv: s.p.v + (s.q.v - s.p.v) * g, ru: s.rim[k]![0], rv: s.rim[k]![1], s: i, lip: onLip(s, f) });
      });
      bounds.push([i, from, core.length - 1]);
    }
    // Where the next tile carries the wall on, run a hair past the tile's edge.
    const ext = (a: Station, b: Station): Station => {
      const du = a.fu - b.fu, dv = a.fv - b.fv, d = Math.hypot(du, dv) || 1;
      return { ...a, fu: a.fu + (du / d) * OVERRUN, fv: a.fv + (dv / d) * OVERRUN, ru: a.ru + (du / d) * OVERRUN, rv: a.rv + (dv / d) * OVERRUN };
    };
    const pre = !openStart && core.length > 1 ? 1 : 0;
    const sts = [...(pre ? [ext(core[0]!, core[1]!)] : []), ...core];
    if (!openEnd && core.length > 1) sts.push(ext(core[core.length - 1]!, core[core.length - 2]!));
    const spans = bounds.map(([s, from, to], j) => ({ s, from: j === 0 ? 0 : from + pre - 1, to: j === bounds.length - 1 ? sts.length - 1 : to + pre }));
    return { sts, core, spans, openStart, openEnd };
  });
}

// ── a column ────────────────────────────────────────────────────────────────────────────────────

/** Paint one column: its terrace slabs bottom to top (each nests inside the one below). */
export function drawColumn(ctx: Ctx, P: Proj, cls: number, masks: readonly number[], o: ColumnOpts): void {
  const L = masks.length * STEP_LEVELS;
  const outlines = masks.map((_, t) => slabOutline(masks, t));
  const [t0, t1] = o.slabs ?? [0, masks.length - 1];
  for (let t = t0; t <= t1; t++) drawSlab(ctx, P, o.layers?.[t] ?? cls, outlines[t]!, outlines[t - 1] ?? null, outlines[t + 1] ?? null, t * STEP_LEVELS, (t + 1) * STEP_LEVELS, L, o, t);
}

function drawSlab(ctx: Ctx, P: Proj, cls: number, pts: readonly OutlinePt[], below: readonly OutlinePt[] | null, above: readonly OutlinePt[] | null, z0: number, z1: number, L: number, o: ColumnOpts, t: number): void {
  const look = ROCK[cls]!;
  const k = o.k;
  const rnd = (n: number): number => hashUnit(o.seed, n, 0x6f + t * 977);
  const pool = z1 === L ? o.top : null;
  // A pool's top keeps its straight outline (its shore runs on into the next tile's).
  const jitter = !pool;
  const sides = sidesOf(pts, below, above, rnd, o.detail >= 2 ? 0.06 : o.detail === 1 ? 0.12 : 0.25, jitter);
  const runs = runsOf(sides);
  const at = (st: Station, z: number): Pt => {
    if (z <= z1 - KNEE || (st.ru === st.fu && st.rv === st.fv)) return P(st.fu, st.fv, z);
    const e = clamp01((z - (z1 - KNEE)) / KNEE), s = e * e * (3 - 2 * e);
    return P(st.fu + (st.ru - st.fu) * s, st.fv + (st.rv - st.fv) * s, z);
  };

  // ── walls ──
  for (const run of runs) wall(ctx, P, at, cls, sides, run, z0, z1, o, rnd);
  if (o.vein && o.detail >= 1) for (const [r, run] of runs.entries()) veinCrystals(ctx, P, veinRun(sides, run), z0, z1, o, rnd, r);

  // ── top ──
  const tp = jitter ? topOutline(sides) : pts.map((p, i) => ({ u: p.u, v: p.v, sil: p.sil && sides[i]!.lips.length > 0 }));
  const topPts = tp.map((p) => P(p.u, p.v, z1));
  ctx.fillStyle = topColor(cls, z1);
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  poly(ctx, topPts);
  // Bleed 0.8 px so neighbouring tops join without a hairline (water bleeds its own colour instead).
  if (pool?.kind !== 'water' && pool?.kind !== 'river') ctx.stroke();
  ctx.fill();
  if (pool && pool.kind !== 'rock') drawTop(ctx, P, topPts, z1, pool, o, rnd, cls);
  else if (o.detail >= 1 && z1 === L) {
    ctx.save();
    poly(ctx, topPts);
    ctx.clip();
    topMarks(ctx, P, cls, z1, o, rnd);
    ctx.restore();
  }
  // Rock beside water at its height: the pool's corner over its grain.
  if (pool?.kind === 'rock') drawTop(ctx, P, topPts, z1, pool, o, rnd, cls);

  // ── ink ──
  // The lit lip along the lit walls' rims.
  for (const run of runs) {
    let seg: Pt[] = [];
    const flush = (): void => { if (seg.length > 1) line(ctx, seg, look.rim, 1.5 * k, o.detail >= 1 ? 0.85 : 0.6); seg = []; };
    for (const st of run.sts) {
      if (st.lip && sides[st.s]!.sh < 0.55) seg.push(P(st.ru, st.rv, z1));
      else flush();
    }
    flush();
  }
  // A front facing south-west, straight along the camera's line of sight, shows no wall: its edge
  // alone would read as a crack (owner, 2026-10-17, by a stream: « a long thin dark line… »). Its
  // lip is lit as a lit wall's is (the light comes from that side), a bevel inside the edge, so it
  // reads as a terrace's edge.
  if (o.detail >= 1) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      if (!a.sil) continue;
      const du = b.u - a.u, dv = b.v - a.v, len = Math.hypot(du, dv);
      if (len < 0.3 || du * dv <= 0 || Math.abs(du - dv) > 0.3 * len) continue;
      // Inward (the outline runs clockwise: the top on the right of a→b): north-east of the edge.
      const iu = -dv / len, iv = du / len;
      if (iu <= 0 || iv >= 0) continue;
      const q = (t: number, d: number): Pt => P(a.u + du * t + iu * d, a.v + dv * t + iv * d, z1);
      fillPoly(ctx, [q(0.04, 0.03), q(0.96, 0.03), q(0.96, 0.1), q(0.04, 0.1)], rgba(look.rim, 0.55));
      line(ctx, [q(0.04, 0.05), q(0.96, 0.05)], look.rim, 1.4 * k, 0.85);
    }
  }
  // The rim's silhouette, then the feet: the heaviest at the floor, a light crease where a wall
  // stands on a ledge, none where it carries on the wall below.
  for (const r of silhouetteRuns(tp)) {
    const pp = r.map((p) => P(p.u, p.v, z1));
    if (o.detail >= 2) ink(ctx, pp, { w: 1.8 * k, seed: o.seed + r.length + t, taper: 0.04, jitter: 0.3 });
    else line(ctx, pp, C.ink, 1.35 * k, 0.9);
  }
  for (const run of runs) {
    if (z0 === 0) {
      const bottom = run.sts.map((st) => P(st.fu, st.fv, 0));
      if (o.detail >= 2) ink(ctx, bottom, { w: 2.3 * k, seed: o.seed + 7, taper: 0.03, jitter: 0.25 });
      else line(ctx, bottom, C.ink, 1.4 * k, 0.88);
    } else {
      for (const sp of run.spans) {
        if (sides[sp.s]!.flush) continue;
        line(ctx, run.sts.slice(sp.from, sp.to + 1).map((st) => P(st.fu, st.fv, z0)), C.ink, 1 * k, 0.5);
      }
    }
    // Where a wall turns away into open air: its edge, up the knee to the rim.
    const vw = (o.detail >= 2 ? 1.5 : 1.05) * k;
    const edge = (st: Station): Pt[] => [z0, z1 - KNEE, z1 - KNEE * 0.5, z1].map((z) => at(st, z));
    if (run.openStart) line(ctx, edge(run.sts[0]!), C.ink, vw, 0.9);
    if (run.openEnd) line(ctx, edge(run.sts[run.sts.length - 1]!), C.ink, vw, 0.9);
    // Folds where the wall changes direction (a chamfer meets a side).
    for (let j = 1; j < run.spans.length; j++) {
      const st = run.sts[run.spans[j]!.from]!;
      if (Math.abs(sides[st.s]!.a - sides[run.spans[j]!.s]!.a) > 0.1) line(ctx, [P(st.fu, st.fv, z0), at(st, z1 - KNEE), at(st, z1)], C.ink, 0.75 * k, 0.4);
    }
  }
  // A stream's fall lands at the foot of the wall it pours down (the wall's lowest slab there).
  if (o.top?.kind === 'river' && o.top.fall && o.detail >= 1) {
    for (const [i, sd] of sides.entries()) if (sd.vis && !sd.flush && fallsDown(sd, o.top)) splash(ctx, P, sides, i, z0, o, rnd);
  }
  // Talus at the foot of the walls on this slab's top, where the slab above stands back from its
  // edge (a ledge in front of a chamfered wall: drawn with the ledge, so it takes the ledge's
  // shade, world/relief-view.ts). A higher neighbour's wall rising from its top: `drawFoot`.
  if (o.detail >= 2 && !pool) {
    if (above) {
      ctx.save();
      poly(ctx, topPts);
      ctx.clip();
      for (let i = 0; i < above.length; i++) {
        const p = above[i]!, q = above[(i + 1) % above.length]!;
        const du = q.u - p.u, dv = q.v - p.v, len = Math.hypot(du, dv) || 1;
        // A front facing south-west shows no wall, edge-on (D115): its foot gets the talus too, and
        // the shade it casts at the foot, so the step reads.
        const edgeOn = du * dv > 0 && Math.abs(du - dv) <= 0.3 * len && -dv > 0 && du < 0;
        if (!p.sil || !(facesCamera(Math.atan2(-du, dv)) || edgeOn)) continue;
        for (const [fa, fb] of rest(along(p, q, pts))) {
          const s0: [number, number] = [p.u + du * fa, p.v + dv * fa], s1: [number, number] = [p.u + du * fb, p.v + dv * fb], nu = dv / len, nv = -du / len;
          if (edgeOn) {
            for (const [d, a] of [[0.05, 0.16], [0.11, 0.1], [0.18, 0.05]] as const) {
              fillPoly(ctx, [P(s0[0], s0[1], z1), P(s1[0], s1[1], z1), P(s1[0] + nu * d, s1[1] + nv * d, z1), P(s0[0] + nu * d, s0[1] + nv * d, z1)], rgba(C.ink, a));
            }
          }
          talus(ctx, P, z1, s0, s1, [nu, nv], cls, o, rnd, 900 + i * 37);
        }
      }
      ctx.restore();
    }
  }
  // A face ore's points poking up along the lip of the top, over every side that drops (sprites
  // only: the paint's would stick out past the sprite's silhouette where both show).
  if (o.vein && o.detail >= 2 && z1 === L) veinLip(ctx, P, tp, z1, o, rnd);
}

/** A run of wall as the vein's helpers read it: the straight foot line, each point with its side's normal. */
const veinRun = (sides: readonly Side[], run: Run): Array<{ u: number; v: number; a: number }> => run.core.map((st) => ({ u: st.fu, v: st.fv, a: sides[st.s]!.a }));

/**
 * One wall run of a slab: its beds as flat bands of tone (strata running on across tiles), then,
 * clipped to the wall: occlusion at its foot, desert varnish, the hardness's joints, the bedding
 * planes, hatching in the shade, grooves and fallen-block scars, the caprock over its shadowed
 * overhang, the notches' gullies, and the vein's seam.
 */
function wall(ctx: Ctx, P: Proj, at: (st: Station, z: number) => Pt, cls: number, sides: readonly Side[], run: Run, z0: number, z1: number, o: ColumnOpts, rnd: (n: number) => number): void {
  const look = ROCK[cls]!, k = o.k, sts = run.sts;
  const rank = rankOf(cls, o.detail);
  const planes = bedsIn(rank, z0, z1);
  // Each plane wanders a little along the wall — nil where a tile meets the next.
  const wob = new Map<number, (u: number, v: number) => number>();
  const wobOf = (b: number): ((u: number, v: number) => number) => {
    let f = wob.get(b);
    if (!f) {
      const amp = o.detail === 0 ? 0 : 0.025 + hashUnit(o.seed, b, 0xb0) * 0.035, m = 1 + (hash32(o.seed, b, 0xb1) & 1), ph = hashUnit(o.seed, b, 0xb2) * 6.283;
      const g = (s: number): number => Math.sin(Math.PI * s) * Math.sin(2 * Math.PI * m * s + ph);
      f = (u, v) => amp * (g(u) + g(v));
      wob.set(b, f);
    }
    return f;
  };
  const zOf = (st: Station, b: number): number => {
    const z = BEDS[b]!.z + wobOf(b)(st.fu, st.fv);
    return z < z0 ? z0 : z > z1 ? z1 : z;
  };
  /** A band of the wall between two heights per station (lo, hi), over stations [from, to]. */
  const band = (from: number, to: number, lo: (st: Station) => number, hi: (st: Station) => number): Pt[] => {
    const out: Pt[] = [];
    for (let i = from; i <= to; i++) out.push(at(sts[i]!, lo(sts[i]!)));
    for (let i = to; i >= from; i--) out.push(at(sts[i]!, hi(sts[i]!)));
    return out;
  };

  // The beds' bands, side by side (each side its own light).
  const edges: Array<(st: Station) => number> = [() => z0, ...planes.map((b) => (st: Station) => zOf(st, b)), () => z1];
  for (const sp of run.spans) {
    const sh = sides[sp.s]!.sh;
    for (let j = 0; j + 1 < edges.length; j++) {
      const za = j === 0 ? z0 : BEDS[planes[j - 1]!]!.z, zb = j + 1 === edges.length - 1 ? z1 : BEDS[planes[j]!]!.z;
      const tone = j === 0 ? toneAt(rank, z0) : BEDS[planes[j - 1]!]!.tone;
      fillPoly(ctx, band(sp.from, sp.to, edges[j]!, edges[j + 1]!), wallColor(cls, sh, (za + zb) / 2, tone));
    }
  }

  const body = band(0, sts.length - 1, () => z0, () => z1);
  ctx.save();
  poly(ctx, body);
  ctx.clip();
  const lipped = sts.some((st) => st.lip);
  const cap = look.cap;
  if (o.detail >= 1) {
    // Occlusion at the foot (not where the wall carries on the one below).
    for (const sp of run.spans) {
      if (sides[sp.s]!.flush) continue;
      fillPoly(ctx, band(sp.from, sp.to, () => z0, () => z0 + 0.32), rgba(C.ink, 0.12));
      fillPoly(ctx, band(sp.from, sp.to, () => z0, () => z0 + 0.1), rgba(C.ink, 0.1));
    }
    varnish(ctx, at, sides, run, z0, z1, o, rnd);
    joints(ctx, at, cls, sides, run, z0, z1, o, rnd);
  }
  // The bedding planes: a thick bed's base inked heavier, a thin one broken here and there; a lit
  // ledge on a thick bed's top where the light falls on the wall.
  for (const b of planes) {
    const bed = BEDS[b]!;
    const w = (bed.rank === 2 ? 1.15 : bed.rank === 1 ? 0.85 : 0.6) * k;
    const alpha = (bed.rank === 2 ? 0.5 : bed.rank === 1 ? 0.38 : 0.28) * (cls === 3 ? 0.6 : 1) * (o.detail === 0 ? 0.7 : 1);
    let seg: Pt[] = [];
    const flush = (): void => { if (seg.length > 1) line(ctx, seg, look.line, w, alpha); seg = []; };
    for (const [i, st] of sts.entries()) {
      seg.push(at(st, zOf(st, b)));
      if (bed.rank === 0 && i > 0 && i < sts.length - 1 && hashUnit(o.seed, b, i, 0xb3) < 0.14) flush();
    }
    flush();
    if (bed.rank === 2 && o.detail >= 1) {
      for (const sp of run.spans) {
        if (sides[sp.s]!.sh > 0.5) continue;
        line(ctx, sts.slice(sp.from, sp.to + 1).map((st) => at(st, Math.min(z1, zOf(st, b) + 0.06))), look.rim, 0.9 * k, 0.45);
      }
    }
  }
  if (o.detail >= 2) hatchShade(ctx, at, sides, run, z0, z1, cap, lipped, o, rnd);
  if (o.detail >= 1) grooves(ctx, at, cls, sides, run, z0, z1, o, rnd);
  // The caprock: a harder, paler layer at the lip, its overhang's shadow under it.
  if (lipped) {
    const ph = hashUnit(o.seed, 0xca9) * 6.283;
    for (const sp of run.spans) {
      const sh = sides[sp.s]!.sh;
      let a = -1;
      for (let i = sp.from; i <= sp.to + 1; i++) {
        const on = i <= sp.to && sts[i]!.lip;
        if (on && a < 0) a = i;
        if (!on && a >= 0) {
          const b = i - 1;
          if (b > a) {
            // The overhang's shadow, its lower edge wandering (as the planes: nil where tiles meet).
            const under = (st: Station): number => z1 - cap - 0.11 - 0.05 * (Math.sin(Math.PI * st.fu) * Math.sin(3 * Math.PI * st.fu + ph) + Math.sin(Math.PI * st.fv) * Math.sin(3 * Math.PI * st.fv + ph));
            fillPoly(ctx, band(a, b, under, () => z1 - cap), rgba(mix(look.dark, C.ink, 0.35), o.detail >= 1 ? 0.45 : 0.3));
            fillPoly(ctx, band(a, b, () => z1 - cap, () => z1), mix(wallColor(cls, sh, z1, 0.5), look.rim, 0.28 * (1 - sh)));
            if (o.detail >= 1) line(ctx, sts.slice(a, b + 1).map((st) => at(st, z1 - cap)), look.line, 0.8 * k, 0.5);
          }
          a = -1;
        }
      }
    }
    if (o.detail >= 1) gullies(ctx, P, at, cls, sides, run, z0, z1, o, rnd);
  }
  if (o.vein) veinSeam(ctx, P, veinRun(sides, run), z0, z1, o, rnd);
  if (o.top?.kind === 'river' && o.top.fall) for (const sp of run.spans) if (fallsDown(sides[sp.s]!, o.top)) waterfall(ctx, at, sides, sp.s, z0, z1, o, rnd);
  ctx.restore();
}

/** A stream's way as a tile-local unit vector. */
const flowVec = (top: TopLook): [number, number] => { const a = ((top.flow ?? 0) * Math.PI) / 4; return [Math.cos(a), Math.sin(a)]; };

/** Does a stream fall down this side's wall (it faces the way the stream runs)? */
const fallsDown = (sd: Side, top: TopLook): boolean => {
  const [fx, fy] = flowVec(top);
  return Math.cos(sd.a) * fx + Math.sin(sd.a) * fy > 0.55;
};

/**
 * A stream's surface (D94): a stroke or two along the way it runs, paper-white hooked like a
 * ripple and a darker one, as the floor's rivers (gaps.ts); where it falls, a band of foam across
 * it at the lip.
 */
function streamMarks(ctx: Ctx, P: Proj, z: number, top: TopLook, o: ColumnOpts, rnd: (n: number) => number): void {
  const k = o.k, [fx, fy] = flowVec(top);
  for (let q = 0; q < 2; q++) {
    if (rnd(470 + q) > 0.7) continue;
    const cu = 0.25 + rnd(480 + q) * 0.5, cv = 0.25 + rnd(490 + q) * 0.5, L = 0.15 + rnd(500 + q) * 0.12, b = 0.08;
    const pts: Pt[] = [];
    for (let e = 0; e <= 6; e++) {
      const s = e / 6 - 0.5, bend = Math.sin((e / 6) * Math.PI) * b;
      pts.push(P(cu + fx * L * 2 * s - fy * bend, cv + fy * L * 2 * s + fx * bend, z));
    }
    line(ctx, pts, q ? rgba(C.riverD, 0.6) : 'rgba(255,255,255,0.8)', (q ? 1 : 1.3) * k);
  }
  if (top.fall) {
    // Foam at the lip, across the stream where it pours over.
    const eu = 0.5 + fx * 0.42, ev = 0.5 + fy * 0.42;
    line(ctx, [P(eu - fy * 0.42, ev + fx * 0.42, z), P(eu + fy * 0.42, ev - fx * 0.42, z)], 'rgba(255,255,255,0.9)', 2.4 * k);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let q = 0; q < 4; q++) {
      const s = (rnd(510 + q) - 0.5) * 0.7, back = 0.05 + rnd(520 + q) * 0.12;
      const [x, y] = P(eu - fy * s - fx * back, ev + fx * s - fy * back, z);
      ctx.beginPath(); ctx.ellipse(x, y, (1.2 + rnd(530 + q) * 1.4) * k, (0.8 + rnd(540 + q)) * k, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/**
 * A stream's waterfall down a wall it pours over (D94), inside the wall: a sheet of running water
 * across most of the face, white and pale-blue streaks falling down it — long on a tall fall,
 * broken into rapids on a fall of one level —, the lip's curl at the top of the column.
 */
function waterfall(ctx: Ctx, at: (st: Station, z: number) => Pt, sides: readonly Side[], s: number, z0: number, z1: number, o: ColumnOpts, rnd: (n: number) => number): void {
  const k = o.k, sd = sides[s]!, tall = (o.top?.fall ?? 0) > STEP_LEVELS;
  // As wide as the channel it leaves (D115), its edges a thinner veil, its sides wavering down.
  const fa = 0.06, fb = 0.94, n = 8;
  for (const [ea, eb, alpha] of [[0.015, 0.985, 0.5], [fa, fb, 0.94]] as const) {
    const left: Pt[] = [], right: Pt[] = [];
    for (let q = 0; q <= n; q++) {
      const z = z1 - ((z1 - z0) * q) / n, spread = 0.025 * (q / n), wob = (rnd(7900 + s * 17 + q) - 0.5) * 0.03 * (q / n);
      left.push(at(stationAt(sides, s, Math.max(0.01, ea - spread + wob)), z));
      right.push(at(stationAt(sides, s, Math.min(0.99, eb + spread + wob)), z));
    }
    fillPoly(ctx, [...left, ...right.reverse()], rgba(C.river, alpha));
  }
  const streaks = Math.round(sd.len * (o.detail >= 2 ? 16 : o.detail === 1 ? 7 : 3));
  for (let q = 0; q < streaks; q++) {
    const f = fa + 0.03 + rnd(8000 + s * 131 + q) * (fb - fa - 0.06), st = stationAt(sides, s, f);
    const white = rnd(8100 + s * 131 + q) < 0.55, dark = !white && rnd(8200 + s * 131 + q) < 0.35;
    const color = white ? 'rgba(255,255,255,0.85)' : dark ? rgba(C.riverD, 0.5) : rgba('#d4f1fb', 0.8);
    const w = (white ? 1.1 : 0.8) * k;
    if (tall || o.detail === 0) {
      const za = z1 - rnd(8300 + s * 131 + q) * 0.3, zb = z0 + rnd(8400 + s * 131 + q) * (z1 - z0) * 0.35;
      line(ctx, [at(st, za), at(st, zb)], color, w);
    } else {
      // Rapids: the water breaks over the step in short dashes.
      for (let e = 0; e < 3; e++) {
        const za = z1 - 0.1 - (e + rnd(8500 + s * 131 + q * 3 + e)) * ((z1 - z0) / 3.2);
        line(ctx, [at(st, za), at(st, Math.max(z0, za - 0.25))], color, w);
      }
    }
  }
  // The lip's curl where the sheet leaves the top (a lip: the walls below carry the sheet on).
  if (o.detail >= 1 && sd.lips.length) line(ctx, [at(stationAt(sides, s, fa), z1 - 0.06), at(stationAt(sides, s, (fa + fb) / 2), z1 - 0.1), at(stationAt(sides, s, fb), z1 - 0.06)], 'rgba(255,255,255,0.9)', 1.8 * k);
}

/** Foam and spray at the foot of a waterfall (D94), over the wall's foot: the water boiling where it lands. */
function splash(ctx: Ctx, P: Proj, sides: readonly Side[], s: number, z0: number, o: ColumnOpts, rnd: (n: number) => number): void {
  const k = o.k, sd = sides[s]!;
  const at = (f: number, d: number, z: number): Pt => P(sd.p.u + (sd.q.u - sd.p.u) * f - sd.iu * d, sd.p.v + (sd.q.v - sd.p.v) * f - sd.iv * d, z);
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let q = 0; q < 3; q++) {
    const [x, y] = at(0.2 + q * 0.3, 0, z0 + 0.3);
    ctx.beginPath(); ctx.ellipse(x, y, (9 + rnd(9000 + q) * 5) * k, (5 + rnd(9010 + q) * 3) * k, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  const n = Math.round(sd.len * 9);
  for (let q = 0; q < n; q++) {
    const [x, y] = at(0.1 + rnd(9020 + q) * 0.8, 0, z0 + 0.05 + rnd(9030 + q) * 0.25);
    ctx.beginPath(); ctx.ellipse(x, y, (2 + rnd(9040 + q) * 2.6) * k, (1.4 + rnd(9050 + q) * 1.4) * k, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(212,241,251,0.9)';
  for (let q = 0; q < 6; q++) {
    const [x, y] = at(0.12 + rnd(9060 + q) * 0.76, 0, z0 + 0.4 + rnd(9070 + q) * 0.5);
    ctx.beginPath(); ctx.arc(x, y, (0.8 + rnd(9080 + q) * 0.8) * k, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** A wall's station at fraction f of side s (for the marks placed along a side). */
function stationAt(sides: readonly Side[], s: number, f: number): Station {
  const sd = sides[s]!, [ru, rv] = rimAt(sd, f);
  return { fu: sd.p.u + (sd.q.u - sd.p.u) * f, fv: sd.p.v + (sd.q.v - sd.p.v) * f, ru, rv, s, lip: onLip(sd, f) };
}

/** Desert varnish: dark streaks (now and then a pale one) hanging from the lip down the face. */
function varnish(ctx: Ctx, at: (st: Station, z: number) => Pt, sides: readonly Side[], run: Run, z0: number, z1: number, o: ColumnOpts, rnd: (n: number) => number): void {
  for (const sp of run.spans) {
    const sd = sides[sp.s]!;
    if (!sd.lips.length) continue;
    const n = Math.floor(sd.len * (0.6 + rnd(3000 + sp.s) * 2.2) * (1 - sd.sh * 0.5));
    for (let i = 0; i < n; i++) {
      const h = (m: number): number => rnd(3010 + sp.s * 41 + i * 7 + m);
      const f = 0.1 + h(0) * 0.8;
      if (!onLip(sd, f)) continue;
      const w = (0.02 + h(1) * 0.05) / sd.len, len = 0.35 + h(2) ** 1.4 * 1.5;
      const zt = z1 - 0.04, zb = Math.max(z0 + 0.15, zt - len);
      const left: Pt[] = [], right: Pt[] = [];
      for (let q = 0; q <= 4; q++) {
        const e = q / 4, z = zt + (zb - zt) * e, ww = w * (1 - e * 0.65) * (0.8 + 0.4 * Math.sin(q * 2.1 + h(3) * 6));
        const c = f + (h(4) - 0.5) * 0.03 * e;
        left.push(at(stationAt(sides, sp.s, Math.max(0.02, c - ww / 2)), z));
        right.push(at(stationAt(sides, sp.s, Math.min(0.98, c + ww / 2)), z));
      }
      const pale = h(5) < 0.22;
      fillPoly(ctx, [...left, ...right.reverse()], pale ? rgba('#fff4e6', 0.2) : rgba(C.ink, 0.06 + h(6) * 0.06));
    }
  }
}

/** The hardness in the wall: cross-bedding and pits in sandstone, joints in the red-bed, long fractures in the sienna, facets and glowing veins in the heartrock. */
function joints(ctx: Ctx, at: (st: Station, z: number) => Pt, cls: number, sides: readonly Side[], run: Run, z0: number, z1: number, o: ColumnOpts, rnd: (n: number) => number): void {
  const look = ROCK[cls]!, k = o.k;
  const fine = o.detail >= 2;
  for (const sp of run.spans) {
    const sd = sides[sp.s]!;
    const n = Math.max(1, Math.round(sd.len * 2));
    const h = (m: number): number => rnd(4000 + sp.s * 61 + m);
    if (cls === 0) {
      if (!fine) continue;
      // Cross-bedding: short slanted laminae inside a bed or two.
      for (let j = 0; j < n; j++) {
        if (h(j) < 0.45) continue;
        const f = 0.15 + h(10 + j) * 0.6, zc = z0 + 0.3 + h(20 + j) * (z1 - z0 - 0.8);
        for (let q = 0; q < 3; q++) {
          const ff = f + q * 0.05 / sd.len;
          line(ctx, [at(stationAt(sides, sp.s, ff), zc), at(stationAt(sides, sp.s, Math.min(0.95, ff + 0.08 / sd.len)), zc + 0.22)], look.line, 0.55 * k, 0.28);
        }
      }
      // Weathering pits (tafoni) in a cluster on the face.
      if (h(40) < 0.5) {
        const f = 0.2 + h(41) * 0.6, zc = z0 + 0.4 + h(42) * (z1 - z0 - 0.9);
        ctx.fillStyle = rgba(look.line, 0.38);
        for (let q = 0; q < 5; q++) {
          const [x, y] = at(stationAt(sides, sp.s, Math.min(0.92, Math.max(0.08, f + (h(43 + q) - 0.5) * 0.18 / sd.len))), zc + (h(50 + q) - 0.5) * 0.35);
          ctx.beginPath(); ctx.ellipse(x, y, (1 + h(56 + q) * 1.6) * k, (0.8 + h(62 + q) * 1.1) * k, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (cls === 1) {
      // Blocky joints: short verticals within the beds, off-set from bed to bed.
      const planes = [z0, ...bedsIn(1, z0, z1).map((b) => BEDS[b]!.z), z1];
      for (let j = 0; j + 1 < planes.length; j++) {
        if (h(100 + j) < 0.5 || planes[j + 1]! - planes[j]! < 0.25) continue;
        const f = 0.1 + h(110 + j) * 0.8, st = stationAt(sides, sp.s, f);
        line(ctx, [at(st, planes[j]! + 0.04), at(st, planes[j + 1]! - 0.04)], look.line, 0.8 * k, 0.36);
      }
    } else if (cls === 2) {
      // Long vertical fractures, jagged, a lit edge beside each: the columnar look.
      for (let j = 0; j < n; j++) {
        const f = 0.08 + h(200 + j) * 0.84, za = z0 + h(210 + j) * 0.5, zb = z1 - ROCK[cls]!.cap - 0.05;
        const pts: Pt[] = [], lit: Pt[] = [];
        for (let q = 0; q <= 4; q++) {
          const z = za + ((zb - za) * q) / 4, ff = f + (h(220 + j * 5 + q) - 0.5) * 0.025;
          pts.push(at(stationAt(sides, sp.s, ff), z));
          lit.push(at(stationAt(sides, sp.s, Math.min(0.97, ff + 0.018 / sd.len)), z));
        }
        line(ctx, pts, look.line, (fine ? 1 : 0.8) * k, 0.45);
        if (fine && sd.sh < 0.6) line(ctx, lit, look.rim, 0.7 * k, 0.35);
      }
    } else {
      // Heartrock: sharp facets, glints, and its veins glowing.
      for (let j = 0; j < n; j++) {
        const f = 0.12 + h(300 + j) * 0.7, za = z0 + 0.15 + h(310 + j) * (z1 - z0 - 0.9);
        const a = stationAt(sides, sp.s, f), b = stationAt(sides, sp.s, Math.min(0.92, f + 0.16 / sd.len));
        line(ctx, [at(a, za), at(b, za + 0.55)], look.line, 0.9 * k, 0.45);
        if (fine) line(ctx, [at(a, za + 0.1), at(a, za + 0.4)], look.rim, 1.3 * k, 0.7);
      }
      for (let j = 0; j < n; j++) {
        if (h(330 + j) > 0.5) continue;
        const f = 0.15 + h(340 + j) * 0.7, za = z0 + h(350 + j) * (z1 - z0 - 0.8), zb = za + 0.3 + h(360 + j) * 0.5;
        const a = at(stationAt(sides, sp.s, f), za), b = at(stationAt(sides, sp.s, Math.min(0.95, f + 0.05 / sd.len)), zb);
        line(ctx, [a, b], C.cyan, 1.4 * k, 0.75);
        if (fine) line(ctx, [a, b], C.led, 0.6 * k, 0.9);
      }
    }
  }
}

/** Pen hatching on the shaded faces: verticals hanging from under the caprock, denser where it is darker. */
function hatchShade(ctx: Ctx, at: (st: Station, z: number) => Pt, sides: readonly Side[], run: Run, z0: number, z1: number, cap: number, lipped: boolean, o: ColumnOpts, rnd: (n: number) => number): void {
  for (const sp of run.spans) {
    const sd = sides[sp.s]!;
    if (sd.sh < 0.5) continue;
    const n = Math.max(1, Math.round(sd.len / 0.065));
    const alpha = 0.08 + (sd.sh - 0.5) * 0.26;
    for (let j = 0; j < n; j++) {
      const f = 0.03 + ((j + 0.2 + rnd(4900 + sp.s * 97 + j) * 0.6) / n) * 0.94;
      const st = stationAt(sides, sp.s, f);
      // Hung from under the caprock, most of them short: the shade gathers under the lip.
      const top = (lipped && st.lip ? z1 - cap - 0.12 : z1 - 0.04) - rnd(5000 + sp.s * 97 + j) * 0.2;
      const bot = Math.max(z0 + 0.05, top - 0.15 - rnd(5100 + sp.s * 97 + j) ** 2 * (top - z0) * 0.9);
      line(ctx, [at(st, top), at(st, bot)], C.ink, 0.7 * o.k, alpha);
    }
  }
}

/** Erosion grooves down the face from the lip (a dark channel, its lit edge), and now and then the pale scar of a fallen block. */
function grooves(ctx: Ctx, at: (st: Station, z: number) => Pt, cls: number, sides: readonly Side[], run: Run, z0: number, z1: number, o: ColumnOpts, rnd: (n: number) => number): void {
  const look = ROCK[cls]!, k = o.k;
  for (const sp of run.spans) {
    const sd = sides[sp.s]!;
    if (!sd.lips.length) continue;
    const h = (m: number): number => rnd(6000 + sp.s * 71 + m);
    const n = Math.floor(sd.len * (h(0) * 2.4));
    for (let j = 0; j < n; j++) {
      const f = 0.15 + h(1 + j) * 0.7;
      if (!onLip(sd, f)) continue;
      const st = stationAt(sides, sp.s, f), lit = stationAt(sides, sp.s, Math.min(0.95, f + 0.016 / sd.len));
      const za = z1 - look.cap - 0.05, zb = Math.max(z0 + 0.2, za - 0.45 - h(10 + j) * 1.0);
      line(ctx, [at(st, za), at(st, (za + zb) / 2), at(st, zb)], look.line, 1.1 * k, 0.42);
      if (o.detail >= 2) line(ctx, [at(lit, za), at(lit, zb + 0.15)], look.rim, 0.8 * k, sd.sh < 0.6 ? 0.5 : 0.25);
    }
    if (o.detail >= 2 && h(30) < 0.24) {
      // A fallen block's scar: fresh, paler rock under the cap, its broken edge inked.
      const f = 0.2 + h(31) * 0.5, w = (0.12 + h(32) * 0.12) / sd.len, ht = 0.35 + h(33) * 0.45;
      if (onLip(sd, f) && onLip(sd, Math.min(1, f + w))) {
        const zt = z1 - look.cap - 0.1;
        const a = stationAt(sides, sp.s, f), b = stationAt(sides, sp.s, Math.min(0.95, f + w)), m = stationAt(sides, sp.s, f + w * (0.4 + h(34) * 0.3));
        const scar = [at(a, zt), at(b, zt), at(b, zt - ht * 0.6), at(m, zt - ht), at(a, zt - ht * 0.7)];
        fillPoly(ctx, scar, mix(wallColor(cls, sd.sh, z1, 0.8), look.rim, 0.35));
        line(ctx, scar.slice(1), look.line, 0.85 * k, 0.55);
      }
    }
  }
}

/** The gully a notch in the lip cuts down the face: a dark wedge, inked on its shaded side, its lit side catching the light. */
function gullies(ctx: Ctx, P: Proj, at: (st: Station, z: number) => Pt, cls: number, sides: readonly Side[], run: Run, z0: number, z1: number, o: ColumnOpts, rnd: (n: number) => number): void {
  const look = ROCK[cls]!, k = o.k;
  for (const { s } of run.spans) {
    const sd = sides[s]!;
    for (const l of sd.lips) {
      if (!l.notch) continue;
      const fOf = (g: number): number => l.fa + g * (l.fb - l.fa);
      const fl = fOf(l.notch.g - l.notch.w * 0.75), fr = fOf(l.notch.g + l.notch.w * 0.75), fc = fOf(l.notch.g);
      const deep = rimAt(sd, fc), low = Math.max(z0 + 0.3, z1 - KNEE - 0.1 - rnd(7000 + s) * 0.45);
      const base = stationAt(sides, s, fc);
      const l0 = at(stationAt(sides, s, fl), z1), r0 = at(stationAt(sides, s, fr), z1), tip = at(base, low);
      const inner = P(deep[0], deep[1], z1);
      fillPoly(ctx, [l0, inner, r0, tip], wallColor(cls, Math.min(1, sd.sh + 0.32), z1, -0.4));
      line(ctx, [l0, inner, tip], look.line, 0.8 * k, 0.45);
      if (o.detail >= 2) line(ctx, [r0, tip], look.rim, 0.8 * k, 0.5);
    }
  }
}

// ── tops ────────────────────────────────────────────────────────────────────────────────────────

/** An irregular blob round (u, v) of radius r (tiles), `n` points. */
function blob(u: number, v: number, r: number, n: number, h: (m: number) => number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + h(i) * 0.4, rr = r * (0.72 + h(20 + i) * 0.5);
    out.push([u + Math.cos(a) * rr, v + Math.sin(a) * rr]);
  }
  return out;
}

/** A stone standing on a top at height z (iso): its shaded body, its lit top `hb` levels up, inked. */
function stone(ctx: Ctx, P: Proj, ring: ReadonlyArray<readonly [number, number]>, z: number, hb: number, lit: string, dark: string, k: number): void {
  const base = ring.map(([u, v]) => P(u, v, z)), top = ring.map(([u, v]) => P(u, v, z + hb));
  ctx.fillStyle = dark;
  ctx.beginPath();
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    ctx.moveTo(base[i]![0], base[i]![1]); ctx.lineTo(base[j]![0], base[j]![1]); ctx.lineTo(top[j]![0], top[j]![1]); ctx.lineTo(top[i]![0], top[i]![1]); ctx.closePath();
  }
  ctx.fill();
  fillPoly(ctx, top, lit);
  ctx.save();
  ctx.strokeStyle = C.ink;
  ctx.globalAlpha *= 0.7;
  ctx.lineWidth = 0.8 * k;
  ctx.lineJoin = 'round';
  poly(ctx, top);
  ctx.stroke();
  ctx.restore();
}

/**
 * A top's surface by hardness, kept inside the tile (the next tile's marks are its own): sand
 * pockets with ripples in the soft rock, raised slabs and cracks in the harder, boulders on the
 * hard crests, facets and glints on the heartrock; stipple and pebbles everywhere.
 */
function topMarks(ctx: Ctx, P: Proj, cls: number, z: number, o: ColumnOpts, rnd: (n: number) => number): void {
  const look = ROCK[cls]!, k = o.k, base = topColor(cls, z);
  const pos = (m: number): [number, number] => [0.14 + rnd(m) * 0.72, 0.14 + rnd(m + 1) * 0.72];
  // A grain or two at the paint's detail only: a dot a tile reads as a grid of dots (owner, 2026-10-16).
  const dots = o.detail >= 2 ? 0 : 1;
  ctx.fillStyle = rgba(look.line, 0.2);
  for (let i = 0; i < dots; i++) {
    const [x, y] = P(0.08 + rnd(100 + i) * 0.84, 0.08 + rnd(120 + i) * 0.84, z);
    ctx.beginPath(); ctx.arc(x, y, (0.6 + rnd(140 + i) * 0.8) * k, 0, Math.PI * 2); ctx.fill();
  }
  const pockets = [0.45, 0.22, 0.1, 0][cls]!;
  if (rnd(150) < pockets) {
    // A sand pocket in a hollow: pale sand, its up-light rim in shade, a ripple or two.
    const [u, v] = pos(151), r = 0.09 + rnd(153) * 0.1;
    const ring = blob(u, v, r, 9, (m) => rnd(160 + m));
    fillPoly(ctx, ring.map(([a, b]) => P(a, b, z)), mix(base, SAND_POCKET, 0.55));
    if (o.detail >= 2) {
      line(ctx, ring.slice(4, 9).map(([a, b]) => P(a, b, z)), look.line, 0.7 * k, 0.3);
      for (let q = 0; q < 2; q++) {
        const rv = v - r * 0.3 + q * r * 0.45;
        line(ctx, [P(u - r * 0.45, rv, z), P(u, rv - r * 0.12, z), P(u + r * 0.45, rv, z)], C.dune, 0.9 * k, 0.8);
      }
    }
  }
  if (o.detail < 2) return;
  // Raised slabs: a paler plate, its lit edge to the light, its shadow edge inked.
  const slabs = [0, 1 + (rnd(200) < 0.4 ? 1 : 0), 1, 1 + (rnd(200) < 0.5 ? 1 : 0)][cls]!;
  for (let i = 0; i < slabs; i++) {
    const [u, v] = pos(210 + i * 3), r = 0.07 + rnd(212 + i * 3) * 0.08;
    const ring = blob(u, v, r, 6, (m) => rnd(230 + i * 40 + m)).map(([a, b]) => P(a, b, z));
    fillPoly(ctx, ring, cls === 3 ? mix(base, look.rim, 0.25) : mix(base, '#ffffff', 0.1));
    line(ctx, [...ring.slice(3), ring[0]!], look.line, 0.75 * k, 0.3);
    line(ctx, ring.slice(0, 4), look.rim, 0.75 * k, 0.5);
  }
  // Cracks: a crooked line, now and then a branch.
  const cracks = [1, 2, 3, 2][cls]!;
  for (let i = 0; i < cracks; i++) {
    if (rnd(300 + i) < 0.25) continue;
    let [u, v] = pos(310 + i * 2);
    let a = rnd(320 + i) * 6.283;
    const pts: Pt[] = [P(u, v, z)];
    const steps = cls === 2 ? 4 : 3;
    for (let q = 0; q < steps; q++) {
      a += (rnd(330 + i * 9 + q) - 0.5) * 1.4;
      const d = 0.06 + rnd(340 + i * 9 + q) * 0.06;
      u = Math.min(0.9, Math.max(0.1, u + Math.cos(a) * d)); v = Math.min(0.9, Math.max(0.1, v + Math.sin(a) * d));
      pts.push(P(u, v, z));
      if (q === 1 && rnd(350 + i) < 0.45) {
        const b = a + (rnd(351 + i) < 0.5 ? 1 : -1) * (0.8 + rnd(352 + i) * 0.6);
        line(ctx, [P(u, v, z), P(Math.min(0.92, Math.max(0.08, u + Math.cos(b) * 0.08)), Math.min(0.92, Math.max(0.08, v + Math.sin(b) * 0.08)), z)], look.line, 0.65 * k, 0.35);
      }
    }
    line(ctx, pts, look.line, 0.85 * k, 0.42);
  }
  // Boulders: a stone with its shadow (the light from the top-left: it falls down-right).
  const boulders = [rnd(400) < 0.05 ? 1 : 0, rnd(400) < 0.08 ? 1 : 0, rnd(400) < 0.18 ? 1 : 0, rnd(400) < 0.1 ? 1 : 0][cls]!;
  for (let i = 0; i < boulders; i++) {
    const [u, v] = pos(410 + i * 3), r = 0.045 + rnd(412 + i * 3) * 0.04;
    const ring = blob(u, v, r, 6, (m) => rnd(420 + i * 30 + m));
    fillPoly(ctx, ring.map(([a, b]) => P(a + r * 0.9, b + r * 0.2, z)), rgba(C.ink, 0.2));
    stone(ctx, P, ring, z, r * 1.6, mix(look.lit, '#ffffff', 0.22), wallColor(cls, 0.7, z), k);
  }
  // Pebbles.
  ctx.fillStyle = mix(look.dark, base, 0.6);
  for (let i = 0; i < 2; i++) {
    if (rnd(449 + i) < 0.7) continue;
    const [x, y] = P(0.12 + rnd(450 + i) * 0.76, 0.12 + rnd(460 + i) * 0.76, z);
    ctx.beginPath(); ctx.ellipse(x, y, (1.2 + rnd(470 + i)) * k, (0.8 + rnd(480 + i) * 0.6) * k, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (cls === 3) {
    // Glints on the heartrock, and a glowing vein's mouth.
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 2; i++) {
      const [x, y] = P(0.2 + rnd(500 + i) * 0.6, 0.2 + rnd(510 + i) * 0.6, z), r = (1.6 + rnd(520 + i) * 1.4) * k, w = r * 0.28;
      ctx.beginPath();
      ctx.moveTo(x, y - r); ctx.lineTo(x + w, y - w); ctx.lineTo(x + r, y); ctx.lineTo(x + w, y + w);
      ctx.lineTo(x, y + r); ctx.lineTo(x - w, y + w); ctx.lineTo(x - r, y); ctx.lineTo(x - w, y - w);
      ctx.closePath();
      ctx.fill();
    }
    if (rnd(530) < 0.5) {
      const [x, y] = P(0.3 + rnd(531) * 0.4, 0.3 + rnd(532) * 0.4, z);
      ctx.fillStyle = C.led;
      ctx.beginPath(); ctx.arc(x, y, 1.6 * k, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/**
 * The talus at the foot of higher neighbours' walls on a column's top at height z (`foot`: where
 * they rise from it), a decal of its own (world/relief-view.ts: a few dozen looks serve every foot,
 * instead of a column look for each): the walls' occlusion on the top, fallen blocks and gravel.
 */
export function drawFoot(ctx: Ctx, P: Proj, z: number, cls: number, foot: Foot, seed: number, k: number): void {
  const o: ColumnOpts = { detail: 2, seed, k };
  const rnd = (n: number): number => hashUnit(seed, n, 0x7f);
  ctx.save();
  poly(ctx, [P(0, 0, z), P(1, 0, z), P(1, 1, z), P(0, 1, z)]);
  ctx.clip();
  if (foot.n) talus(ctx, P, z, [foot.n[0], 0], [foot.n[1], 0], [0, 1], cls, o, rnd, 1200);
  if (foot.w) talus(ctx, P, z, [0, foot.w[1]], [0, foot.w[0]], [1, 0], cls, o, rnd, 1500);
  ctx.restore();
}

/**
 * The talus at the foot of a wall, on the ledge at height z in front of it: the wall's foot from a
 * to b (tile-local), `out` the way off it onto the ledge. The occlusion of the wall's foot, then
 * fallen blocks, the biggest against the wall, and gravel — kept off the ends of the foot, so a
 * tile's talus meets the next one's without a stone cut in two.
 */
function talus(ctx: Ctx, P: Proj, z: number, a: readonly [number, number], b: readonly [number, number], out: readonly [number, number], cls: number, o: ColumnOpts, rnd: (n: number) => number, salt: number): void {
  const look = ROCK[cls]!, k = o.k;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 0.1) return;
  const at = (f: number, d: number): [number, number] => [a[0] + (b[0] - a[0]) * f + out[0] * d, a[1] + (b[1] - a[1]) * f + out[1] * d];
  const pt = (f: number, d: number): Pt => P(...at(f, d), z);
  fillPoly(ctx, [pt(0, 0), pt(1, 0), pt(1, 0.2), pt(0, 0.2)], rgba(C.ink, 0.07));
  fillPoly(ctx, [pt(0, 0), pt(1, 0), pt(1, 0.07), pt(0, 0.07)], rgba(C.ink, 0.09));
  const h = (m: number): number => rnd(salt + m);
  const margin = Math.min(0.45, 0.07 / len);
  const n = Math.round(len * (3 + h(0) * 4));
  const blocks: Array<{ f: number; d: number; r: number; i: number }> = [];
  for (let i = 0; i < n; i++) {
    const d = 0.025 + h(1 + i) ** 1.8 * 0.2;
    blocks.push({ f: margin + h(20 + i) * (1 - 2 * margin), d, r: (0.045 - d * 0.1) * (0.6 + h(40 + i) * 0.6), i });
  }
  // Back to front: the blocks against the wall first, the ones rolled furthest last.
  blocks.sort((p, q) => p.d - q.d);
  const lit = mix(look.lit, '#ffffff', 0.12), dark = wallColor(cls, 0.75, z);
  for (const bl of blocks) {
    const [cu, cv] = at(bl.f, bl.d);
    stone(ctx, P, blob(cu, cv, bl.r, 5, (m) => h(60 + bl.i * 9 + m)), z, bl.r * 1.4, lit, dark, k);
  }
  ctx.fillStyle = rgba(look.line, 0.5);
  for (let i = 0; i < Math.round(len * 9); i++) {
    const [x, y] = pt(margin + h(150 + i) * (1 - 2 * margin), 0.02 + h(170 + i) ** 1.5 * 0.28);
    ctx.beginPath(); ctx.arc(x, y, (0.6 + h(190 + i) * 0.7) * k, 0, Math.PI * 2); ctx.fill();
  }
}

/** A tile's corners clockwise from the back (NW, NE, SE, SW), and the 3×3 bits (`TopLook.wet`) of the four tiles meeting at each. */
const CORNERS: ReadonlyArray<readonly [number, number, readonly number[]]> = [
  [0, 0, [0, 1, 3, 4]], [1, 0, [1, 2, 4, 5]], [1, 1, [4, 5, 7, 8]], [0, 1, [3, 4, 6, 7]],
];
/** The neighbour across each side (N, E, S, W: the side leaving each corner above), as a 3×3 bit. */
const ACROSS = [1, 5, 7, 3] as const;

/**
 * The part of a tile inside a pool (`mask`: which tiles of its 3×3 hold it), in tile-local coords
 * clockwise from the back: marching squares over the tile's corners, each worth the share of the
 * four tiles meeting there that hold it, cut at a half. Every tile reads its corners from the same
 * neighbours, so the outline runs on across tiles — straight along a shore, cut on the diagonal at
 * a corner, out of the pool and into the rock where three tiles of water meet it. `shore`: does
 * the segment leaving the point bound the pool (not a side shared with more of it)? `across`: the
 * 3×3 bit of the tile beyond the side the segment runs along (−1: inside the tile).
 */
function poolPart(mask: number): Array<{ u: number; v: number; shore: boolean; across: number }> {
  const val = CORNERS.map(([, , q]) => q.filter((b) => mask & (1 << b)).length / 4);
  const pts: Array<{ u: number; v: number; edge: boolean; side: number }> = [];
  for (let k = 0; k < 4; k++) {
    const [u0, v0] = CORNERS[k]!, [u1, v1] = CORNERS[(k + 1) % 4]!;
    const a = val[k]!, b = val[(k + 1) % 4]!;
    if (a >= 0.5) pts.push({ u: u0, v: v0, edge: a === 0.5, side: k });
    if (a !== 0.5 && b !== 0.5 && a < 0.5 !== b < 0.5) {
      const t = (0.5 - a) / (b - a);
      pts.push({ u: u0 + (u1 - u0) * t, v: v0 + (v1 - v0) * t, edge: true, side: k });
    }
  }
  if (pts.length < 3) return [];
  // A point on side k (leaving corner k) also lies on side k − 1 when it is corner k itself.
  const onSide = (p: { u: number; v: number }, k: number): boolean => (k === 0 ? p.v === 0 : k === 1 ? p.u === 1 : k === 2 ? p.v === 1 : p.u === 0);
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    let shore = p.edge && q.edge, across = -1;
    for (let k = 0; k < 4; k++) if (onSide(p, k) && onSide(q, k)) across = ACROSS[k]!;
    if (across >= 0 && mask & (1 << across)) shore = false;
    return { u: p.u, v: p.v, shore, across };
  });
}

/** A tile's corners (NW, NE, SE, SW): the diagonal neighbour's 3×3 bit and the two orthogonal ones'. */
const DIAG = [[0, 1, 3], [2, 1, 5], [8, 5, 7], [6, 7, 3]] as const;
/**
 * How far a stream's bank cuts across a corner (tiles along each side): a stream tile's corner that
 * touches no water, and the wedge a rock tile takes where a stream steps on diagonally past it —
 * half a tile, the line the rock tiles' corners of water already follow where three tiles of it
 * meet (`poolPart`), so a stream that steps runs on as one straight channel.
 */
const WEDGE = 0.5;
/** The corners a stream leaves its tile by (its way, the eighth of a turn: 0 = +x … 7): kept whole for the lip of its fall. */
const EXIT: ReadonlyArray<readonly number[]> = [[1, 2], [1, 2, 3], [2, 3], [2, 3, 0], [3, 0], [3, 0, 1], [0, 1], [0, 1, 2]];

/** The share of a stream tile its far banks' inner walls take: the channel's sides seen dropping to the water (D115). */
const BANK = 0.11;
/** The stream's middle, deeper: half widths (tiles) of its bands from the edge in, and their colours. */
const MIDDLE: ReadonlyArray<readonly [number, string]> = [[0.3, mix(C.river, C.riverD, 0.22)], [0.2, mix(C.river, C.riverD, 0.42)], [0.11, mix(C.river, C.riverD, 0.6)]];

/**
 * A stream's top (D94; D115: owner, 2026-10-17, of a stream up on the rock: « the visuals are still
 * a little bit broken »): running water in a channel cut a little into the rock, a tile wide. Its
 * corners that touch no water are cut (`WEDGE`) — but at the lip of its fall and where a fall lands
 * on it (`from`) —, and where it steps on diagonally across a corner the rock tiles beside take a
 * wedge of it (`streamWedges`): a stream that steps, orthogonally or diagonally, is one straight
 * channel, not a saw or a string of beads. Its middle deeper along the way it runs (`MIDDLE`); the
 * far banks (north and west, the ones whose inner walls face the camera) show their wall dropping
 * to the water (`BANK`), lit at the lip, wet at the foot; the near banks, the rock's inked lip; the
 * current's strokes; where a fall lands, the water churned white and ringed.
 */
function streamTop(ctx: Ctx, P: Proj, z: number, top: TopLook, o: ColumnOpts, rnd: (n: number) => number, cls: number): void {
  const k = o.k, wet = top.wet | (top.from ?? 0);
  const has = (b: number): boolean => (wet & (1 << b)) !== 0;
  const exit = top.fall ? EXIT[top.flow ?? 0]! : [];
  const cut = [0, 1, 2, 3].map((c) => { const [dg, a, b] = DIAG[c]!; return !has(dg) && !has(a) && !has(b) && !exit.includes(c); });
  // The water's outline, clockwise from the back: each corner, or its cut's two ends.
  const C2 = 1 - WEDGE;
  const outline: Array<{ u: number; v: number; bank: boolean }> = [];
  for (let c = 0; c < 4; c++) {
    const [cu, cv] = CORNERS[c]!, [pu, pv] = CORNERS[(c + 3) % 4]!, [nu, nv] = CORNERS[(c + 1) % 4]!;
    const bankOut = !has(ACROSS[c]!);
    if (cut[c]) {
      outline.push({ u: cu + (pu - cu) * C2, v: cv + (pv - cv) * C2, bank: true });
      outline.push({ u: cu + (nu - cu) * C2, v: cv + (nv - cv) * C2, bank: bankOut });
    } else outline.push({ u: cu, v: cv, bank: bankOut });
  }
  const pts = outline.map((p) => P(p.u, p.v, z));
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle = C.river;
  ctx.lineWidth = 1.6;
  poly(ctx, pts);
  ctx.stroke();
  ctx.fill();
  // Clipped a hair past the tile, so the next tile's water runs on over the seam with no hairline.
  poly(ctx, outline.map((p) => P(0.5 + (p.u - 0.5) * 1.04, 0.5 + (p.v - 0.5) * 1.04, z)));
  ctx.clip();
  // The far banks' walls (north and west: their inner faces turned to the camera) take the
  // water's edge there; the middle runs between them.
  const farN = !has(1) ? 1 : 0, farW = !has(3) ? 1 : 0;
  const [fx, fy] = flowVec(top);
  if (o.detail >= 1) {
    const mu = 0.5 + (farW * BANK) / 2, mv = 0.5 + (farN * BANK) / 2;
    for (const [hw, color] of MIDDLE) {
      // A band along the way it runs, through the water's middle, long enough to leave the tile.
      fillPoly(ctx, [P(mu - fx * 0.9 - fy * hw, mv - fy * 0.9 + fx * hw, z), P(mu + fx * 0.9 - fy * hw, mv + fy * 0.9 + fx * hw, z), P(mu + fx * 0.9 + fy * hw, mv + fy * 0.9 - fx * hw, z), P(mu - fx * 0.9 + fy * hw, mv - fy * 0.9 - fx * hw, z)], color);
    }
  }
  if (o.detail >= 1) streamMarks(ctx, P, z, top, o, rnd);
  if (o.detail >= 1 && top.from) landing(ctx, P, z, top, o, rnd);
  // The far banks' inner walls: a strip of the rock from the lip down to the water, lit at its lip,
  // dark and wet at its foot.
  const wallC = mix(wallColor(cls, 0.45, z), C.riverD, 0.18), footC = mix(C.ink, C.riverD, 0.45);
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!, b = outline[(i + 1) % outline.length]!;
    if (!a.bank) continue;
    const du = b.u - a.u, dv = b.v - a.v, len = Math.hypot(du, dv) || 1;
    // Inward (towards the water): the outline runs clockwise, so the inside is on the right of a→b.
    const iu = -dv / len, iv = du / len;
    // A far bank's wall faces the camera (+u, +v) from the rock into the water.
    if (iu + iv < 0.5) continue;
    const a2 = { u: a.u + iu * BANK, v: a.v + iv * BANK }, b2 = { u: b.u + iu * BANK, v: b.v + iv * BANK };
    fillPoly(ctx, [P(a.u, a.v, z), P(b.u, b.v, z), P(b2.u, b2.v, z), P(a2.u, a2.v, z)], wallC);
    if (o.detail >= 1) {
      line(ctx, [P(a2.u, a2.v, z), P(b2.u, b2.v, z)], rgba(footC, 0.7), 1.6 * k);
      line(ctx, [P(a2.u + iu * 0.04, a2.v + iv * 0.04, z), P(b2.u + iu * 0.04, b2.v + iv * 0.04, z)], 'rgba(255,255,255,0.45)', 0.9 * k);
    }
  }
  ctx.restore();
  // The banks' lip: the rock's edge inked over a paper glow.
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!, b = outline[(i + 1) % outline.length]!;
    if (!a.bank) continue;
    const near = (p: { u: number; v: number }): number => CORNERS.findIndex(([cu, cv]) => Math.abs(cu - p.u) < 1e-6 && Math.abs(cv - p.v) < 1e-6);
    const ca = near(a), cb = near(b);
    const len = Math.hypot(b.u - a.u, b.v - a.v) || 1;
    // Short of a corner whose diagonal tile holds water: the tile across carries the stream past it (a wedge).
    const ta = ca >= 0 && has(DIAG[ca]![0]) ? WEDGE / len : 0, tb = cb >= 0 && has(DIAG[cb]![0]) ? WEDGE / len : 0;
    if (ta + tb >= 1 - 1e-6) continue;
    const seg = [P(a.u + (b.u - a.u) * ta, a.v + (b.v - a.v) * ta, z), P(b.u + (a.u - b.u) * tb, b.v + (a.v - b.v) * tb, z)];
    line(ctx, seg, C.paper, 3 * k, 0.7);
    line(ctx, seg, C.ink, (o.detail >= 2 ? 1.8 : 1.3) * k, 0.95);
  }
}

/**
 * Where a fall lands on a stream (D115: « the falls flowing into the next segment »): along the side
 * it comes over, the water churned white — a band of foam, bubbles — and rings spreading downstream.
 */
function landing(ctx: Ctx, P: Proj, z: number, top: TopLook, o: ColumnOpts, rnd: (n: number) => number): void {
  const k = o.k, from = top.from ?? 0;
  for (let side = 0; side < 4; side++) {
    if (!(from & (1 << ACROSS[side]!))) continue;
    // The side's two corners and the way in, across it.
    const [au, av] = CORNERS[side]!, [bu, bv] = CORNERS[(side + 1) % 4]!;
    const nu = side === 1 ? -1 : side === 3 ? 1 : 0, nv = side === 0 ? 1 : side === 2 ? -1 : 0;
    const at = (f: number, d: number): Pt => P(au + (bu - au) * f + nu * d, av + (bv - av) * f + nv * d, z);
    fillPoly(ctx, [at(0, 0), at(1, 0), at(1, 0.16), at(0.75, 0.24), at(0.5, 0.2), at(0.25, 0.26), at(0, 0.18)], 'rgba(235,248,252,0.62)');
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    for (let q = 0; q < 9; q++) {
      const [x, y] = at(0.08 + rnd(9500 + side * 31 + q) * 0.84, 0.02 + rnd(9520 + side * 31 + q) * 0.2);
      ctx.beginPath(); ctx.ellipse(x, y, (1.6 + rnd(9540 + side * 31 + q) * 2.2) * k, (1 + rnd(9560 + side * 31 + q) * 1.2) * k, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Rings: the landing's swell spreading downstream.
    for (let q = 0; q < 2; q++) {
      const d = 0.34 + q * 0.2, pts: Pt[] = [];
      for (let e = 0; e <= 8; e++) pts.push(at(0.2 + (e / 8) * 0.6, d + Math.sin((e / 8) * Math.PI) * 0.06));
      line(ctx, pts, `rgba(255,255,255,${0.55 - q * 0.2})`, (1.2 - q * 0.3) * k);
    }
  }
}

/** The wedges of a stream stepping diagonally past a rock tile's corners at its height (its two neighbours there hold it, the third tile does not): water, its bank inked. */
function streamWedges(ctx: Ctx, P: Proj, z: number, top: TopLook, o: ColumnOpts): void {
  const k = o.k, has = (b: number): boolean => (top.wet & (1 << b)) !== 0;
  for (let c = 0; c < 4; c++) {
    const [dg, a, b] = DIAG[c]!;
    if (!has(a) || !has(b) || has(dg)) continue;
    const [cu, cv] = CORNERS[c]!, du = cu ? -WEDGE : WEDGE, dv = cv ? -WEDGE : WEDGE;
    const p = P(cu + du, cv, z), q = P(cu, cv + dv, z);
    fillPoly(ctx, [P(cu, cv, z), p, q], C.river);
    line(ctx, [p, q], C.paper, 3 * k, 0.7);
    line(ctx, [p, q], C.ink, (o.detail >= 2 ? 1.8 : 1.3) * k, 0.95);
  }
}

/** Ink a pool part's shore: a paper glow under the ink, as on the floor's water (terrain.ts). */
function inkShore(ctx: Ctx, part: ReadonlyArray<{ shore: boolean }>, pp: readonly Pt[], color: string, w: number, glow: number): void {
  for (const [c, width, a] of [[C.paper, glow, 0.7], [color, w, 0.95]] as const) {
    if (!width) continue;
    for (let i = 0; i < part.length; i++) if (part[i]!.shore) line(ctx, [pp[i]!, pp[(i + 1) % part.length]!], c, width, a);
  }
}

/**
 * The top of a column up on the rock that holds water or borders it (D63), over the top just
 * drawn and inside `topPts`: its part of the pool (shallow, the deep within it), ripples, the
 * shore; reclaimed ground first, as fill.
 */
function drawTop(ctx: Ctx, P: Proj, topPts: readonly Pt[], z: number, top: TopLook, o: ColumnOpts, rnd: (n: number) => number, cls = 0): void {
  const k = o.k;
  ctx.save();
  // Kept inside a top cut back by a drop beside it (rock dug away round the pool); a whole tile's
  // top is not clipped, so the bleed and the shore's ink run on into the next tile's.
  if (topPts.length !== 4) {
    poly(ctx, topPts);
    ctx.clip();
  }
  if (top.kind === 'ground') {
    ctx.fillStyle = C.filled;
    poly(ctx, topPts);
    ctx.fill();
    if (o.detail >= 1) {
      ctx.fillStyle = rgba(C.ink, 0.22);
      for (let i = 0; i < 6; i++) {
        const [x, y] = P(0.15 + rnd(400 + i) * 0.7, 0.15 + rnd(420 + i) * 0.7, z);
        ctx.beginPath(); ctx.arc(x, y, (0.6 + rnd(440 + i) * 0.7) * k, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  if (top.kind === 'river') { streamTop(ctx, P, z, top, o, rnd, cls); ctx.restore(); return; }
  const wet = poolPart(top.wet), pw = wet.map((p) => P(p.u, p.v, z));
  if (top.run) streamWedges(ctx, P, z, top, o);
  if (wet.length) {
    // Each part bleeds into the next (no seam between two tiles of water) — not over a
    // neighbour's deep water, drawn before it.
    const running = !!top.run;
    ctx.fillStyle = ctx.strokeStyle = running ? C.river : C.shallow;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (let i = 0; i < wet.length; i++) {
      const a = wet[i]!.across;
      if (a >= 0 && top.deep & (1 << a)) continue;
      ctx.beginPath(); ctx.moveTo(pw[i]![0], pw[i]![1]); ctx.lineTo(pw[(i + 1) % wet.length]![0], pw[(i + 1) % wet.length]![1]); ctx.stroke();
    }
    poly(ctx, pw);
    ctx.fill();
    const deep = poolPart(top.deep), pd = deep.map((p) => P(p.u, p.v, z));
    if (deep.length) {
      ctx.fillStyle = ctx.strokeStyle = C.deep;
      poly(ctx, pd);
      ctx.stroke();
      ctx.fill();
      if (o.detail >= 1) inkShore(ctx, deep, pd, C.turqL, 1.2 * k, 0);
    }
    if (o.detail >= 1 && top.wet & 16) {
      // A ripple now and then on the tiles of water.
      if (rnd(460) < 0.5) {
        const u = 0.2 + rnd(470) * 0.45, v = 0.25 + rnd(480) * 0.5;
        line(ctx, [P(u, v, z), P(u + 0.12, v - 0.05, z), P(u + 0.24, v, z)], 'rgba(255,255,255,0.75)', 1.1 * k);
      }
    }
    inkShore(ctx, wet, pw, C.ink, (o.detail >= 2 ? 1.8 : 1.3) * k, 3 * k);
  }
  ctx.restore();
}

/** Strata, joints, facets or veins by hardness, then pen hatching on the shaded faces. */
// ── the face ore's vein (D87: quartz set in the cliff) ─────────────────────────────────────────

/**
 * Rock crystal's tones: a milky body, the face towards the light white, the far face and the
 * termination's shade ice-blue, the ink a cool violet-black. Plain paint (no light token: a vein
 * does not glow at night, D83's spy and the night lights never see it).
 */
export const QZ = { body: '#e8f0f3', lit: '#ffffff', shade: '#b4c9d6', deep: '#86a0b6', line: '#232a44' } as const;

/**
 * One terminated crystal point in canvas px: a hexagonal prism from `base` to `tip`, `w` px either
 * side of its axis — three faces seen side by side (the one turned to the light, top-left, white;
 * the far one ice-blue), its termination cut in facets to the tip, its root clouded milky. `lw`:
 * the outline's width (0: none, the far paint's flecks); `fine`: facet edges and a glint (sprites,
 * near plan buckets). Shared by the cliff's vein, the plan's seam (terrain.ts) and the machines'
 * cut quartz (recipes/buildings.ts), so the quartz reads the same wherever it shows.
 */
export function crystal(ctx: Ctx, base: Pt, tip: Pt, w: number, lw: number, fine: boolean): void {
  const dx = tip[0] - base[0], dy = tip[1] - base[1], L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  // The across axis, turned towards the light (from the top-left): +b is the lit side.
  let nx = -uy, ny = ux;
  if (nx * -0.6 + ny * -0.8 < 0) { nx = -nx; ny = -ny; }
  const at = (a: number, b: number): Pt => [base[0] + ux * a + nx * b, base[1] + uy * a + ny * b];
  const sh = Math.max(L * 0.45, L - w * 1.3), sm = Math.min(L * 0.92, sh + w * 0.3);
  const e1 = w * 0.3, e2 = -w * 0.42;
  const out = [at(0, w), at(sh, w), tip, at(sh, -w), at(0, -w)];
  const poly = (q: readonly Pt[], col: string, alpha = 1): void => {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = col;
    ctx.beginPath();
    q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  poly(out, QZ.body);
  poly([at(0, w), at(sh, w), tip, at(sm, e1), at(0, e1)], QZ.lit);
  poly([at(0, e2), at(sm, e2), tip, at(sh, -w), at(0, -w)], QZ.shade);
  poly([at(sm, e2), tip, at(sh, -w)], QZ.deep, 0.7);
  // The root clouded: milky quartz where it grows out of the rock.
  poly([at(0, w), at(L * 0.3, w), at(L * 0.3, -w), at(0, -w)], '#ffffff', 0.4);
  if (fine) {
    const edge = (q: readonly Pt[]): void => line(ctx, q, QZ.line, Math.max(0.5, lw * 0.45), 0.45);
    edge([at(0, e1), at(sm, e1), tip]);
    edge([at(0, e2), at(sm, e2), tip]);
    edge([at(sh, w), at(sm, e1), at(sm, e2), at(sh, -w)]);
  }
  if (lw > 0) {
    ctx.save();
    ctx.strokeStyle = QZ.line;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    out.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
  }
  if (fine) {
    const [gx, gy] = at(sh * 0.86, w * 0.55);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(gx, gy, Math.max(0.7, w * 0.32), 0, Math.PI * 2); ctx.fill();
  }
}

/** Points along a polyline every `step` tiles from `start`, each with its arc length and the outward normal (u, v) there. */
function alongRun(run: ReadonlyArray<{ u: number; v: number; a: number }>, step: number, start: number): Array<{ u: number; v: number; s: number; nu: number; nv: number; tu: number; tv: number }> {
  const out: Array<{ u: number; v: number; s: number; nu: number; nv: number; tu: number; tv: number }> = [];
  let d = start, acc = 0;
  for (let i = 0; i < run.length - 1; i++) {
    const p = run[i]!, q = run[i + 1]!;
    const len = Math.hypot(q.u - p.u, q.v - p.v);
    if (len < 1e-6) continue;
    const tu = (q.u - p.u) / len, tv = (q.v - p.v) / len, a = q.a;
    while (d <= acc + len) {
      const f = (d - acc) / len;
      out.push({ u: p.u + (q.u - p.u) * f, v: p.v + (q.v - p.v) * f, s: d, nu: Math.cos(a), nv: Math.sin(a), tu, tv });
      d += step;
    }
    acc += len;
  }
  return out;
}

/** The seam's height (levels above the slab's foot) at arc length s along a wall: it wanders, low and high. */
const seamAt = (s: number, z0: number, z1: number, ph: number): number => z0 + (z1 - z0) * (0.3 + 0.12 * Math.sin(s * 4.4 + ph) + 0.05 * Math.sin(s * 11 + ph * 2));

/** px per tile of a projection (the crystals' widths follow the drawing's scale: sprite, paint, artboard). */
const scaleOf = (P: Proj): number => { const a = P(0, 0, 0), b = P(1, 0, 0); return Math.hypot(b[0] - a[0], b[1] - a[1]); };

/** The vein's seam across a wall run: a milky band that wanders along it, sparkling (inside the wall). */
function veinSeam(ctx: Ctx, P: Proj, run: ReadonlyArray<{ u: number; v: number; a: number }>, z0: number, z1: number, o: ColumnOpts, rnd: (n: number) => number): void {
  const ph = rnd(500) * 6.28, pts = alongRun(run, 0.06, 0);
  if (pts.length < 2) return;
  const half = (z1 - z0) * 0.075;
  const top = pts.map((p) => P(p.u, p.v, seamAt(p.s, z0, z1, ph) + half));
  const bot = pts.map((p) => P(p.u, p.v, seamAt(p.s, z0, z1, ph) - half)).reverse();
  ctx.save();
  ctx.globalAlpha *= o.detail >= 1 ? 0.62 : 0.8;
  ctx.fillStyle = QZ.body;
  ctx.beginPath();
  [...top, ...bot].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (o.detail < 1) return;
  line(ctx, bot, QZ.deep, 0.9 * o.k, 0.55);
  // Sparkle: white flecks along the seam.
  ctx.fillStyle = '#ffffff';
  for (const [i, p] of pts.entries()) {
    if (rnd(520 + i) > 0.3) continue;
    const [x, y] = P(p.u, p.v, seamAt(p.s, z0, z1, ph) + (rnd(560 + i) - 0.5) * half * 2);
    ctx.beginPath(); ctx.arc(x, y, (0.6 + rnd(600 + i) * 0.7) * o.k, 0, Math.PI * 2); ctx.fill();
  }
}

/**
 * Clusters of rock crystal erupting from the seam of a wall run: every third of a tile or so, a
 * tall point and one or two smaller ones leaning off it, standing out of the face a little.
 */
function veinCrystals(ctx: Ctx, P: Proj, run: ReadonlyArray<{ u: number; v: number; a: number }>, z0: number, z1: number, o: ColumnOpts, rnd: (n: number) => number, r: number): void {
  const ph = rnd(500) * 6.28, sc = scaleOf(P), fine = o.detail >= 2;
  const lw = (fine ? 1.3 : 0.9) * o.k;
  // Standing out of the face only in the sprites: the far paint's crystals (placed by the world's
  // hash, not the sprite's key) stay in the wall's plane, under the sprite's wall when both show.
  const out = fine ? 0.08 : 0;
  const at = alongRun(run, 0.4, 0.14 + rnd(700 + r) * 0.12);
  // The run's far end: keep the clusters off the wall's open-air corners.
  let total = 0;
  for (let i = 0; i < run.length - 1; i++) total += Math.hypot(run[i + 1]!.u - run[i]!.u, run[i + 1]!.v - run[i]!.v);
  for (const [i, p] of at.entries()) {
    if (p.s > total - 0.1 || rnd(710 + r * 31 + i) < 0.18) continue;
    const zb = seamAt(p.s, z0, z1, ph);
    const n = 2 + (rnd(730 + r * 31 + i) < 0.55 ? 1 : 0);
    const big = 0.85 + rnd(750 + r * 31 + i) * 0.4;
    // Far ones first: the side crystals, then the tall middle one over them.
    for (let c = n - 1; c >= 0; c--) {
      const lean = c === 0 ? (rnd(770 + i) - 0.5) * 0.3 : c === 1 ? -0.75 : 0.8;
      const h = (c === 0 ? 0.72 : 0.46) * big * (z1 - z0) / 2;
      const off = c === 0 ? 0 : c === 1 ? -0.085 : 0.095;
      const bu = p.u + p.tu * off, bv = p.v + p.tv * off;
      const base = P(bu, bv, zb - 0.04);
      const tip = P(bu + p.nu * out + p.tu * lean * 0.16, bv + p.nv * out + p.tv * lean * 0.16, zb + h);
      crystal(ctx, base, tip, (c === 0 ? 0.085 : 0.062) * big * sc, lw, fine);
    }
  }
}

/** A face ore's points poking up along the lip of a column's top, over the sides that drop (any side: a face may look away). */
function veinLip(ctx: Ctx, P: Proj, pts: readonly OutlinePt[], z: number, o: ColumnOpts, rnd: (n: number) => number): void {
  const sc = scaleOf(P), fine = o.detail >= 2, lw = (fine ? 1.2 : 0.85) * o.k;
  let n = 0;
  for (const run of silhouetteRuns(pts)) {
    const r = run.map((p) => ({ u: p.u, v: p.v, a: 0 }));
    for (const p of alongRun(r, 0.36, 0.16 + rnd(800 + n) * 0.1)) {
      n++;
      if (rnd(820 + n) < 0.45) continue;
      // Just inside the edge, leaning out over it.
      const bu = p.u + (0.5 - p.u) * 0.14, bv = p.v + (0.5 - p.v) * 0.14;
      const ou = (p.u - 0.5) * 0.12, ov = (p.v - 0.5) * 0.12;
      const h = 0.34 + rnd(840 + n) * 0.22;
      crystal(ctx, P(bu, bv, z - 0.04), P(bu + ou, bv + ov, z + h), 0.065 * sc, lw, fine);
      if (rnd(860 + n) < 0.5) crystal(ctx, P(bu + 0.07, bv - 0.05, z - 0.03), P(bu + 0.07 + ou * 1.6, bv - 0.05 + ov * 1.6, z + h * 0.6), 0.048 * sc, lw, fine);
    }
  }
}

/** Consecutive outline points joined by silhouette edges. */
function silhouetteRuns(pts: readonly OutlinePt[]): OutlinePt[][] {
  const runs: OutlinePt[][] = [];
  let cur: OutlinePt[] | null = null;
  const n = pts.length;
  // Start right after a non-silhouette segment, so runs are not split at index 0.
  let start = 0;
  for (let i = 0; i < n; i++) if (!pts[(i + n - 1) % n]!.sil) { start = i; break; }
  for (let s = 0; s < n; s++) {
    const i = (start + s) % n;
    const p = pts[i]!, q = pts[(i + 1) % n]!;
    if (p.sil) {
      if (!cur) { cur = [p]; runs.push(cur); }
      cur.push(q);
    } else cur = null;
  }
  return runs;
}
