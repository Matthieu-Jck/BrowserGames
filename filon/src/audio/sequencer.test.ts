import { describe, it, expect } from 'vitest';
import { Sequencer, type Tick } from './sequencer';

/** Drive a sequencer with frames `dt` apart for `seconds`, collecting every tick. */
function drive(seq: Sequencer, frames: number[], stepDur: (now: number) => number): Tick[] {
  const out: Tick[] = [];
  for (const now of frames) seq.due(now, stepDur(now), out);
  return out;
}

describe('audio sequencer', () => {
  it('steps fall exactly on the grid, each once, however irregular the frames', () => {
    const seq = new Sequencer(0.3, 0.05);
    const frames: number[] = [];
    let t = 1;
    for (let k = 0; k < 2000; k++) { frames.push(t); t += 0.008 + ((k * 37) % 23) / 1000; } // 8–30 ms frames
    const ticks = drive(seq, frames, () => 0.5);
    expect(ticks[0]!.t).toBeCloseTo(1.05, 9);
    ticks.forEach((tk, k) => {
      expect(tk.i).toBe(k);
      expect(tk.t).toBeCloseTo(1.05 + 0.5 * k, 6);
    });
  });

  it('a step is handed out before its time, within the look-ahead, never after it passed', () => {
    const seq = new Sequencer(0.25, 0.05);
    for (let now = 0; now < 30; now += 1 / 60) {
      for (const tk of seq.due(now, 0.4)) {
        expect(tk.t).toBeGreaterThanOrEqual(now);
        expect(tk.t).toBeLessThan(now + 0.25);
      }
    }
  });

  it('a tempo change takes effect from the next step', () => {
    const seq = new Sequencer(0.2, 0);
    const ticks: Tick[] = [];
    for (let now = 0; now < 10; now += 0.01) seq.due(now, now < 5 ? 0.5 : 0.25, ticks);
    for (let k = 1; k < ticks.length; k++) {
      const d = ticks[k]!.t - ticks[k - 1]!.t;
      expect([0.5, 0.25].some((x) => Math.abs(d - x) < 1e-9), `gap ${d}`).toBe(true);
    }
    expect(ticks.filter((tk) => tk.t > 6).every((tk, k, a) => k === 0 || Math.abs(tk.t - a[k - 1]!.t - 0.25) < 1e-9)).toBe(true);
  });

  it('after a long stall it skips the missed steps (counted, not played late) and keeps the bar lines', () => {
    const seq = new Sequencer(0.3, 0);
    const first = seq.due(0, 0.5);
    expect(first.map((t) => t.i)).toEqual([0]);
    const after = seq.due(7.3, 0.5); // 7 s of silence (a hitch, a hidden tab)
    expect(after[0]!.t).toBeGreaterThanOrEqual(7.3);
    expect(after[0]!.t).toBeCloseTo(7.5, 9); // still on the 0.5 s grid
    expect(after[0]!.i).toBe(15); // the step count went on: bars stay aligned
  });

  it('reset starts a fresh grid', () => {
    const seq = new Sequencer(0.3, 0.1);
    seq.due(5, 0.5);
    seq.reset();
    const t = seq.due(20, 0.5);
    expect(t[0]).toEqual({ i: 0, t: 20.1 });
  });
});
