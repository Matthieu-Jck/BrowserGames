// moving-parts.test.ts — how fast moving parts turn: turbines with the wind they see (bounded,
// faster in a stronger wind, a mesa or a ridge outspinning the sheltered cirque), machines only
// while they work; each building's own start phase and speed factor, stable and in range.
import { describe, it, expect } from 'vitest';
import { St } from '@/sim/types';
import { GUST_LEVELS } from '@/sim/constants';
import { BAL } from '@/content/balance';
import { IDLE_TURNS, WORK_TURNS, spinSeed, windTurns, workTurns } from './moving-parts';

describe('moving parts: speeds', () => {
  it('a turbine turns faster in a stronger wind, within bounds, and faster than an idle one', () => {
    let prev = 0;
    for (const gust of GUST_LEVELS) {
      const v = windTurns(700, gust); // the sheltered cirque
      expect(v).toBeGreaterThan(prev);
      expect(v).toBeGreaterThan(IDLE_TURNS);
      prev = v;
    }
    for (const local of [700, 1000, 1600, 2000]) for (const gust of GUST_LEVELS) {
      const v = windTurns(local, gust);
      expect(v).toBeGreaterThanOrEqual(0.1);
      expect(v).toBeLessThanOrEqual(0.75);
    }
    expect(windTurns(1600, 1000)).toBeGreaterThan(windTurns(700, 1000)); // a mesa outspins the cirque
  });

  it('a turbine on the mountains outspins one on the cirque floor, in any gust (D44)', () => {
    for (const gust of GUST_LEVELS) {
      const floor = windTurns(BAL.windCirque, gust);
      for (const ridge of BAL.windHeight) expect(windTurns(ridge, gust)).toBeGreaterThan(floor * 2);
    }
  });

  it('a machine turns only while it works, slower on a short grid', () => {
    expect(workTurns(St.Ok, 1000)).toBeCloseTo(WORK_TURNS, 9);
    expect(workTurns(St.LowPower, 500)).toBeCloseTo(WORK_TURNS / 2, 9);
    for (const st of [St.Starved, St.Blocked, St.Unpowered, St.NoJob, St.Idle, St.NoFuel]) expect(workTurns(st, 1000)).toBe(0);
  });

  it('each building has its own start phase and speed factor, stable and in range', () => {
    const seen = new Set<number>();
    for (let id = 1; id < 200; id++) {
      const a = spinSeed(id), b = spinSeed(id);
      expect(a).toEqual(b);
      expect(a.phase).toBeGreaterThanOrEqual(0);
      expect(a.phase).toBeLessThan(1);
      expect(a.vary).toBeGreaterThanOrEqual(0.92);
      expect(a.vary).toBeLessThanOrEqual(1.08);
      seen.add(Math.floor(a.phase * 16));
    }
    expect(seen.size).toBe(16); // phases spread over the whole period
  });
});
