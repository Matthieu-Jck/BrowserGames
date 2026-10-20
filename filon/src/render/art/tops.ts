// tops.ts — what stands on the mountain tops (D149; owner, 2026-10-19: « let's put some interesting
// stuff at the top of the mountains »), on map 6: a balanced rock — a boulder the Souffle has left on a
// worn pedestal, on every land's spring summit and on the huge mountains' upper terraces (D157) — and,
// on each huge mountain's summit, the wreck of an old CrierBelt survey beacon: its lattice mast fallen
// askew, its dish in the scree, its lamp still blinking red. The generator marks the tile (mapgen's
// `BIOME.beacon`, `BIOME.boulder`); this draws it on the column's top at height z, for the relief
// sprites (a decal lifted onto the top, world/relief-view.ts) and the far paint (art/terrain.ts
// `paintRelief`), and its plan mark (`topMarkPlan`). Worker-safe (Canvas2D only).
import { hashUnit } from '@/core/hash';
import { C, mix, rgba } from './tokens';
import type { Ctx, Pt } from './ink';
import { blob, stone, type Proj } from './rock';

/** The tops' marks in the biome array (mapgen's `BIOME.beacon`, `BIOME.boulder`); the painter keeps off the generator's module. */
export const TOP_BEACON = 34, TOP_BOULDER = 35;

/** Is this biome code a top's mark? */
export const isTopMark = (b: number): boolean => b === TOP_BEACON || b === TOP_BOULDER;

/** How far a mark rises over its top (levels): the decal's headroom. */
export const TOP_HEAD = 2.4;

function poly(ctx: Ctx, pts: readonly Pt[], color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

function stroke(ctx: Ctx, pts: readonly Pt[], color: string, w: number, alpha = 1): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha *= alpha;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.restore();
}

/** A rounded stone body between heights z0 and z1 at (u, v), radius r (tiles): its lit side, its shaded side, inked. */
function rock(ctx: Ctx, P: Proj, u: number, v: number, r: number, z0: number, z1: number, k: number, lit: string, dark: string): void {
  const ring = (z: number, rr: number): Pt[] => Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; return P(u + Math.cos(a) * rr, v + Math.sin(a) * rr, z); });
  const mid = (z0 + z1) / 2, lo = ring(z0 + (z1 - z0) * 0.15, r * 0.75), md = ring(mid, r), hi = ring(z1 - (z1 - z0) * 0.12, r * 0.7);
  // Its silhouette: the rings' outermost points.
  const all = [...lo, ...md, ...hi];
  const left = all.reduce((a, b) => (b[0] < a[0] ? b : a)), right = all.reduce((a, b) => (b[0] > a[0] ? b : a));
  const top = P(u, v, z1), bottom = P(u, v, z0);
  const outline: Pt[] = [bottom, [left[0], (left[1] + bottom[1]) / 2], left, [left[0] + (top[0] - left[0]) * 0.3, top[1] + (left[1] - top[1]) * 0.35], top, [right[0] + (top[0] - right[0]) * 0.3, top[1] + (right[1] - top[1]) * 0.35], right, [right[0], (right[1] + bottom[1]) / 2]];
  poly(ctx, outline, dark);
  // The lit half (the light from the top-left).
  poly(ctx, [bottom, [left[0], (left[1] + bottom[1]) / 2], left, [left[0] + (top[0] - left[0]) * 0.3, top[1] + (left[1] - top[1]) * 0.35], top, [top[0] - (top[0] - left[0]) * 0.1, (top[1] + bottom[1]) / 2]], lit);
  stroke(ctx, [...outline, outline[0]!], C.ink, 1.1 * k, 0.85);
}

/**
 * Draw a top's mark (`kind`: `TOP_BOULDER`, `TOP_BEACON`) on a column's top at height z (P: tile-local u,
 * v, levels → px); `seed` its look; `detail` 0 the far paint's few strokes … 2 the sprites'.
 */
