// shapes.ts — the inked sci-fi vocabulary of Ysmère's machines, seen from above: riveted
// blue-steel foundations, panelled domes with glowing portholes, pipes and ducts, pistons,
// vents, rotors, antennas, vaults, power terminals (art/terminals.ts), the CrierBelt mark.
// Geometry is placed through a Frame (tile coordinates of the UNROTATED footprint → canvas
// pixels of the rotated sprite) while the light stays fixed at the top-left whatever the
// rotation.
import type { Rot } from '@/sim/types';
import { C, mix } from './tokens';
import {
  castShadow, ellipsePts, flat, hatch, highlight, ink, pathOf, roundRectPts, shadowCrescent, shape, stipple,
  type Ctx, type Pt,
} from './ink';
import { INSULATOR, terminalProbe, type Terminal } from './terminals';

/** Sprite geometry: px per tile, margin, footprint and rotation. */
export class Frame {
  readonly W: number;
  readonly H: number;
  constructor(readonly S: number, readonly M: number, readonly w: number, readonly h: number, readonly rot: Rot) {
    const rw = rot & 1 ? h : w, rh = rot & 1 ? w : h;
    this.W = rw * S + 2 * M;
    this.H = rh * S + 2 * M;
  }
  /** Unrotated tile coords (x right, y down, may be fractional) → canvas px. */
  p(x: number, y: number): Pt {
    const { w, h, rot, S, M } = this;
    let rx = x, ry = y;
    switch (rot) {
      case 1: rx = h - y; ry = x; break;
      case 2: rx = w - x; ry = h - y; break;
      case 3: rx = y; ry = w - x; break;
    }
    return [M + rx * S, M + ry * S];
  }
  /** A length in tiles → px. */
  l(t: number): number { return t * this.S; }
  /** Rotate a direction given as unrotated side index (0 N, 1 E, 2 S, 3 W). */
  dir(side: number): number { return (side + this.rot) & 3; }
}

const DIRV: ReadonlyArray<Pt> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Axis-aligned rect (after rotation) from unrotated tile coords. */
export function rectPts(f: Frame, x0: number, y0: number, x1: number, y1: number, r: number): Pt[] {
  const a = f.p(x0, y0), b = f.p(x1, y1);
  return roundRectPts(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), f.l(r));
}

/** A rivet: a tiny bolt head with a glint. */
export function rivet(ctx: Ctx, x: number, y: number, r: number, color: string = C.steelL): void {
  flat(ctx, ellipsePts(x + r * 0.3, y + r * 0.4, r, r, 3, 0, 10), C.ink, 0.35);
  shape(ctx, ellipsePts(x, y, r, r, 5, 0, 10), color, { w: Math.max(0.7, r * 0.4), shade: false, jitter: 0 });
  flat(ctx, ellipsePts(x - r * 0.3, y - r * 0.3, r * 0.35, r * 0.35, 7, 0, 8), '#ffffff', 0.7);
}

/**
 * The riveted foundation every machine stands on: a blue-steel plate with a bevel, panel
 * seams, corner rivets and (optionally) hazard stripes on the front edge — over the whole
 * footprint or, given `at` (a local rect [x0, y0, x1, y1]), over part of it (the trade post's pad).
 */
export function plinth(ctx: Ctx, f: Frame, color: string = C.steel, inset = 0.06, seed = 1, hazard = false, at: readonly [number, number, number, number] = [0, 0, f.w, f.h]): Pt[] {
  const a = f.p(at[0] + inset, at[1] + inset), b = f.p(at[2] - inset, at[3] - inset);
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const W = x1 - x0, H = y1 - y0, r = f.l(0.16);
  const pts = roundRectPts(x0, y0, W, H, r);
  castShadow(ctx, pts, f.l(0.12), 0.32);
  flat(ctx, pts, color);
  // Bevel: lit top-left rim, shaded bottom-right rim.
  const bev = f.l(0.07);
  const inner = roundRectPts(x0 + bev, y0 + bev, W - 2 * bev, H - 2 * bev, r * 0.7);
  ink(ctx, [[x0 + r, y0 + bev * 0.5], [x1 - r, y0 + bev * 0.5]], { w: bev * 0.9, color: mix(color, '#ffffff', 0.35), shade: false, taper: 0, jitter: 0.2, seed });
  ink(ctx, [[x0 + bev * 0.5, y0 + r], [x0 + bev * 0.5, y1 - r]], { w: bev * 0.9, color: mix(color, '#ffffff', 0.25), shade: false, taper: 0, jitter: 0.2, seed: seed + 1 });
  ink(ctx, [[x0 + r, y1 - bev * 0.5], [x1 - r, y1 - bev * 0.5]], { w: bev, color: mix(color, C.ink, 0.45), shade: false, taper: 0, jitter: 0.2, seed: seed + 2 });
  ink(ctx, [[x1 - bev * 0.5, y0 + r], [x1 - bev * 0.5, y1 - r]], { w: bev, color: mix(color, C.ink, 0.4), shade: false, taper: 0, jitter: 0.2, seed: seed + 3 });
  // Panel seams on a grid of whole tiles.
  ctx.save();
  ctx.strokeStyle = mix(color, C.ink, 0.5);
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(0.8, f.l(0.012));
  const cols = Math.round(W / f.S), rows = Math.round(H / f.S);
  for (let i = 1; i < cols; i++) { const x = x0 + (W * i) / cols; ctx.beginPath(); ctx.moveTo(x, y0 + bev); ctx.lineTo(x, y1 - bev); ctx.stroke(); }
  for (let j = 1; j < rows; j++) { const y = y0 + (H * j) / rows; ctx.beginPath(); ctx.moveTo(x0 + bev, y); ctx.lineTo(x1 - bev, y); ctx.stroke(); }
  ctx.restore();
  if (hazard) hazardEdge(ctx, f, seed, at);
  ink(ctx, pts, { closed: true, w: f.l(0.04), seed: seed + 4 });
  ink(ctx, inner, { closed: true, w: f.l(0.012), alpha: 0.4, shade: false, seed: seed + 5 });
  const rv = Math.max(1.6, f.l(0.035));
  for (const [x, y] of [[x0 + r * 0.9, y0 + r * 0.9], [x1 - r * 0.9, y0 + r * 0.9], [x0 + r * 0.9, y1 - r * 0.9], [x1 - r * 0.9, y1 - r * 0.9]] as const) rivet(ctx, x, y, rv);
  return pts;
}

