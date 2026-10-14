// iso-shapes.ts — inked volumes in 2:1 isometric for building sprites: boxes and slabs with
// lit top / mid +y face / shaded +x face, cylinders, domes, barrel vaults, horizontal
// rotors, masts, dishes, protruding ports, the power terminals wires clamp to (art/terminals.ts),
// the CrierBelt mark on a deck or a wall. An IsoFrame maps the building's own (unrotated)
// tile coordinates + height levels to canvas px; rotation permutes the footprint so the
// visible faces are always the rotated +x / +y ones and the light stays top-left.
import type { Rot } from '@/sim/types';
import { C, mix } from './tokens';
import { castShadow, ellipsePts, flat, hatch, ink, pathOf, shape, type Ctx, type Pt } from './ink';
import { cable, crierMarkMapped, hull, light, rivet } from './shapes';
import { CLAMP, INSULATOR, terminalProbe, type Terminal } from './terminals';

/** Atlas scale (2× world): half tile width, half tile height, px per height level, margin. */
export const IS = 64;
export const IH = 32;
export const ILH = 32;
export const IM = 14;
const SQ2 = Math.SQRT2;

export class IsoFrame {
  readonly rw: number;
  readonly rh: number;
  readonly W: number;
  readonly H: number;
  /** Canvas px of the rotated footprint's top corner (tile (0,0) at z = 0). */
  readonly ox: number;
  readonly oy: number;
  constructor(readonly w: number, readonly h: number, readonly rot: Rot, readonly head: number) {
    this.rw = rot & 1 ? h : w;
    this.rh = rot & 1 ? w : h;
    this.ox = IM + this.rh * IS;
    this.oy = IM + head * ILH;
    this.W = Math.ceil((this.rw + this.rh) * IS + 2 * IM);
    this.H = Math.ceil((this.rw + this.rh) * IH + head * ILH + 2 * IM);
  }
  /** Local (unrotated) continuous tile coords → rotated coords. */
  r(x: number, y: number): [number, number] {
    const { w, h } = this;
    switch (this.rot) {
      case 0: return [x, y];
      case 1: return [h - y, x];
      case 2: return [w - x, h - y];
      case 3: return [y, w - x];
    }
  }
  /** Rotated coords + height → canvas px. */
  pr(rx: number, ry: number, z = 0): Pt {
    return [this.ox + (rx - ry) * IS, this.oy + (rx + ry) * IH - z * ILH];
  }
  /** Local coords + height → canvas px. */
  p(x: number, y: number, z = 0): Pt {
    const [rx, ry] = this.r(x, y);
    return this.pr(rx, ry, z);
  }
  /** Local rect → rotated, axis-aligned bounds. */
  rect(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
    const [ax, ay] = this.r(x0, y0), [bx, by] = this.r(x1, y1);
    return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
  }
  /** Screen-space radii of a horizontal circle of radius r tiles. */
  ell(r: number): [number, number] { return [r * SQ2 * IS, r * SQ2 * IH]; }
  /** Rotate an unrotated side index (0 N, 1 E, 2 S, 3 W). */
  dir(side: number): number { return (side + this.rot) & 3; }
  /** Painter's depth of a local point once rotated (bigger = nearer the viewer). */
  depth(x: number, y: number): number { const [rx, ry] = this.r(x, y); return rx + ry; }
}

/** Painter's queue inside one sprite: parts are drawn far to near (stable for ties). */
export class Scene {
  private readonly parts: Array<{ d: number; i: number; fn: () => void }> = [];
  add(d: number, fn: () => void): this { this.parts.push({ d, i: this.parts.length, fn }); return this; }
  run(): void {
    this.parts.sort((a, b) => a.d - b.d || a.i - b.i);
    for (const p of this.parts) p.fn();
  }
}

/** Rotated rect [a0, b0, a1, b1] (see IsoFrame.rect). */
export type RRect = [number, number, number, number];
/** The two faces that ever face the camera: L = the +y face (lit), R = the +x face (shaded). */
export type Face = 'L' | 'R';

export interface Faces { top: string; left?: string; right?: string }
const shadeL = (c: string): string => mix(c, C.ink, 0.22);
const shadeR = (c: string): string => mix(c, C.ink, 0.42);

/** A box from a local rect, between heights z0 and z1: lit top, +y face, shaded +x face. */
export function box(ctx: Ctx, f: IsoFrame, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, col: string | Faces, seed = 1, o: { hatchRight?: boolean; outline?: number; shadow?: boolean } = {}): RRect {
  const fc: Faces = typeof col === 'string' ? { top: col } : col;
  const [a0, b0, a1, b1] = f.rect(x0, y0, x1, y1);
  const top: Pt[] = [f.pr(a0, b0, z1), f.pr(a1, b0, z1), f.pr(a1, b1, z1), f.pr(a0, b1, z1)];
  const left: Pt[] = [f.pr(a0, b1, z1), f.pr(a1, b1, z1), f.pr(a1, b1, z0), f.pr(a0, b1, z0)];
  const right: Pt[] = [f.pr(a1, b0, z1), f.pr(a1, b1, z1), f.pr(a1, b1, z0), f.pr(a1, b0, z0)];
  const sil: Pt[] = [f.pr(a0, b0, z1), f.pr(a1, b0, z1), f.pr(a1, b0, z0), f.pr(a1, b1, z0), f.pr(a0, b1, z0), f.pr(a0, b1, z1)];
  if (o.shadow !== false) castShadow(ctx, sil, 4 + (z1 - z0) * 5, 0.3);
  if (z1 > z0) {
    flat(ctx, left, fc.left ?? shadeL(fc.top));
    flat(ctx, right, fc.right ?? shadeR(fc.top));
    if (o.hatchRight !== false) hatch(ctx, right, Math.PI / 3, 3.4, { alpha: 0.4, seed, w: 1 });
    ink(ctx, [f.pr(a1, b1, z1), f.pr(a1, b1, z0)], { w: 1.4, seed: seed + 5, taper: 0 });
  }
  flat(ctx, top, fc.top);
  // Lit top rim.
  ink(ctx, [f.pr(a0, b1, z1), f.pr(a0, b0, z1), f.pr(a1, b0, z1)], { w: 1.2, color: mix(fc.top, '#ffffff', 0.45), shade: false, taper: 0, jitter: 0.1, seed: seed + 7 });
  ink(ctx, [f.pr(a0, b1, z1), f.pr(a1, b1, z1), f.pr(a1, b0, z1)], { w: 1.2, alpha: 0.7, taper: 0, seed: seed + 8 });
  ink(ctx, sil, { closed: true, w: o.outline ?? 2.2, seed: seed + 9 });
  return [a0, b0, a1, b1];
}

/** A point on a visible face of a rotated rect; u runs 0 → 1 left to right on screen. */
export function facePt(f: IsoFrame, rr: RRect, face: Face, u: number, z: number): Pt {
  const [a0, b0, a1, b1] = rr;
  return face === 'L' ? f.pr(a0 + (a1 - a0) * u, b1, z) : f.pr(a1, b1 - (b1 - b0) * u, z);
}

export function faceQuad(f: IsoFrame, rr: RRect, face: Face, u0: number, u1: number, z0: number, z1: number): Pt[] {
  return [facePt(f, rr, face, u0, z1), facePt(f, rr, face, u1, z1), facePt(f, rr, face, u1, z0), facePt(f, rr, face, u0, z0)];
}

/** Glowing LEDs in a row on a face. */
export function faceLeds(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, z: number, u0: number, u1: number, n: number, colors: readonly string[] = [C.led], r = 2.3): void {
  const pad = faceQuad(f, rr, face, u0 - 0.03, u1 + 0.03, z - 0.12, z + 0.12);
  shape(ctx, pad, C.steelDD, { w: 1, shade: false, jitter: 0 });
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const [x, y] = facePt(f, rr, face, u0 + (u1 - u0) * t, z);
    light(ctx, x, y, r, colors[i % colors.length]!);
  }
}

