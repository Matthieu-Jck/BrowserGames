// stats.ts — the statistics recorder: samples the engine's cumulative production and
// consumption counters (and the grids' power) once per second for ten minutes and once per
// minute for ten hours, so the stats screen can show rates over 1 min / 10 min / 1 h / 10 h.
// Kept by the shell, not the engine (an absence is summarised by the catch-up report).
import { N_ITEMS } from '@/content/registry';
import type { Sim } from '@/sim/state';

export interface Sample { t: number; prod: Float64Array; cons: Float64Array; demand: number; supply: number }
export type StatWindow = '1m' | '10m' | '1h' | '10h';
export const WINDOWS: Record<StatWindow, { sec: number; fine: boolean }> = {
  '1m': { sec: 60, fine: true }, '10m': { sec: 600, fine: true }, '1h': { sec: 3600, fine: false }, '10h': { sec: 36000, fine: false },
};

export class StatsRecorder {
  /** One sample per game second (last 10 min) and per game minute (last 10 h). */
  readonly fine: Sample[] = [];
  readonly coarse: Sample[] = [];
  private lastSec = -1;

  /** Call every frame; samples when the game second changes. */
  sample(sim: Sim): void {
    const sec = Math.floor(sim.tick / 10);
    if (sec === this.lastSec) return;
    this.lastSec = sec;
    let demand = 0, supply = 0;
    for (const n of sim.netPower) { if (!n) continue; demand += n.demand; supply += n.renew + n.fuel; }
    const s: Sample = { t: sec, prod: Float64Array.from(sim.produced), cons: Float64Array.from(sim.consumed), demand, supply };
    this.fine.push(s);
    if (this.fine.length > 601) this.fine.shift();
    if (sec % 60 === 0 || !this.coarse.length) {
      this.coarse.push(s);
      if (this.coarse.length > 601) this.coarse.shift();
    }
  }

  /** Samples covering a window, oldest first (empty until two exist). */
  series(w: StatWindow): Sample[] {
    const { sec, fine } = WINDOWS[w];
    const src = fine ? this.fine : this.coarse;
    if (src.length < 2) return [];
    const last = src[src.length - 1]!.t;
    return src.filter((s) => s.t >= last - sec);
  }

  /** Per item: produced and consumed per minute over a window. */
  rates(w: StatWindow): { made: Float64Array; used: Float64Array; span: number } {
    const ser = this.series(w);
    const made = new Float64Array(N_ITEMS), used = new Float64Array(N_ITEMS);
    if (ser.length < 2) return { made, used, span: 0 };
    const a = ser[0]!, b = ser[ser.length - 1]!;
    const span = b.t - a.t;
    for (let i = 0; i < N_ITEMS; i++) {
      made[i] = ((b.prod[i]! - a.prod[i]!) / 1000) * (60 / span);
      used[i] = ((b.cons[i]! - a.cons[i]!) / 1000) * (60 / span);
    }
    return { made, used, span };
  }
}
