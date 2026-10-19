// drills-d150.test.ts — D150: on the same tiles, a better drill never extracts less. A drill's rate
// is min(its rating, the tiles' caps × its `capMult`); the fast drill had no `capMult`, so on a poor
// deposit both read the deposit's cap and a fast drill on poorer tiles showed less than a drill
// beside it (owner, 2026-10-19: « the fast drill says 1.75/min and the normal says 2/min lol »).
import { describe, it, expect } from 'vitest';
import { buildingIdx, itemIdx } from '@/content/registry';
import { drillRate } from './graph/compile';
import type { Grid } from './world/grid';
import type { Ent } from './types';
import { testSim } from './testkit';

const rateOn = (def: string, tileMu: number): number => {
  const ore = itemIdx('iron_ore');
  const grid = { ore: () => ore, capMuPerEpoch: () => tileMu } as unknown as Grid;
  const e = { id: 1, def: buildingIdx(def), x: 500, y: 500, rot: 0, cfg: 0, builtAt: 0 } as Ent;
  return drillRate(grid, e, testSim().mods).rateEp;
};

describe('a better drill never extracts less from the same tiles (D150)', () => {
  it('the fast drill draws at least what a drill draws on every richness, and more where the deposit is the limit', () => {
    for (let tile = 50; tile <= 12000; tile += 130) {
      const drill = rateOn('drill', tile), fast = rateOn('fast_drill', tile);
      expect(fast, `tile ${tile} mu/epoch`).toBeGreaterThanOrEqual(drill);
      if (drill < 20000 && drill >= 500) expect(fast, `tile ${tile} mu/epoch`).toBeGreaterThan(drill);
    }
  });

  it('on rich tiles each reaches its own rating: 20 and 35 a minute', () => {
    expect(rateOn('drill', 20000)).toBe(20000);
    expect(rateOn('fast_drill', 20000)).toBe(35000);
  });
});
