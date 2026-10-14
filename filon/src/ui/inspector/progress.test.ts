import { describe, it, expect } from 'vitest';
import { smoothProgress } from './kit';

describe('progress bars: smooth between ticks', () => {
  it('advances by the last step per tick, across the time since the tick, and wraps with the next craft', () => {
    const sim = { tick: 0 };
    let v = 0, on = true;
    const prog = smoothProgress(sim, () => ({ v, need: 10_000, on }));
    expect(prog(0)).toBe(0);
    sim.tick = 1; v = 1000;
    expect(prog(1)).toBeCloseTo(0.1);
    expect(prog(1.5)).toBeCloseTo(0.15); // halfway to the next tick
    sim.tick = 3; v = 3000; // two ticks in one frame: the step is per tick
    expect(prog(3.5)).toBeCloseTo(0.35);
    sim.tick = 4; v = 500; // 3000 → 10 000 done, the next craft at 500: a step of 7 500 across the wrap
    expect(prog(4)).toBeCloseTo(0.05);
    expect(prog(4.2)).toBeLessThanOrEqual(1);
  });

  it('stands still when it does not advance (waiting, blocked), and never passes full', () => {
    const sim = { tick: 0 };
    let v = 9800, on = true;
    const prog = smoothProgress(sim, () => ({ v, need: 10_000, on }));
    prog(0);
    sim.tick = 1; v = 9900;
    expect(prog(1.9)).toBeLessThanOrEqual(1);
    on = false; sim.tick = 2;
    expect(prog(2.7)).toBeCloseTo(0.99);
  });
});
