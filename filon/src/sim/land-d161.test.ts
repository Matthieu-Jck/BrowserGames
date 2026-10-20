// land-d161.test.ts — D161 (owner, 2026-10-19: « you should be able to buy parcels that are not
// connected to your base from Tier 1. Parcels should also be a bit more expensive »): Far Claim is a
// Tier 1 node, and a far parcel bought at Tier 1 is usable with Tier 1's means — a turbine on it, no
// kite delay, and the plain ribbon and pole across the free land between; every parcel 30 % dearer.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { DEPTH_COST, RESEARCH } from '@/content/research';
import { CENTER } from './constants';
import { grantCost, testSim } from './testkit';
import { PARCEL, parcelAt } from './world/land';

describe('land at Tier 1 (D161)', () => {
  it('Far Claim is a Tier 1 node: Tier 1 tokens, resources a Tier 1 base makes', () => {
    const r = RESEARCH.xp_far;
    expect(r.tier).toBe(1);
    expect(r.tokens).toBe(DEPTH_COST[2]!.tokens);
    expect(r.cost.map(([it]) => it).sort()).toEqual(['copper_wire', 'iron_plate']);
  });

  it('a far parcel bought at Tier 1 takes a turbine at once; ribbons and poles reach it across free land', () => {
    const sim = testSim();
    // Three parcels east of the starting square's edge: it touches nothing the claim holds.
    const far = parcelAt(CENTER + 4 * PARCEL, CENTER);
    expect(sim.land.touches(far)).toBe(false);
    sim.grantCredits(sim.landPrice(far));
    expect(sim.buyLand(far)).toBe('far');
    sim.done.add('xp_guard');
    sim.done.add('xp_far');
    sim.rebuildDerived();
    expect(sim.hearthLevel).toBeLessThan(BAL.tierCoreLevel[1]!); // still Tier 1
    expect(sim.buyLand(far)).toBeNull();
    // A turbine on it: its land, so no kite delay.
    grantCost(sim, 'wind_flower');
    const t = sim.canPlace('wind_flower', CENTER + 4 * PARCEL - 1, CENTER - 1, 0);
    expect(t.reason).toBe('ok');
    expect(t.delay).toBe(0);
    // Between it and the claim's land: free land, open to the plain ribbon and the pole (by kite).
    const x = CENTER + 3 * PARCEL, y = CENTER;
    expect(sim.land.covers(x, y)).toBe(false);
    for (const def of ['ribbon', 'mast'] as const) {
      grantCost(sim, def);
      const c = sim.canPlace(def, x, y, 0);
      expect(c.reason, def).toBe('ok');
      expect(c.delay, def).toBeGreaterThan(0);
    }
  });

  it('a bare parcel costs 30 % more than before D161; its rent and resale follow', () => {
    const sim = testSim();
    const east = parcelAt(CENTER + 2 * PARCEL, CENTER);
    const old = 20_000 + PARCEL * PARCEL * 60;
    expect(sim.landPrice(east)).toBe(Math.floor((old * 13) / 10));
    expect(sim.landRent(east)).toBe(Math.floor((sim.landPrice(east) * BAL.land.rentPermille) / 1000));
    sim.grantCredits(sim.landPrice(east));
    expect(sim.buyLand(east)).toBeNull();
    // The market price, the parcel itself out of the growth (D119), less the Cadastre's tax.
    expect(sim.resalePrice(east)).toBe(Math.floor((Math.floor((old * 13) / 10) * (1000 - BAL.landResaleTax)) / 1000));
    expect(sim.buyLand(parcelAt(CENTER, CENTER))).toBe('held'); // the starting square is never sold
  });
});
