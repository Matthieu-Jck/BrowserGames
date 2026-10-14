// rock.ts — inks one rock column (a tile of relief) as a stack of terrace slabs: each slab's
// walls rise from the step below, shaded by how they face the light, then its flat top.
// One painter serves both the relief sprites (iso projection, full detail) and the terrain
// worker (oblique projection into the ground texture, light detail), so far and near zooms
// agree. Each hardness reads differently: banded sandstone, jointed basalt, faceted
// obsidian, heartrock with glowing veins. Worker-safe (Canvas2D only).
import { hashUnit } from '@/core/hash';
import { slabOutline, shadeOf, STEP_LEVELS, wallRuns, type OutlinePt } from '../relief';
import { C, mix, rgba } from './tokens';
import { ink, type Ctx, type Pt } from './ink';

/** Projection of a column-local point (u, v ∈ [0, 1], z in levels) to canvas px. */
export type Proj = (u: number, v: number, z: number) => Pt;

interface RockLook { top: string; lit: string; dark: string; line: string; rim: string }
/** Index 0..3 = hardness H1..H4. */
export const ROCK: readonly RockLook[] = [
  { top: '#efc09a', lit: '#e09a72', dark: '#a8604a', line: '#8a4a3a', rim: '#fde3c8' }, // soft sandstone
  { top: '#c3adcf', lit: '#9b86ad', dark: '#5f4f78', line: '#4a3d63', rim: '#ece0f4' }, // basalt
  { top: '#a993d6', lit: '#7f69b8', dark: '#4a3888', line: '#36286b', rim: '#ddd2ff' }, // lilac obsidian
  { top: '#7d68b0', lit: '#5c4794', dark: '#33265e', line: '#221944', rim: '#c4b6f0' }, // heartrock
];

/** Top colour: higher terraces read a touch lighter (aerial perspective). */
export const topColor = (cls: number, level: number): string => mix(ROCK[cls]!.top, '#ffffff', (level - 2) * 0.03);
export const wallColor = (cls: number, shade: number): string => mix(ROCK[cls]!.lit, ROCK[cls]!.dark, shade);

