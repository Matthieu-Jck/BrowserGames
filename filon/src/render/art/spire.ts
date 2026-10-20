// spire.ts — a rock spire (map 6, D147; owner, 2026-10-19: « in an area of the desert around the
// cirque put lots of very small but tall mountains that will seem like big spiky mountains. Very
// unusual. »): one tile at the foot, as tall as the land's level there (map 6's needles stand 4 to
// 14 levels, far over the mountains' 5), drawn as rough rock — never as a column of terrace slabs
// (relief.ts masks: a needle would read as a stack of crates). After Bryce Canyon's hoodoos,
// Zhangjiajie's pillars and Cappadocia's fairy chimneys:
// · a spire is a clump of one to three needles on a mound of scree, the main one the tile's full
//   height, the others shorter at its side (a crown of points, a fin);
// · a needle is a stack of beds — the mesas' own table (rock.ts `BEDS`, by absolute height), so the
//   whole field shows one geology — each bed a block of rock with flat fractured faces (an irregular
//   section of its own, so the silhouette is jagged), stepping in at the bed planes (a ledge: a lit
//   shelf), narrowing up to a point, a broken top or a hoodoo's wider cap rock; some leaning;
// · flat facets lit by the way they face (the light from the top-left, as everywhere), the beds in
//   gentle bands, the ink as the mesas': the silhouette, the ridges between facets, cracks, hatching
//   in the shade, the ledges' lips.
// One shape (`spireShape`: the same rings at every detail, so a sprite covers its painted self
// exactly) serves the relief sprites (world/relief-view.ts), the far paint (art/terrain.ts
// `paintRelief`), the sun's shadows (`spireShadow`), the shade on the rock round it
// (`spireHeightAt`) and the plan's mark (`spirePlan`: contour rings and hachures, a peak from above).
// Worker-safe (Canvas2D only).
import { hash32, hashUnit } from '@/core/hash';
import { shadeOf } from '../relief';
import { C, mix, rgba } from './tokens';
import { ink, type Ctx, type Pt } from './ink';
import { BEDS, blob, stone, toneAt, type Proj } from './rock';

/** A spire's tile in the biome array (mapgen.ts `BIOME.spire`, D147); the painter keeps off the generator's module. */
export const SPIRE_BIOME = 32;

/** Vertices round a needle's section: few, so its faces are flat fractures. */
const N = 7;

/** The builds of the main needle: a needle to a point, a pillar with a broken top, a hoodoo under its cap rock. */
export const NEEDLE = 0, PILLAR = 1, HOODOO = 2;

/** One ring of a needle: its height (levels; each vertex `dz` above it), its axis there (tile-local u, v), its radius at each vertex (tiles); `part` 0 the scree, 1 the rock, 2 a cap rock. */
export interface SpireRing { readonly z: number; readonly cu: number; readonly cv: number; readonly r: Float32Array; readonly dz: Float32Array | null; readonly part: 0 | 1 | 2 }

/** A needle: its section's vertex angles, its rings bottom to top, whether its top is a flat (a cap's, a broken pillar's) or a point. */
export interface Needle { readonly ang: Float32Array; readonly rings: readonly SpireRing[]; readonly flat: boolean; readonly nrm: Float32Array }

/** A spire's solid: its height (relief levels), its main needle's build, its scree mound and its needles, back to front. */
export interface SpireShape { readonly h: number; readonly kind: number; readonly mound: Needle; readonly needles: readonly Needle[] }

/** Which look a spire takes (one of four), hashed from the world tile: the same for the sprites and the far paint. */
export const spireVariant = (x: number, y: number): number => hash32(x, y, 0x5b) & 3;

/** The seed of a spire's shape and marks, from what its sprite's key holds. */
export const spireSeed = (h: number, variant: number): number => hash32(h, variant, 0x5b1e);

const SHAPES = new Map<number, SpireShape>();

/** The thick beds' bases (rank 2) strictly between z0 and z1: where a needle's beds meet. */
const planesIn = (z0: number, z1: number): number[] => BEDS.filter((b) => b.rank === 2 && b.z > z0 + 0.4 && b.z < z1 - 0.4).map((b) => b.z);

/**
 * One needle `H` levels tall from `z0`, its foot `rb` round (tiles) at axis (u, v), its top `rt`
 * round (≈ 0: a point), leaning (lu, lv) at its top; `kind` its top's build. Its beds stack from
 * its foot: each a block with its own fractured section, stepping in at the planes.
 */