/** Yellow/ink hazard stripes along the front (unrotated top) edge. */
function hazardEdge(ctx: Ctx, f: Frame, seed: number, at: readonly [number, number, number, number]): void {
  const band = rectPts(f, at[0] + 0.18, at[1] + 0.1, at[2] - 0.18, at[1] + 0.22, 0.02);
  flat(ctx, band, C.hazard);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(band[0]![0], band[0]![1]); for (const p of band) ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.clip();
  hatch(ctx, band, Math.PI / 4, f.l(0.12), { w: f.l(0.05), alpha: 0.85, seed });
  ctx.restore();
}

/** A glowing light: halo, core, tiny glint. */
export function light(ctx: Ctx, x: number, y: number, r: number, color: string = C.glowCyan): void {
  flat(ctx, ellipsePts(x, y, r * 2.1, r * 2.1, 2, 0, 16), color, 0.22);
  flat(ctx, ellipsePts(x, y, r * 1.35, r * 1.35, 3, 0, 14), color, 0.35);
  shape(ctx, ellipsePts(x, y, r, r, 4, 0, 12), color, { w: Math.max(0.8, r * 0.35), shade: false, jitter: 0 });
  flat(ctx, ellipsePts(x - r * 0.3, y - r * 0.3, r * 0.35, r * 0.35, 5, 0, 8), '#ffffff', 0.9);
}

/**
 * A panelled dome seen from above: flat colour, meridian seams, hatched shadow crescent,
 * highlight, glowing portholes, inked rim.
 */
export function dome(ctx: Ctx, cx: number, cy: number, r: number, color: string, seed = 1, band?: string, ports = 0): void {
  const pts = ellipsePts(cx, cy, r, r, seed, 0.008);
  castShadow(ctx, pts, r * 0.2, 0.3);
  flat(ctx, pts, color);
  if (band) {
    const inner = ellipsePts(cx, cy, r * 0.7, r * 0.7, seed + 3, 0.005);
    ink(ctx, inner, { closed: true, w: r * 0.15, color: band, shade: false, jitter: 0.1, seed: seed + 4 });
  }
  if (r > 10) {
    // Meridian seams.
    ctx.save();
    ctx.strokeStyle = mix(color, C.ink, 0.55);
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = Math.max(0.7, r * 0.025);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI + 0.3;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.96, r * Math.abs(Math.cos(a)) * 0.96, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  const cres = shadowCrescent(cx, cy, r, 0.38, seed);
  hatch(ctx, cres, Math.PI / 4, Math.max(2, r * 0.11), { w: Math.max(0.8, r * 0.035), alpha: 0.55, seed });
  highlight(ctx, cx, cy, r, '#ffffff', 0.7);
  for (let i = 0; i < ports; i++) {
    const a = -Math.PI * 0.85 + (i / Math.max(1, ports)) * Math.PI * 1.7;
    light(ctx, cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78, Math.max(1.4, r * 0.07));
  }
  ink(ctx, pts, { closed: true, w: Math.max(1.6, r * 0.085), seed: seed + 9 });
}

/** A glass bulb / tank: a dome with ribs and a bright glint. */
export function bulb(ctx: Ctx, cx: number, cy: number, r: number, color: string, seed = 1, ribs = 6): void {
  dome(ctx, cx, cy, r, color, seed);
  ctx.save();
  ctx.strokeStyle = mix(color, C.ink, 0.5);
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(0.9, r * 0.045);
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3);
    ctx.lineTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92);
    ctx.stroke();
  }
  ctx.restore();
  flat(ctx, ellipsePts(cx - r * 0.32, cy - r * 0.38, r * 0.17, r * 0.1, seed + 2, 0, 16, -0.6), '#ffffff', 0.85);
}

/** A pipe between points: dark outline, coloured body, a highlight line, ring joints. */
export function pipe(ctx: Ctx, pts: readonly Pt[], w: number, color: string = C.steelL, seed = 1, joints = true): void {
  ink(ctx, pts, { w: w + 3, color: C.ink, taper: 0, jitter: 0.2, seed, shade: false });
  ink(ctx, pts, { w, color, taper: 0, jitter: 0.1, seed: seed + 1, shade: false });
  const hl = pts.map(([x, y]) => [x - w * 0.18, y - w * 0.22] as Pt);
  ink(ctx, hl, { w: Math.max(0.8, w * 0.22), color: '#ffffff', alpha: 0.55, taper: 0.1, jitter: 0.1, seed: seed + 2, shade: false });
  if (joints) {
    for (const [x, y] of [pts[0]!, pts[pts.length - 1]!]) shape(ctx, ellipsePts(x, y, w * 0.75, w * 0.75, seed + 3, 0, 16), C.brass, { w: 1, shade: false, jitter: 0 });
  }
}

/** Ventilation slats inside a rect. */
export function vents(ctx: Ctx, rect: readonly Pt[], n: number, along: 'x' | 'y', seed = 1): void {
  shape(ctx, rect, C.steelD, { w: 1.3, seed, shade: false });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of rect) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  ctx.save();
  ctx.strokeStyle = C.steelL;
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 0.9;
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    ctx.beginPath();
    if (along === 'x') { ctx.moveTo(x0 + (x1 - x0) * t, y0 + 2); ctx.lineTo(x0 + (x1 - x0) * t, y1 - 2); }
    else { ctx.moveTo(x0 + 2, y0 + (y1 - y0) * t); ctx.lineTo(x1 - 2, y0 + (y1 - y0) * t); }
    ctx.stroke();
  }
  ctx.restore();
}

