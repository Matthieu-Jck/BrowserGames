// land-resale.test.ts — selling a parcel back (D119): always available, at the market price less the
// Ring Cadastre's tax; Parcel Resale (`xp_resell`) is gone from the tree and from saves; Far Claim is Tier 2.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { RESEARCH } from '@/content/research';
import { CENTER } from './constants';
import { deserialize, serialize } from './serialize';
import { landPrice } from './systems/land';
import { testSim, testSource } from './testkit';
import { PARCEL, parcelAt } from './world/land';

const EAST = parcelAt(CENTER + 2 * PARCEL, CENTER), NORTH = parcelAt(CENTER, CENTER - 2 * PARCEL);

describe('land resale (D119)', () => {
  it('needs no research and pays the market price less the tax, which follows the land growth', () => {
    const sim = testSim();
    sim.grantCredits(1_000_000);
    expect(sim.sellBlock(EAST)).toBe('not_bought');
    expect(sim.buyLand(EAST)).toBeNull();
    expect(sim.sellBlock(EAST)).toBeNull();
    // Another purchase makes every parcel dearer: the sale sees the market, not what was paid.
    const paid = sim.land.paid.get(EAST)!;
    expect(sim.buyLand(NORTH)).toBeNull();
    const market = landPrice(sim, EAST, sim.land.bought.size - 1);
    expect(market).toBeGreaterThan(paid);
    expect(sim.resalePrice(EAST)).toBe(Math.floor((market * (1000 - BAL.landResaleTax)) / 1000));
    const before = sim.credits;
    expect(sim.sellLand(EAST)).toBeNull();
    expect(sim.credits - before).toBe(Math.floor((market * 800) / 1000));
    expect(sim.land.bought.has(EAST)).toBe(false);
  });

  it('Parcel Resale is retired: a save holding it loads, forgetting it', () => {
    const sim = testSim();
    sim.done.add('xp_resell');
    const back = deserialize(JSON.parse(JSON.stringify(serialize(sim))), testSource());
    expect(back.done.has('xp_resell')).toBe(false);
    expect('xp_resell' in RESEARCH).toBe(false);
    expect(RESEARCH.xp_treaties.prereq).toContain('xp4');
  });

  it('Far Claim is a Tier 2 node of Logistique', () => {
    expect(RESEARCH.xp_far.tier).toBe(2);
    expect(RESEARCH.xp_far.prereq).toContain('xp_camo');
  });
});
