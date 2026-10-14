import { describe, it, expect } from 'vitest';
import { simulateFishery, maxSustainableYield } from './fishery';
import type { FisheryConfig } from './types';

const base: Omit<FisheryConfig, 'policy' | 'boats' | 'catchPerBoat'> = {
  capacity: 1000,
  growthRate: 0.4,
  initialStock: 1000,
  seasons: 60,
};
const MSY = maxSustainableYield(base.growthRate, base.capacity); // 0.4·1000/4 = 100

describe('fishery dynamics', () => {
  it('MSY = rK/4', () => {
    expect(MSY).toBeCloseTo(100, 6);
  });

  it('harvesting above MSY collapses the stock', () => {
    const run = simulateFishery({
      ...base, policy: 'open', boats: 13, catchPerBoat: 10, // 130 > 100
    });
    expect(run.collapsed).toBe(true);
    expect(run.collapseSeason).not.toBeNull();
    expect(run.finalStock).toBeLessThan(0.05 * base.capacity);
  });

  it('harvesting below MSY is sustainable', () => {
    const run = simulateFishery({
      ...base, policy: 'quota', boats: 13, catchPerBoat: 10, quota: 0.85 * MSY,
    });
    expect(run.collapsed).toBe(false);
    expect(run.finalStock).toBeGreaterThan(0.2 * base.capacity);
  });

  it('the tragedy collapses while a quota survives — same fleet', () => {
    const fleet = { boats: 13, catchPerBoat: 10 };
    const tragedy = simulateFishery({ ...base, ...fleet, policy: 'open' });
    const quota = simulateFishery({ ...base, ...fleet, policy: 'quota', quota: 0.85 * MSY });
    expect(tragedy.collapsed).toBe(true);
    expect(quota.collapsed).toBe(false);
  });

  it('keeps the stock within [0, K] every season', () => {
    const run = simulateFishery({ ...base, policy: 'open', boats: 20, catchPerBoat: 10 });
    for (const s of run.stockPerSeason) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(base.capacity + 1e-9);
    }
  });
});