/** A rotor: n airfoil blades around a bolted hub. */
export function rotor(ctx: Ctx, cx: number, cy: number, r: number, n: number, colors: readonly string[], phase = 0, seed = 1): void {
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const nx = -sa, ny = ca;
    const w0 = r * 0.16, w1 = r * 0.07;
    const blade: Pt[] = [
      [cx + ca * r * 0.18 + nx * w0, cy + sa * r * 0.18 + ny * w0],
      [cx + ca * r * 0.98 + nx * w1, cy + sa * r * 0.98 + ny * w1],
      [cx + ca * r * 1.02, cy + sa * r * 1.02],
      [cx + ca * r * 0.98 - nx * w1 * 0.4, cy + sa * r * 0.98 - ny * w1 * 0.4],
      [cx + ca * r * 0.18 - nx * w0 * 0.5, cy + sa * r * 0.18 - ny * w0 * 0.5],
    ];
    castShadow(ctx, blade, r * 0.12, 0.22);
    shape(ctx, blade, colors[i % colors.length]!, { w: Math.max(1.2, r * 0.05), seed: seed + i });
    ink(ctx, [[cx + ca * r * 0.3, cy + sa * r * 0.3], [cx + ca * r * 0.9, cy + sa * r * 0.9]], { w: Math.max(0.8, r * 0.025), alpha: 0.6, seed: seed + 20 + i, shade: false });
  }
  dome(ctx, cx, cy, r * 0.24, C.steel, seed + 50);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    rivet(ctx, cx + Math.cos(a) * r * 0.13, cy + Math.sin(a) * r * 0.13, Math.max(1.2, r * 0.03), C.brassL);
  }
}

/** A rosette of petals (poles keep a flower motif). */
export function petals(ctx: Ctx, cx: number, cy: number, r: number, n: number, colors: readonly string[], phase = 0, seed = 1, width = 0.42): void {
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const tip: Pt = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    const sideA = a + width, sideB = a - width;
    const pts: Pt[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const ang = sideA + (sideB - sideA) * t;
      const rr = r * (0.18 + 0.82 * Math.sin(Math.PI * (0.15 + 0.7 * t)));
      pts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
    }
    pts.push(tip);
    pts.push([cx, cy]);
    shape(ctx, pts, colors[i % colors.length]!, { w: Math.max(1.1, r * 0.06), seed: seed + i });
  }
  dome(ctx, cx, cy, r * 0.22, C.steel, seed + 50);
}

/** A thin antenna (mast + ball tip) with a small glowing beacon. */
export function antenna(ctx: Ctx, base: Pt, tip: Pt, ballR: number, color: string = C.turq, seed = 1): void {
  ink(ctx, [base, tip], { w: Math.max(1.4, ballR * 0.45), color: C.steelD, seed, taper: 0.05 });
  shape(ctx, ellipsePts(base[0], base[1], ballR * 0.9, ballR * 0.9, seed + 1, 0, 12), C.steelL, { w: 1.1, shade: false, jitter: 0 });
  dome(ctx, tip[0], tip[1], ballR, color, seed + 2);
  light(ctx, tip[0] - ballR * 0.2, tip[1] - ballR * 0.25, Math.max(1, ballR * 0.28), C.glowCyan);
}

/** A hydraulic arm: two steel segments with pistons and brass joints, ending in a tool head. */
export function arm(ctx: Ctx, a: Pt, b: Pt, c: Pt, r: number, color: string = C.coral, seed = 1): void {
  for (const [p, q, k] of [[a, b, 0], [b, c, 1]] as const) {
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1;
    const nx = (-dy / L) * r, ny = (dx / L) * r;
    const seg: Pt[] = [[p[0] + nx, p[1] + ny], [q[0] + nx, q[1] + ny], [q[0] - nx, q[1] - ny], [p[0] - nx, p[1] - ny]];
    castShadow(ctx, seg, r * 1.2, 0.25);
    shape(ctx, seg, k === 0 ? C.steelL : color, { w: Math.max(1.2, r * 0.4), seed: seed + k });
    // Piston rod along the segment.
    ink(ctx, [[p[0] + (dx / L) * r * 2, p[1] + (dy / L) * r * 2], [q[0] - (dx / L) * r * 2, q[1] - (dy / L) * r * 2]], { w: Math.max(0.8, r * 0.35), color: '#ffffff', alpha: 0.6, shade: false, taper: 0, seed: seed + 10 + k });
  }
  dome(ctx, a[0], a[1], r * 1.6, C.steelD, seed + 4);
  dome(ctx, b[0], b[1], r * 1.3, C.brass, seed + 3);
  dome(ctx, c[0], c[1], r * 1.2, C.coralD, seed + 5);
}

/** A spire / stack seen from above: concentric rings narrowing to a glowing tip. */
export function spire(ctx: Ctx, cx: number, cy: number, r: number, color: string, tip: string = C.glowPeach, seed = 1): void {
  dome(ctx, cx, cy, r, color, seed);
  for (let i = 1; i <= 3; i++) {
    const rr = r * (1 - i * 0.24);
    ink(ctx, ellipsePts(cx - i * r * 0.05, cy - i * r * 0.07, rr, rr, seed + i, 0.01), { closed: true, w: Math.max(0.9, r * 0.06), alpha: 0.8, seed: seed + 10 + i });
  }
  light(ctx, cx - r * 0.2, cy - r * 0.28, r * 0.17, tip);
}

