// scene-auction.ts — Chapter 2. The double auction, made visible. Buyers and sellers are
// motes placed at their secret reservation prices; as the seeded auction runs round by
// round, the clearing price line slides and settles onto the equilibrium, while an inset
// traces the running mean converging. No central mover — the crowd finds the price.
import type { Scene } from './scene';
import type { Severity } from '@/core/kinds';
import type { AuctionResult } from '@/econ/types';
import { runDoubleAuction } from '@/econ/auction';
import { makeDemand } from '@/econ/curves';
import { CH2_DEMAND, CH2_SUPPLY } from '@/content/chapter2';
import { glowDot, line, text } from './draw';
import { palette, withAlpha } from './palette';
import { clamp, lerp } from '@/core/math';
import { makeRng } from '@/core/rng';

interface Dot { x: number; baseY: number; price: number; role: 0 | 1; ph: number; }

const P_LO = 0;
const P_HI = 150;
const ROUNDS = 60;

export class SupplyAuctionScene implements Scene {
  readonly id = 'auction' as const;
  private p = { revealRun: 0, buyers: 140, shock: 0 };
  private box = { x: 0, y: 0, w: 10, h: 10 };
  private res!: AuctionResult;
  private dots: Dot[] = [];
  private roundF = 0; // fractional round cursor
  private priceY = 0;
  private flash = 0;
  private verdictFlash = 0;
  private built = false;

  constructor() { this.rebuild(); }

  setParam(key: string, value: number): void {
    if (key in this.p) {
      const prev = (this.p as Record<string, number>)[key];
      (this.p as Record<string, number>)[key] = value;
      if ((key === 'buyers' || key === 'shock') && prev !== value) this.rebuild();
      if (key === 'revealRun' && value > 0) this.roundF = 0;
    }
  }

  private rebuild(): void {
    const demand = makeDemand(CH2_DEMAND.intercept + this.p.shock, Math.abs(CH2_DEMAND.slope));
    const n = Math.round(this.p.buyers);
    this.res = runDoubleAuction({ seed: 'agora-ch2', demand, supply: CH2_SUPPLY, buyers: n, sellers: n, rounds: ROUNDS });
    const rng = makeRng(`layout-${n}-${this.p.shock}`);
    this.dots = [];
    this.res.values.forEach((v) => this.dots.push({ x: rng.range(0.04, 0.44), baseY: v, price: v, role: 0, ph: rng.range(0, 6.28) }));
    this.res.costs.forEach((c) => this.dots.push({ x: rng.range(0.56, 0.96), baseY: c, price: c, role: 1, ph: rng.range(0, 6.28) }));
    this.roundF = this.p.revealRun ? 0 : -1;
    this.built = true;
  }

  reveal(): void { if (this.p.revealRun) this.roundF = 0; }

  showVerdict(severity: Severity): void {
    this.verdictFlash = severity === 'catastrophic' || severity === 'wrong' ? 1 : severity === 'close' ? 0.4 : 0.15;
  }

  runToCompletion(): void { this.roundF = ROUNDS - 1; }
  result(): unknown { return this.res; }

  resize(w: number, h: number): void {
    const bw = clamp(w * 0.5, 340, 680);
    const bh = clamp(h * 0.62, 300, 520);
    const bx = w < 940 ? w / 2 - bw / 2 : w - bw - w * 0.06;
    const by = h * 0.5 - bh * 0.46;
    this.box = { x: bx, y: by, w: bw, h: bh };
  }

  private Y(price: number): number {
    const { y, h } = this.box;
    return y + h - ((clamp(price, P_LO, P_HI) - P_LO) / (P_HI - P_LO)) * h;
  }

  update(dt: number, _t: number): void {
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.verdictFlash = Math.max(0, this.verdictFlash - dt * 0.7);
    if (this.p.revealRun && this.roundF >= 0 && this.roundF < ROUNDS - 1) {
      const before = Math.floor(this.roundF);
      this.roundF = Math.min(ROUNDS - 1, this.roundF + dt * 14);
      if (Math.floor(this.roundF) !== before) this.flash = 1;
    }
    const target = this.roundF >= 0
      ? this.Y(this.res.pricePerRound[Math.min(ROUNDS - 1, Math.round(this.roundF))] ?? this.res.equilibrium.priceStar)
      : this.Y(this.res.equilibrium.priceStar);
    this.priceY = this.priceY === 0 ? target : lerp(this.priceY, target, clamp(dt * 6, 0, 1));
  }

  render(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    if (!this.built) return;
    const { x, w } = this.box;
    const round = Math.round(this.roundF);
    const curPrice = this.roundF >= 0 ? (this.res.pricePerRound[Math.min(ROUNDS - 1, round)] ?? 0) : 0;

    // motes at their secret reservation prices
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const d of this.dots) {
      const px = x + d.x * w + Math.sin(d.ph) * 3;
      const py = this.Y(d.baseY);
      const inMoney = this.roundF >= 0 &&
        ((d.role === 0 && d.price >= curPrice) || (d.role === 1 && d.price <= curPrice));
      const a = inMoney ? 0.5 + this.flash * 0.4 : 0.16;
      glowDot(ctx, px, py, inMoney ? 7 : 5, d.role === 0 ? palette.buyer : palette.seller, a);
    }
    ctx.restore();

    // equilibrium reference + the live clearing price
    const eqY = this.Y(this.res.equilibrium.priceStar);
    ctx.save();
    ctx.setLineDash([4, 5]);
    line(ctx, x, eqY, x + w, eqY, withAlpha(palette.ink, 0.28), 1.2);
    ctx.restore();
    text(ctx, `equilibrium $${Math.round(this.res.equilibrium.priceStar)}`, x + w, eqY - 10, { color: palette.dim, size: 11, align: 'right' });

    if (this.roundF >= 0) {
      const flareW = 2.4 + this.verdictFlash * 5;
      line(ctx, x, this.priceY, x + w, this.priceY, withAlpha(palette.accent, 0.9), flareW);
      text(ctx, `$${Math.round(curPrice)}`, x + w / 2, this.priceY - 14,
        { color: palette.accent, size: 20, weight: 700, align: 'center', font: 'Space Grotesk, sans-serif' });
      text(ctx, `round ${round + 1} / ${ROUNDS}`, x, this.box.y + this.box.h + 18, { color: palette.dim, size: 11 });
      this.trace(ctx);
    }
  }

  /** Small inset: the running mean homing onto equilibrium. */
  private trace(ctx: CanvasRenderingContext2D): void {
    const tw = this.box.w * 0.42, th = 64;
    const tx = this.box.x, ty = this.box.y - th - 14;
    const upto = Math.max(1, Math.round(this.roundF));
    const eqP = this.res.equilibrium.priceStar;
    const yOf = (p: number) => ty + th - (clamp(p, eqP * 0.4, eqP * 1.7) - eqP * 0.4) / (eqP * 1.3) * th;
    line(ctx, tx, yOf(eqP), tx + tw, yOf(eqP), withAlpha(palette.ink, 0.25), 1);
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i <= upto; i++) {
      const px = tx + (tw * i) / (ROUNDS - 1);
      const py = yOf(this.res.runningMean[i] ?? eqP);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    text(ctx, 'average price', tx, ty - 8, { color: palette.dim, size: 10 });
  }
}
