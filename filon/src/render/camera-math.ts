// camera-math.ts — pure camera maths (no Pixi): world ↔ screen, zoom about a cursor, chunk
// ranges. One tile = TILE world pixels; the camera centre is in world pixels.

export const TILE = 32;
export const ZOOM_MIN = 0.125;
export const ZOOM_MAX = 2;

export interface CamState {
  /** Camera centre in world pixels. */
  cx: number;
  cy: number;
  zoom: number;
}

export function worldToScreen(c: CamState, vw: number, vh: number, wx: number, wy: number): [number, number] {
  return [(wx - c.cx) * c.zoom + vw / 2, (wy - c.cy) * c.zoom + vh / 2];
}

export function screenToWorld(c: CamState, vw: number, vh: number, sx: number, sy: number): [number, number] {
  return [(sx - vw / 2) / c.zoom + c.cx, (sy - vh / 2) / c.zoom + c.cy];
}

export const clampZoom = (z: number): number => (z < ZOOM_MIN ? ZOOM_MIN : z > ZOOM_MAX ? ZOOM_MAX : z);

/** New camera that zooms to `zoom` while keeping the world point under (sx, sy) fixed. */
export function zoomAt(c: CamState, vw: number, vh: number, sx: number, sy: number, zoom: number): CamState {
  const z = clampZoom(zoom);
  const [wx, wy] = screenToWorld(c, vw, vh, sx, sy);
  return { zoom: z, cx: wx - (sx - vw / 2) / z, cy: wy - (sy - vh / 2) / z };
}

/** Visible world rectangle [x0, y0, x1, y1] in world pixels. */
export function viewRect(c: CamState, vw: number, vh: number): [number, number, number, number] {
  const hw = vw / 2 / c.zoom, hh = vh / 2 / c.zoom;
  return [c.cx - hw, c.cy - hh, c.cx + hw, c.cy + hh];
}

/** Inclusive chunk index range covering the view plus a margin (chunk size in tiles). */
export function chunkRange(
  c: CamState, vw: number, vh: number, chunkTiles: number, margin = 1,
): [number, number, number, number] {
  const [x0, y0, x1, y1] = viewRect(c, vw, vh);
  const span = chunkTiles * TILE;
  return [
    Math.floor(x0 / span) - margin, Math.floor(y0 / span) - margin,
    Math.floor(x1 / span) + margin, Math.floor(y1 / span) + margin,
  ];
}

/** Tile under a screen point. */
export function tileAt(c: CamState, vw: number, vh: number, sx: number, sy: number): [number, number] {
  const [wx, wy] = screenToWorld(c, vw, vh, sx, sy);
  return [Math.floor(wx / TILE), Math.floor(wy / TILE)];
}
