// wind-spacing.test.ts — wind turbines a turbine's room apart (D132; owner, 2026-10-18: « on ne
// devrait pas pouvoir placer autant d'éoliennes aussi proches les unes des autres. Et leur
// production devrait encore être réduite un peu »): a turbine is refused closer than
// `BAL.wind.spacing` tiles, middle to middle, to another one; one laid over a turbine to replace it
// is not; the ratings lowered again (below D116's).
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { BUILDINGS } from '@/content/buildings';
import { grantCost, testSim } from './testkit';

describe('wind turbines a turbine’s room apart (D132)', () => {
  it('refuses a turbine closer than the spacing to another, middle to middle, straight or diagonal; takes one at the spacing', () => {
    const sim = testSim(), S = BAL.wind.spacing;
    grantCost(sim, 'wind_flower', 6);
    expect(S).toBe(6);
    const a = sim.place('wind_flower', 520, 500, 0);
    expect(a.ok, a.reason).toBe(true);
    expect(sim.canPlace('wind_flower', 520 + S - 1, 500, 0).reason).toBe('wind_spacing');
    expect(sim.canPlace('wind_flower', 524, 504, 0).reason).toBe('wind_spacing'); // 4, 4 off: 5.7 tiles
    expect(sim.canPlace('wind_flower', 520, 500 - S - 1, 0).ok).toBe(true);
    const b = sim.place('wind_flower', 520 + S, 500, 0);
    expect(b.ok, b.reason).toBe(true);
  });

  it('a pitch-control turbine laid over a wind turbine replaces it, the spacing aside', () => {
    const sim = testSim();
    sim.done.add('en_pitch'); sim.rebuildDerived(); // its plan is a research node's
    grantCost(sim, 'wind_flower', 2);
    grantCost(sim, 'pitch_turbine', 1);
    const a = sim.place('wind_flower', 520, 500, 0);
    expect(a.ok, a.reason).toBe(true);
    const p = sim.place('pitch_turbine', 520, 500, 0);
    expect(p.ok, p.reason).toBe(true);
    expect(p.replaces).toEqual([a.id]);
  });

  it('their ratings below D116’s: a wind turbine 130 kW, the pitch-control turbine 180 kW', () => {
    expect(BUILDINGS.wind_flower.gen.kw).toBe(130);
    expect(BUILDINGS.pitch_turbine.gen.kw).toBe(180);
  });
});
