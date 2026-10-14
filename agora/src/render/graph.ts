// graph.ts — maps economic space (quantity, price) onto a canvas rect and draws the
// supply/demand picture: axes, animated curves, the equilibrium point, and shaded
// surplus / deadweight regions. It only ever *draws* numbers handed to it by the econ
// engine — it never computes economics itself.
import type { LinearCurve } from '@/econ/types';
import { fillPoly, line, text } from './draw';
import { palette, withAlpha } from './palette';
import { clamp } from '@/core/math';

export interface GraphView {
  x: number; y: number; w: number; h: number; // pixel rect (CSS px)
  qMax: number; pMax: number; // economic extent
}

export class GraphRenderer {
  constructor(public view: GraphView) {}

  setView(v: GraphView): void { this.view = v; }

  /** Quantity → x pixel. */
  X(q: number): number {
    const { x, w, qMax } = this.view;
    return x + (clamp(q, 0, qMax) / qMax) * w;
  }

  /** Price → y pixel (inverted: higher price is higher on screen). */
  Y(p: number): number {
    const { y, h, pMax } = this.view;
    return y + h - (clamp(p, 0, pMax) / pMax) * h;
  }

  axes(ctx: CanvasRenderingContext2D, qLabel = 'Quantity', pLabel = 'Price'): void {
    const { x, y, w, h } = this.view;
    line(ctx, x, y, x, y + h, palette.faint, 1.2);
    line(ctx, x, y + h, x + w, y + h, palette.faint, 1.2);
    // faint inner grid
    for (let i = 1; i <= 4; i++) {
      const gy = y + (h * i) / 5;
      line(ctx, x, gy, x + w, gy, withAlpha('#8a99b3', 0.06), 1);
    }
    text(ctx, pLabel, x + 4, y + 10, { color: palette.dim, size: 11, weight: 600 });
    text(ctx, qLabel, x + w, y + h + 16, { color: palette.dim, size: 11, weight: 600, align: 'right' });
  }

  /** Draw a linear curve. `sweep` (0..1) animates how much of it is drawn. */
  curve(
    ctx: CanvasRenderingContext2D,
    c: LinearCurve,
    color: string,
    sweep = 1,
    width = 2.4,
    label?: string,
  ): void {
    const steps = 48;
    const upto = Math.max(1, Math.floor(steps * clamp(sweep, 0, 1)));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= upto; i++) {
      const q = (this.view.qMax * i) / steps;
      const p = c.intercept + c.slope * q;
      const px = this.X(q), py = this.Y(p);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    if (label && sweep > 0.9) {
      const q = this.view.qMax * 0.82;
      const p = c.intercept + c.slope * q;
      text(ctx, label, this.X(q) + 6, this.Y(p), { color, size: 12, weight: 700 });
    }
  }

  point(
    ctx: CanvasRenderingContext2D,
    q: number, p: number, color: string, label?: string, r = 5,
  ): void {
    const px = this.X(q), py = this.Y(p);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (label) text(ctx, label, px + 10, py - 12, { color: palette.ink, size: 12, weight: 700 });
  }

  vLine(ctx: CanvasRenderingContext2D, q: number, color: string, dash = true): void {
    ctx.save();
    if (dash) ctx.setLineDash([4, 4]);
    line(ctx, this.X(q), this.view.y, this.X(q), this.view.y + this.view.h, color, 1.2);
    ctx.restore();
  }

  hLine(ctx: CanvasRenderingContext2D, p: number, color: string, dash = true): void {
    ctx.save();
    if (dash) ctx.setLineDash([4, 4]);
    line(ctx, this.view.x, this.Y(p), this.view.x + this.view.w, this.Y(p), color, 1.2);
    ctx.restore();
  }

  /** Fill a region given in economic coordinates. */
  region(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, fill: string): void {
    fillPoly(ctx, pts.map(([q, p]) => [this.X(q), this.Y(p)] as [number, number]), fill);
  }
}