/** A recessed grille (intake / heat sink) on a face. */
export function faceGrille(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, u0: number, u1: number, z0: number, z1: number, seed = 1, slats = 0): void {
  const q = faceQuad(f, rr, face, u0, u1, z0, z1);
  shape(ctx, q, C.steelDD, { w: 1.2, shade: false, jitter: 0, seed });
  const n = slats || Math.max(2, Math.round((z1 - z0) * 4));
  ctx.save();
  ctx.strokeStyle = C.steelL;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1;
  for (let i = 1; i < n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    const a = facePt(f, rr, face, u0 + 0.02, z), b = facePt(f, rr, face, u1 - 0.02, z);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.restore();
}

/** An inset panel / door with bolts. */
export function facePanel(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, u0: number, u1: number, z0: number, z1: number, color: string, seed = 1): void {
  const q = faceQuad(f, rr, face, u0, u1, z0, z1);
  shape(ctx, q, color, { w: 1.3, shade: false, jitter: 0.1, seed });
  for (const [u, z] of [[u0, z0], [u1, z0], [u0, z1], [u1, z1]] as const) {
    const [x, y] = facePt(f, rr, face, u + (u === u0 ? 0.04 : -0.04), z + (z === z0 ? 0.08 : -0.08));
    rivet(ctx, x, y, 1.3, C.steelD);
  }
}

/** A glowing window strip on a face. */
export function faceGlow(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, u0: number, u1: number, z0: number, z1: number, color: string = C.led): void {
  const q = faceQuad(f, rr, face, u0, u1, z0, z1);
  flat(ctx, faceQuad(f, rr, face, u0 - 0.02, u1 + 0.02, z0 - 0.06, z1 + 0.06), color, 0.25);
  shape(ctx, q, color, { w: 1.2, shade: false, jitter: 0 });
  ink(ctx, [q[0]!, q[1]!], { w: 1.2, color: '#ffffff', alpha: 0.7, shade: false, taper: 0, jitter: 0 });
}

/** Hazard stripes on a face. */
export function faceHazard(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, u0: number, u1: number, z0: number, z1: number, seed = 1): void {
  const q = faceQuad(f, rr, face, u0, u1, z0, z1);
  flat(ctx, q, C.hazard);
  ctx.save(); pathOf(ctx, q); ctx.clip();
  hatch(ctx, q, Math.PI / 4, 7, { w: 3.2, alpha: 0.85, seed });
  ctx.restore();
  ink(ctx, q, { closed: true, w: 1, shade: false, seed: seed + 1 });
}

/** A pipe through local 3D points: ink outline, coloured body, highlight, brass joints. */
export function pipeIso(ctx: Ctx, f: IsoFrame, pts: ReadonlyArray<readonly [number, number, number]>, w: number, color: string = C.steelL, seed = 1, joints = true): void {
  const pp = pts.map(([x, y, z]) => f.p(x, y, z));
  ink(ctx, pp.map(([x, y]) => [x + 3, y + 5] as Pt), { w, color: C.ink, alpha: 0.18, shade: false, taper: 0, seed: seed + 9 });
  ink(ctx, pp, { w: w + 3, color: C.ink, taper: 0, jitter: 0.15, seed, shade: false });
  ink(ctx, pp, { w, color, taper: 0, jitter: 0.1, seed: seed + 1, shade: false });
  ink(ctx, pp.map(([x, y]) => [x - w * 0.12, y - w * 0.28] as Pt), { w: Math.max(0.8, w * 0.24), color: '#ffffff', alpha: 0.55, taper: 0.1, jitter: 0.1, seed: seed + 2, shade: false });
  if (joints) for (const [x, y] of [pp[0]!, pp[pp.length - 1]!]) shape(ctx, ellipsePts(x, y, w * 0.72, w * 0.5, seed + 3, 0, 16), C.brass, { w: 1, shade: false, jitter: 0 });
}

/** A tapered tower (cone / obelisk) from a base circle to an apex, glowing tip. */
export function spireIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, r: number, z0: number, z1: number, color: string, tip: string = C.led, seed = 1): void {
  const [ex, ey] = f.ell(r);
  const b = f.p(cx, cy, z0), t = f.p(cx, cy, z1);
  const base = ellipsePts(b[0], b[1], ex, ey, seed, 0, 28).filter(([, y]) => y >= b[1] - 0.01).sort((p, q) => p[0] - q[0]);
  const body: Pt[] = [t, ...base.reverse()];
  castShadow(ctx, body, 6 + (z1 - z0) * 3, 0.28);
  flat(ctx, body, color);
  const right: Pt[] = [t, [b[0] + ex, b[1]], [b[0] + ex * 0.1, b[1] + ey]];
  flat(ctx, right, mix(color, C.ink, 0.38));
  ctx.save(); pathOf(ctx, right); ctx.clip();
  hatch(ctx, right, Math.PI / 3, 3.2, { alpha: 0.4, seed });
  ctx.restore();
  ink(ctx, [t, [b[0] - ex * 0.45, b[1] + ey * 0.6]], { w: 1.6, color: '#ffffff', alpha: 0.5, shade: false, taper: 0.2, seed: seed + 2 });
  ink(ctx, body, { closed: true, w: 1.8, seed: seed + 3 });
  light(ctx, t[0], t[1], 2.8, tip);
}