function needle(hu: (m: number) => number, salt: number, u: number, v: number, z0: number, H: number, rb: number, rt: number, lu: number, lv: number, kind: number, foot: number): Needle {
  const h = (m: number): number => hu(salt + m);
  const ang = new Float32Array(N), rot = h(0) * 6.283;
  for (let i = 0; i < N; i++) ang[i] = rot + ((2 * Math.PI) / N) * (i + (h(1 + i) - 0.5) * 0.55);
  // Fins: a section longer one way (two lobes), the same up the needle.
  const fin = 0.16 + h(10) * 0.22, fph = h(11) * 6.283;
  const lobe = Array.from({ length: N }, (_, i) => 1 + fin * Math.cos(2 * ang[i]! + fph));
  // How its radius falls off with height: a needle as a mountain does, its flanks flaring out to
  // its foot and steepening to its peak (concave); a pillar near straight; a hoodoo between.
  const top = z0 + H, p = kind === NEEDLE ? 0.85 + h(12) * 0.6 : kind === PILLAR ? 1.2 + h(12) * 0.8 : 0.8 + h(12) * 0.3;
  const axis = (z: number): [number, number] => { const s = Math.max(0, (z - z0) / H) ** 1.5; return [u + lu * s, v + lv * s]; };
  const room = (cu: number, cv: number): number => 0.48 - Math.max(Math.abs(cu - 0.5), Math.abs(cv - 0.5));
  const radius = (z: number): number => rb + (rt - rb) * Math.min(1, Math.max(0, (z - z0) / H)) ** p;
  const rings: SpireRing[] = [];
  const ring = (z: number, R: number, noise: (i: number) => number, part: 0 | 1 | 2, dz: Float32Array | null = null): void => {
    const [cu, cv] = axis(z), r = new Float32Array(N), m = room(cu, cv);
    for (let i = 0; i < N; i++) r[i] = Math.max(0.008, Math.min(m, R * lobe[i]! * noise(i)));
    rings.push({ z, cu, cv, r, dz, part });
  };
  // Its foot: from the ground, a little wider (`foot` × its body's), up to where its beds begin.
  if (z0 > 0) ring(0, rb * foot, (i) => 1 + (h(70 + i) - 0.5) * 0.12, 1);
  // The beds: from the foot to the top's block, broken at the planes (short beds merged).
  const capT = kind === HOODOO ? Math.min(H * 0.2, 0.7 + h(13) * 0.5) : 0;
  const body = top - capT;
  // Its ledges: a few of the thick beds' bases (about one in three, none closer than 2.5 levels to
  // the last), where it steps in and its section breaks anew; between them its faces run on.
  const breaks: number[] = [];
  for (const z of planesIn(z0, body)) if (hashUnit(Math.floor(h(22) * 1e6), Math.round(z * 100), 0x5b4) < 0.34 && z - (breaks[breaks.length - 1] ?? z0) > 2.5) breaks.push(z);
  const cuts = [z0, ...breaks, body];
  let shrink = 1;
  for (let b = 0; b + 1 < cuts.length; b++) {
    const za = cuts[b]!, zb = cuts[b + 1]!;
    // Each stretch's own section (fractured), stepped in at its foot but the first's.
    const n = (i: number): number => 1 + (hashUnit(Math.floor(h(20) * 1e6), b, i, 0x5b3) - 0.5) * 0.4;
    if (b > 0) shrink *= 1 - (0.06 + hashUnit(Math.floor(h(21) * 1e6), b, 0x5b4) * 0.1);
    const last = b + 2 === cuts.length && kind !== HOODOO;
    ring(za, radius(za) * shrink, n, 1);
    // Rings between, every level or so: its taper, its lean, and a bulge or a waist at a soft or a
    // hard bed (the beds' own wear, gentle).
    const steps = Math.max(1, Math.ceil((zb - za) / 1.1));
    for (let q = 1; q < steps; q++) {
      // Lumpy: a bulge or a waist by the ring (its own draw), the soft beds worn in.
      const z = za + ((zb - za) * q) / steps, wear = (1 - 0.12 * (0.5 - 0.5 * toneAt(2, z))) * (0.9 + hashUnit(Math.floor(h(23) * 1e6), b, q, 0x5b5) * 0.16);
      const nz = (i: number): number => n(i) * (1 + 0.09 * Math.sin(z * 1.7 + i * 2.3 + h(24) * 6.28));
      ring(z, radius(z) * shrink * wear, nz, 1);
    }
    if (last && kind === PILLAR) {
      // A broken top: its rim at uneven heights, the top tilted and torn.
      const dz = new Float32Array(N);
      for (let i = 0; i < N; i++) dz[i] = -h(30 + i) * Math.min(0.9, H * 0.08);
      ring(zb, radius(zb) * shrink, n, 1, dz);
    } else ring(zb, radius(zb) * shrink, n, 1);
  }
  if (kind === HOODOO) {
    // The cap rock: harder, wider than the neck under it, its edge broken, its top a little domed.
    const neck = radius(body) * shrink, rc = Math.min(0.3, Math.max(neck * 1.6, 0.14 + h(40) * 0.1));
    const n = (i: number): number => 1 + (h(41 + i) - 0.5) * 0.4;
    ring(body, rc, n, 2);
    ring(body + capT * 0.75, rc * 0.97, n, 2);
    const dz = new Float32Array(N);
    for (let i = 0; i < N; i++) dz[i] = -h(50 + i) * capT * 0.3;
    ring(top, rc * 0.8, n, 2, dz);
  }
  // Its faces' light: the section's own (its lobes, not each bed's fractures), so a face keeps one
  // light up the needle — no patchwork.
  const nrm = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N, a = [lobe[i]! * Math.cos(ang[i]!), lobe[i]! * Math.sin(ang[i]!)], b = [lobe[j]! * Math.cos(ang[j]!), lobe[j]! * Math.sin(ang[j]!)];
    nrm[i] = normalOf(a, b);
  }
  return { ang, rings, flat: kind !== NEEDLE, nrm };
}