/** A barrel vault (workshops): panelled roof with arched ribs, a skylight ridge. */
export function vault(ctx: Ctx, pts: readonly Pt[], color: string, ribs: number, along: 'x' | 'y', seed = 1): void {
  castShadow(ctx, pts, 8, 0.3);
  flat(ctx, pts, color);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const half: Pt[] = along === 'x'
    ? [[x0, (y0 + y1) / 2 + (y1 - y0) * 0.1], [x1, (y0 + y1) / 2 + (y1 - y0) * 0.1], [x1, y1], [x0, y1]]
    : [[(x0 + x1) / 2 + (x1 - x0) * 0.1, y0], [x1, y0], [x1, y1], [(x0 + x1) / 2 + (x1 - x0) * 0.1, y1]];
  ctx.save();
  ctx.beginPath(); ctx.moveTo(pts[0]![0], pts[0]![1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.clip();
  hatch(ctx, half, Math.PI / 4, 3, { alpha: 0.42, seed });
  ctx.restore();
  for (let i = 1; i < ribs; i++) {
    const t = i / ribs;
    const seg: Pt[] = along === 'x'
      ? [[x0 + (x1 - x0) * t, y0 + 3], [x0 + (x1 - x0) * t, y1 - 3]]
      : [[x0 + 3, y0 + (y1 - y0) * t], [x1 - 3, y0 + (y1 - y0) * t]];
    ink(ctx, seg, { w: 2.2, color: C.steelD, seed: seed + i });
    const r1 = along === 'x' ? seg[0]! : seg[0]!;
    rivet(ctx, r1[0], r1[1] + (along === 'x' ? 3 : 0), 1.6);
  }
  // Skylight ridge with cyan glazing.
  const sky: Pt[] = along === 'x'
    ? [[x0 + 8, (y0 + y1) / 2 - 5], [x1 - 8, (y0 + y1) / 2 - 5], [x1 - 8, (y0 + y1) / 2 + 1], [x0 + 8, (y0 + y1) / 2 + 1]]
    : [[(x0 + x1) / 2 - 5, y0 + 8], [(x0 + x1) / 2 + 1, y0 + 8], [(x0 + x1) / 2 + 1, y1 - 8], [(x0 + x1) / 2 - 5, y1 - 8]];
  shape(ctx, sky, C.glowCyan, { w: 1.2, seed: seed + 30, shade: false });
  ink(ctx, pts, { closed: true, w: 2.6, seed: seed + 40 });
}

/** A port on a building edge: inputs are turquoise intakes, outputs coral nozzles. */
export function port(ctx: Ctx, f: Frame, x: number, y: number, side: number, io: 'in' | 'out', seed = 1): void {
  const mid: Record<number, Pt> = { 0: [x + 0.5, y], 1: [x + 1, y + 0.5], 2: [x + 0.5, y + 1], 3: [x, y + 0.5] };
  const [mx, my] = mid[side]!;
  const d = DIRV[f.dir(side)]!;
  const c = f.p(mx, my);
  const s = f.l(0.18);
  const tx = -d[1], ty = d[0];
  const out = io === 'out' ? 1.05 : -0.1;
  const pts: Pt[] = [
    [c[0] + tx * s - d[0] * s * 0.7, c[1] + ty * s - d[1] * s * 0.7],
    [c[0] + tx * s * 0.8 + d[0] * s * out, c[1] + ty * s * 0.8 + d[1] * s * out],
    [c[0] - tx * s * 0.8 + d[0] * s * out, c[1] - ty * s * 0.8 + d[1] * s * out],
    [c[0] - tx * s - d[0] * s * 0.7, c[1] - ty * s - d[1] * s * 0.7],
  ];
  castShadow(ctx, pts, s * 0.3, 0.25);
  shape(ctx, pts, io === 'out' ? C.coral : C.turq, { w: Math.max(1.2, f.l(0.03)), seed });
  const k = s * 0.5;
  ink(ctx, io === 'in'
    ? [[c[0] + tx * k + d[0] * k * 0.3, c[1] + ty * k + d[1] * k * 0.3], [c[0] - d[0] * k * 0.6, c[1] - d[1] * k * 0.6], [c[0] - tx * k + d[0] * k * 0.3, c[1] - ty * k + d[1] * k * 0.3]]
    : [[c[0] + tx * k - d[0] * k * 0.2, c[1] + ty * k - d[1] * k * 0.2], [c[0] + d[0] * k * 0.7, c[1] + d[1] * k * 0.7], [c[0] - tx * k - d[0] * k * 0.2, c[1] - ty * k - d[1] * k * 0.2]],
  { w: 1.5, color: C.paper, shade: false, seed: seed + 1, taper: 0 });
}

/** Texture: stippled grain over a polygon. */
export function grain(ctx: Ctx, pts: readonly Pt[], density: number, color: string = C.ink, seed = 1): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  stipple(ctx, x0, y0, x1 - x0, y1 - y0, Math.round((x1 - x0) * (y1 - y0) * density), { clip: pts, color, alpha: 0.4, seed, r: 0.8 });
}

// ── tech details ────────────────────────────────────────────────────────────

/** A row of glowing LEDs between two points. */
export function ledStrip(ctx: Ctx, a: Pt, b: Pt, n: number, r: number, colors: readonly string[] = [C.led], seed = 1): void {
  const pad: Pt[] = [];
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * r * 1.6, ny = (dx / L) * r * 1.6;
  pad.push([a[0] + nx - (dx / L) * r * 1.6, a[1] + ny - (dy / L) * r * 1.6], [b[0] + nx + (dx / L) * r * 1.6, b[1] + ny + (dy / L) * r * 1.6],
    [b[0] - nx + (dx / L) * r * 1.6, b[1] - ny + (dy / L) * r * 1.6], [a[0] - nx - (dx / L) * r * 1.6, a[1] - ny - (dy / L) * r * 1.6]);
  shape(ctx, pad, C.steelDD, { w: 1, shade: false, jitter: 0, seed });
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    light(ctx, a[0] + dx * t, a[1] + dy * t, r, colors[i % colors.length]!);
  }
}

/** A slack cable between two points (quadratic sag), dark with a faint highlight. */
export function cable(ctx: Ctx, a: Pt, b: Pt, w: number, sag = 0.18, color: string = C.steelDD, seed = 1): void {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const c: Pt = [mx + L * sag * 0.6, my + L * sag];
  const pts: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, u = 1 - t;
    pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  ink(ctx, pts.map(([x, y]) => [x + 2, y + 3] as Pt), { w, color: C.ink, alpha: 0.25, shade: false, taper: 0, seed });
  ink(ctx, pts, { w: w + 1.4, color: C.ink, shade: false, taper: 0, seed: seed + 1 });
  ink(ctx, pts, { w, color, shade: false, taper: 0, seed: seed + 2 });
  ink(ctx, pts.map(([x, y]) => [x - w * 0.2, y - w * 0.25] as Pt), { w: Math.max(0.6, w * 0.25), color: C.steelL, alpha: 0.7, shade: false, taper: 0.1, seed: seed + 3 });
}

