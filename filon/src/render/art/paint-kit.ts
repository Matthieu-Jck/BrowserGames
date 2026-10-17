// paint-kit.ts — what the chunk painters share (terrain.ts for the ground and the rock, gaps.ts for
// the water, the rivers and the chasms): the paint window (the chunk and `BORDER` tiles round it,
// so shapes that read their neighbours join across chunk seams), the marching squares that turn a
// per-tile predicate into soft outlines, and the fill and stroke helpers. No DOM, no Pixi: it runs
// in the terrain worker.
import { MAX_LEVEL, SHIFT, SMOOTH } from '../relief';

export type Ctx2 = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/**
 * Border of the paint window: relief columns up to MAX_LEVEL·SHIFT tiles in front of the chunk
 * lean back into it, and their levels need the smoothing ring plus one for the masks.
 */
export const BORDER = Math.ceil(MAX_LEVEL * SHIFT) + SMOOTH + 1;
export const WIN = 32 + 2 * BORDER;

export interface PaintData {
  cx: number;
  cy: number;
  terrain: Uint8Array; // WIN×WIN
  ore: Uint8Array;
  rich: Uint16Array;
  height: Uint8Array;
  biome: Uint8Array;
  /** The land's level (D45): the relief's terraces. */
  level: Uint8Array;
}

/** The chunk arrays a window is cut from (a Grid chunk, or test data). */
export interface ChunkArrays { terrain: Uint8Array; ore: Uint8Array; rich: Uint16Array; height: Uint8Array; biome: Uint8Array; level: Uint8Array }


/**
 * Marching squares with linear interpolation over a SMOOTHED membership field (3×3 mean of a
 * per-tile predicate), so shores are soft curves instead of tile staircases. The field reads
 * the border, so both sides of a chunk seam compute identical values. Samples sit at tile
 * centres; chunk px of sample i: (i - BORDER + 0.5) * ppt. Only cells near the chunk march.
 */
export function march(inside: (i: number, j: number) => boolean, ppt: number, keep = false): { polys: number[][]; segs: number[][] } {
  const polys: number[][] = [];
  const segs: number[][] = [];
  const raw = new Float32Array(WIN * WIN);
  for (let j = 0; j < WIN; j++) for (let i = 0; i < WIN; i++) raw[j * WIN + i] = inside(i, j) ? 1 : 0;
  const v = new Float32Array(WIN * WIN);
  let any = false;
  for (let j = 1; j < WIN - 1; j++) {
    for (let i = 1; i < WIN - 1; i++) {
      let s = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += raw[(j + dj) * WIN + i + di]! * (di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1);
      // `keep`: a tile inside stays inside however thin its band (a chasm's tapered end, a river
      // two tiles wide on a diagonal): what is drawn is what the rules read.
      v[j * WIN + i] = keep && raw[j * WIN + i] ? Math.max(0.62, s / 16) : s / 16;
      if (s > 0) any = true;
    }
  }
  if (!any) return { polys, segs };
  const X = (i: number): number => (i - BORDER + 0.5) * ppt;
  const lerp = (a: number, b: number): number => { const d = b - a; return d === 0 ? 0.5 : (0.5 - a) / d; };
  const lo = BORDER - 2, hi = BORDER + 33;
  for (let j = lo; j < hi; j++) {
    for (let i = lo; i < hi; i++) {
      const a = v[j * WIN + i]!, b = v[j * WIN + i + 1]!, c = v[(j + 1) * WIN + i + 1]!, d = v[(j + 1) * WIN + i]!;
      const code = (a >= 0.5 ? 8 : 0) | (b >= 0.5 ? 4 : 0) | (c >= 0.5 ? 2 : 0) | (d >= 0.5 ? 1 : 0);
      if (code === 0) continue;
      const x0 = X(i), x1 = X(i + 1), y0 = X(j), y1 = X(j + 1);
      const T_: [number, number] = [x0 + (x1 - x0) * lerp(a, b), y0];
      const R: [number, number] = [x1, y0 + (y1 - y0) * lerp(b, c)];
      const B: [number, number] = [x0 + (x1 - x0) * lerp(d, c), y1];
      const L: [number, number] = [x0, y0 + (y1 - y0) * lerp(a, d)];
      const A: [number, number] = [x0, y0], Bc: [number, number] = [x1, y0], Cc: [number, number] = [x1, y1], D: [number, number] = [x0, y1];
      const P = (...pts: Array<[number, number]>): void => { polys.push(pts.flat()); };
      const S = (p: [number, number], q: [number, number]): void => { segs.push([p[0], p[1], q[0], q[1]]); };
      switch (code) {
        case 15: P(A, Bc, Cc, D); break;
        case 8: P(A, T_, L); S(T_, L); break;
        case 4: P(T_, Bc, R); S(T_, R); break;
        case 2: P(R, Cc, B); S(R, B); break;
        case 1: P(L, B, D); S(L, B); break;
        case 12: P(A, Bc, R, L); S(L, R); break;
        case 6: P(T_, Bc, Cc, B); S(T_, B); break;
        case 3: P(L, R, Cc, D); S(L, R); break;
        case 9: P(A, T_, B, D); S(T_, B); break;
        case 14: P(A, Bc, Cc, B, L); S(L, B); break;
        case 13: P(A, Bc, R, B, D); S(R, B); break;
        case 11: P(A, T_, R, Cc, D); S(T_, R); break;
        case 7: P(T_, Bc, Cc, D, L); S(T_, L); break;
        case 10: P(A, T_, R, Cc, B, L); S(T_, R); S(B, L); break;
        case 5: P(T_, Bc, R, B, D, L); S(T_, L); S(R, B); break;
      }
    }
  }
  return { polys, segs };
}

export function fillPolys(ctx: Ctx2, polys: number[][], color: string, dx = 0, dy = 0): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const p of polys) {
    ctx.moveTo(p[0]! + dx, p[1]! + dy);
    for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k]! + dx, p[k + 1]! + dy);
    ctx.closePath();
  }
  ctx.fill();
}

export function strokeSegs(ctx: Ctx2, segs: number[][], color: string, w: number, alpha = 1): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const s of segs) { ctx.moveTo(s[0]!, s[1]!); ctx.lineTo(s[2]!, s[3]!); }
  ctx.stroke();
  ctx.restore();
}