export function drawTopMark(ctx: Ctx, P: Proj, kind: number, z: number, seed: number, k: number, detail: 0 | 1 | 2): void {
  const h = (m: number): number => hashUnit(seed, m, 0x70b);
  const u = 0.45 + h(1) * 0.1, v = 0.45 + h(2) * 0.1;
  // Its shadow on the top, down-right.
  ctx.fillStyle = rgba(C.ink, 0.22);
  ctx.beginPath();
  const [sx, sy] = P(u + 0.12, v + 0.06, z);
  ctx.ellipse(sx, sy, 22 * k * (kind === TOP_BEACON ? 1.2 : 0.8), 8 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  if (kind === TOP_BOULDER) {
    // A balanced rock: a worn, waisted pedestal, the boulder on it far wider, polished by the wind.
    const lean = (h(3) - 0.5) * 0.06;
    rock(ctx, P, u, v, 0.09, z, z + 0.7, k, '#d6a07e', '#94606a');
    rock(ctx, P, u + lean, v - lean, 0.24, z + 0.62, z + 1.75 + h(4) * 0.35, k, '#e8b896', '#9b6670');
    if (detail >= 1) {
      // Its polish: a lit crescent, a crack or two.
      const [cx, cy] = P(u + lean - 0.08, v - lean - 0.08, z + 1.45);
      stroke(ctx, [[cx - 5 * k, cy + 2 * k], [cx, cy - 3 * k], [cx + 6 * k, cy - 2 * k]], '#fff2e2', 1.4 * k, 0.8);
      if (detail >= 2) stroke(ctx, [P(u + lean + 0.05, v - lean + 0.1, z + 1.0), P(u + lean + 0.08, v - lean + 0.12, z + 1.3)], C.ink, 0.8 * k, 0.5);
      stone(ctx, P, blob(u + 0.24, v + 0.16, 0.05, 5, (m) => h(20 + m)), z, 0.07, '#e8c0a0', '#94606a', k);
    }
    return;
  }
  // The beacon's wreck: a three-legged lattice mast fallen askew, its head in the scree, its dish
  // torn off beside it, its lamp still blinking red (painted: the night grades it, the red holds).
  const steel = '#4f6d7a', steelL = '#86a7b2', brass = C.brass;
  const foot = P(u - 0.22, v + 0.18, z), headPt = P(u + 0.26, v - 0.2, z + 1.9);
  const legs = [[-0.06, 0], [0.06, 0.03], [0, -0.06]] as const;
  for (const [du, dv] of legs) stroke(ctx, [P(u - 0.22 + du, v + 0.18 + dv, z), P(u + 0.26 + du * 0.3, v - 0.2 + dv * 0.3, z + 1.9)], C.ink, 2.6 * k, 0.9);
  for (const [du, dv] of legs) stroke(ctx, [P(u - 0.22 + du, v + 0.18 + dv, z), P(u + 0.26 + du * 0.3, v - 0.2 + dv * 0.3, z + 1.9)], steel, 1.5 * k);
  if (detail >= 1) {
    // Its lattice: cross braces along it.
    for (let q = 1; q < 6; q++) {
      const t = q / 6, a: Pt = [foot[0] + (headPt[0] - foot[0]) * t - 3 * k, foot[1] + (headPt[1] - foot[1]) * t], b: Pt = [foot[0] + (headPt[0] - foot[0]) * (t + 0.1) + 3 * k, foot[1] + (headPt[1] - foot[1]) * (t + 0.1)];
      stroke(ctx, [a, b], steelL, 0.9 * k, 0.9);
    }
  }
  // The dish, torn off, on its rim in the scree.
  const [dx, dy] = P(u + 0.2, v + 0.22, z + 0.35);
  ctx.save();
  ctx.translate(dx, dy);
  ctx.rotate(-0.5 + h(5) * 0.3);
  ctx.fillStyle = mix(steelL, '#ffffff', 0.3);
  ctx.beginPath(); ctx.ellipse(0, 0, 12 * k, 7 * k, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = rgba(C.ink, 0.25);
  ctx.beginPath(); ctx.ellipse(2 * k, 1 * k, 8 * k, 4.5 * k, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.1 * k;
  ctx.beginPath(); ctx.ellipse(0, 0, 12 * k, 7 * k, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  // Its head: a brass housing and the red lamp, a halo round it.
  ctx.fillStyle = brass;
  ctx.beginPath(); ctx.arc(headPt[0], headPt[1], 3.4 * k, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = rgba(C.ledRed, 0.3);
  ctx.beginPath(); ctx.arc(headPt[0] + 1 * k, headPt[1] - 4 * k, 6 * k, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.ledRed;
  ctx.beginPath(); ctx.arc(headPt[0] + 1 * k, headPt[1] - 4 * k, 2.2 * k, 0, Math.PI * 2); ctx.fill();
}

/** A top's mark in plan (D149), on the ground's map: (x0, y0) its tile's top-left px, `ppt` px a tile. */
export function topMarkPlan(ctx: Ctx, x0: number, y0: number, ppt: number, kind: number): void {
  const k = ppt / 32, cx = x0 + ppt * 0.5, cy = y0 + ppt * 0.5;
  ctx.fillStyle = rgba(C.ink, 0.25);
  ctx.beginPath(); ctx.ellipse(cx + 0.1 * ppt, cy + 0.12 * ppt, 0.2 * ppt, 0.15 * ppt, 0, 0, Math.PI * 2); ctx.fill();
  if (kind === TOP_BOULDER) {
    ctx.fillStyle = '#e2b292';
    ctx.beginPath(); ctx.arc(cx, cy, 0.22 * ppt, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(0.8, 1.1 * k);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,242,226,0.8)';
    ctx.beginPath(); ctx.arc(cx - 0.07 * ppt, cy - 0.07 * ppt, 0.07 * ppt, 0, Math.PI * 2); ctx.fill();
    return;
  }
  // The beacon: its fallen mast across the tile, its dish, its red lamp.
  stroke(ctx, [[cx - 0.3 * ppt, cy + 0.2 * ppt], [cx + 0.3 * ppt, cy - 0.22 * ppt]], C.ink, Math.max(1.2, 2.4 * k), 0.9);
  stroke(ctx, [[cx - 0.3 * ppt, cy + 0.2 * ppt], [cx + 0.3 * ppt, cy - 0.22 * ppt]], '#86a7b2', Math.max(0.8, 1.3 * k));
  ctx.fillStyle = '#c9dde3';
  ctx.beginPath(); ctx.ellipse(cx + 0.14 * ppt, cy + 0.18 * ppt, 0.13 * ppt, 0.09 * ppt, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(0.6, 0.9 * k); ctx.stroke();
  ctx.fillStyle = C.ledRed;
  ctx.beginPath(); ctx.arc(cx + 0.3 * ppt, cy - 0.22 * ppt, Math.max(1, 0.05 * ppt), 0, Math.PI * 2); ctx.fill();
}