/**
 * The solid of a spire `h` relief levels tall (D147), from its seed: its main needle's build (by
 * height and the hash: the short ones mostly hoodoos, the tall ones needles and broken pillars), up
 * to two shorter needles at its side, and its mound of scree. Kept: the looks are few (heights ×
 * four variants).
 */
export function spireShape(h: number, seed: number): SpireShape {
  const key = hash32(h, seed);
  const kept = SHAPES.get(key);
  if (kept) return kept;
  const hu = (m: number): number => hashUnit(seed, m, 0x5b2);
  const r0 = hu(1);
  const kind = h <= 12 ? (r0 < 0.45 ? HOODOO : r0 < 0.8 ? NEEDLE : PILLAR) : h >= 20 ? (r0 < 0.62 ? NEEDLE : r0 < 0.95 ? PILLAR : HOODOO) : r0 < 0.18 ? HOODOO : r0 < 0.65 ? NEEDLE : PILLAR;
  // The mound of scree: from the tile's edge up to the needles' feet.
  const zs = 0.5 + hu(2) * 0.6;
  const moundRing = (z: number, R: number): SpireRing => {
    const r = new Float32Array(N);
    for (let i = 0; i < N; i++) r[i] = R * (1 + (hu(3 + i) - 0.5) * 0.18);
    return { z, cu: 0.5, cv: 0.5, r, dz: null, part: 0 };
  };
  const mang = new Float32Array(N);
  for (let i = 0; i < N; i++) mang[i] = hu(19) * 6.283 + ((2 * Math.PI) / N) * (i + (hu(60 + i) - 0.5) * 0.5);
  // (Its debris on the ground round the foot: a decal, `drawSpire`; its solid casts and stands in the shade's reading.)
  const mound: Needle = { ang: mang, rings: [moundRing(0, 0.46), moundRing(zs * 0.45, 0.4), moundRing(zs, 0.27)], flat: false, nrm: new Float32Array(N) };
  // The main needle, full height, off the middle a little, leaning.
  const lean = kind === PILLAR ? 0.06 : 0.12;
  const mu = 0.5 + (hu(20) - 0.5) * 0.08, mv = 0.5 + (hu(21) - 0.5) * 0.08;
  const rb = kind === HOODOO ? 0.32 + hu(22) * 0.08 : kind === NEEDLE ? 0.38 + hu(22) * 0.06 : 0.34 + hu(22) * 0.07;
  const rt = kind === NEEDLE ? 0.01 : kind === PILLAR ? 0.14 + hu(23) * 0.07 : 0.11 + hu(23) * 0.05;
  const main = needle(hu, 100, mu, mv, zs, h - zs, rb, rt, (hu(24) - 0.5) * lean * 2, (hu(25) - 0.5) * lean * 2, kind, 1.18);
  // Side needles: none, one or two, shorter, at the main one's flanks (a crown, a fin).
  const sides: Needle[] = [];
  const n = h < 10 ? (hu(26) < 0.4 ? 1 : 0) : hu(26) < 0.15 ? 0 : hu(26) < 0.6 ? 1 : 2;
  for (let s = 0; s < n; s++) {
    const a = hu(30 + s) * 6.283, d = 0.17 + hu(32 + s) * 0.08;
    const H = h * (0.38 + hu(34 + s) * 0.42);
    sides.push(needle(hu, 200 + s * 100, mu + Math.cos(a) * d, mv + Math.sin(a) * d, zs * 0.8, H - zs * 0.8, 0.15 + hu(36 + s) * 0.07, 0.01, (hu(38 + s) - 0.5) * 0.12, (hu(40 + s) - 0.5) * 0.12, NEEDLE, 1.15));
  }
  // Back to front (the camera sits at +x +y).
  const needles = [main, ...sides].sort((p, q) => p.rings[0]!.cu + p.rings[0]!.cv - (q.rings[0]!.cu + q.rings[0]!.cv));
  const shape: SpireShape = { h, kind, mound, needles };
  SHAPES.set(key, shape);
  return shape;
}

