// iso.ts — the 2:1 isometric projection between the engine's square tile grid and world
// pixels. The sim never sees it: tile (x, y) stays a square cell; only drawing and picking go
// through here. +x runs down-right on screen, +y down-left, height z lifts by LH per level.
// Light comes from the top-left of the screen (from −x): +x faces are the shaded ones.
import { CHUNK, CHUNKS } from '@/sim/constants';
import { screenToWorld, type CamState } from './camera-math';

/** World px: tile width, tile height, px per relief level. */
export const TW = 64;
export const TH = 32;
export const LH = 16;
const HW = TW / 2, HH = TH / 2;

/** Tile coords (continuous; integer = tile corner) + height → world px. */
export function tileToIso(x: number, y: number, z = 0): [number, number] {
  return [(x - y) * HW, (x + y) * HH - z * LH];
}

/** World px → tile coords on the ground plane (z = 0). */
export function isoToTile(X: number, Y: number): [number, number] {
  return [(X / HW + Y / HH) / 2, (Y / HH - X / HW) / 2];
}

/** Screen px → tile under the cursor (ground plane). */
export function screenToTile(c: CamState, vw: number, vh: number, sx: number, sy: number): [number, number] {
  const [X, Y] = screenToWorld(c, vw, vh, sx, sy);
  const [x, y] = isoToTile(X, Y);
  return [Math.floor(x), Math.floor(y)];
}

/** Painter's depth of a tile (higher = nearer the viewer). */
export const depthOf = (x: number, y: number): number => x + y;

/** World-px bounds of the whole map (for camera clamping). */
export const WORLD_ISO: [number, number, number, number] = [-CHUNKS * CHUNK * HW, 0, CHUNKS * CHUNK * HW, CHUNKS * CHUNK * TH];

/**
 * Chunks whose iso footprint may intersect the view (plus `margin` chunks, and room for
 * relief rising above the ground). Returned near-to-far is not needed: callers sort.
 */
export function visibleChunks(c: CamState, vw: number, vh: number, margin = 1, reliefPx = 6 * LH): Array<[number, number]> {
  const corners = [[0, 0], [vw, 0], [0, vh], [vw, vh]] as const;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [sx, sy] of corners) {
    for (const lift of [0, reliefPx]) {
      const [X, Y] = screenToWorld(c, vw, vh, sx, sy);
      const [tx, ty] = isoToTile(X, Y + lift);
      x0 = Math.min(x0, tx); y0 = Math.min(y0, ty); x1 = Math.max(x1, tx); y1 = Math.max(y1, ty);
    }
  }
  const cx0 = Math.max(0, Math.floor(x0 / CHUNK) - margin), cy0 = Math.max(0, Math.floor(y0 / CHUNK) - margin);
  const cx1 = Math.min(CHUNKS - 1, Math.floor(x1 / CHUNK) + margin), cy1 = Math.min(CHUNKS - 1, Math.floor(y1 / CHUNK) + margin);
  // Screen-space rect in world px for the precise test.
  const [vx0, vy0] = screenToWorld(c, vw, vh, 0, 0);
  const [vx1, vy1] = screenToWorld(c, vw, vh, vw, vh);
  const out: Array<[number, number]> = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const [bx0, by0, bx1, by1] = chunkIsoBounds(cx, cy, reliefPx);
      if (bx1 < vx0 || bx0 > vx1 || by1 < vy0 || by0 > vy1) continue;
      out.push([cx, cy]);
    }
  }
  return out;
}

/** World-px bounding box of a chunk's diamond (with headroom above for relief). */
export function chunkIsoBounds(cx: number, cy: number, reliefPx = 0): [number, number, number, number] {
  const x = cx * CHUNK, y = cy * CHUNK;
  const [tx] = tileToIso(x, y + CHUNK); // leftmost corner
  const [rx] = tileToIso(x + CHUNK, y); // rightmost corner
  const [, topY] = tileToIso(x, y);
  const [, botY] = tileToIso(x + CHUNK, y + CHUNK);
  return [tx, topY - reliefPx, rx, botY];
}

/**
 * The affine matrix that lays a top-down texture of a chunk (ppt px per tile) flat on the
 * iso ground: texture px (u, v) → world px. Pixi Matrix(a, b, c, d, tx, ty).
 */
export function groundMatrix(cx: number, cy: number, ppt: number): [number, number, number, number, number, number] {
  const [X0, Y0] = tileToIso(cx * CHUNK, cy * CHUNK);
  return [HW / ppt, HH / ppt, -HW / ppt, HH / ppt, X0, Y0];
}
