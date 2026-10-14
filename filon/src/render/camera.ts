// camera.ts — the smoothed camera. Its centre lives in TILE coordinates, so it survives the
// morph between the iso and plan views (the tile at the centre stays put while the board turns
// and unfolds); the current view's projection turns it into world px each frame. A target the
// input moves, a current state that eases towards it, applied to the world container (a render
// group, so the transform runs on the GPU). Bounds clamp the centre to the map.
import type { Container } from 'pixi.js';
import { clampZoom, type CamState } from './camera-math';
import { apply, invert, type Lin } from './projection';
import { CHUNK, CHUNKS } from '@/sim/constants';

interface TileCam { tx: number; ty: number; zoom: number }

export class Camera {
  cur: TileCam;
  target: TileCam;
  /** Clamp rectangle for the centre, in tiles. */
  bounds: [number, number, number, number] = [0, 0, CHUNKS * CHUNK, CHUNKS * CHUNK];
  /** The projection of the view being drawn (set by the app every frame). */
  P: Lin = { a: 32, b: 0, c: 0, d: 32 };

  constructor(tx: number, ty: number, zoom = 1) {
    this.cur = { tx, ty, zoom };
    this.target = { tx, ty, zoom };
  }

  /** Current state in world px for the current projection. */
  get state(): CamState {
    const [cx, cy] = apply(this.P, this.cur.tx, this.cur.ty);
    return { cx, cy, zoom: this.cur.zoom };
  }

  /** Pan by a screen-pixel delta. */
  panScreen(dx: number, dy: number): void {
    const [ux, uy] = apply(invert(this.P), dx / this.target.zoom, dy / this.target.zoom);
    this.target.tx -= ux;
    this.target.ty -= uy;
    this.clampTarget();
  }

  /** Zoom by a factor keeping the ground point under the cursor fixed. */
  zoomBy(factor: number, sx: number, sy: number, vw: number, vh: number): void {
    const inv = invert(this.P);
    const z0 = this.target.zoom, z1 = clampZoom(z0 * factor);
    // Tile offset of the cursor from the centre, before and after.
    const [ox0, oy0] = apply(inv, (sx - vw / 2) / z0, (sy - vh / 2) / z0);
    const [ox1, oy1] = apply(inv, (sx - vw / 2) / z1, (sy - vh / 2) / z1);
    this.target = { tx: this.target.tx + ox0 - ox1, ty: this.target.ty + oy0 - oy1, zoom: z1 };
    this.clampTarget();
  }

  jumpTo(tx: number, ty: number, zoom?: number): void {
    this.target = { tx, ty, zoom: clampZoom(zoom ?? this.target.zoom) };
    this.clampTarget();
    this.cur = { ...this.target };
  }

  /** Centre on a tile's middle. */
  centerOnTile(tx: number, ty: number, zoom?: number): void {
    this.jumpTo(tx + 0.5, ty + 0.5, zoom);
  }

  /** Glide (not jump) to a tile. */
  glideTo(tx: number, ty: number, zoom?: number): void {
    this.target = { tx, ty, zoom: clampZoom(zoom ?? this.target.zoom) };
    this.clampTarget();
  }

  private clampTarget(): void {
    const [x0, y0, x1, y1] = this.bounds;
    this.target.tx = Math.min(x1, Math.max(x0, this.target.tx));
    this.target.ty = Math.min(y1, Math.max(y0, this.target.ty));
  }

  /** Ease the current state towards the target (frame-rate independent). */
  update(dt: number): boolean {
    const k = 1 - Math.exp(-14 * dt);
    const c = this.cur, t = this.target;
    const before = c.tx + c.ty * 7 + c.zoom * 13;
    c.zoom = Math.exp(Math.log(c.zoom) + (Math.log(t.zoom) - Math.log(c.zoom)) * k);
    c.tx += (t.tx - c.tx) * k;
    c.ty += (t.ty - c.ty) * k;
    if (Math.abs(t.zoom - c.zoom) < 1e-4) c.zoom = t.zoom;
    if (Math.abs(t.tx - c.tx) < 1e-3) c.tx = t.tx;
    if (Math.abs(t.ty - c.ty) < 1e-3) c.ty = t.ty;
    return before !== c.tx + c.ty * 7 + c.zoom * 13;
  }

  /** Apply to the world container for a view of vw×vh CSS pixels. */
  apply(world: Container, vw: number, vh: number, resolution: number, snap: boolean): void {
    const s = this.state;
    world.scale.set(s.zoom);
    let x = vw / 2 - s.cx * s.zoom;
    let y = vh / 2 - s.cy * s.zoom;
    // When idle, snap to device pixels so ink lines stay crisp.
    if (snap && !this.moving()) {
      x = Math.round(x * resolution) / resolution;
      y = Math.round(y * resolution) / resolution;
    }
    world.position.set(x, y);
  }

  moving(): boolean {
    const c = this.cur, t = this.target;
    return c.tx !== t.tx || c.ty !== t.ty || c.zoom !== t.zoom;
  }
}
