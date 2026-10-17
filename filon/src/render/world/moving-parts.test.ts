// moving-parts.test.ts — how fast moving parts turn: turbines with the wind they see (bounded,
// faster in a stronger wind, a crest outspinning the sheltered cirque, D95), machines only
// while they work; each building's own start phase and speed factor, stable and in range.
import { describe, it, expect } from 'vitest';
import { St } from '@/sim/types';
import { WORK_TURNS, spinSeed, windTurns, workTurns } from './moving-parts';

describe('moving parts: speeds', () => {
  it('a turbine turns faster in a stronger wind, within bounds; barely below its cut-in, braked at its cut-out (D95)', () => {
    let prev = 0;
    for (let wind = 400; wind <= 3000; wind += 200) {
      const v = windTurns(wind, 400, 3600);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0.1);
      expect(v).toBeLessThanOrEqual(0.75);
      prev = v;
    }
    expect(windTurns(399, 400, 3600)).toBeLessThan(windTurns(400, 400, 3600) / 2);
    expect(windTurns(399, 400, 3600)).toBeGreaterThan(0);
    expect(windTurns(3600, 400, 3600)).toBe(0);
    expect(windTurns(2000, 300)).toBeGreaterThan(windTurns(600, 300) * 2); // a crest outspins the cirque
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