/** The riveted foundation slab every machine stands on (with hazard stripes if asked). */
export function slab(ctx: Ctx, f: IsoFrame, color: string = C.steel, inset = 0.06, z = 0.3, seed = 1, hazard = false): void {
  box(ctx, f, inset, inset, f.w - inset, f.h - inset, 0, z, { top: color, left: mix(color, C.ink, 0.3), right: mix(color, C.ink, 0.5) }, seed);
  // Panel seams along whole tiles.
  ctx.save();
  ctx.strokeStyle = mix(color, C.ink, 0.55);
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1.1;
  for (let i = 1; i < f.w; i++) { const a = f.p(i, inset, z), b = f.p(i, f.h - inset, z); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  for (let j = 1; j < f.h; j++) { const a = f.p(inset, j, z), b = f.p(f.w - inset, j, z); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  ctx.restore();
  if (hazard) {
    const band: Pt[] = [f.p(0.2, 0.12, z), f.p(f.w - 0.2, 0.12, z), f.p(f.w - 0.2, 0.3, z), f.p(0.2, 0.3, z)];
    flat(ctx, band, C.hazard);
    ctx.save(); pathOf(ctx, band); ctx.clip();
    hatch(ctx, band, Math.PI / 4, 9, { w: 4, alpha: 0.85, seed });
    ctx.restore();
    ink(ctx, band, { closed: true, w: 1, shade: false, seed: seed + 3 });
  }
  const k = 0.2;
  for (const [x, y] of [[inset + k, inset + k], [f.w - inset - k, inset + k], [inset + k, f.h - inset - k], [f.w - inset - k, f.h - inset - k]] as const) {
    rivet(ctx, ...f.p(x, y, z), 2.2, C.steelL);
  }
}

/** A vertical cylinder between z0 and z1 centred on local (cx, cy). */
export function cylinder(ctx: Ctx, f: IsoFrame, cx: number, cy: number, r: number, z0: number, z1: number, color: string, seed = 1, o: { top?: string; rings?: number } = {}): void {
  const [ex, ey] = f.ell(r);
  const b = f.p(cx, cy, z0), t = f.p(cx, cy, z1);
  const side: Pt[] = [[t[0] - ex, t[1]], ...ellipsePts(b[0], b[1], ex, ey, seed, 0, 32).filter(([, y]) => y >= b[1] - 0.01).sort((p, q) => p[0] - q[0]), [t[0] + ex, t[1]]];
  castShadow(ctx, side, 8, 0.3);
  flat(ctx, side, mix(color, C.ink, 0.15));
  const rightHalf: Pt[] = [[t[0] + ex * 0.15, t[1]], [t[0] + ex, t[1]], [b[0] + ex, b[1]], [b[0] + ex * 0.15, b[1] + ey]];
  ctx.save(); pathOf(ctx, side); ctx.clip();
  flat(ctx, rightHalf, mix(color, C.ink, 0.38));
  hatch(ctx, rightHalf, Math.PI / 3, 3.2, { alpha: 0.45, seed });
  // Highlight line down the lit side.
  ink(ctx, [[t[0] - ex * 0.6, t[1] + 2], [b[0] - ex * 0.6, b[1] + ey * 0.8]], { w: 2, color: '#ffffff', alpha: 0.5, shade: false, taper: 0.1, seed: seed + 3 });
  for (let i = 1; i <= (o.rings ?? 0); i++) {
    const z = z0 + ((z1 - z0) * i) / ((o.rings ?? 0) + 1);
    const c = f.p(cx, cy, z);
    ink(ctx, ellipsePts(c[0], c[1], ex, ey, seed + i, 0, 32).filter(([, y]) => y >= c[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 1.4, color: C.steelDD, alpha: 0.8, taper: 0, seed: seed + 20 + i });
  }
  ctx.restore();
  ink(ctx, side, { closed: true, w: 2, seed: seed + 6 });
  const topE = ellipsePts(t[0], t[1], ex, ey, seed + 1, 0, 32);
  shape(ctx, topE, o.top ?? mix(color, '#ffffff', 0.18), { w: 1.8, seed: seed + 7 });
}

/** A dome resting on local (cx, cy) at z0, rising hz levels; optional band and portholes. */
export function domeIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, r: number, z0: number, hz: number, color: string, seed = 1, band?: string, ports = 0): void {
  const [ex, ey] = f.ell(r);
  const b = f.p(cx, cy, z0);
  const hp = hz * ILH;
  const out: Pt[] = [];
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI; out.push([b[0] + Math.cos(a) * ex, b[1] + Math.sin(a) * ey]); }
  for (let i = 1; i < 24; i++) { const a = Math.PI + (i / 24) * Math.PI; out.push([b[0] + Math.cos(a) * ex, b[1] + Math.sin(a) * (ey + hp)]); }
  castShadow(ctx, out, 9, 0.3);
  flat(ctx, out, color);
  ctx.save(); pathOf(ctx, out); ctx.clip();
  // Shadow crescent towards the lower right, hatched.
  const sh: Pt[] = out.map(([x, y]) => [x + ex * 0.42, y + (ey + hp) * 0.18] as Pt);
  flat(ctx, sh, mix(color, C.ink, 0.3), 0.85);
  hatch(ctx, sh, Math.PI / 3, Math.max(2.4, ex * 0.07), { alpha: 0.45, seed });
  // Meridian seams.
  ctx.strokeStyle = mix(color, C.ink, 0.5);
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.1;
  for (const k of [-0.5, 0, 0.5]) {
    ctx.beginPath();
    ctx.ellipse(b[0] + k * ex * 0.5, b[1] - hp * 0.45, Math.max(2, ex * (1 - Math.abs(k)) * 0.35), ey + hp * 0.55, 0, Math.PI, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (band) {
    ink(ctx, ellipsePts(b[0], b[1] - hp * 0.35, ex * 0.98, ey * 0.98, seed + 3, 0, 40).filter(([, y]) => y >= b[1] - hp * 0.35 - 0.5).sort((p, q) => p[0] - q[0]), { w: Math.max(3, hp * 0.18), color: band, shade: false, taper: 0, seed: seed + 4 });
  }
  // Highlight on the upper left.
  ink(ctx, [[b[0] - ex * 0.55, b[1] - hp * 0.55], [b[0] - ex * 0.2, b[1] - hp * 0.9 - ey * 0.3]], { w: Math.max(2, ex * 0.07), color: '#ffffff', alpha: 0.6, shade: false, taper: 0.3, seed: seed + 5 });
  ctx.restore();
  for (let i = 0; i < ports; i++) {
    const a = 0.25 * Math.PI + (i / Math.max(1, ports - 1)) * 0.5 * Math.PI;
    light(ctx, b[0] + Math.cos(a) * ex * 0.72, b[1] - hp * 0.25 + Math.sin(a) * ey * 0.55, Math.max(2, ex * 0.05), C.led);
  }
  ink(ctx, out, { closed: true, w: Math.max(2, ex * 0.04), seed: seed + 9 });
}

/** A barrel vault along local x or y: a box whose top reads as a curved, ribbed roof. */
export function vaultIso(ctx: Ctx, f: IsoFrame, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, color: string, ribs: number, axis: 'x' | 'y', seed = 1): void {
  box(ctx, f, x0, y0, x1, y1, z0, z1, color, seed);
  // Lit and shaded halves of the roof, a glowing skylight on the ridge.
  const mid = axis === 'x' ? (y0 + y1) / 2 : (x0 + x1) / 2;
  const half: Pt[] = axis === 'x'
    ? [f.p(x0, mid, z1), f.p(x1, mid, z1), f.p(x1, y1, z1), f.p(x0, y1, z1)]
    : [f.p(mid, y0, z1), f.p(x1, y0, z1), f.p(x1, y1, z1), f.p(mid, y1, z1)];
  flat(ctx, half, mix(color, C.ink, 0.18));
  hatch(ctx, half, Math.PI / 3, 3.4, { alpha: 0.3, seed: seed + 2 });
  const sky: Pt[] = axis === 'x'
    ? [f.p(x0 + 0.2, mid - 0.06, z1), f.p(x1 - 0.2, mid - 0.06, z1), f.p(x1 - 0.2, mid + 0.06, z1), f.p(x0 + 0.2, mid + 0.06, z1)]
    : [f.p(mid - 0.06, y0 + 0.2, z1), f.p(mid + 0.06, y0 + 0.2, z1), f.p(mid + 0.06, y1 - 0.2, z1), f.p(mid - 0.06, y1 - 0.2, z1)];
  shape(ctx, sky, C.glowCyan, { w: 1, shade: false, seed: seed + 3 });
  for (let i = 1; i < ribs; i++) {
    const t = i / ribs;
    const seg: Pt[] = axis === 'x'
      ? [f.p(x0 + (x1 - x0) * t, y0, z1), f.p(x0 + (x1 - x0) * t, y1, z1), f.p(x0 + (x1 - x0) * t, y1, z0 + (z1 - z0) * 0.3)]
      : [f.p(x0, y0 + (y1 - y0) * t, z1), f.p(x1, y0 + (y1 - y0) * t, z1), f.p(x1, y0 + (y1 - y0) * t, z0 + (z1 - z0) * 0.3)];
    ink(ctx, seg, { w: 2.2, color: C.steelD, taper: 0, seed: seed + 10 + i });
  }
}

/** A horizontal rotor (vertical-axis "flower" turbine) at height z. */
export function rotorIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, r: number, z: number, n: number, colors: readonly string[], phase = 0, seed = 1): void {
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, ny = ca;
    const w0 = r * 0.16, w1 = r * 0.07;
    const loc: Array<[number, number]> = [
      [cx + ca * r * 0.18 + nx * w0, cy + sa * r * 0.18 + ny * w0],
      [cx + ca * r * 0.98 + nx * w1, cy + sa * r * 0.98 + ny * w1],
      [cx + ca * r * 1.02, cy + sa * r * 1.02],
      [cx + ca * r * 0.98 - nx * w1 * 0.4, cy + sa * r * 0.98 - ny * w1 * 0.4],
      [cx + ca * r * 0.18 - nx * w0 * 0.5, cy + sa * r * 0.18 - ny * w0 * 0.5],
    ];
    const blade = loc.map(([x, y]) => f.p(x, y, z));
    // The blade's shadow falls on the ground far below.
    flat(ctx, loc.map(([x, y]) => f.p(x + 0.15, y + 0.15, 0.3)), C.ink, 0.18);
    shape(ctx, blade, colors[i % colors.length]!, { w: 1.6, seed: seed + i });
    const tip = f.p(cx + ca * r * 0.9, cy + sa * r * 0.9, z);
    light(ctx, tip[0], tip[1], 2.2, C.ledRed);
  }
  const hub = f.p(cx, cy, z);
  shape(ctx, ellipsePts(hub[0], hub[1], f.ell(r * 0.22)[0], f.ell(r * 0.22)[1], seed + 30), C.steel, { w: 1.6, seed: seed + 30 });
  rivet(ctx, hub[0], hub[1], 2.4, C.brassL);
}

/** A mast from z0 to z1 with a ball tip and a beacon light. */
export function mastIso(ctx: Ctx, f: IsoFrame, x: number, y: number, z0: number, z1: number, tip: string = C.cyan, seed = 1): void {
  const a = f.p(x, y, z0), b = f.p(x, y, z1);
  ink(ctx, [[a[0] + 6, a[1] + 3], [a[0] + 16, a[1] + 8]], { w: 2, color: C.ink, alpha: 0.2, shade: false, taper: 0.4, seed }); // ground shadow
  ink(ctx, [a, b], { w: 3.4, color: C.steelD, taper: 0.05, seed: seed + 1 });
  shape(ctx, ellipsePts(b[0], b[1], 5, 5, seed + 2, 0, 14), tip, { w: 1.4, seed: seed + 2 });
  light(ctx, b[0] - 1, b[1] - 1, 2.2, C.led);
}

/** A sensor dish lying on the roof at height z. */
export function dishIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, r: number, z: number, seed = 1): void {
  const c = f.p(cx, cy, z);
  const [ex, ey] = f.ell(r);
  const rim = ellipsePts(c[0], c[1] - ey * 0.4, ex, ey * 1.25, seed, 0.004, 32);
  castShadow(ctx, rim, 8, 0.3);
  shape(ctx, rim, C.ice, { w: 1.8, seed });
  ink(ctx, ellipsePts(c[0] + 2, c[1] - ey * 0.3, ex * 0.6, ey * 0.75, seed + 1, 0, 24), { closed: true, w: 1.1, color: C.steelL, shade: false, seed: seed + 1 });
  ctx.save(); pathOf(ctx, rim); ctx.clip();
  hatch(ctx, rim.map(([x, y]) => [x + ex * 0.5, y + ey * 0.4] as Pt), Math.PI / 3, 3, { alpha: 0.35, seed });
  ctx.restore();
  ink(ctx, [[c[0], c[1] - ey * 0.4], [c[0] - ex * 0.15, c[1] - ey * 1.6]], { w: 1.6, color: C.steelD, shade: false, taper: 0, seed: seed + 3 });
  light(ctx, c[0] - ex * 0.15, c[1] - ey * 1.6, 2.6, C.led);
}

