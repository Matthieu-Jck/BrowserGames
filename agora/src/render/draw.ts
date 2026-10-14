// draw.ts — Canvas-2D primitives. The expensive glow is baked once into an offscreen
// sprite and blitted with drawImage, so hundreds of agents never rebuild a gradient in
// the hot loop.
import { withAlpha } from './palette';

const glowCache = new Map<string, HTMLCanvasElement>();

/** A soft radial glow sprite for `color`, cached. `size` is the sprite diameter in px. */
export function bakeGlow(color: string, size = 64): HTMLCanvasElement {
  const key = `${color}|${size}`;
  const hit = glowCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, withAlpha(color, 1));
  g.addColorStop(0.35, withAlpha(color, 0.55));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowCache.set(key, c);
  return c;
}

/** Blit a baked glow centred at (x,y) with on-screen radius `rad` and alpha. */
export function glowDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rad: number,
  color: string,
  alpha = 1,
): void {
  const sprite = bakeGlow(color);
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, x - rad, y - rad, rad * 2, rad * 2);
  ctx.globalAlpha = 1;
}

/** A crisp filled core dot (no glow) — for precise marks. */
export function dot(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function line(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, width = 1.5,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Fill a closed polygon from a flat list of points. */
export function fillPoly(
  ctx: CanvasRenderingContext2D,
  pts: Array<[number, number]>,
  fill: string,
): void {
  if (pts.length < 3) return;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.closePath();
  ctx.fill();
}

export function text(
  ctx: CanvasRenderingContext2D,
  str: string, x: number, y: number,
  opts: { color?: string; size?: number; weight?: number; align?: CanvasTextAlign; font?: string } = {},
): void {
  ctx.fillStyle = opts.color ?? '#e8eef7';
  ctx.font = `${opts.weight ?? 500} ${opts.size ?? 13}px ${opts.font ?? 'Inter, system-ui, sans-serif'}`;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}
