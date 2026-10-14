// scene-fishery.ts — Chapter 5. A living sea of fish whose number tracks the stock, over
// a stock-vs-time line. Overfish and the shoal visibly thins to nothing and the water
// goes red: COLLAPSED. Restrain it and the shoal holds steady.
import type { Scene } from './scene';
import type { Severity } from '@/core/kinds';
import type { FisheryRun } from '@/econ/types';
import { simulateFishery } from '@/econ/fishery';
import { glowDot, line, text } from './draw';
import { palette, withAlpha } from './palette';
import { clamp } from '@/core/math';
import { makeRng } from '@/core/rng';

const CAP = 1000;
const R = 0.4;
const SEASONS = 50;
const MAX_FISH = 90;

interface Fish { x: number; y: number; ph: number; sp: number; }

export class FisheryScene implements Scene {
  readonly id = 'fishery' as const;
  private p = { boats: 16, quota: 100, policy: 0, revealRun: 0 };
  private sea = { x: 0, y: 0, w: 10, h: 10 };
  private chart = { x: 0, y: 0, w: 10, h: 10 };
  private run!: FisheryRun;
  private fish: Fish[] = [];
  private seasonF = 0;
  private flash = 0;

  constructor() { this.fishLayout(); this.rebuild(); }

  setParam(key: string, value: number): void {
    if (key in this.p) {
      const prev = (this.p as Record<string, number>)[key];
      (this.p as Record<string, number>)[key] = value;
      if (prev !== value) this.rebuild();
    }
  }
  reveal(): void { if (this.p.revealRun) this.seasonF = 0; }
  showVerdict(severity: Severity): void { this.flash = severity === 'catastrophic' || severity === 'wrong' ? 1 : 0.3; }
  runToCompletion(): void { this.seasonF = SEASONS; }
  result(): unknown { return this.run; }

  private rebuild(): void {
    this.run = simulateFishery({
      capacity: CAP, growthRate: R, initialStock: CAP, seasons: SEASONS,
      boats: Math.round(this.p.boats), catchPerBoat: 10,
      policy: this.p.policy ? 'quota' : 'open', quota: this.p.quota,
    });
    this.seasonF = this.p.revealRun ? 0 : SEASONS; // narrate beats show the steady full sea
  }

  private fishLayout(): void {
    const rng = makeRng('shoal');
    this.fish = [];
    for (let i = 0; i < MAX_FISH; i++) {
      this.fish.push({ x: rng.next(), y: rng.next(), ph: rng.range(0, 6.28), sp: rng.range(0.3, 1) });
    }
  }

  resize(w: number, h: number): void {
    const bw = clamp(w * 0.5, 340, 660);
    const bx = w < 940 ? w / 2 - bw / 2 : w - bw - w * 0.06;
    const top = h * 0.16;
    const seaH = h * 0.42;
    this.sea = { x: bx, y: top, w: bw, h: seaH };
    this.chart = { x: bx, y: top + seaH + 46, w: bw, h: h * 0.2 };
  }

  update(dt: number, t: number): void {
    this.flash = Math.max(0, this.flash - dt * 0.7);
    if (this.p.revealRun && this.seasonF < SEASONS) this.seasonF = Math.min(SEASONS, this.seasonF + dt * 10);
    for (const f of this.fish) { f.x += Math.sin(t * f.sp + f.ph) * 0.0006; }
  }

  private stockAt(season: number): number {
    return this.run.stockPerSeason[Math.min(SEASONS, Math.max(0, season))] ?? 0;
  }

  render(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    const season = Math.round(this.seasonF);
    const stock = this.stockAt(season);
    const frac = clamp(stock / CAP, 0, 1);
    const collapsed = this.run.collapsed && this.run.collapseSeason !== null && season >= this.run.collapseSeason;

    // --- the sea ---
    const s = this.sea;
    ctx.save();
    ctx.fillStyle = withAlpha(collapsed ? palette.danger : palette.accent, 0.05);
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.globalCompositeOperation = 'lighter';
    const shown = Math.round(frac * MAX_FISH);
    for (let i = 0; i < shown; i++) {
      const f = this.fish[i]!;
      const px = s.x + ((f.x + i * 0.013) % 1) * s.w;
      const py = s.y + f.y * s.h;
      glowDot(ctx, px, py, 5, collapsed ? palette.danger : palette.accent, 0.55);
    }
    ctx.restore();

    text(ctx, `${Math.round(stock)} fish`, s.x + s.w / 2, s.y - 14,
      { color: collapsed ? palette.danger : palette.accent, size: 22, weight: 700, align: 'center', font: 'Space Grotesk, sans-serif' });
    if (collapsed) {
      text(ctx, `COLLAPSED — year ${this.run.collapseSeason}`, s.x + s.w / 2, s.y + s.h / 2,
        { color: palette.danger, size: 26, weight: 700, align: 'center', font: 'Space Grotesk, sans-serif' });
    }

    // --- stock over time ---
    this.chartView(ctx, season);
  }

  private chartView(ctx: CanvasRenderingContext2D, season: number): void {
    const c = this.chart;
    const xOf = (i: number) => c.x + (i / SEASONS) * c.w;
    const yOf = (v: number) => c.y + c.h - (v / CAP) * c.h;

    line(ctx, c.x, c.y + c.h, c.x + c.w, c.y + c.h, palette.faint, 1.2);
    line(ctx, c.x, c.y, c.x, c.y + c.h, palette.faint, 1.2);
    // K/2 = the most productive level
    line(ctx, c.x, yOf(CAP / 2), c.x + c.w, yOf(CAP / 2), withAlpha(palette.ink, 0.2), 1);
    text(ctx, 'most productive level', c.x + c.w, yOf(CAP / 2) - 8, { color: palette.dim, size: 10, align: 'right' });

    const upto = Math.max(0, season);
    ctx.strokeStyle = this.run.collapsed ? palette.danger : palette.accent;
    ctx.lineWidth = 2 + this.flash * 2;
    ctx.beginPath();
    for (let i = 0; i <= upto; i++) {
      const px = xOf(i), py = yOf(this.stockAt(i));
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    text(ctx, `season ${season} / ${SEASONS}`, c.x, c.y + c.h + 16, { color: palette.dim, size: 11 });
  }
}