function poly(ctx: Ctx, pts: readonly Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.closePath();
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

export interface ColumnOpts {
  /** 0 = flat (far terrain), 1 = light (terrain worker), 2 = full (sprites). */
  detail: 0 | 1 | 2;
  /** Seed for the column's marks. */
  seed: number;
  /** Line width unit (px per 1 at sprite scale). */
  k: number;
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

/** Paint one column: its terrace slabs bottom to top (each nests inside the one below). */
export function drawColumn(ctx: Ctx, P: Proj, cls: number, masks: readonly number[], o: ColumnOpts): void {
  const L = masks.length * STEP_LEVELS;
  for (let t = 0; t < masks.length; t++) drawSlab(ctx, P, cls, slabOutline(masks, t), t * STEP_LEVELS, (t + 1) * STEP_LEVELS, L, o, t);
}

function drawSlab(ctx: Ctx, P: Proj, cls: number, pts: readonly OutlinePt[], z0: number, z1: number, L: number, o: ColumnOpts, t: number): void {
  const look = ROCK[cls]!;
  const runs = wallRuns(pts);
  const k = o.k;
  const rnd = (n: number): number => hashUnit(o.seed, n, 0x6f + t * 977);

  // ── walls ──
  for (const { pts: run } of runs) {
    const bottom = run.map((p) => P(p.u, p.v, z0));
    const top = run.map((p) => P(p.u, p.v, z1));
    const body = [...bottom, ...top.slice().reverse()];
    ctx.fillStyle = wallColor(cls, shadeOf(run[run.length - 1]!.a));
    poly(ctx, body);
    ctx.fill();
    // Per-segment shading (a chamfer turns between the lit and the shaded side).
    for (let i = 0; i < run.length - 1; i++) {
      ctx.fillStyle = wallColor(cls, shadeOf(run[i + 1]!.a));
      poly(ctx, [bottom[i]!, bottom[i + 1]!, top[i + 1]!, top[i]!]);
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 0.8;
      ctx.stroke(); // close hairline seams between segments
    }
    if (o.detail >= 1) {
      ctx.save();
      poly(ctx, body);
      ctx.clip();
      // Ambient occlusion at the foot of the wall.
      const foot = [...run.map((p) => P(p.u, p.v, z0)), ...run.map((p) => P(p.u, p.v, z0 + 0.4)).reverse()];
      ctx.fillStyle = rgba(C.ink, 0.15);
      poly(ctx, foot);
      ctx.fill();
      wallMarks(ctx, P, cls, run, z0, z1, o, rnd);
      ctx.restore();
    }
  }

  // ── top ──
  const topPts = pts.map((p) => P(p.u, p.v, z1));
  ctx.fillStyle = topColor(cls, z1);
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  poly(ctx, topPts);
  ctx.stroke(); // bleed 0.8 px so neighbouring tops join without a hairline
  ctx.fill();
  if (o.detail >= 1 && z1 === L) {
    ctx.save();
    poly(ctx, topPts);
    ctx.clip();
    // Stipple and a few pen strokes: the plateau's grain.
    const dots = o.detail >= 2 ? 10 : 4;
    ctx.fillStyle = rgba(look.line, 0.32);
    for (let i = 0; i < dots; i++) {
      const [x, y] = P(0.08 + rnd(100 + i) * 0.84, 0.08 + rnd(120 + i) * 0.84, z1);
      ctx.beginPath();
      ctx.arc(x, y, (0.7 + rnd(140 + i) * 0.9) * k, 0, Math.PI * 2);
      ctx.fill();
    }
    if (o.detail >= 2) {
      for (let i = 0; i < 3; i++) {
        if (rnd(160 + i) < 0.35) continue;
        const u = 0.15 + rnd(170 + i) * 0.6, v = 0.15 + rnd(180 + i) * 0.6;
        const d = 0.14 + rnd(190 + i) * 0.16;
        line(ctx, [P(u, v, z1), P(u + d, v + d * (rnd(200 + i) - 0.5), z1)], look.line, 1 * k, 0.38);
      }
      // Now and then a boulder on the plateau.
      if (rnd(215) < 0.18) {
        const u = 0.3 + rnd(216) * 0.4, v = 0.3 + rnd(217) * 0.4;
        const [x, y] = P(u, v, z1);
        ctx.fillStyle = rgba(C.ink, 0.25);
        ctx.beginPath(); ctx.ellipse(x + 3 * k, y + 2 * k, 5 * k, 2.6 * k, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = mix(look.lit, '#ffffff', 0.2);
        ctx.beginPath(); ctx.ellipse(x, y - 2 * k, 4.5 * k, 3.6 * k, 0, 0, Math.PI * 2); ctx.fill();
        line(ctx, [[x - 4.5 * k, y - 2 * k], [x, y - 5.6 * k], [x + 4.5 * k, y - 2 * k], [x, y + 1.6 * k], [x - 4.5 * k, y - 2 * k]], C.ink, 1 * k, 0.7);
      }
      if (cls === 3 && rnd(210) < 0.5) {
        const [x, y] = P(0.3 + rnd(211) * 0.4, 0.3 + rnd(212) * 0.4, z1);
        ctx.fillStyle = C.led;
        ctx.beginPath(); ctx.arc(x, y, 1.6 * k, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ── ink ──
  // Lit lip along the top of the lit walls, then silhouettes.
  for (const { pts: run } of runs) {
    const lit = run.filter((p) => shadeOf(p.a) < 0.55);
    if (lit.length > 1) line(ctx, lit.map((p) => P(p.u, p.v, z1)), look.rim, 1.6 * k, o.detail >= 1 ? 0.85 : 0.6);
  }
  const w = o.detail >= 2 ? 2 : 1.4;
  for (const r of silhouetteRuns(pts)) {
    const pp = r.map((p) => P(p.u, p.v, z1));
    if (o.detail >= 2) ink(ctx, pp, { w: w * k, seed: o.seed + r.length + t, taper: 0.05, jitter: 0.35 });
    else line(ctx, pp, C.ink, w * k, 0.9);
  }
  for (const { pts: run, openStart, openEnd } of runs) {
    const bottom = run.map((p) => P(p.u, p.v, z0));
    // Ground contact for the lowest slab; a lighter crease where a slab sits on the one below.
    if (z0 === 0) {
      if (o.detail >= 2) ink(ctx, bottom, { w: 1.8 * k, seed: o.seed + 7, taper: 0.05, jitter: 0.3 });
      else line(ctx, bottom, C.ink, 1.3 * k, 0.85);
    } else line(ctx, bottom, C.ink, 1.1 * k, 0.55);
    // Silhouette verticals where a wall turns away into open air.
    const vw = (o.detail >= 2 ? 1.6 : 1.1) * k;
    const a = run[0]!, b = run[run.length - 1]!;
    if (openStart) line(ctx, [P(a.u, a.v, z0), P(a.u, a.v, z1)], C.ink, vw, 0.9);
    if (openEnd) line(ctx, [P(b.u, b.v, z0), P(b.u, b.v, z1)], C.ink, vw, 0.9);
    // Fold lines where a chamfer meets a side (the wall changes direction).
    for (let i = 1; i < run.length - 1; i++) {
      const p = run[i]!;
      if (Math.abs(run[i]!.a - run[i + 1]!.a) > 0.1) line(ctx, [P(p.u, p.v, z0), P(p.u, p.v, z1)], C.ink, 0.9 * k, 0.5);
    }
  }
}

/** Strata, joints, facets or veins by hardness, then pen hatching on the shaded faces. */
function wallMarks(ctx: Ctx, P: Proj, cls: number, run: ReadonlyArray<{ u: number; v: number; a: number }>, z0: number, z1: number, o: ColumnOpts, rnd: (n: number) => number): void {
  const look = ROCK[cls]!;
  const k = o.k;
  if (cls === 0) {
    for (let z = z0 + 0.5; z < z1 - 0.01; z += 0.5) {
      const wob = run.map((p, i) => P(p.u, p.v, z + (rnd(300 + i + z * 8) - 0.5) * 0.14));
      const major = Math.abs(z - Math.round(z)) < 0.01;
      line(ctx, wob, look.line, (major ? 1.3 : 0.8) * k, major ? 0.55 : 0.3);
    }
  } else if (cls === 1) {
    // Columnar joints: vertical lines at irregular spacing, a ledge half-way.
    for (const [i, p] of sampleRun(run, 0.16 + rnd(1) * 0.06).entries()) {
      const zt = z1 - (rnd(310 + i) < 0.3 ? 0.25 : 0);
      line(ctx, [P(p.u, p.v, z0 + 0.05), P(p.u, p.v, zt)], look.line, 1.1 * k, 0.5);
    }
    line(ctx, run.map((p) => P(p.u, p.v, (z0 + z1) / 2)), look.line, 1.1 * k, 0.4);
  } else if (cls === 2) {
    // Obsidian: sharp facet lines and a glint.
    for (let z = z0; z < z1; z++) {
      const s = sampleRun(run, 0.33);
      for (let i = 0; i + 1 < s.length; i += 2) {
        const a = s[i]!, b = s[i + 1]!;
        line(ctx, [P(a.u, a.v, z + 0.1), P(b.u, b.v, z + 0.9)], look.line, 1 * k, 0.5);
      }
      if (o.detail >= 2 && s.length) {
        const g = s[Math.floor(rnd(10 + z) * s.length)]!;
        line(ctx, [P(g.u, g.v, z + 0.3), P(g.u, g.v, z + 0.7)], look.rim, 1.6 * k, 0.8);
      }
    }
    line(ctx, run.map((p) => P(p.u, p.v, (z0 + z1) / 2)), look.line, 1 * k, 0.4);
  } else {
    // Heartrock: dark mass, glowing veins.
    line(ctx, run.map((p) => P(p.u, p.v, (z0 + z1) / 2)), look.line, 1.1 * k, 0.5);
    const s = sampleRun(run, 0.25);
    for (let i = 0; i < s.length; i++) {
      if (rnd(30 + i) > 0.45) continue;
      const p = s[i]!, za = z0 + rnd(40 + i) * (z1 - z0 - 0.6), zb = za + 0.3 + rnd(50 + i) * 0.5;
      line(ctx, [P(p.u, p.v, za), P(p.u + 0.04, p.v + 0.04, zb)], C.cyan, 1.4 * k, 0.75);
      if (o.detail >= 2) line(ctx, [P(p.u, p.v, za), P(p.u + 0.04, p.v + 0.04, zb)], C.led, 0.6 * k, 0.9);
    }
  }
  if (o.detail < 2) return;
  // Pen hatching on the shaded faces.
  for (let i = 0; i < run.length - 1; i++) {
    const sh = shadeOf(run[i + 1]!.a);
    if (sh < 0.55) continue;
    const p = run[i]!, q = run[i + 1]!;
    const n = Math.max(1, Math.round(Math.hypot(q.u - p.u, q.v - p.v) / 0.07));
    for (let j = 0; j < n; j++) {
      const f = (j + 0.5) / n;
      const u = p.u + (q.u - p.u) * f, v = p.v + (q.v - p.v) * f;
      const za = z0 + rnd(60 + i * 31 + j) * 0.4, zb = Math.min(z1, za + 0.5 + rnd(70 + i * 31 + j) * (z1 - z0 - 0.5));
      line(ctx, [P(u, v, za), P(u, v, zb)], C.ink, 0.9 * k, 0.22 + (sh - 0.55) * 0.5);
    }
  }
}

/** Points along a wall run every `step` tiles (excluding the very ends). */
function sampleRun(run: ReadonlyArray<{ u: number; v: number }>, step: number): Array<{ u: number; v: number }> {
  const out: Array<{ u: number; v: number }> = [];
  let carry = step * 0.5;
  for (let i = 0; i < run.length - 1; i++) {
    const p = run[i]!, q = run[i + 1]!;
    const len = Math.hypot(q.u - p.u, q.v - p.v);
    let d = carry;
    while (d < len) {
      const f = d / len;
      out.push({ u: p.u + (q.u - p.u) * f, v: p.v + (q.v - p.v) * f });
      d += step;
    }
    carry = d - len;
  }
  return out;
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