/** A fine grille (heat sink / intake) inside a rect. */
export function grille(ctx: Ctx, rect: readonly Pt[], step: number, seed = 1): void {
  shape(ctx, rect, C.steelDD, { w: 1.2, shade: false, seed });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of rect) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  ctx.save();
  ctx.strokeStyle = C.steelL;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 1;
  for (let x = x0 + step; x < x1 - 1; x += step) { ctx.beginPath(); ctx.moveTo(x, y0 + 2); ctx.lineTo(x, y1 - 2); ctx.stroke(); }
  for (let y = y0 + step; y < y1 - 1; y += step) { ctx.beginPath(); ctx.moveTo(x0 + 2, y); ctx.lineTo(x1 - 2, y); ctx.stroke(); }
  ctx.restore();
}

/** A sensor dish seen from above: rings, struts and a glowing feed. */
export function dish(ctx: Ctx, cx: number, cy: number, r: number, seed = 1): void {
  const rim = ellipsePts(cx, cy, r, r, seed, 0.004);
  castShadow(ctx, rim, r * 0.25, 0.3);
  shape(ctx, rim, C.ice, { w: Math.max(1.4, r * 0.08), seed });
  for (let k = 1; k <= 2; k++) ink(ctx, ellipsePts(cx + r * 0.04 * k, cy + r * 0.05 * k, r * (1 - k * 0.3), r * (1 - k * 0.3), seed + k), { closed: true, w: 1, color: C.steelL, shade: false, seed: seed + k });
  hatch(ctx, shadowCrescent(cx, cy, r, 0.45, seed), Math.PI / 4, Math.max(2, r * 0.13), { alpha: 0.4, seed });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    ink(ctx, [[cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85], [cx, cy]], { w: 1.2, color: C.steelD, shade: false, taper: 0, seed: seed + 5 + i });
  }
  light(ctx, cx, cy, Math.max(1.4, r * 0.16), C.led);
}

/** A glowing seam along a polyline (light leaking between panels). */
export function glowSeam(ctx: Ctx, pts: readonly Pt[], w: number, color: string = C.led, seed = 1): void {
  ink(ctx, pts, { w: w * 3.2, color, alpha: 0.22, shade: false, taper: 0, jitter: 0, seed });
  ink(ctx, pts, { w, color, shade: false, taper: 0, jitter: 0, seed: seed + 1 });
}

/** Tiny stencil marks (serials, arrows) in a rect corner — reads as "engineered". */
export function decal(ctx: Ctx, x: number, y: number, s: number, seed = 1): void {
  ctx.save();
  ctx.fillStyle = C.ice;
  ctx.globalAlpha = 0.8;
  let ox = 0;
  for (let i = 0; i < 4; i++) {
    const w = s * (0.6 + ((seed * (i + 3)) % 5) * 0.18);
    ctx.fillRect(x + ox, y, w, s * 0.55);
    ox += w + s * 0.35;
  }
  ctx.restore();
}

/** An access hatch: inset panel, bolts and a handle. */
export function hatchDoor(ctx: Ctx, rect: readonly Pt[], seed = 1): void {
  shape(ctx, rect, C.steelL, { w: 1.4, seed, shade: false });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of rect) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  for (const [x, y] of [[x0 + 3, y0 + 3], [x1 - 3, y0 + 3], [x0 + 3, y1 - 3], [x1 - 3, y1 - 3]] as const) rivet(ctx, x, y, 1.2, C.steelD);
  ink(ctx, [[(x0 + x1) / 2 - 4, (y0 + y1) / 2], [(x0 + x1) / 2 + 4, (y0 + y1) / 2]], { w: 2, color: C.steelDD, shade: false, taper: 0, seed: seed + 1 });
}

// ── machine parts seen from above (logistics marks, tanks, stacks, crates, drums, booms) ──

