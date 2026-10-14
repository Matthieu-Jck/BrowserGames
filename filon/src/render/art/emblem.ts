// emblem.ts — the claim's emblem drawn in ink (content/emblem.ts gives its parts): a shape filled
// with the field's colour and inked round, a thin inner rim, the symbol in the other colour. One
// drawing for the register's designer (ui/screens/intro.ts), the Heart's flag (world/heart-flag.ts)
// and anywhere else the claim shows its colours. Canvas2D only: no Pixi, so the DOM UI may use it.
import type { Emblem, EmblemColor, EmblemShape, EmblemSymbol } from '@/content/emblem';
import { flat, ink, type Ctx, type Pt } from './ink';
import { C, mix } from './tokens';

/** A palette name → its ink colour. */
export const emblemColor = (c: EmblemColor): string => ({
  coral: C.coral, turq: C.turq, lilac: C.lilac, brass: C.brass, teal: C.teal, violet: C.violet, ink: C.ink, paper: C.paper,
})[c];

/** A shape's outline round (cx, cy), r its half-height. */
export function shapeOutline(shape: EmblemShape, cx: number, cy: number, r: number): Pt[] {
  switch (shape) {
    case 'round': return Array.from({ length: 40 }, (_, i) => { const a = (i / 40) * Math.PI * 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt; });
    case 'diamond': return [[cx, cy - r], [cx + r * 0.82, cy], [cx, cy + r], [cx - r * 0.82, cy]];
    case 'pennant': {
      const w = r * 0.78;
      return [[cx - w, cy - r], [cx + w, cy - r], [cx + w, cy + r], [cx, cy + r * 0.55], [cx - w, cy + r]];
    }
    case 'shield': {
      const w = r * 0.82, pts: Pt[] = [[cx - w, cy - r * 0.86], [cx, cy - r], [cx + w, cy - r * 0.86]];
      // The sides curve in to the point.
      for (let i = 1; i <= 10; i++) { const t = i / 10; pts.push([cx + w * (1 - t * t), cy - r * 0.86 + t * r * 1.86]); }
      for (let i = 9; i >= 1; i--) { const t = i / 10; pts.push([cx - w * (1 - t * t), cy - r * 0.86 + t * r * 1.86]); }
      return pts;
    }
  }
}

/** The emblem round (cx, cy), r its half-height (px); `lw` the ink line's width. */
export function drawEmblem(ctx: Ctx, e: Emblem, cx: number, cy: number, r: number, lw = Math.max(1.2, r * 0.09)): void {
  const field = emblemColor(e.field), inkC = emblemColor(e.ink);
  const out = shapeOutline(e.shape, cx, cy, r);
  flat(ctx, out, field);
  // A lit top edge, a shaded bottom: printed cloth, not a flat sticker.
  ctx.save();
  ctx.beginPath(); out.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.clip();
  flat(ctx, [[cx - r * 2, cy + r * 0.35], [cx + r * 2, cy + r * 0.35], [cx + r * 2, cy + r * 2], [cx - r * 2, cy + r * 2]], mix(field, C.ink, 0.5), 0.18);
  ctx.restore();
  ink(ctx, shapeOutline(e.shape, cx, cy, r * 0.84), { closed: true, w: lw * 0.45, color: inkC, alpha: 0.55, shade: false, taper: 0, jitter: 0 });
  drawSymbol(ctx, e.symbol, cx, cy + (e.shape === 'shield' ? -r * 0.06 : e.shape === 'pennant' ? -r * 0.12 : 0), r * 0.5, inkC, lw);
  ink(ctx, out, { closed: true, w: lw, color: C.ink, shade: false, taper: 0, jitter: 0.1 });
}

/** A symbol round (cx, cy), s its half-size, in colour `col`. */
export function drawSymbol(ctx: Ctx, sym: EmblemSymbol, cx: number, cy: number, s: number, col: string, lw: number): void {
  const line = (pts: Pt[], w = lw, closed = false): void => ink(ctx, pts, { closed, w, color: col, shade: false, taper: 0, jitter: 0 });
  const ring = (r: number, n = 32): Pt[] => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt; });
  switch (sym) {
    case 'star': {
      const pts: Pt[] = [];
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? s * 0.42 : s; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      flat(ctx, pts, col);
      return;
    }
    case 'gear': {
      const pts: Pt[] = [];
      for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2, r = (i >> 1) % 2 ? s * 0.74 : s; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      flat(ctx, pts, col);
      flat(ctx, ring(s * 0.32), mix(col, C.ink, 0.65));
      return;
    }
    case 'wave':
      for (const dy of [-0.32, 0.32]) line(Array.from({ length: 17 }, (_, i) => { const t = i / 16; return [cx - s + 2 * s * t, cy + dy * s + Math.sin(t * Math.PI * 2) * s * 0.22] as Pt; }), lw * 1.3);
      return;
    case 'peak':
      flat(ctx, [[cx - s, cy + s * 0.7], [cx - s * 0.25, cy - s * 0.75], [cx + s * 0.2, cy - s * 0.05], [cx + s * 0.5, cy - s * 0.45], [cx + s, cy + s * 0.7]], col);
      return;
    case 'eye':
      // The ocelle: a ring round a dot.
      line(ring(s * 0.8), lw * 1.4, true);
      flat(ctx, ring(s * 0.3), col);
      return;
    case 'bird':
      line([[cx - s, cy - s * 0.15], [cx - s * 0.45, cy - s * 0.45], [cx, cy + s * 0.15], [cx + s * 0.45, cy - s * 0.45], [cx + s, cy - s * 0.15]], lw * 1.5);
      return;
    case 'sun':
      flat(ctx, ring(s * 0.45), col);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; line([[cx + Math.cos(a) * s * 0.62, cy + Math.sin(a) * s * 0.62], [cx + Math.cos(a) * s, cy + Math.sin(a) * s]], lw * 1.1); }
      return;
    case 'bolt':
      flat(ctx, [[cx + s * 0.2, cy - s], [cx - s * 0.55, cy + s * 0.12], [cx - s * 0.02, cy + s * 0.12], [cx - s * 0.25, cy + s], [cx + s * 0.55, cy - s * 0.15], [cx + s * 0.05, cy - s * 0.15]], col);
      return;
  }
}
