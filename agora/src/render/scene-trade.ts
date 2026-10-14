// scene-trade.ts — Chapter 4. Two views: paired bars comparing autarky vs specialised
// output (with the value gained), and a terms-of-trade number line showing the band of
// prices both parties accept.
import type { Scene } from './scene';
import type { Severity } from '@/core/kinds';
import { comparativeAdvantage } from '@/econ/advantage';
import { ADA, BEN_BREAD } from '@/content/chapter4';
import { roundRect, text, line } from './draw';
import { palette, withAlpha } from './palette';
import { clamp, lerp } from '@/core/math';

export class TradeScene implements Scene {
  readonly id = 'trade' as const;
  private p = { benGood0: 2, tot: 2.5, mode: 0 };
  private box = { x: 0, y: 0, w: 10, h: 10 };
  private grow = 0; // bar reveal
  private flash = 0;

  setParam(key: string, value: number): void {
    if (key in this.p) (this.p as Record<string, number>)[key] = value;
  }
  reveal(): void { this.grow = Math.max(this.grow, 0.001); }
  showVerdict(severity: Severity): void {
    this.flash = severity === 'catastrophic' || severity === 'wrong' ? 1 : 0.3;
  }
  resize(w: number, h: number): void {
    const bw = clamp(w * 0.46, 320, 560);
    const bh = clamp(h * 0.5, 260, 420);
    const bx = w < 940 ? w / 2 - bw / 2 : w - bw - w * 0.07;
    const by = h * 0.5 - bh * 0.42;
    this.box = { x: bx, y: by, w: bw, h: bh };
  }
  update(dt: number, _t: number): void {
    this.grow = lerp(this.grow, 1, clamp(dt * 3, 0, 1));
    this.flash = Math.max(0, this.flash - dt * 0.8);
  }

  render(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    const ca = comparativeAdvantage(ADA, { name: 'Ben', output: [this.p.benGood0, BEN_BREAD] });
    if (this.p.mode === 1) this.renderBand(ctx, ca);
    else this.renderBars(ctx, ca);
  }

  private renderBars(ctx: CanvasRenderingContext2D, ca: ReturnType<typeof comparativeAdvantage>): void {
    const { x, y, w, h } = this.box;
    const maxV = Math.max(...ca.autarkyOutput, ...ca.specializedOutput, 1);
    const groups = [
      { label: 'Robots', aut: ca.autarkyOutput[0]!, spec: ca.specializedOutput[0]! },
      { label: 'Bread', aut: ca.autarkyOutput[1]!, spec: ca.specializedOutput[1]! },
    ];
    const groupW = w / groups.length;
    const barW = groupW * 0.28;
    const baseY = y + h;

    groups.forEach((grp, i) => {
      const gx = x + groupW * i + groupW * 0.5;
      const bars = [
        { v: grp.aut, color: withAlpha(palette.dim, 0.55), label: 'alone', dx: -barW * 0.62 },
        { v: grp.spec, color: palette.accent, label: 'trade', dx: barW * 0.62 },
      ];
      for (const b of bars) {
        const bh = (b.v / maxV) * (h - 30) * this.grow;
        roundRect(ctx, gx + b.dx - barW / 2, baseY - bh, barW, bh, 4);
        ctx.fillStyle = b.color;
        ctx.fill();
        text(ctx, String(Math.round(b.v)), gx + b.dx, baseY - bh - 10, { color: palette.dim, size: 11, align: 'center' });
      }
      text(ctx, grp.label, gx, baseY + 16, { color: palette.ink, size: 13, weight: 600, align: 'center' });
    });

    // headline gain
    const pct = ca.autarkyValue > 0 ? (ca.gain / ca.autarkyValue) * 100 : 0;
    const headline = ca.gainsExist && pct > 0.5 ? `Total value  +${Math.round(pct)}%` : 'No gains from trade';
    text(ctx, headline, x + w / 2, y - 14, {
      color: ca.gainsExist ? palette.accent : palette.dim, size: 22, weight: 700, align: 'center', font: 'Space Grotesk, sans-serif',
    });
    text(ctx, 'dim = each does a bit of both   ·   bright = specialise & trade', x + w / 2, baseY + 40,
      { color: palette.dim, size: 11, align: 'center' });
  }

  private renderBand(ctx: CanvasRenderingContext2D, ca: ReturnType<typeof comparativeAdvantage>): void {
    const { x, y, w, h } = this.box;
    const cy = y + h * 0.5;
    const lineW = w * 0.86;
    const lx = x + (w - lineW) / 2;
    const min = 0, max = 6;
    const toX = (v: number) => lx + (clamp(v, min, max) / (max - min)) * lineW;

    const lo = ca.termsOfTrade.min, hi = ca.termsOfTrade.max;
    // accepted band
    ctx.fillStyle = withAlpha(palette.good, 0.16);
    ctx.fillRect(toX(lo), cy - 26, toX(hi) - toX(lo), 52);
    line(ctx, lx, cy, lx + lineW, cy, withAlpha(palette.ink, 0.4), 2);

    // boundary opportunity costs
    for (const [v, who, col] of [[lo, 'Ada’s cost', palette.buyer], [hi, 'Ben’s cost', palette.seller]] as const) {
      line(ctx, toX(v), cy - 30, toX(v), cy + 30, withAlpha(col, 0.7), 1.6);
      text(ctx, `${who} ${v.toFixed(0)}`, toX(v), cy + 46, { color: col, size: 11, weight: 600, align: 'center' });
    }

    // the player's marker
    const tot = this.p.tot;
    const inside = tot > lo && tot < hi;
    const mx = toX(tot);
    const col = inside ? palette.good : palette.danger;
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 14 + this.flash * 16;
    ctx.beginPath();
    ctx.moveTo(mx, cy - 16);
    ctx.lineTo(mx + 8, cy - 30);
    ctx.lineTo(mx - 8, cy - 30);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    text(ctx, `${tot.toFixed(1)} loaves / robot`, mx, cy - 40, { color: col, size: 13, weight: 700, align: 'center' });
    text(ctx, inside ? 'both accept' : 'no deal', mx, cy + 22, { color: col, size: 12, weight: 600, align: 'center' });
    text(ctx, 'Price of a robot, measured in bread', x + w / 2, y - 12, { color: palette.dim, size: 13, align: 'center' });
  }
}