/** A port protruding from the slab edge: coral nozzle (out) / turquoise intake (in). */
export function portIso(ctx: Ctx, f: IsoFrame, px: number, py: number, side: number, io: 'in' | 'out', z = 0.3, seed = 1): void {
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const mid: Record<number, [number, number]> = { 0: [px + 0.5, py], 1: [px + 1, py + 0.5], 2: [px + 0.5, py + 1], 3: [px, py + 0.5] };
  const [mx, my] = mid[side]!;
  const dx = DX[side]!, dy = DY[side]!;
  const tx = -dy, ty = dx;
  const out = io === 'out' ? 0.2 : 0.08, back = 0.12, half = 0.2;
  const x0 = Math.min(mx - tx * half - dx * back, mx + tx * half + dx * out), x1 = Math.max(mx - tx * half - dx * back, mx + tx * half + dx * out);
  const y0 = Math.min(my - ty * half - dy * back, my + ty * half + dy * out), y1 = Math.max(my - ty * half - dy * back, my + ty * half + dy * out);
  const col = io === 'out' ? C.coral : C.cyan;
  box(ctx, f, x0, y0, x1, y1, 0, z + 0.35, col, seed, { outline: 1.6 });
  const c = f.p(mx + dx * 0.02, my + dy * 0.02, z + 0.35);
  light(ctx, c[0], c[1], 2, io === 'out' ? C.ledWarm : C.led);
}

/** A slack cable between two local 3D points. */
export function cableIso(ctx: Ctx, f: IsoFrame, a: [number, number, number], b: [number, number, number], w = 2.2, seed = 1): void {
  cable(ctx, f.p(a[0], a[1], a[2]), f.p(b[0], b[1], b[2]), w, 0.12, C.steelDD, seed);
}

/** A sphere floating at (cx, cy, cz): flat colour, hatched shadow side, highlight, ink rim. */
export function sphereIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, cz: number, r: number, color: string, seed = 1, band?: string): void {
  const [x, y] = f.p(cx, cy, cz);
  const rx = r * SQ2 * IS, ry = Math.hypot(r * SQ2 * IH, r * 2 * ILH);
  const out = ellipsePts(x, y, rx, ry, seed, 0.006, 40);
  flat(ctx, out, color);
  ctx.save(); pathOf(ctx, out); ctx.clip();
  const sh = ellipsePts(x + rx * 0.35, y + ry * 0.3, rx, ry, seed + 1, 0, 40);
  flat(ctx, sh, mix(color, C.ink, 0.32), 0.9);
  hatch(ctx, sh, Math.PI / 3, Math.max(2.4, rx * 0.08), { alpha: 0.4, seed });
  if (band) ink(ctx, ellipsePts(x, y, rx * 1.02, ry * 0.32, seed + 2, 0, 40).filter(([, py]) => py >= y - 0.5).sort((p, q) => p[0] - q[0]), { w: Math.max(3, ry * 0.14), color: band, shade: false, taper: 0, seed: seed + 3 });
  ctx.restore();
  flat(ctx, ellipsePts(x - rx * 0.38, y - ry * 0.42, rx * 0.2, ry * 0.12, seed + 4, 0, 16, -0.5), '#ffffff', 0.75);
  ink(ctx, out, { closed: true, w: Math.max(1.8, rx * 0.035), seed: seed + 5 });
}

/** A vertical toothed wheel at (cx, cy, cz) in the plane facing `axis` (bucket wheels, gears). */
export function wheelIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, cz: number, r: number, axis: 'x' | 'y', teeth: number, color: string, seed = 1): void {
  const P = (a: number, k: number): Pt => {
    const h = Math.cos(a) * r * k, v = Math.sin(a) * r * k * 2; // r tiles across, 2r levels up
    return axis === 'x' ? f.p(cx, cy + h, cz + v) : f.p(cx + h, cy, cz + v);
  };
  const rim: Pt[] = [];
  for (let i = 0; i < teeth * 2; i++) rim.push(P((i / (teeth * 2)) * Math.PI * 2, i % 2 ? 1 : 0.84));
  castShadow(ctx, rim, 8, 0.28);
  shape(ctx, rim, color, { w: 1.8, seed });
  ctx.save(); pathOf(ctx, rim); ctx.clip();
  hatch(ctx, rim.map(([x, y]) => [x + 10, y + 8] as Pt), Math.PI / 3, 3.2, { alpha: 0.35, seed: seed + 1 });
  ctx.restore();
  const inner: Pt[] = [];
  for (let i = 0; i < 24; i++) inner.push(P((i / 24) * Math.PI * 2, 0.55));
  shape(ctx, inner, mix(color, C.ink, 0.3), { w: 1.2, shade: false, seed: seed + 2 });
  for (let i = 0; i < 6; i++) ink(ctx, [P((i / 6) * Math.PI * 2, 0.1), P((i / 6) * Math.PI * 2, 0.55)], { w: 1.6, color: C.steelL, shade: false, taper: 0, seed: seed + 3 + i });
  const hub = P(0, 0);
  rivet(ctx, hub[0], hub[1], 3, C.brassL);
}