/** A ring's vertex i (tile-local u, v, and its height). */
const vtx = (nd: Needle, g: SpireRing, i: number): [number, number, number] => {
  const j = i % N, a = nd.ang[j]!;
  return [g.cu + g.r[j]! * Math.cos(a), g.cv + g.r[j]! * Math.sin(a), g.z + (g.dz ? g.dz[j]! : 0)];
};

/** A ring's mean radius (tiles). */
const meanR = (g: SpireRing): number => { let t = 0; for (let i = 0; i < N; i++) t += g.r[i]!; return t / N; };

// ── colour ─────────────────────────────────────────────────────────────────────────────────────

/** The spires' rock: the warm middle, a pale soft bed, an iron-red hard one, the cap's harder rock, the tops, the ink's line, the lit lip, the shade's violet, the scree. */
const SP = { warm: '#df9f7c', pale: '#f2d3b8', red: '#c8705a', cap: '#a8675e', top: '#f3d6bd', line: '#6a2f37', rim: '#fff2e4', shade: '#4d2b4a', scree: '#d8ab8a' } as const;

const COLORS = new Map<string, string>();
/** A face's colour: its part, its bed's tone (quantised), its shade (0 lit … 1 away), how much it looks up (a ledge, a top). Kept: a spire fills hundreds of faces. */
function faceColor(part: number, tone: number, sh: number, up: number): string {
  // Three lights, as an ink drawing's flats: lit, half, shade (and a ledge's or a top's up-light).
  const t = Math.round(tone * 3) / 3, s = sh < 0.34 ? 0.08 : sh < 0.62 ? 0.45 : 0.9, u = up > 0.55 ? 1 : 0;
  const key = `${part}:${t}:${s}:${u}`;
  let c = COLORS.get(key);
  if (!c) {
    const base = part === 0 ? SP.scree : part === 2 ? SP.cap : t > 0 ? mix(SP.warm, SP.pale, t * 0.55) : mix(SP.warm, SP.red, -t * 0.5);
    c = mix(mix(base, SP.shade, s * (part === 2 ? 0.6 : 0.66)), part === 2 ? mix(SP.cap, SP.top, 0.45) : SP.top, u * 0.75);
    COLORS.set(key, c);
  }
  return c;
}

// ── drawing ────────────────────────────────────────────────────────────────────────────────────

export interface SpireOpts {
  /** 0 = far paint, 1 = the terrain worker's near paint, 2 = sprites (full marks). The shape is the same at all three. */
  detail: 0 | 1 | 2;
  /** Seed (`spireSeed`). */
  seed: number;
  /** Line width unit (px per 1 at sprite scale). */
  k: number;
}

