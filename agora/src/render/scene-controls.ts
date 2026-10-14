// scene-controls.ts — Chapter 3. The same supply/demand picture, now with a meddling
// hand: a price ceiling/floor, or a tax wedge. The deadweight-loss triangle is drawn in
// red, the tax revenue in gold, so the cost of interference is literally shaded in.
import type { Scene } from './scene';
import type { Severity } from '@/core/kinds';
import { GraphRenderer } from './graph';
import { priceAtQ } from '@/econ/curves';
import { solveEquilibrium, outcomeAtPrice } from '@/econ/equilibrium';
import { priceControl, applyTax } from '@/econ/controls';
import { CH3_DEMAND, CH3_SUPPLY } from '@/content/chapter3';
import { palette, withAlpha } from './palette';
import { text } from './draw';
import { clamp, lerp } from '@/core/math';

export class ControlsScene implements Scene {
  readonly id = 'controls' as const;
  private g = new GraphRenderer({ x: 0, y: 0, w: 10, h: 10, qMax: 100, pMax: 110 });
  private p = { tool: 0, price: 60, tax: 0, showEq: 1 };
  private sweep = 0;
  private ctrl = 60; // animated control line
  private taxA = 0; // animated tax
  private flash = 0;

  setParam(key: string, value: number): void {
    if (key in this.p) (this.p as Record<string, number>)[key] = value;
  }
  reveal(): void { this.sweep = Math.max(this.sweep, 0.001); }
  showVerdict(severity: Severity): void {
    this.flash = severity === 'catastrophic' ? 1 : severity === 'wrong' ? 0.7 : severity === 'close' ? 0.35 : 0.1;
  }
  resize(w: number, h: number): void {
    const gw = clamp(w * 0.46, 320, 600);
    const gh = clamp(h * 0.56, 260, 460);
    const gx = w < 940 ? w / 2 - gw / 2 : w - gw - w * 0.07;
    const gy = h * 0.5 - gh * 0.42;
    this.g.setView({ x: gx, y: gy, w: gw, h: gh, qMax: 100, pMax: 110 });
  }
  update(dt: number, _t: number): void {
    this.sweep = lerp(this.sweep, 1, clamp(dt * 2.6, 0, 1));
    this.ctrl = lerp(this.ctrl, this.p.price, clamp(dt * 9, 0, 1));
    this.taxA = lerp(this.taxA, this.p.tax, clamp(dt * 9, 0, 1));
    this.flash = Math.max(0, this.flash - dt * 0.8);
  }

  render(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    const g = this.g;
    const eq = solveEquilibrium(CH3_DEMAND, CH3_SUPPLY);
    g.axes(ctx, 'Quantity', 'Price');
    g.curve(ctx, CH3_DEMAND, palette.buyer, this.sweep, 2.6, 'Demand');
    g.curve(ctx, CH3_SUPPLY, palette.seller, this.sweep, 2.6, 'Supply');

    if (this.sweep < 0.6) return;

    if (this.p.tool === 2) this.renderTax(ctx, eq);
    else this.renderControl(ctx, eq, this.p.tool === 1 ? 'floor' : 'ceiling');

    if (this.p.showEq) g.point(ctx, eq.qtyStar, eq.priceStar, palette.accent, `$${Math.round(eq.priceStar)}`);
  }

  private renderControl(ctx: CanvasRenderingContext2D, eq: ReturnType<typeof solveEquilibrium>, kind: 'ceiling' | 'floor'): void {
    const g = this.g;
    const price = this.ctrl;
    const c = priceControl(CH3_DEMAND, CH3_SUPPLY, { kind, price });
    const o = outcomeAtPrice(CH3_DEMAND, CH3_SUPPLY, price);

    // the control line
    g.hLine(ctx, price, withAlpha(kind === 'ceiling' ? palette.danger : palette.warn, 0.8), false);
    text(ctx, kind === 'ceiling' ? `cap $${Math.round(price)}` : `floor $${Math.round(price)}`,
      g.X(0) + 6, g.Y(price) - 10, { color: kind === 'ceiling' ? palette.danger : palette.warn, size: 12, weight: 700 });

    if (c.binding) {
      // deadweight-loss triangle: from qTraded out to Q*, between demand and supply
      const q = c.qTraded;
      g.region(ctx, [
        [q, priceAtQ(CH3_DEMAND, q)],
        [q, priceAtQ(CH3_SUPPLY, q)],
        [eq.qtyStar, eq.priceStar],
      ], withAlpha(palette.danger, 0.22 + this.flash * 0.3));
      g.vLine(ctx, q, withAlpha(palette.ink, 0.3));
      // shortage / glut marker on the control line
      const label = kind === 'ceiling' ? `shortage ${Math.round(c.shortage)}` : `glut ${Math.round(c.surplus)}`;
      const gapColor = kind === 'ceiling' ? palette.danger : palette.warn;
      text(ctx, label, g.X((o.qd + o.qs) / 2), g.Y(price) - 26, { color: gapColor, size: 12, weight: 700, align: 'center' });
      text(ctx, `deadweight loss ${Math.round(c.deadweightLoss)}`, g.X(eq.qtyStar) + 8, g.Y(eq.priceStar) + 18,
        { color: palette.danger, size: 11, weight: 600 });
    }
  }

  private renderTax(ctx: CanvasRenderingContext2D, eq: ReturnType<typeof solveEquilibrium>): void {
    const g = this.g;
    const tx = applyTax(CH3_DEMAND, CH3_SUPPLY, { perUnit: this.taxA, on: 'seller' });
    const q = tx.qty;

    // revenue rectangle (0..q, between seller and buyer price)
    if (this.taxA > 0.5) {
      g.region(ctx, [
        [0, tx.sellerPrice], [q, tx.sellerPrice], [q, tx.buyerPrice], [0, tx.buyerPrice],
      ], withAlpha(palette.warn, 0.2));
      // deadweight-loss triangle q..Q*
      g.region(ctx, [
        [q, tx.buyerPrice], [q, tx.sellerPrice], [eq.qtyStar, eq.priceStar],
      ], withAlpha(palette.danger, 0.22 + this.flash * 0.3));
      g.vLine(ctx, q, withAlpha(palette.ink, 0.3));
      g.hLine(ctx, tx.buyerPrice, withAlpha(palette.buyer, 0.6));
      g.hLine(ctx, tx.sellerPrice, withAlpha(palette.seller, 0.6));
      text(ctx, `buyers pay $${Math.round(tx.buyerPrice)}`, g.X(0) + 6, g.Y(tx.buyerPrice) - 10, { color: palette.buyer, size: 11, weight: 600 });
      text(ctx, `bakers keep $${Math.round(tx.sellerPrice)}`, g.X(0) + 6, g.Y(tx.sellerPrice) + 12, { color: palette.seller, size: 11, weight: 600 });
      text(ctx, `revenue ${Math.round(tx.taxRevenue)}`, g.X(q / 2), g.Y((tx.buyerPrice + tx.sellerPrice) / 2), { color: palette.warn, size: 12, weight: 700, align: 'center' });
      text(ctx, `deadweight loss ${Math.round(tx.deadweightLoss)}`, g.X(eq.qtyStar) + 8, g.Y(eq.priceStar) + 18, { color: palette.danger, size: 11, weight: 600 });
    }
  }
}