/**
 * A bucket wheel standing on an axle along local `axis` at (cx, cy, cz): a drum of radius r tiles
 * (2r levels tall) `half` tiles either side of its plane, dark between its rims, `n` buckets
 * round the rim leaning into the turn, `n` spokes on the near face (so the picture repeats every
 * 1/n turn), a brass hub. `phase` (radians) turns it: as it grows the top moves towards −y
 * (axis 'x') or −x (axis 'y'). `full(a)`: does the bucket at angle a (0 = towards +y / +x,
 * π/2 = the top) carry a load, drawn in `load`?
 */
export function bucketWheelIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, cz: number, r: number, half: number, axis: 'x' | 'y', n: number, phase: number, color: string, seed = 1, o: { bucket?: string; load?: string; full?: (a: number) => boolean } = {}): void {
  const [ux, uy] = axis === 'x' ? [1, 0] : [0, 1];
  const W = (a: number, rho: number, d: number): Pt => {
    const h = Math.cos(a) * rho, v = Math.sin(a) * rho * 2;
    return axis === 'x' ? f.p(cx + d, cy + h, cz + v) : f.p(cx + h, cy + d, cz + v);
  };
  const near = f.depth(cx + ux * half, cy + uy * half) >= f.depth(cx - ux * half, cy - uy * half) ? half : -half;
  const ring = (d: number, rho: number, m = 40): Pt[] => Array.from({ length: m }, (_, i) => W((i / m) * Math.PI * 2, rho, d));
  // The drum: the hull of both rims, dark between them.
  const body = hull([...ring(-near, r), ...ring(near, r)]);
  castShadow(ctx, body, 5 + cz * 4, 0.26);
  flat(ctx, body, mix(color, C.ink, 0.6));
  // The near face's shade: by where its normal turns once rotated (light from −x).
  const [r0x, r0y] = f.r(cx, cy), [r1x, r1y] = f.r(cx + ux * Math.sign(near), cy + uy * Math.sign(near));
  const face = mix(color, C.ink, faceInk(r1x - r0x, r1y - r0y) * 0.8);
  // Buckets: each the hull of its section on both rims, shaded by whether it faces up.
  const angles = Array.from({ length: n }, (_, k) => phase + (k / n) * Math.PI * 2);
  for (const a of angles) {
    const sec = (d: number): Pt[] => [W(a - 0.2, r * 0.97, d), W(a - 0.13, r + 0.085, d), W(a + 0.24, r + 0.095, d), W(a + 0.2, r * 0.97, d)];
    const pts = hull([...sec(-near * 0.94), ...sec(near * 0.94)]);
    shape(ctx, pts, mix(o.bucket ?? C.brass, C.ink, 0.16 - 0.16 * Math.sin(a)), { w: 1.3, shade: false, jitter: 0, seed: seed + 1 });
    ink(ctx, sec(near * 0.94).slice(1, 3), { w: 1.2, color: mix(o.bucket ?? C.brass, '#ffffff', 0.35), shade: false, taper: 0, jitter: 0, seed: seed + 2 });
    if (o.full?.(a)) {
      const m = W(a + 0.05, r + 0.065, near * 0.2);
      shape(ctx, ellipsePts(m[0], m[1], 5.2, 3.2, seed + 3, 0.12, 14), o.load ?? C.sand, { w: 0.9, shade: false, seed: seed + 3 });
    }
  }
  // The near face: the rim, spokes and hub.
  const outer = ring(near, r), inner = ring(near, r * 0.8);
  flat(ctx, [...outer, outer[0]!, ...inner.slice().reverse(), inner[inner.length - 1]!], face);
  ink(ctx, outer, { closed: true, w: 1.6, seed: seed + 4 });
  ink(ctx, inner, { closed: true, w: 1.1, alpha: 0.75, shade: false, seed: seed + 5 });
  for (const a of angles) ink(ctx, [W(a, r * 0.14, near), W(a, r * 0.8, near)], { w: 2, color: face, shade: false, taper: 0, jitter: 0, seed: seed + 6 });
  for (const a of angles) ink(ctx, [W(a + 0.07, r * 0.2, near), W(a + 0.05, r * 0.78, near)], { w: 0.9, alpha: 0.55, shade: false, taper: 0, jitter: 0, seed: seed + 7 });
  const hub = W(0, 0, near);
  shape(ctx, ellipsePts(hub[0], hub[1], 6.5, 6.5, seed + 8, 0, 16), C.steelD, { w: 1.2, shade: false, jitter: 0, seed: seed + 8 });
  rivet(ctx, hub[0], hub[1], 3.4, C.brassL);
}

/**
 * An IsoFrame that lays every point on the ground along the light: a point at height z lands
 * z·(dx, dy) tiles away (in rotated, screen-fixed tile terms, as the light is), at z = 0. A
 * recipe drawn through it paints its own cast shadow (buildings.ts `drawBuildingShadow`). It has
 * no headroom (nothing rises); `SW` / `SH` are the canvas it needs, room for the longest shadow.
 */
export class ShadowFrame extends IsoFrame {
  readonly SW: number;
  readonly SH: number;
  constructor(w: number, h: number, rot: Rot, head: number, readonly dx: number, readonly dy: number) {
    super(w, h, rot, 0);
    this.SW = Math.ceil(this.W + Math.max(0, dx - dy) * head * IS);
    this.SH = Math.ceil(this.H + Math.max(0, dx + dy) * head * IH);
  }
  override pr(rx: number, ry: number, z = 0): Pt {
    return super.pr(rx + z * this.dx, ry + z * this.dy, 0);
  }
}

/** A cup of petals opening upward around (cx, cy): r0 at z0 → r1 at z1. */
export function cupIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, r0: number, r1: number, z0: number, z1: number, n: number, colors: readonly string[], seed = 1, phase = 0): void {
  const petals: Array<{ d: number; pts: Pt[]; c: string }> = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2, w = Math.PI / n;
    const pt = (aa: number, rr: number, z: number): Pt => f.p(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr, z);
    const pts: Pt[] = [pt(a - w * 0.5, r0, z0), pt(a - w * 0.85, r1 * 0.92, z1 * 0.97 + z0 * 0.03), pt(a, r1, z1), pt(a + w * 0.85, r1 * 0.92, z1 * 0.97 + z0 * 0.03), pt(a + w * 0.5, r0, z0)];
    petals.push({ d: f.depth(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1), pts, c: colors[i % colors.length]! });
  }
  petals.sort((a, b) => a.d - b.d);
  for (const p of petals) shape(ctx, p.pts, p.c, { w: 1.5, seed: seed + Math.round(p.d * 10) });
}

// ── machine solids: prisms, frustums, lathe solids, drums, lattices, flow marks ─────────────

/**
 * Ink fraction of a face from its ROTATED outward horizontal normal. The light comes from −x
 * (top-left of the screen): a +y face gets 0.22 (box's lit face), a +x face 0.42 (box's shaded
 * face), faces turned towards −x get lighter still.
 */
export function faceInk(nx: number, ny: number): number {
  const b = -(nx * 0.91 + ny * 0.41);
  return Math.min(0.5, Math.max(0.04, 0.22 + (-0.41 - b) * 0.4));
}

const area2 = (q: readonly Pt[]): number => {
  let s = 0;
  for (let i = 0; i < q.length; i++) { const a = q[i]!, b = q[(i + 1) % q.length]!; s += a[0] * b[1] - b[0] * a[1]; }
  return s;
};

/**
 * A vertical prism over a convex local polygon, from z0 up to a flat top or a sloped one (one
 * height per vertex: ramps, lean-tos, sawtooth teeth). Only the faces turned to the camera are
 * drawn, each shaded by how it faces the light (`faceInk`; `col.left` / `col.right` override the
 * +y-ish / +x-ish ones), then the top with a lit far rim. Returns the top's canvas points.
 */