function fillPoly(ctx: Ctx, pts: readonly Pt[], color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.closePath();
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

/** How much a horizontal direction faces the camera (which sits at +x +y): > 0 seen. */
const facing = (a: number): number => (Math.cos(a) + Math.sin(a)) * Math.SQRT1_2;
/** The outward normal's angle of the face from vertex a to vertex b of a section (counter-clockwise in u, v: its right-hand side out). */
const normalOf = (a: readonly number[], b: readonly number[]): number => Math.atan2(-(b[0]! - a[0]!), b[1]! - a[1]!);

/**
 * Paint one needle (or the scree mound): ring by ring from its foot up, the faces the camera sees
 * back to front (an overhang above covers the bed under it), each in its bed's tone and its light; a
 * ledge where a bed steps in (two rings at one height: a lit shelf); its top; then its ink.
 */
function drawNeedle(ctx: Ctx, P: Proj, nd: Needle, o: SpireOpts, salt: number, mound: boolean): void {
  const k = o.k, R = nd.rings;
  const tile = R.map((g) => Array.from({ length: N }, (_, i) => vtx(nd, g, i)));
  const pts = tile.map((row) => row.map(([u, v, z]) => P(u, v, z)));
  // The silhouette: each ring's leftmost and rightmost points on screen.
  const left: Pt[] = [], right: Pt[] = [];
  for (const p of pts) {
    let a = p[0]!, b = p[0]!;
    for (const q of p) { if (q[0] < a[0]) a = q; if (q[0] > b[0]) b = q; }
    left.push(a); right.push(b);
  }
  // Under-fill the whole silhouette (no hairline between faces).
  fillPoly(ctx, [...left, ...right.slice().reverse()], faceColor(mound ? 0 : 1, 0, 0.55, 0));
  const ridges: Array<[number, number, number]> = [];
  for (let r = 0; r + 1 < R.length; r++) {
    const a = R[r]!, b = R[r + 1]!;
    const part = mound || a.part === 0 ? 0 : b.part === 2 && a.part === 2 ? 2 : 1;
    const tone = toneAt(2, (a.z + b.z) / 2 + 0.01) * 0.8;
    const faces: Array<{ i: number; f: number; sh: number; up: number }> = [];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, nrm = nd.nrm[i]!, f = facing(nrm);
      if (f < -0.25) continue;
      // How much it looks up: the ring above drawn in (a ledge, a taper), over the height between.
      const rin = (a.r[i]! + a.r[j]!) - (b.r[i]! + b.r[j]!), dz = Math.max(0.02, b.z - a.z);
      faces.push({ i, f, sh: shadeOf(nrm), up: Math.max(0, Math.min(mound ? 0.35 : 1, rin / (2 * dz * 0.3))) });
    }
    faces.sort((p, q) => p.f - q.f);
    for (const fc of faces) {
      const j = (fc.i + 1) % N;
      fillPoly(ctx, [pts[r]![fc.i]!, pts[r]![j]!, pts[r + 1]![j]!, pts[r + 1]![fc.i]!], faceColor(part, tone, fc.sh, fc.up));
    }
    // Ridges between two faces in sight whose light differs: the rock's fractures.
    if (o.detail >= 1 && !mound) {
      for (const fc of faces) {
        const next = faces.find((q) => q.i === (fc.i + 1) % N);
        if (next && fc.f > 0 && next.f > 0 && Math.abs(fc.sh - next.sh) > 0.18) ridges.push([r, (fc.i + 1) % N, fc.sh > next.sh ? 1 : 0]);
      }
    }
  }
  // The top: a flat (a cap's, a broken pillar's, the mound's), lit and inked.
  const top = pts[pts.length - 1]!;
  if (nd.flat) fillPoly(ctx, top, faceColor(mound ? 0 : R[R.length - 1]!.part, 0.4, 0.15, 1));
  if (mound) return;
  // ── ink ──
  if (o.detail >= 1) {
    for (const [r, i, dark] of ridges) line(ctx, [pts[r]![i]!, pts[r + 1]![i]!], dark ? SP.line : SP.rim, 0.75 * k, dark ? 0.4 : 0.45);
    // The ledges' lips: where a bed steps in, its shelf's front edge.
    for (let r = 1; r < R.length; r++) {
      if (Math.abs(R[r]!.z - R[r - 1]!.z) > 1e-6) continue;
      const arc: Pt[] = [];
      for (let i = 0; i <= N; i++) { const j = i % N, f = facing(normalOf(tile[r - 1]![(j + N - 1) % N]!, tile[r - 1]![j]!)); if (f > -0.1) arc.push(pts[r - 1]![j]!); }
      line(ctx, arc, SP.line, 0.85 * k, 0.5);
    }
    // A point of face i (vertices i, i + 1) at fraction t across it, between rings r and r + 1 at e.
    const at = (r: number, i: number, t: number, e = 0): Pt => {
      const j = (i + 1) % N, a = pts[r]!, b = pts[Math.min(R.length - 1, r + 1)]!;
      const x0 = a[i]![0] + (a[j]![0] - a[i]![0]) * t, y0 = a[i]![1] + (a[j]![1] - a[i]![1]) * t;
      const x1 = b[i]![0] + (b[j]![0] - b[i]![0]) * t, y1 = b[i]![1] + (b[j]![1] - b[i]![1]) * t;
      return [x0 + (x1 - x0) * e, y0 + (y1 - y0) * e];
    };
    const seen = Array.from({ length: N }, (_, i) => facing(nd.nrm[i]!) > 0.05);
    // The beds across its front: a fine line at each plane of the table (rank ≥ 1), broken here and there.
    for (const b of BEDS) {
      if (b.rank < 1) continue;
      const r = R.findIndex((g, q) => q + 1 < R.length && g.z <= b.z && R[q + 1]!.z > b.z);
      if (r < 0 || R[r]!.part === 2 || R[r + 1]!.part === 2) continue;
      const e = (b.z - R[r]!.z) / (R[r + 1]!.z - R[r]!.z);
      let run: Pt[] = [];
      for (let i = 0; i < N; i++) {
        if (!seen[i] || hashUnit(o.seed, salt, Math.round(b.z * 100), i) < 0.18) { line(ctx, run, SP.line, (b.rank === 2 ? 0.8 : 0.55) * k, b.rank === 2 ? 0.42 : 0.28); run = []; continue; }
        if (!run.length) run.push(at(r, i, 0, e));
        run.push(at(r, i, 1, e));
      }
      line(ctx, run, SP.line, (b.rank === 2 ? 0.8 : 0.55) * k, b.rank === 2 ? 0.42 : 0.28);
    }
    if (o.detail >= 2) {
      for (let i = 0; i < N; i++) {
        if (!seen[i]) continue;
        const sh = shadeOf(nd.nrm[i]!), hh = (m: number): number => hashUnit(o.seed, salt, i, m);
        if (sh > 0.5) {
          // Hatching in the shade: strokes hung down the face, denser where it is darker.
          const n = Math.round(R.length * (0.35 + (sh - 0.5) * 0.9));
          for (let q = 0; q < n; q++) {
            const r = Math.floor(hh(100 + q) * (R.length - 2)), t = 0.12 + hh(200 + q) * 0.76, len = 1 + Math.floor(hh(300 + q) * 4);
            if (R[r]!.part === 2) continue;
            line(ctx, [at(r, i, t), at(Math.min(R.length - 2, r + len), i, t + (hh(400 + q) - 0.5) * 0.08, 1)], C.ink, 0.6 * k, 0.1 + (sh - 0.5) * 0.4);
          }
        } else {
          // Cracks down the lit faces, and weathering pits.
          for (let q = 0; q < Math.ceil(R.length / 5); q++) {
            const r = Math.floor(hh(500 + q) * (R.length - 2)), t = 0.15 + hh(600 + q) * 0.7, len = 1 + Math.floor(hh(700 + q) * 3);
            const p: Pt[] = [];
            for (let w = 0; w <= len; w++) p.push(at(Math.min(R.length - 2, r + w), i, t + (hh(800 + q * 7 + w) - 0.5) * 0.12));
            line(ctx, p, SP.line, 0.65 * k, 0.38);
          }
          ctx.fillStyle = rgba(SP.line, 0.3);
          for (let q = 0; q < Math.ceil(R.length / 3); q++) {
            const [x, y] = at(Math.floor(hh(900 + q) * (R.length - 1)), i, 0.1 + hh(950 + q) * 0.8, hh(980 + q));
            ctx.beginPath(); ctx.ellipse(x, y, (0.7 + hh(990 + q) * 0.9) * k, (0.5 + hh(995 + q) * 0.6) * k, 0, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }
  }
  if (o.detail >= 2) {
    ink(ctx, left, { w: 1.45 * k, seed: o.seed + salt + 3, taper: 0.05, jitter: 0.3 });
    ink(ctx, right, { w: 1.45 * k, seed: o.seed + salt + 5, taper: 0.05, jitter: 0.3 });
  } else {
    line(ctx, left, C.ink, 1.15 * k, 0.85);
    line(ctx, right, C.ink, 1.15 * k, 0.85);
  }
  if (nd.flat) {
    line(ctx, [...top, top[0]!], C.ink, (o.detail >= 2 ? 1.2 : 0.95) * k, 0.85);
    // Its lit lip.
    if (o.detail >= 1) {
      const lit: Pt[] = [];
      const last = tile[tile.length - 1]!;
      for (let i = 0; i <= N; i++) { const j = i % N; if (shadeOf(normalOf(last[(j + N - 1) % N]!, last[j]!)) < 0.45) lit.push(top[j]!); }
      line(ctx, lit, SP.rim, 1.1 * k, 0.7);
    }
  }
}

/**
 * Paint a spire `h` relief levels tall on its tile (P: tile-local u, v and height z in levels → px):
 * its mound of scree, its needles back to front, the gravel and the fallen blocks round its foot.
 */
export function drawSpire(ctx: Ctx, P: Proj, h: number, o: SpireOpts): void {
  const s = spireShape(h, o.seed), k = o.k;
  // The debris round its foot, on the ground: a ragged patch of scree, its gravel.
  const m0 = s.mound.rings[0]!, patch: Pt[] = [];
  for (let i = 0; i < N * 2; i++) {
    const a = s.mound.ang[0]! + (Math.PI * i) / N, rr = 0.44 * (0.86 + hashUnit(o.seed, i, 0x5bf) * 0.16);
    patch.push(P(m0.cu + rr * Math.cos(a), m0.cv + rr * Math.sin(a), 0));
  }
  fillPoly(ctx, patch, rgba(SP.scree, 0.32));
  if (o.detail >= 1) {
    const rnd = (m: number): number => hashUnit(o.seed, m, 0x5b8);
    ctx.fillStyle = rgba(SP.line, 0.4);
    for (let q = 0; q < (o.detail >= 2 ? 30 : 10); q++) {
      const a = rnd(q) * 6.283, rr = 0.2 + rnd(100 + q) * 0.25;
      const [x, y] = P(0.5 + rr * Math.cos(a), 0.5 + rr * Math.sin(a), 0);
      ctx.beginPath(); ctx.arc(x, y, (0.5 + rnd(200 + q) * 0.8) * k, 0, Math.PI * 2); ctx.fill();
    }
  }
  s.needles.forEach((nd, n) => drawNeedle(ctx, P, nd, o, 10 + n * 7, false));
  if (o.detail >= 1) {
    // Blocks fallen from above round its foot.
    const rnd = (n: number): number => hashUnit(o.seed, n, 0x5be);
    const blocks: Array<{ u: number; v: number; r: number; q: number }> = [];
    for (let q = 0; q < 2 + Math.floor(rnd(1) * 4); q++) {
      const a = rnd(10 + q) * 6.283;
      if (facing(a) < 0) continue;
      const r = 0.03 + rnd(20 + q) * 0.04, d = 0.46 - r;
      blocks.push({ u: 0.5 + d * Math.cos(a), v: 0.5 + d * Math.sin(a), r, q });
    }
    blocks.sort((a, b) => a.u + a.v - (b.u + b.v));
    for (const b of blocks) stone(ctx, P, blob(b.u, b.v, b.r, 5, (n) => rnd(40 + b.q * 9 + n)), 0, b.r * 1.5, mix(SP.scree, '#ffffff', 0.25), mix(SP.red, SP.shade, 0.45), k);
  }
}

// ── what reads its solid ───────────────────────────────────────────────────────────────────────

/**
 * A spire's cast shadow on the ground (D147: « a spire's long shadow would look great »): each
 * needle's rings moved along the light (`sx`, `sy` tiles per relief level), joined by their two
 * flanks across it — long tapering shadows, a cap's a blot at the end. Opaque fills: the caller
 * paints all shadows as one union, then shows it once (terrain.ts `paintSunShadows`).
 */
export function spireShadow(ctx: Ctx, P: Proj, h: number, seed: number, sx: number, sy: number): void {
  const s = spireShape(h, seed), n = Math.hypot(sx, sy);
  const pu = n > 1e-6 ? -sy / n : 1, pv = n > 1e-6 ? sx / n : 0;
  for (const nd of [s.mound, ...s.needles]) {
    const L: Pt[] = [], R: Pt[] = [];
    for (const g of nd.rings) {
      const ou = g.cu + sx * g.z, ov = g.cv + sy * g.z, m = meanR(g);
      L.push(P(ou - pu * m, ov - pv * m, 0));
      R.push(P(ou + pu * m, ov + pv * m, 0));
    }
    fillPoly(ctx, [...L, ...R.reverse()], C.ink);
    const g = nd.rings[nd.rings.length - 1]!, ring: Pt[] = [];
    for (let i = 0; i < N; i++) { const [u, v, z] = vtx(nd, g, i); ring.push(P(u + sx * z, v + sy * z, 0)); }
    fillPoly(ctx, ring, C.ink);
  }
}

/**
 * How high a spire stands at a point of its tile (u, v tile-local; relief levels): the highest ring
 * of its needles (or its mound) whose round holds it (its mean radius about its axis), 0 off its
 * foot. The shade on the rock round it and on the floor reads it (world/relief-view.ts), as the rock
 * as drawn.
 */
export function spireHeightAt(h: number, seed: number, u: number, v: number): number {
  const s = spireShape(h, seed);
  let best = 0;
  for (const nd of [s.mound, ...s.needles]) {
    for (let r = nd.rings.length - 1; r >= 0; r--) {
      const g = nd.rings[r]!, du = u - g.cu, dv = v - g.cv, m = meanR(g);
      if (du * du + dv * dv <= m * m) { if (g.z > best) best = g.z; break; }
    }
  }
  return best;
}

/**
 * A spire seen from above (D147: « a spire must read as a tall peak from above »), on the ground's
 * plan map: its foot's scree; each needle as a cone shaded from the light (its half to the light
 * pale, the half away dark, hachures running down it, denser in the shade), a contour or two round
 * it; at its top the map-maker's peak, a small inked triangle (bigger the taller), a flat top's rim
 * round it; a soft shadow down-right. (x0, y0): the tile's top-left (px), `ppt` px a tile.
 */
export function spirePlan(ctx: Ctx, x0: number, y0: number, ppt: number, h: number, seed: number): void {
  const s = spireShape(h, seed), k = ppt / 32;
  const X = (u: number): number => x0 + u * ppt, Y = (v: number): number => y0 + v * ppt;
  const ringPts = (nd: Needle, g: SpireRing): Pt[] => Array.from({ length: N }, (_, i) => { const [u, v] = vtx(nd, g, i); return [X(u), Y(v)] as Pt; });
  const base = ringPts(s.mound, s.mound.rings[0]!);
  // Its shadow, soft, down-right (the plan's light from the top-left), and its scree.
  ctx.save();
  ctx.globalAlpha = 0.3;
  fillPoly(ctx, base.map(([x, y]) => [x + 0.14 * ppt, y + 0.18 * ppt] as Pt), C.inkSoft);
  ctx.restore();
  fillPoly(ctx, base, mix(SP.scree, '#f4e2cc', 0.35));
  for (const nd of s.needles) {
    const R = nd.rings, foot = R[0]!, top = R[R.length - 1]!, tu = top.cu, tv = top.cv;
    const fp = ringPts(nd, foot), apex: Pt = [X(tu), Y(tv)];
    // The cone: a face from the foot's edge to the apex for each side, lit or shaded as it faces.
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, sh = facing(nd.nrm[i]!);
      fillPoly(ctx, [fp[i]!, fp[j]!, apex], sh > 0 ? mix(SP.warm, SP.shade, 0.25 + sh * 0.5) : mix(SP.warm, SP.top, 0.35 - sh * 0.4));
    }
    if (ppt >= 12) {
      // Hachures down the cone, denser and darker in the shade.
      for (let i = 0; i < N * 3; i++) {
        const f = i / 3, a = Math.floor(f) % N, b = (a + 1) % N, t = f - Math.floor(f);
        const fx = fp[a]![0] + (fp[b]![0] - fp[a]![0]) * t, fy = fp[a]![1] + (fp[b]![1] - fp[a]![1]) * t;
        const sh = facing(nd.nrm[a]!);
        if (sh < -0.2 && i % 3) continue;
        line(ctx, [[fx, fy], [fx + (apex[0] - fx) * 0.62, fy + (apex[1] - fy) * 0.62]], SP.line, 0.55 * k, sh > 0 ? 0.3 + sh * 0.3 : 0.15);
      }
    }
    line(ctx, [...fp, fp[0]!], C.ink, Math.max(0.8, 1.1 * k), 0.85);
    // The peak: the map-maker's triangle, a flat top's rim round it.
    if (nd.flat && ppt >= 16) line(ctx, [...ringPts(nd, top), ringPts(nd, top)[0]!], C.ink, 0.8 * k, 0.7);
    const t = Math.max(2.2, (0.08 + 0.14 * Math.min(1, (top.z - foot.z) / 26)) * ppt) * (top.z > h * 0.8 ? 1 : 0.7);
    const tri: Pt[] = [[apex[0], apex[1] - t], [apex[0] + t * 0.87, apex[1] + t * 0.5], [apex[0] - t * 0.87, apex[1] + t * 0.5]];
    fillPoly(ctx, tri, SP.top);
    line(ctx, [...tri, tri[0]!], C.ink, Math.max(0.7, 1 * k), 0.9);
  }
}
