// projection.ts — the two views of one world and the morph between them. Everything flat
// (ground, ribbons, plan sprites, grid, fog) lives in TILE units under one linear map P(t):
// t = 0 is the isometric view (a 45° turn and a 2:1 squash), t = 1 the plan view used to
// build (a tile is a 32 px square). In between, the plane turns and unfolds — a scale-and-
// rotate interpolation, so the board lies down instead of shearing. Volumes (iso buildings,
// cliffs) live in iso world px and follow M(t) = P(t)·P(0)⁻¹ while they fade out.
import { CHUNK, CHUNKS } from '@/sim/constants';
import { screenToWorld, type CamState } from './camera-math';
import { TW, TH, LH } from './iso';

/** Plan view: world px per tile. */
export const TOP = 32;

/** Linear map tile → world px: X = a·x + c·y, Y = b·x + d·y (Pixi's matrix layout). */
export interface Lin { a: number; b: number; c: number; d: number }

const ISO_SX = (TW / 2) * Math.SQRT2, ISO_SY = (TH / 2) * Math.SQRT2;

/** Smoothstep easing for the view morph. */
export const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** P(t) for a view parameter t ∈ [0, 1] (already eased). */
export function proj(t: number): Lin {
  const th = (Math.PI / 4) * (1 - t);
  const sx = ISO_SX + (TOP - ISO_SX) * t, sy = ISO_SY + (TOP - ISO_SY) * t;
  const cs = Math.cos(th), sn = Math.sin(th);
  return { a: sx * cs, b: sy * sn, c: -sx * sn, d: sy * cs };
}

export const ISO_LIN = proj(0);

export function apply(P: Lin, x: number, y: number): [number, number] {
  return [P.a * x + P.c * y, P.b * x + P.d * y];
}

export function invert(P: Lin): Lin {
  const det = P.a * P.d - P.b * P.c;
  return { a: P.d / det, b: -P.b / det, c: -P.c / det, d: P.a / det };
}

/** A then B (apply A first). */
export function compose(B: Lin, A: Lin): Lin {
  return { a: B.a * A.a + B.c * A.b, b: B.b * A.a + B.d * A.b, c: B.a * A.c + B.c * A.d, d: B.b * A.c + B.d * A.d };
}

/** M(t): iso world px → the current view's world px (for the volumes during the morph). */
export const isoToView = (P: Lin): Lin => compose(P, invert(ISO_LIN));

/** Screen px → tile coords on the ground plane under view P. */
export function screenTile(P: Lin, c: CamState, vw: number, vh: number, sx: number, sy: number): [number, number] {
  const [X, Y] = screenToWorld(c, vw, vh, sx, sy);
  return apply(invert(P), X, Y);
}

/**
 * Chunks whose footprint (plus `reliefPx` of headroom above, in the iso view) may intersect
 * the screen, plus `margin` chunks around.
 */
export function visibleChunksP(P: Lin, c: CamState, vw: number, vh: number, margin = 1, reliefPx = 0): Array<[number, number]> {
  const inv = invert(P);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [sx, sy] of [[0, 0], [vw, 0], [0, vh], [vw, vh]] as const) {
    const [X, Y] = screenToWorld(c, vw, vh, sx, sy);
    for (const lift of [0, reliefPx]) {
      const [tx, ty] = apply(inv, X, Y + lift);
      x0 = Math.min(x0, tx); y0 = Math.min(y0, ty); x1 = Math.max(x1, tx); y1 = Math.max(y1, ty);
    }
  }
  const cx0 = Math.max(0, Math.floor(x0 / CHUNK) - margin), cy0 = Math.max(0, Math.floor(y0 / CHUNK) - margin);
  const cx1 = Math.min(CHUNKS - 1, Math.floor(x1 / CHUNK) + margin), cy1 = Math.min(CHUNKS - 1, Math.floor(y1 / CHUNK) + margin);
  const [vx0, vy0] = screenToWorld(c, vw, vh, 0, 0);
  const [vx1, vy1] = screenToWorld(c, vw, vh, vw, vh);
  const out: Array<[number, number]> = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const [bx0, by0, bx1, by1] = tileBoxBounds(P, cx * CHUNK, cy * CHUNK, CHUNK, reliefPx);
      if (bx1 < vx0 || bx0 > vx1 || by1 < vy0 || by0 > vy1) continue;
      out.push([cx, cy]);
    }
  }
  return out;
}

/** World-px bounding box of a square of `n` tiles at (x, y) under P (headroom above). */
export function tileBoxBounds(P: Lin, x: number, y: number, n: number, reliefPx = 0): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [u, v] of [[x, y], [x + n, y], [x, y + n], [x + n, y + n]] as const) {
    const [X, Y] = apply(P, u, v);
    x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
  }
  return [x0, y0 - reliefPx, x1, y1];
}

/** Relief headroom in world px for a view parameter (cliffs only stand up in iso). */
export const reliefHead = (t: number, levels: number): number => levels * LH * (1 - t);