export function prismIso(ctx: Ctx, f: IsoFrame, base: ReadonlyArray<readonly [number, number]>, z0: number, top: number | readonly number[], col: string | Faces, seed = 1, o: { outline?: number; shadow?: boolean; hatch?: boolean } = {}): Pt[] {
  const fc: Faces = typeof col === 'string' ? { top: col } : col;
  let R = base.map(([x, y]) => f.r(x, y));
  let Z = base.map((_, i) => (typeof top === 'number' ? top : top[i] ?? z0));
  // Clockwise on screen (positive shoelace in rotated coords, y down): outward normal = (ey, −ex).
  if (area2(R) < 0) { R = R.slice().reverse(); Z = Z.slice().reverse(); }
  const n = R.length;
  const tp = R.map(([x, y], i) => f.pr(x, y, Z[i]!)), bp = R.map(([x, y]) => f.pr(x, y, z0));
  const sil = hull([...tp, ...bp]);
  if (o.shadow !== false) castShadow(ctx, sil, 4 + (Math.max(...Z) - z0) * 5, 0.3);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = R[j]![0] - R[i]![0], ey = R[j]![1] - R[i]![1], L = Math.hypot(ex, ey) || 1;
    const nx = ey / L, ny = -ex / L;
    if (nx + ny <= 1e-6) continue;
    const q: Pt[] = [tp[i]!, tp[j]!, bp[j]!, bp[i]!];
    const k = faceInk(nx, ny);
    flat(ctx, q, (ny >= nx ? fc.left : fc.right) ?? mix(fc.top, C.ink, k));
    if (k > 0.3 && o.hatch !== false) hatch(ctx, q, Math.PI / 3, 3.4, { alpha: 0.4, seed: seed + i, w: 1 });
    ink(ctx, [tp[j]!, bp[j]!], { w: 1.2, alpha: 0.8, taper: 0, seed: seed + 20 + i });
  }
  flat(ctx, tp, fc.top);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const far = (R[j]![1] - R[i]![1]) - (R[j]![0] - R[i]![0]) <= 0;
    ink(ctx, [tp[i]!, tp[j]!], far
      ? { w: 1.2, color: mix(fc.top, '#ffffff', 0.45), shade: false, taper: 0, jitter: 0.1, seed: seed + 40 + i }
      : { w: 1.2, alpha: 0.7, taper: 0, seed: seed + 40 + i });
  }
  ink(ctx, sil, { closed: true, w: o.outline ?? 2.2, seed: seed + 9 });
  return tp;
}

/**
 * A box whose sides lean in by `inset` tiles at the top (battered walls, hip roofs, furnace
 * shafts), or flare out when `inset` < 0 (hoppers, chutes). `open` paints the top as a mouth:
 * dark inside, far inner walls lit, so a hopper reads as hollow. Returns the top's canvas points.
 */
export function frustumIso(ctx: Ctx, f: IsoFrame, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, inset: number, col: string | Faces, seed = 1, o: { open?: string; outline?: number; shadow?: boolean } = {}): Pt[] {
  const fc: Faces = typeof col === 'string' ? { top: col } : col;
  const [a0, b0, a1, b1] = f.rect(x0, y0, x1, y1);
  const B: Array<[number, number]> = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
  const T: Array<[number, number]> = [[a0 + inset, b0 + inset], [a1 - inset, b0 + inset], [a1 - inset, b1 - inset], [a0 + inset, b1 - inset]];
  const bp = B.map(([x, y]) => f.pr(x, y, z0)), tp = T.map(([x, y]) => f.pr(x, y, z1));
  const sil = hull([...bp, ...tp]);
  if (o.shadow !== false) castShadow(ctx, sil, 4 + (z1 - z0) * 5, 0.3);
  const N: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const tilt = Math.abs(inset) / (Math.abs(inset) + Math.max(0.05, z1 - z0) * 0.5);
  const sides = [0, 1, 2, 3].map((i) => { const j = (i + 1) % 4; return { i, q: [bp[i]!, bp[j]!, tp[j]!, tp[i]!] as Pt[] }; });
  for (const { i, q } of sides) {
    if (area2(q) <= 0) continue;
    const k = faceInk(N[i]![0], N[i]![1]) * (1 - (inset > 0 ? 0.45 : 0) * tilt);
    flat(ctx, q, (i === 2 ? fc.left : i === 1 ? fc.right : undefined) ?? mix(fc.top, C.ink, k));
    if (k > 0.28) hatch(ctx, q, Math.PI / 3, 3.4, { alpha: 0.4, seed: seed + i, w: 1 });
    ink(ctx, [q[1]!, q[2]!], { w: 1.2, alpha: 0.8, taper: 0, seed: seed + 20 + i });
  }
  if (o.open) {
    flat(ctx, tp, o.open);
    // The far inner walls (back-facing outside, so seen from inside through the mouth).
    ctx.save(); pathOf(ctx, tp); ctx.clip();
    for (const { i, q } of sides) {
      if (area2(q) > 0) continue;
      flat(ctx, q, mix(fc.top, C.ink, 0.12 + 0.25 * (i === 3 ? 0 : 1)));
      if (i === 0) hatch(ctx, q, Math.PI / 3, 3.2, { alpha: 0.3, seed: seed + 30 + i });
    }
    flat(ctx, bp, o.open);
    ctx.restore();
    ink(ctx, tp, { closed: true, w: 1.6, seed: seed + 8 });
  } else {
    flat(ctx, tp, fc.top);
    ink(ctx, [tp[3]!, tp[0]!, tp[1]!], { w: 1.2, color: mix(fc.top, '#ffffff', 0.45), shade: false, taper: 0, jitter: 0.1, seed: seed + 7 });
    ink(ctx, [tp[3]!, tp[2]!, tp[1]!], { w: 1.2, alpha: 0.7, taper: 0, seed: seed + 8 });
  }
  ink(ctx, sil, { closed: true, w: o.outline ?? 2.2, seed: seed + 9 });
  return tp;
}

/**
 * A solid of revolution about a vertical axis on local (cx, cy). `prof` lists [z, r] from the
 * bottom up; two points at the same z make a flat ledge. Stacks, cones, cooling towers, flasks,
 * funnels and drill bits: each band is the hull of its two rings, its right flank shaded and
 * hatched, a highlight down the lit flank, a seam at every ring; the top is capped (`top`) or
 * left open (`open`: a dark throat showing its far inner wall).
 */
