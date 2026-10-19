// mountains.test.ts — buildings on the mountains (D44): a wind turbine, a pole or a pylon may
// stand on rock — its whole footprint, never astride a cliff; a turbine, like any
// building that needs land, on the claim's parcels (D60) — and the Sough blows harder on the rock's
// top than on the flat round it (D95: the wind field, world/wind.test.ts).
import { describe, it, expect } from 'vitest';
import { WORLD_EPOCH0 } from './constants';
import { powerLine } from './dev';
import { Sim } from './state';
import { grantCost, learnPlans } from './testkit';
import { T } from './types';
import { FlatSource, tileIndex } from './world/grid';
import { parcelAt } from './world/land';
import { meanExposure } from './world/wind';

/** A flat base with a block of soft rock east of the Heart (x 534–539), harder rock beyond, and soft rock past the starting square (x 560–563). */
function mountainSim(): Sim {
  const sim = new Sim({
    worldSeed: 7, playerSeed: 11, foundingEpoch: WORLD_EPOCH0 + 24,
    source: new FlatSource([], [{ x: 534, y: 505, w: 6, h: 6, t: T.Rock1, level: 1 }, { x: 540, y: 505, w: 4, h: 4, t: T.Rock3, level: 2 }, { x: 560, y: 505, w: 4, h: 4, t: T.Rock1, level: 1 }]),
  });
  learnPlans(sim);
  sim.done.add('tr4'); // the pylon (research, granted outside the commands)
  sim.rebuildDerived();
  sim.grant('iron_plate', 500); sim.grant('glass', 100); sim.grant('copper_wire', 200); sim.grant('ceramic', 20);
  grantCost(sim, 'pylon', 5); // its price today (D123: steel and cable)
  return sim;
}

/** The exposure ‰ over the days the compiled grid gives a turbine (wired; D95). */
const windOf = (sim: Sim, id: number): number | undefined => {
  sim.ensureCompiled();
  for (const n of sim.graph.nets) for (const p of n.producers) if (p.ent === id) return meanExposure(p.local);
  return undefined;
};

describe('the mountains (D44)', () => {
  it('a turbine, a pole or a pylon stands on rock; never astride a cliff; a drill never; a turbine on the claim\'s land', () => {
    const sim = mountainSim();
    for (const def of ['wind_flower', 'mast', 'pylon']) expect(sim.canPlace(def, 534, 505, 0).reason, def).toBe('ok');
    expect(sim.canPlace('wind_flower', 533, 505, 0).reason).toBe('uneven'); // half on the floor: not level ground (D45)
    expect(sim.canPlace('drill', 534, 505, 0).reason).toBe('terrain');
    expect(sim.canPlace('kiln', 534, 505, 0).reason).toBe('terrain');
    // Past the starting square the mountain is CrierBelt's: poles and pylons go up, a turbine waits for the parcel.
    expect(sim.canPlace('wind_flower', 560, 505, 0).reason).toBe('outside_zone');
    for (const def of ['mast', 'pylon']) expect(sim.canPlace(def, 560, 505, 0).reason, def).toBe('ok');
    sim.grantCredits(sim.landPrice(parcelAt(560, 505)));
    expect(sim.buyLand(parcelAt(560, 505))).toBe(null);
    expect(sim.canPlace('wind_flower', 560, 505, 0).reason).toBe('ok');
  });

  it('the Sough: a turbine on the rock\'s top catches more wind than one on the flat round it, the highest rock most', () => {
    const sim = mountainSim();
    const floor = sim.place('wind_flower', 516, 518, 0), hard = sim.place('wind_flower', 540, 505, 0);
    for (const r of [floor, hard]) expect(r.ok, r.reason).toBe(true);
    for (const r of [floor, hard]) { powerLine(sim, r.id!); expect(sim.linksOf(r.id!).length).toBeGreaterThan(0); }
    sim.run(1200); // what stands out of the zone comes by kite
    expect(windOf(sim, hard.id!)!).toBeGreaterThan(windOf(sim, floor.id!)! + 300);
  });

  it('rock with a building on it is never marked for digging', () => {
    const sim = mountainSim();
    expect(sim.place('mast', 536, 507, 0).ok).toBe(true);
    expect(sim.designate([tileIndex(536, 507), tileIndex(537, 507)])).toBe(1);
    expect(sim.designated.has(tileIndex(536, 507))).toBe(false);
  });
});
