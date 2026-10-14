// scene-supply-demand.ts — Chapter 1's picture. Demand and supply sweep in, the
// equilibrium lands, and the player's chosen price opens a visible shortage or glut on
// the price line. A wrong verdict makes that gap flare.
import type { Scene } from './scene';
import type { Severity } from '@/core/kinds';
import { GraphRenderer } from './graph';
import { palette, withAlpha } from './palette';
import { text, line } from './draw';
import { clamp, lerp } from '@/core/math';
import { CH1_DEMAND, CH1_SUPPLY } from '@/content/chapter1';
import { makeSupply } from '@/econ/curves';
import { solveEquilibrium, outcomeAtPrice } from '@/econ/equilibrium';

export class SupplyDemandScene implements Scene {
  readonly id = 'supply-demand' as const;
  private graph = new GraphRenderer({ x: 0, y: 0, w: 10, h: 10, qMax: 100, pMax: 110 });
  private p = { price: -1, showSupply: 0, showEq: 0, supplyShift: 0 };

  // animation state
  private demandSweep = 0;
  private supplySweep = 0;
  private eqGlow = 0;
  private priceMark = 60;
  private flash = 0;

  setParam(key: string, value: number): void {
    if (key in this.p) (this.p as Record<string, number>)[key] = value;
    if (key === 'price' && value >= 0) this.priceMark = value;
  }

  reveal(): void {
    // sweeps animate toward their targets in update()
    this.eqGlow = Math.max(this.eqGlow, 0.001);
  }

  showVerdict(severity: Severity): void {
    this.flash = severity === 'catastrophic' ? 1 : severity === 'wrong' ? 0.7 : severity === 'close' ? 0.35 : 0;
  }

  resize(w: number, h: number): void {
    const gw = clamp(w * 0.46, 320, 600);
    const gh = clamp(h * 0.56, 260, 460);
    const gx = w < 940 ? w / 2 - gw / 2 : w - gw - w * 0.07;
    const gy = h * 0.5 - gh * 0.42;
    this.graph.setView({ x: gx, y: gy, w: gw, h: gh, qMax: 100, pMax: 110 });
  }

  update(dt: number, _t: number): void {
    const k = clamp(dt * 2.6, 0, 1);
    this.demandSweep = lerp(this.demandSweep, 1, k);
    this.supplySweep = lerp(this.supplySweep, this.p.showSupply ? 1 : 0, k);
    this.eqGlow = lerp(this.eqGlow, this.p.showEq ? 1 : 0, clamp(dt * 3, 0, 1));
    if (this.p.price >= 0) this.priceMark = lerp(this.priceMark, this.p.price, clamp(dt * 9, 0, 1));
    this.flash = Math.max(0, this.flash - dt * 0.8);
  }

  render(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    const g = this.graph;
    const supply = makeSupply(CH1_SUPPLY.intercept + this.p.supplyShift, Math.abs(CH1_SUPPLY.slope));
    const eq = solveEquilibrium(CH1_DEMAND, supply);

    g.axes(ctx, 'Loaves', 'Price');
    g.curve(ctx, CH1_DEMAND, palette.buyer, this.demandSweep, 2.6, 'Demand');
    if (this.supplySweep > 0.02) g.curve(ctx, supply, palette.seller, this.supplySweep, 2.6, 'Supply');

    // Equilibrium point + guide lines.
    if (this.eqGlow > 0.02 && this.supplySweep > 0.6) {
      ctx.globalAlpha = this.eqGlow;
      g.vLine(ctx, eq.qtyStar, withAlpha(palette.ink, 0.35));
      g.hLine(ctx, eq.priceStar, withAlpha(palette.ink, 0.35));
      g.point(ctx, eq.qtyStar, eq.priceStar, palette.accent, `$${Math.round(eq.priceStar)}`);
      ctx.globalAlpha = 1;
    }

    // The player's price line and the shortage / glut it opens.
    if (this.p.price >= 0 && this.supplySweep > 0.6) {
      const o = outcomeAtPrice(CH1_DEMAND, supply, this.priceMark);
      const py = g.Y(this.priceMark);
      const gapColor = o.kind === 'shortage' ? palette.danger : o.kind === 'surplus' ? palette.warn : palette.good;
      line(ctx, g.X(0), py, g.X(g.view.qMax), py, withAlpha(gapColor, 0.5), 1.4);

      // markers where demand and supply hit this price
      g.point(ctx, o.qd, this.priceMark, palette.buyer, undefined, 4);
      g.point(ctx, o.qs, this.priceMark, palette.seller, undefined, 4);

      // the gap segment, flaring on a bad verdict
      const flareW = 3 + this.flash * 7;
      const flareA = 0.6 + this.flash * 0.4;
      line(ctx, g.X(o.qs), py, g.X(o.qd), py, withAlpha(gapColor, flareA), flareW);

      const label =
        o.kind === 'shortage'
          ? `shortage ${Math.round(o.gap)}`
          : o.kind === 'surplus'
            ? `glut ${Math.round(-o.gap)}`
            : 'cleared';
      const midQ = (o.qd + o.qs) / 2;
      text(ctx, label, g.X(midQ), py - 14, { color: gapColor, size: 12, weight: 700, align: 'center' });
    }
  }
}
