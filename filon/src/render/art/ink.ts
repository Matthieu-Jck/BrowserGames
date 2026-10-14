// ink.ts — hand-inked drawing primitives on Canvas2D (works in workers on OffscreenCanvas).
// Lines are filled ribbons of varying width (thicker on the shadow side, tapered ends),
// gently wobbled by seeded noise; shading is hatching and stippling, never gradients —
// the "BD Moebius" grammar. Everything is deterministic from a seed.
import { makeRng, type Rng } from '@/core/rng';
import { C, rgba } from './tokens';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Pt = readonly [number, number];

/** Light comes from the top-left: shadow side faces down-right. */
export const LIGHT: Pt = [-0.6, -0.8];

/**
 * How hand-made a line looks — the owner asked for a more precise, less pencil-like line
 * (2026-10-12): ink outlines a little thinner (coloured strokes — pipes, rails, water — keep
 * their width), a third of the wobble, a steadier width along the stroke, a lighter swell on the
 * shadow side, rounder ellipses. Every recipe goes through ink(), so this is the one knob.
 */
export const INK = { outline: 0.78, jitter: 0.35, vary: 0.12, swell: 0.3, irregular: 0.5 } as const;

/** Smooth 1D value noise for stroke wobble. */
function wobble(rng: Rng): (t: number) => number {
  const knots = Array.from({ length: 64 }, () => rng.next() * 2 - 1);
  return (t: number): number => {
    const x = ((t % 64) + 64) % 64;
    const i = Math.floor(x), f = x - i;
    const a = knots[i]!, b = knots[(i + 1) % 64]!;
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  };
}

/** Resample a polyline every `step` px. */
function resample(pts: readonly Pt[], step: number, closed: boolean): Pt[] {
  const src = closed ? [...pts, pts[0]!] : pts.slice();
  const out: Pt[] = [];
  for (let i = 0; i < src.length - 1; i++) {
    const [ax, ay] = src[i]!, [bx, by] = src[i + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  if (!closed) out.push(src[src.length - 1]!);
  return out;
}

export interface InkOpts {
  w?: number;        // base width (px)
  color?: string;
  alpha?: number;
  jitter?: number;   // positional wobble amplitude (px)
  taper?: number;    // fraction of length tapered at each end (open paths)
  closed?: boolean;
  seed?: number;
  shade?: boolean;   // thicker on the shadow side
}

/** A hand-inked stroke drawn as a filled ribbon of varying width. */
export function ink(ctx: Ctx, pts: readonly Pt[], o: InkOpts = {}): void {
  if (pts.length < 2) return;
  const outline = o.color === undefined || o.color === C.ink || o.color === C.inkSoft;
  const w = (o.w ?? 2) * (outline ? INK.outline : 1), jit = (o.jitter ?? 0.5) * INK.jitter, closed = !!o.closed;
  const rng = makeRng(o.seed ?? 1);
  const wob = wobble(rng), wob2 = wobble(rng);
  const p = resample(pts, 3, closed);
  const n = p.length;
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[Math.max(0, i - 1)]!, b = p[Math.min(n - 1, i + 1)]!;
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const nx = -ty, ny = tx;
    const t = i / Math.max(1, n - 1);
    let width = w * (1 - INK.vary / 2 + INK.vary * (wob2(i * 0.35) * 0.5 + 0.5));
    if (o.shade !== false) {
      // Normal pointing away from the light → shadow side → heavier line.
      const facing = nx * -LIGHT[0] + ny * -LIGHT[1];
      width *= 1 + INK.swell * Math.max(0, facing);
    }
    if (!closed && o.taper !== 0) {
      const tp = o.taper ?? 0.15;
      const e = Math.min(t / tp, (1 - t) / tp, 1);
      width *= 0.35 + 0.65 * Math.max(0, e);
    }
    const off = wob(i * 0.22) * jit;
    const cx = p[i]![0] + nx * off, cy = p[i]![1] + ny * off;
    left.push([cx + nx * width * 0.5, cy + ny * width * 0.5]);
    right.push([cx - nx * width * 0.5, cy - ny * width * 0.5]);
  }
  ctx.save();
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.fillStyle = o.color ?? C.ink;
  ctx.beginPath();
  ctx.moveTo(left[0]![0], left[0]![1]);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i]![0], left[i]![1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i]![0], right[i]![1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Points on a (slightly irregular) ellipse. */
export function ellipsePts(cx: number, cy: number, rx: number, ry: number, seed = 1, irregular = 0.03, n = 48, rot = 0): Pt[] {
  const rng = makeRng(seed);
  const wob = wobble(rng);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + wob(i * 0.6) * irregular * INK.irregular;
    const x = Math.cos(a) * rx * k, y = Math.sin(a) * ry * k;
    out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return out;
}

/** Points of a rounded rectangle. */
export function roundRectPts(x: number, y: number, w: number, h: number, r: number, n = 6): Pt[] {
  const out: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number): void => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return out;
}

/** Trace a polygon as the current path. */
export function pathOf(ctx: Ctx, pts: readonly Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.closePath();
}

/** Flat fill of a polygon. */
export function flat(ctx: Ctx, pts: readonly Pt[], color: string, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  pathOf(ctx, pts);
  ctx.fill();
  ctx.restore();
}

/** Flat fill + inked outline. */
export function shape(ctx: Ctx, pts: readonly Pt[], fill: string, o: InkOpts = {}): void {
  flat(ctx, pts, fill);
  ink(ctx, pts, { closed: true, ...o });
}

/** Parallel hatching clipped to a polygon. angle in radians, spacing in px. */
export function hatch(ctx: Ctx, clip: readonly Pt[], angle: number, spacing: number, o: { w?: number; color?: string; alpha?: number; seed?: number } = {}): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of clip) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const R = Math.hypot(x1 - x0, y1 - y0) / 2 + spacing;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const nx = -dy, ny = dx;
  const rng = makeRng(o.seed ?? 7);
  ctx.save();
  pathOf(ctx, clip);
  ctx.clip();
  ctx.strokeStyle = o.color ?? C.ink;
  ctx.globalAlpha *= o.alpha ?? 0.55;
  ctx.lineCap = 'round';
  for (let s = -R; s <= R; s += spacing) {
    const j = (rng.next() - 0.5) * spacing * 0.35;
    ctx.lineWidth = (o.w ?? 0.9) * (0.75 + rng.next() * 0.5);
    ctx.beginPath();
    ctx.moveTo(cx + nx * (s + j) - dx * R, cy + ny * (s + j) - dy * R);
    ctx.lineTo(cx + nx * (s + j) + dx * R, cy + ny * (s + j) + dy * R);
    ctx.stroke();
  }
  ctx.restore();
}