/** Convex hull of screen points (monotone chain). */
export function hull(pts: readonly Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

/**
 * A flat arrow's outline from its tail (x0, y0) to its tip (x1, y1), in whatever plane the
 * caller maps it to (local tiles for the recipes, tile units for the build ghost): a shaft of
 * half-width `shaft`, a head of half-width `head` and length `headLen`.
 */
export function arrowPoly(x0: number, y0: number, x1: number, y1: number, shaft: number, head: number, headLen: number): Array<[number, number]> {
  const L = Math.hypot(x1 - x0, y1 - y0) || 1, dx = (x1 - x0) / L, dy = (y1 - y0) / L, nx = -dy, ny = dx;
  const bx = x1 - dx * headLen, by = y1 - dy * headLen;
  return [
    [x0 + nx * shaft, y0 + ny * shaft], [bx + nx * shaft, by + ny * shaft], [bx + nx * head, by + ny * head], [x1, y1],
    [bx - nx * head, by - ny * head], [bx - nx * shaft, by - ny * shaft], [x0 - nx * shaft, y0 - ny * shaft],
  ];
}

/**
 * A bucket wheel seen from above, foreshortened as the excavator's cutter wheel is (an ellipse
 * `rAlong` along the wheel's plane — local `along` — and `rAcross` thick), with `n` buckets and
 * `n` spokes. The wheel turns by `phase` (radians): its top, drawn towards −across, moves to
 * −along as the phase grows. Buckets under the wheel's axle are drawn behind the disc, the
 * others over it; `full(a)` says which carry a load (drawn in `load`).
 */
export function bucketWheelTop(ctx: Ctx, f: Frame, cx: number, cy: number, rAlong: number, rAcross: number, along: 'x' | 'y', n: number, phase: number, color: string, seed = 1, o: { bucket?: string; load?: string; full?: (a: number) => boolean } = {}): void {
  const P = (a: number, k: number): Pt => {
    const h = Math.cos(a) * rAlong * k, v = Math.sin(a) * rAcross * k;
    return along === 'y' ? f.p(cx - v, cy + h) : f.p(cx + h, cy - v);
  };
  const bucket = (a: number): void => {
    const q: Pt[] = [P(a - 0.2, 0.97), P(a - 0.13, 1.22), P(a + 0.24, 1.24), P(a + 0.2, 0.97)];
    shape(ctx, q, mix(o.bucket ?? C.brass, C.ink, 0.12 - 0.2 * Math.sin(a)), { w: Math.max(1, f.l(0.018)), shade: false, jitter: 0, seed });
    if (o.full?.(a)) flat(ctx, [P(a - 0.08, 1.02), P(a - 0.04, 1.16), P(a + 0.16, 1.18), P(a + 0.13, 1.02)], o.load ?? C.sand);
  };
  const angles = Array.from({ length: n }, (_, k) => phase + (k / n) * Math.PI * 2);
  for (const a of angles) if (Math.sin(a) < 0) bucket(a);
  const rim = Array.from({ length: 40 }, (_, i) => P((i / 40) * Math.PI * 2, 1));
  castShadow(ctx, rim, f.l(0.1), 0.28);
  shape(ctx, rim, mix(color, C.ink, 0.5), { w: Math.max(1.2, f.l(0.025)), seed: seed + 1 });
  ink(ctx, Array.from({ length: 40 }, (_, i) => P((i / 40) * Math.PI * 2, 0.8)), { closed: true, w: Math.max(1.6, f.l(0.035)), color, shade: false, seed: seed + 2 });
  for (const a of angles) ink(ctx, [P(a, 0.12), P(a, 0.8)], { w: Math.max(1, f.l(0.02)), color, shade: false, taper: 0, jitter: 0, seed: seed + 3 });
  const hub = P(0, 0);
  rivet(ctx, hub[0], hub[1], Math.max(1.6, f.l(0.04)), C.brassL);
  for (const a of angles) if (Math.sin(a) >= 0) bucket(a);
}

/** A chevron pointing to a local side (0 N, 1 E, 2 S, 3 W): flow marks on lanes and decks. */
export function chevron(ctx: Ctx, f: Frame, cx: number, cy: number, side: number, size: number, color: string, w = 2.6, seed = 1): void {
  const d = DIRV[side & 3]!, tx = -d[1], ty = d[0];
  const pts: Pt[] = [
    f.p(cx - d[0] * size * 0.45 + tx * size, cy - d[1] * size * 0.45 + ty * size),
    f.p(cx + d[0] * size * 0.45, cy + d[1] * size * 0.45),
    f.p(cx - d[0] * size * 0.45 - tx * size, cy - d[1] * size * 0.45 - ty * size),
  ];
  ink(ctx, pts, { w: w + 2, color: C.ink, alpha: 0.55, shade: false, taper: 0, jitter: 0, seed });
  ink(ctx, pts, { w, color, shade: false, taper: 0, jitter: 0.1, seed: seed + 1 });
}

/**
 * A flat-roofed tank seen from above (silos, cells, capacitors): a lit disc with a rim, seam
 * rings, radial ribs and a bolted hatch, casting a shadow as long as it is tall — a machine
 * drum, not a dome (no crescent, no highlight arc). `cone` adds roof ribs converging on the hatch.
 */
export function tankTop(ctx: Ctx, cx: number, cy: number, r: number, color: string, seed = 1, o: { shadow?: number; ribs?: number; cone?: boolean; rim?: string } = {}): Pt[] {
  const pts = ellipsePts(cx, cy, r, r, seed, 0.004, 40);
  castShadow(ctx, pts, o.shadow ?? r * 0.35, 0.32);
  flat(ctx, pts, color);
  // The far-from-light half of the roof a touch darker, hatched lightly.
  const half: Pt[] = [];
  for (let i = 0; i <= 20; i++) { const a = -Math.PI * 0.25 + (i / 20) * Math.PI; half.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  flat(ctx, half, mix(color, C.ink, 0.12));
  hatch(ctx, half, Math.PI / 4, Math.max(2.4, r * 0.12), { alpha: 0.25, seed });
  ink(ctx, ellipsePts(cx, cy, r * 0.84, r * 0.84, seed + 1, 0, 40), { closed: true, w: Math.max(1, r * 0.04), color: o.rim ?? mix(color, C.ink, 0.45), alpha: 0.8, shade: false, seed: seed + 1 });
  const ribs = o.ribs ?? 8;
  ctx.save();
  ctx.strokeStyle = mix(color, C.ink, 0.45);
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = Math.max(0.8, r * 0.03);
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2 + 0.2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * (o.cone ? 0.18 : 0.62), cy + Math.sin(a) * r * (o.cone ? 0.18 : 0.62));
    ctx.lineTo(cx + Math.cos(a) * r * 0.84, cy + Math.sin(a) * r * 0.84);
    ctx.stroke();
  }
  ctx.restore();
  ink(ctx, [[cx - r * 0.62, cy - r * 0.45], [cx - r * 0.2, cy - r * 0.78]], { w: Math.max(1.2, r * 0.06), color: '#ffffff', alpha: 0.5, shade: false, taper: 0.2, seed: seed + 2 });
  const hr = r * 0.2;
  shape(ctx, ellipsePts(cx, cy, hr, hr, seed + 3, 0, 16), mix(color, C.steelD, 0.5), { w: 1.1, shade: false, jitter: 0 });
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.6; rivet(ctx, cx + Math.cos(a) * hr * 0.62, cy + Math.sin(a) * hr * 0.62, Math.max(0.9, r * 0.03), C.steelL); }
  ink(ctx, pts, { closed: true, w: Math.max(1.6, r * 0.06), seed: seed + 9 });
  return pts;
}