export function latheIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, prof: ReadonlyArray<readonly [number, number]>, color: string, seed = 1, o: { top?: string; open?: string; seams?: boolean; shadow?: boolean; outline?: number } = {}): void {
  const rings = prof.map(([z, r]) => {
    const c = f.p(cx, cy, z);
    const [ex, ey] = f.ell(Math.max(0.001, r));
    return { z, c, ex, ey, pts: ellipsePts(c[0], c[1], ex, ey, seed, 0, 32) };
  });
  const n = rings.length;
  if (n < 2) return;
  const first = rings[0]!, last = rings[n - 1]!;
  // Silhouette: left flank down, the bottom ring's front half, right flank up, the top's back half.
  const sil: Pt[] = [];
  for (let i = n - 1; i >= 0; i--) sil.push([rings[i]!.c[0] - rings[i]!.ex, rings[i]!.c[1]]);
  for (let k = 0; k <= 16; k++) { const a = Math.PI - (k / 16) * Math.PI; sil.push([first.c[0] + Math.cos(a) * first.ex, first.c[1] + Math.sin(a) * first.ey]); }
  for (let i = 0; i < n; i++) sil.push([rings[i]!.c[0] + rings[i]!.ex, rings[i]!.c[1]]);
  for (let k = 0; k <= 16; k++) { const a = -(k / 16) * Math.PI; sil.push([last.c[0] + Math.cos(a) * last.ex, last.c[1] + Math.sin(a) * last.ey]); }
  if (o.shadow !== false) castShadow(ctx, sil, 6 + (last.z - first.z) * 3, 0.28);
  const lit = mix(color, '#ffffff', 0.18);
  for (let i = 0; i < n - 1; i++) {
    const A = rings[i]!, B = rings[i + 1]!;
    if (Math.abs(A.z - B.z) < 1e-6) {
      // A flat ledge: the wider ring's top, lit.
      const W = A.ex >= B.ex ? A : B;
      flat(ctx, W.pts, lit);
      ink(ctx, W.pts, { closed: true, w: 1.2, alpha: 0.8, seed: seed + 50 + i });
      continue;
    }
    const h = hull([...A.pts, ...B.pts]);
    flat(ctx, h, mix(color, C.ink, 0.1));
    ctx.save(); pathOf(ctx, h); ctx.clip();
    const right: Pt[] = [
      [B.c[0] + B.ex * 0.18, B.c[1] - B.ey], [B.c[0] + B.ex + 12, B.c[1] - B.ey],
      [A.c[0] + A.ex + 12, A.c[1] + A.ey + 4], [A.c[0] + A.ex * 0.18, A.c[1] + A.ey + 4],
    ];
    flat(ctx, right, mix(color, C.ink, 0.38));
    hatch(ctx, right, Math.PI / 3, 3.2, { alpha: 0.42, seed: seed + i });
    ink(ctx, [[B.c[0] - B.ex * 0.6, B.c[1] + B.ey * 0.6], [A.c[0] - A.ex * 0.6, A.c[1] + A.ey * 0.6]], { w: 2, color: '#ffffff', alpha: 0.45, shade: false, taper: 0.1, seed: seed + 60 + i });
    ctx.restore();
    if (o.seams !== false && i > 0) {
      ink(ctx, A.pts.filter(([, y]) => y >= A.c[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 1.3, color: C.steelDD, alpha: 0.75, taper: 0, seed: seed + 70 + i });
    }
  }
  if (o.open) {
    flat(ctx, last.pts, o.open);
    ctx.save(); pathOf(ctx, last.pts); ctx.clip();
    const inner = ellipsePts(last.c[0], last.c[1] + last.ey * 0.7, last.ex, last.ey, seed + 3, 0, 32);
    const wall: Pt[] = [...last.pts.filter(([, y]) => y <= last.c[1]).sort((p, q) => p[0] - q[0]), ...inner.filter(([, y]) => y <= last.c[1] + last.ey * 0.7).sort((p, q) => q[0] - p[0])];
    flat(ctx, wall, mix(color, C.ink, 0.2));
    ctx.restore();
    ink(ctx, last.pts, { closed: true, w: 1.6, seed: seed + 4 });
  } else {
    shape(ctx, last.pts, o.top ?? lit, { w: 1.6, seed: seed + 5 });
  }
  ink(ctx, sil, { closed: true, w: o.outline ?? 2, seed: seed + 6 });
}

/**
 * A horizontal cylinder lying along local `axis`, centred on (cx, cy) with its axis at height
 * cz; radius r tiles (2r levels tall), half-length `half`. Boilers, spools, rollers, piped
 * racks: the hull of the two end discs, lit above and hatched below, `bands` (t in −1…1) as
 * seams, and the near end disc on top (shaded by where it faces) with a hub.
 */
export function drumIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, cz: number, r: number, half: number, axis: 'x' | 'y', color: string, seed = 1, o: { end?: string; bands?: readonly number[]; shadow?: boolean; hub?: boolean } = {}): Pt[] {
  const P = (t: number, a: number, k = 1): Pt => {
    const h = Math.cos(a) * r * k, v = Math.sin(a) * r * k * 2;
    return axis === 'x' ? f.p(cx + t * half, cy + h, cz + v) : f.p(cx + h, cy + t * half, cz + v);
  };
  const disc = (t: number, k = 1): Pt[] => Array.from({ length: 32 }, (_, i) => P(t, (i / 32) * Math.PI * 2, k));
  const A = disc(-1), B = disc(1);
  const body = hull([...A, ...B]);
  if (o.shadow !== false) castShadow(ctx, body, 5 + cz * 4, 0.28);
  flat(ctx, body, color);
  ctx.save(); pathOf(ctx, body); ctx.clip();
  const lowHalf = (t: number): Pt[] => Array.from({ length: 17 }, (_, i) => P(t, Math.PI + (i / 16) * Math.PI));
  const low = hull([...lowHalf(-1), ...lowHalf(1), P(-1, 0, 0), P(1, 0, 0)]);
  flat(ctx, low, mix(color, C.ink, 0.34));
  hatch(ctx, low, Math.PI / 3, 3.2, { alpha: 0.4, seed });
  ink(ctx, [P(-0.92, Math.PI * 0.62), P(0.92, Math.PI * 0.62)], { w: 2, color: '#ffffff', alpha: 0.5, shade: false, taper: 0.1, seed: seed + 1 });
  // Seams: the half of each ring that faces the camera.
  const ax = axis === 'x' ? 0 : 1, ay = axis === 'x' ? 1 : 0;
  const s = Math.sign(f.depth(cx + ax, cy + ay) - f.depth(cx, cy)) || 1;
  for (const t of o.bands ?? []) {
    const arc = Array.from({ length: 17 }, (_, i) => P(t, Math.PI / 2 + (s > 0 ? -1 : 1) * (i / 16) * Math.PI));
    ink(ctx, arc, { w: 1.3, color: C.steelDD, alpha: 0.75, taper: 0, seed: seed + 10 });
  }
  ctx.restore();
  // The near end: the disc whose centre is deeper.
  const [ux, uy] = axis === 'x' ? [1, 0] : [0, 1];
  const nearT = f.depth(cx + ux * half, cy + uy * half) >= f.depth(cx - ux * half, cy - uy * half) ? 1 : -1;
  const [r0x, r0y] = f.r(cx, cy), [r1x, r1y] = f.r(cx + ux * nearT, cy + uy * nearT);
  const endCol = o.end ?? mix(color, C.ink, faceInk(r1x - r0x, r1y - r0y) * 0.7);
  shape(ctx, nearT > 0 ? B : A, endCol, { w: 1.6, seed: seed + 2 });
  if (o.hub !== false) {
    ink(ctx, disc(nearT, 0.55), { closed: true, w: 1.1, alpha: 0.6, shade: false, seed: seed + 3 });
    const [hx, hy] = P(nearT, 0, 0);
    rivet(ctx, hx, hy, Math.max(1.6, r * 9), C.brassL);
  }
  ink(ctx, body, { closed: true, w: 1.8, seed: seed + 4 });
  return body;
}

/**
 * A square lattice tower on local (cx, cy): four legs from half-width w0 at z0 to w1 at z1,
 * `segs` X-braced panels with rings between them (derricks, relay and mooring masts, cranes).
 */