/** The shadow crescent of a disc: the disc minus itself shifted towards the light. */
export function shadowCrescent(cx: number, cy: number, r: number, depth = 0.32, seed = 3): Pt[] {
  const outer = ellipsePts(cx, cy, r, r, seed, 0.01, 48);
  const sx = cx + LIGHT[0] * r * depth, sy = cy + LIGHT[1] * r * depth;
  // Walk the lit-side arc of the shifted circle back to close a crescent on the shadow side.
  const out: Pt[] = [];
  const a0 = Math.atan2(-LIGHT[1], -LIGHT[0]); // direction of shadow
  for (let i = 0; i <= 24; i++) {
    const a = a0 - Math.PI / 2 + (i / 24) * Math.PI;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  for (let i = 24; i >= 0; i--) {
    const a = a0 - Math.PI / 2 + (i / 24) * Math.PI;
    out.push([sx + Math.cos(a) * r * 1.02, sy + Math.sin(a) * r * 1.02]);
  }
  void outer;
  return out;
}

/** Stippling: dots scattered by density over a rectangle (optionally clipped). */
export function stipple(ctx: Ctx, x: number, y: number, w: number, h: number, count: number, o: { r?: number; color?: string; alpha?: number; seed?: number; clip?: readonly Pt[] } = {}): void {
  const rng = makeRng(o.seed ?? 11);
  ctx.save();
  if (o.clip) { pathOf(ctx, o.clip); ctx.clip(); }
  ctx.fillStyle = o.color ?? C.ink;
  ctx.globalAlpha *= o.alpha ?? 0.5;
  for (let i = 0; i < count; i++) {
    const r = (o.r ?? 0.9) * (0.6 + rng.next() * 0.8);
    ctx.beginPath();
    ctx.arc(x + rng.next() * w, y + rng.next() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A soft cast shadow (multiply-friendly): flat ink at low alpha, offset down-right. */
export function castShadow(ctx: Ctx, pts: readonly Pt[], off: number, alpha = 0.16): void {
  const sh = pts.map(([x, y]) => [x + off * 0.7, y + off] as Pt);
  flat(ctx, sh, rgba(C.inkSoft, 1), alpha);
}

/** Small highlight arc on the lit side of a disc. */
export function highlight(ctx: Ctx, cx: number, cy: number, r: number, color = '#ffffff', alpha = 0.55): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha *= alpha;
  ctx.lineWidth = Math.max(1.2, r * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  const a = Math.atan2(LIGHT[1], LIGHT[0]);
  ctx.arc(cx, cy, r * 0.72, a - 0.55, a + 0.35);
  ctx.stroke();
  ctx.restore();
}