/** A chimney stack seen from above: a banded rim around a dark throat, glowing if hot. */
export function stack(ctx: Ctx, cx: number, cy: number, r: number, color: string = C.steelD, seed = 1, glow?: string, shadow = r * 1.4): void {
  const pts = ellipsePts(cx, cy, r, r, seed, 0.004, 28);
  // A tall stack's shadow streams away down-right from its foot.
  flat(ctx, hull([...pts, ...pts.map(([x, y]) => [x + shadow * 0.7, y + shadow] as Pt)]), C.inkSoft, 0.26);
  shape(ctx, pts, color, { w: Math.max(1.4, r * 0.12), seed });
  ink(ctx, ellipsePts(cx, cy, r * 0.8, r * 0.8, seed + 1, 0, 24), { closed: true, w: Math.max(1, r * 0.08), color: mix(color, '#ffffff', 0.3), alpha: 0.7, shade: false, seed: seed + 1 });
  const throat = ellipsePts(cx + r * 0.05, cy + r * 0.06, r * 0.55, r * 0.55, seed + 2, 0, 20);
  flat(ctx, throat, C.ink);
  if (glow) {
    flat(ctx, ellipsePts(cx + r * 0.08, cy + r * 0.1, r * 0.38, r * 0.38, seed + 3, 0, 16), glow, 0.9);
    light(ctx, cx, cy, r * 0.22, glow);
  }
}

/** A cargo container seen from above: corrugated roof, corner castings, a stencil band. */
export function crate(ctx: Ctx, pts: readonly Pt[], color: string, seed = 1, along: 'x' | 'y' = 'x', shadow = 6): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  castShadow(ctx, pts, shadow, 0.32);
  flat(ctx, pts, color);
  ctx.save();
  ctx.strokeStyle = mix(color, C.ink, 0.45);
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 1;
  const n = Math.max(3, Math.round((along === 'x' ? x1 - x0 : y1 - y0) / 4.5));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    ctx.beginPath();
    if (along === 'x') { ctx.moveTo(x0 + (x1 - x0) * t, y0 + 2); ctx.lineTo(x0 + (x1 - x0) * t, y1 - 2); }
    else { ctx.moveTo(x0 + 2, y0 + (y1 - y0) * t); ctx.lineTo(x1 - 2, y0 + (y1 - y0) * t); }
    ctx.stroke();
  }
  ctx.restore();
  const band: Pt[] = along === 'x'
    ? [[x0 + (x1 - x0) * 0.4, y0 + 1], [x0 + (x1 - x0) * 0.52, y0 + 1], [x0 + (x1 - x0) * 0.52, y1 - 1], [x0 + (x1 - x0) * 0.4, y1 - 1]]
    : [[x0 + 1, y0 + (y1 - y0) * 0.4], [x1 - 1, y0 + (y1 - y0) * 0.4], [x1 - 1, y0 + (y1 - y0) * 0.52], [x0 + 1, y0 + (y1 - y0) * 0.52]];
  flat(ctx, band, mix(color, '#ffffff', 0.35), 0.7);
  for (const [x, y] of [[x0 + 2, y0 + 2], [x1 - 2, y0 + 2], [x0 + 2, y1 - 2], [x1 - 2, y1 - 2]] as const) flat(ctx, roundRectPts(x - 1.6, y - 1.6, 3.2, 3.2, 0.6), C.steelDD);
  ink(ctx, [[x0, y0 + 1], [x1, y0 + 1]], { w: 1.2, color: mix(color, '#ffffff', 0.4), shade: false, taper: 0, seed: seed + 1 });
  ink(ctx, pts, { closed: true, w: 1.8, seed: seed + 2 });
}

/**
 * A horizontal drum (boiler, spool, roller, tank on its side) seen from above, inside a rect
 * running `along` its axis: a lit upper band, a hatched lower band, ring seams across.
 */
export function drumTop(ctx: Ctx, pts: readonly Pt[], along: 'x' | 'y', color: string, seed = 1, rings = 2, shadow = 6): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  castShadow(ctx, pts, shadow, 0.3);
  flat(ctx, pts, color);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(pts[0]![0], pts[0]![1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.clip();
  const low: Pt[] = along === 'x'
    ? [[x0, (y0 + y1) / 2 + (y1 - y0) * 0.08], [x1, (y0 + y1) / 2 + (y1 - y0) * 0.08], [x1, y1], [x0, y1]]
    : [[(x0 + x1) / 2 + (x1 - x0) * 0.08, y0], [x1, y0], [x1, y1], [(x0 + x1) / 2 + (x1 - x0) * 0.08, y1]];
  flat(ctx, low, mix(color, C.ink, 0.3));
  hatch(ctx, low, Math.PI / 4, 3, { alpha: 0.35, seed });
  const hl: Pt[] = along === 'x' ? [[x0 + 3, y0 + (y1 - y0) * 0.24], [x1 - 3, y0 + (y1 - y0) * 0.24]] : [[x0 + (x1 - x0) * 0.24, y0 + 3], [x0 + (x1 - x0) * 0.24, y1 - 3]];
  ink(ctx, hl, { w: Math.max(1.4, (along === 'x' ? y1 - y0 : x1 - x0) * 0.1), color: '#ffffff', alpha: 0.5, shade: false, taper: 0.1, seed: seed + 1 });
  for (let i = 1; i <= rings; i++) {
    const t = i / (rings + 1);
    const seg: Pt[] = along === 'x' ? [[x0 + (x1 - x0) * t, y0], [x0 + (x1 - x0) * t, y1]] : [[x0, y0 + (y1 - y0) * t], [x1, y0 + (y1 - y0) * t]];
    ink(ctx, seg, { w: 1.4, color: C.steelDD, alpha: 0.75, shade: false, taper: 0, seed: seed + 2 + i });
  }
  ctx.restore();
  ink(ctx, pts, { closed: true, w: 1.8, seed: seed + 9 });
}

/** A lattice boom seen from above between two points: twin chords and a zig-zag web. */
export function truss(ctx: Ctx, a: Pt, b: Pt, w: number, color: string = C.steelL, seed = 1, shadow = 6): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * w * 0.5, ny = (dx / L) * w * 0.5;
  const out: Pt[] = [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
  castShadow(ctx, out, shadow, 0.22);
  const n = Math.max(2, Math.round(L / (w * 1.1)));
  const web: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = i % 2 ? 1 : -1;
    web.push([a[0] + dx * t + nx * s, a[1] + dy * t + ny * s]);
  }
  ink(ctx, web, { w: Math.max(1, w * 0.14), color: C.steelD, shade: false, taper: 0, seed });
  for (const k of [1, -1]) {
    const chord: Pt[] = [[a[0] + nx * k, a[1] + ny * k], [b[0] + nx * k, b[1] + ny * k]];
    ink(ctx, chord, { w: Math.max(1.6, w * 0.22) + 1.6, color: C.ink, shade: false, taper: 0, seed: seed + 2 + k });
    ink(ctx, chord, { w: Math.max(1.6, w * 0.22), color, shade: false, taper: 0, seed: seed + 4 + k });
  }
}