export function trussIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, w0: number, w1: number, z0: number, z1: number, segs: number, color: string = C.steelL, seed = 1, legW = 3): void {
  const K: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const at = (k: number, t: number): Pt => {
    const w = w0 + (w1 - w0) * t, [sx, sy] = K[k]!;
    return f.p(cx + sx * w, cy + sy * w, z0 + (z1 - z0) * t);
  };
  const dep = (k: number): number => f.depth(cx + K[k]![0], cy + K[k]![1]);
  const legs = [0, 1, 2, 3].sort((a, b) => dep(a) - dep(b));
  const panel = (k: number, alpha: number, w: number): void => {
    const j = (k + 1) % 4;
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs, t1 = (s + 1) / segs;
      ink(ctx, [at(k, t0), at(j, t1)], { w, color: C.steelD, alpha, shade: false, taper: 0, seed: seed + k * 10 + s });
      ink(ctx, [at(j, t0), at(k, t1)], { w, color: C.steelD, alpha, shade: false, taper: 0, seed: seed + k * 10 + s + 5 });
      ink(ctx, [at(k, t1), at(j, t1)], { w: w + 0.4, color: C.steelDD, alpha, shade: false, taper: 0, seed: seed + k * 10 + s + 7 });
    }
  };
  const near = (k: number): boolean => dep(k) + dep((k + 1) % 4) > 2 * f.depth(cx, cy);
  for (let k = 0; k < 4; k++) if (!near(k)) panel(k, 0.7, 1.1);
  for (const k of legs.slice(0, 2)) ink(ctx, [at(k, 0), at(k, 1)], { w: legW, color, taper: 0.04, seed: seed + 40 + k });
  for (let k = 0; k < 4; k++) if (near(k)) panel(k, 1, 1.4);
  for (const k of legs.slice(2)) {
    ink(ctx, [at(k, 0), at(k, 1)], { w: legW + 2, color: C.ink, shade: false, taper: 0.04, seed: seed + 50 + k });
    ink(ctx, [at(k, 0), at(k, 1)], { w: legW, color, shade: false, taper: 0.04, seed: seed + 40 + k });
  }
}

/**
 * The CrierBelt mark (`crierMarkMapped`) painted flat on a horizontal surface at height z — a
 * deck, a roof — centred on local (cx, cy), radius r tiles. It turns with the footprint.
 */
export function crierMarkIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, z: number, r: number, seed = 1): void {
  crierMarkMapped(ctx, (u, v) => f.p(cx + u * r, cy + v * r, z), r * IS, seed);
}

/**
 * The CrierBelt mark painted upright on a visible face of a box (a sign, a wall), centred at u
 * across the face and height z, radius r tiles (round in 3D: 2 levels per tile).
 */
export function crierMarkFace(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, u: number, z: number, r: number, seed = 1): void {
  const len = face === 'L' ? rr[2] - rr[0] : rr[3] - rr[1];
  crierMarkMapped(ctx, (a, b) => facePt(f, rr, face, u + (a * r) / len, z - b * r * 2), r * IS * 1.1, seed);
}

// ── power terminals (art/terminals.ts) ──────────────────────────────────────────────────────

/** Porcelain and its shading: the insulators' glaze, lit and in shade. */
const GLAZE = mix(C.ice, '#ffffff', 0.35), GLAZE_D = mix(C.ice, C.steel, 0.45);

/** A horizontal disc (a shed, a cap, a plate) at height z: its lower half shaded, inked all round. */
function discIso(ctx: Ctx, f: IsoFrame, x: number, y: number, z: number, r: number, col: string, shade: string, w = 1): void {
  const c = f.p(x, y, z), [ex, ey] = f.ell(r);
  const full = ellipsePts(c[0], c[1], ex, ey, 1, 0, 20);
  flat(ctx, full, col);
  flat(ctx, [[c[0] - ex, c[1]], ...full.filter(([, py]) => py > c[1]).sort((p, q) => p[0] - q[0]), [c[0] + ex, c[1]]], shade);
  flat(ctx, ellipsePts(c[0], c[1] - ey * 0.25, ex * 0.72, ey * 0.55, 2, 0, 16), col);
  ink(ctx, full, { closed: true, w, shade: false, taper: 0, jitter: 0 });
}

/**
 * A power terminal (art/terminals.ts): the porcelain insulator a wire clamps to — a glazed body
 * with two sheds (three on a hanging string) and a brass clamp, its clamp point exactly at the
 * terminal's (x, y, z). With a `base` it stands on a short dark service mast from that roof (or,
 * `hang`, hangs from it: a pylon's suspension string). `k` scales its width (the Heart's are
 * beefier). Reports its clamp point to `terminalProbe` (tests).
 */
export function terminalIso(ctx: Ctx, f: IsoFrame, t: Terminal, seed = 1, k = 1): void {
  const { x, y, z } = t;
  const P = (zz: number): Pt => f.p(x, y, zz);
  const bar = (z0: number, z1: number, w: number, col: string): void => {
    const a = P(z0), b = P(z1);
    ink(ctx, [a, b], { w: w + 2, color: C.ink, shade: false, taper: 0, jitter: 0, seed });
    ink(ctx, [a, b], { w, color: col, shade: false, taper: 0, jitter: 0, seed: seed + 1 });
  };
  if (t.hang && t.base !== undefined) {
    // Hanging from the arm: a steel link, three sheds down the string, the clamp at its foot.
    const top = t.base, foot = z + CLAMP;
    bar(top, top - 0.06, 1.6 * k, C.steelD);
    bar(top - 0.05, foot, 2.6 * k, GLAZE);
    for (let i = 0; i < 3; i++) discIso(ctx, f, x, y, top - 0.1 - ((top - 0.1 - foot - 0.03) * i) / 2, 0.07 * k, GLAZE, GLAZE_D);
    discIso(ctx, f, x, y, z + CLAMP * 0.4, 0.034 * k, C.brass, mix(C.brass, C.ink, 0.35));
    flat(ctx, ellipsePts(...P(z), 1.3 * k, 1.3 * k, 3, 0, 8), C.brassL);
    terminalProbe.fn?.(x, y, z);
    return;
  }
  const c0 = z - INSULATOR, c1 = z - CLAMP;
  if (t.base !== undefined && c0 - t.base > 0.02) {
    // The service mast: a foot plate on the roof, a dark steel stem with a collar.
    discIso(ctx, f, x, y, t.base + 0.01, 0.055 * k, C.steelD, C.steelDD);
    bar(t.base, c0 + 0.03, 2.4 * k, C.steelD);
    discIso(ctx, f, x, y, c0 + 0.015, 0.04 * k, C.steel, C.steelD);
  }
  // The porcelain: a glazed body, two sheds, the brass clamp on top.
  bar(c0, c1, 3 * k, GLAZE);
  discIso(ctx, f, x, y, c0 + (c1 - c0) * 0.3, 0.07 * k, GLAZE, GLAZE_D);
  discIso(ctx, f, x, y, c0 + (c1 - c0) * 0.78, 0.062 * k, GLAZE, GLAZE_D);
  const cb = P(c1), ct = P(z), [ex, ey] = f.ell(0.034 * k);
  const cap: Pt[] = [[cb[0] - ex, cb[1]], ...ellipsePts(cb[0], cb[1], ex, ey, 4, 0, 14).filter(([, py]) => py > cb[1]).sort((p, q) => p[0] - q[0]), [cb[0] + ex, cb[1]], [ct[0] + ex, ct[1]], [ct[0] - ex, ct[1]]];
  flat(ctx, cap, mix(C.brass, C.ink, 0.2));
  ink(ctx, cap, { closed: true, w: 1, shade: false, taper: 0, jitter: 0 });
  discIso(ctx, f, x, y, z, 0.034 * k, C.brassL, C.brass);
  terminalProbe.fn?.(x, y, z);
}

/** A flat chevron on a horizontal surface at height z, pointing to a local side (0 N … 3 W). */
export function chevronIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, z: number, side: number, size: number, color: string, seed = 1, w = 3): void {
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const dx = DX[side & 3]!, dy = DY[side & 3]!, tx = -dy, ty = dx;
  const loc: Array<[number, number]> = [
    [cx - dx * size * 0.45 + tx * size, cy - dy * size * 0.45 + ty * size],
    [cx + dx * size * 0.45, cy + dy * size * 0.45],
    [cx - dx * size * 0.45 - tx * size, cy - dy * size * 0.45 - ty * size],
  ];
  const pts = loc.map(([x, y]) => f.p(x, y, z));
  ink(ctx, pts, { w: w + 2.2, color: C.ink, alpha: 0.55, shade: false, taper: 0, jitter: 0, seed });
  ink(ctx, pts, { w, color, shade: false, taper: 0, jitter: 0.1, seed: seed + 1 });
}