// ── power terminals seen from above (art/terminals.ts) ──────────────────────

/**
 * A power terminal (art/terminals.ts) seen from above: the porcelain shed's glazed ring round the
 * brass clamp the wire is bolted to, at the terminal's (x, y), and a short shadow dropped
 * down-right by its height above what it stands on. `k` scales it (the Heart's are beefier).
 * Reports its clamp point to `terminalProbe` (tests).
 */
export function terminalTop(ctx: Ctx, f: Frame, t: Terminal, seed = 1, k = 1): void {
  const [x, y] = f.p(t.x, t.y), S = f.l(1);
  const h = t.base !== undefined && !t.hang ? t.z - t.base : INSULATOR;
  const d = 0.11 * h * S;
  ink(ctx, [[x, y], [x + d * 0.7, y + d]], { w: Math.max(1.2, 0.035 * S * k), color: C.inkSoft, alpha: 0.32, shade: false, taper: 0, jitter: 0, seed });
  flat(ctx, ellipsePts(x + d * 0.7, y + d, 0.06 * S * k, 0.06 * S * k, seed + 1, 0, 14), C.inkSoft, 0.26);
  const shed = ellipsePts(x, y, 0.072 * S * k, 0.072 * S * k, seed + 2, 0, 20);
  flat(ctx, shed, mix(C.ice, '#ffffff', 0.35));
  flat(ctx, shadowCrescent(x, y, 0.072 * S * k, 0.35, seed + 3), mix(C.ice, C.steel, 0.45));
  ink(ctx, shed, { closed: true, w: Math.max(0.9, 0.02 * S), shade: false, taper: 0, jitter: 0, seed: seed + 4 });
  const cap = ellipsePts(x, y, 0.032 * S * k, 0.032 * S * k, seed + 5, 0, 12);
  flat(ctx, cap, C.brassL);
  ink(ctx, cap, { closed: true, w: Math.max(0.8, 0.014 * S), shade: false, taper: 0, jitter: 0, seed: seed + 6 });
  terminalProbe.fn?.(t.x, t.y, t.z);
}

// ── the CrierBelt mark ──────────────────────────────────────────────────────

/**
 * The CrierBelt mark — the company that runs the Crier Ring round Ysmère, its cargo lifts and
 * its exchange, the base's partner (docs/lore.md) — redrawn simple and bold (owner, 2026-10-12:
 * "simpler, more sci-fi"): a ringed planet. A teal world, lit on its upper left with a crisp
 * shadow crescent on its lower right, girdled by a brass belt that rises to the right — its far
 * half behind the planet, its near half across it. Two colours and one precise ink line, flat
 * fills, nothing hand-wobbled: it still reads as a ringed planet at 8 px (below 7 px the
 * crescent drops out and the planet is one flat teal). `map(u, v)` places a point of the mark's
 * own square (the planet fills −0.8…0.8, v down; the belt overhangs to about ±1.4 across and
 * ±0.65 up and down, the old mark's envelope) on the canvas, so one drawing serves a sign seen
 * from above, a deck or a wall in iso (`crierMarkIso`, `crierMarkFace`) and the Heart's curved
 * dish; `px` is about how many canvas px one unit spans (it sizes the ink).
 */
export function crierMarkMapped(ctx: Ctx, map: (u: number, v: number) => Pt, px: number, seed = 1): void {
  /** The planet's radius; the belt's outer and inner semi-axes; its tilt (it rises to the right). */
  const RP = 0.8, A0 = 1.45, B0 = 0.5, A1 = 1.12, B1 = 0.27, TILT = -0.36;
  const ct = Math.cos(TILT), st = Math.sin(TILT);
  const onBelt = (a: number, b: number, th: number): Pt => {
    const x = Math.cos(th) * a, y = Math.sin(th) * b;
    return map(x * ct - y * st, x * st + y * ct);
  };
  const arc = (a: number, b: number, th0: number, th1: number, n = 32): Pt[] =>
    Array.from({ length: n + 1 }, (_, i) => onBelt(a, b, th0 + ((th1 - th0) * i) / n));
  const disc = (cx: number, cy: number, r: number, n = 48): Pt[] =>
    Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return map(cx + Math.cos(a) * r, cy + Math.sin(a) * r); });
  const w = Math.max(0.9, px * 0.07);
  const line = (pts: readonly Pt[], closed = false): void => ink(ctx, pts, { w, closed, shade: false, taper: 0, jitter: 0, seed });
  // Half the belt between two angles of its own ellipse: brass, inked along both edges (never
  // across its ends, so the two halves join without a seam).
  const belt = (th0: number, th1: number): void => {
    const out = arc(A0, B0, th0, th1), inn = arc(A1, B1, th0, th1);
    flat(ctx, [...out, ...inn.slice().reverse()], C.brass);
    line(out);
    line(inn);
  };
  // The far half (the ellipse's upper half), the planet over it, the near half across the planet.
  belt(Math.PI, Math.PI * 2);
  const planet = disc(0, 0, RP);
  if (px >= 7) {
    flat(ctx, planet, C.teal);
    // The lit side: the planet within a disc nudged to the upper left; what is left is the crescent.
    ctx.save();
    pathOf(ctx, planet);
    ctx.clip();
    flat(ctx, disc(-0.24, -0.3, RP), C.tealL);
    ctx.restore();
  } else {
    flat(ctx, planet, C.tealL);
  }
  line(planet, true);
  belt(-0.03, Math.PI + 0.03);
}

/** The CrierBelt mark seen from above (a sign, a deck), centred on (cx, cy), radius r px. */
export function crierMark(ctx: Ctx, cx: number, cy: number, r: number, seed = 1): void {
  crierMarkMapped(ctx, (u, v) => [cx + u * r, cy + v * r], r, seed);
}
