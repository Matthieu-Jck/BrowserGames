// mountains.test.ts — buildings on the mountains (D44): a wind turbine, a pole, a pylon or a
// beacon may stand on rock — its whole footprint, never astride a cliff; a turbine, like any
// building that needs land, on the claim's parcels (D60) — and the Sough blows on the Crown and
// hardly on the cirque's floor.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { WORLD_EPOCH0 } from './constants';
import { powerLine } from './dev';
import { Sim } from './state';
import { learnPlans } from './testkit';
import { T } from './types';
import { FlatSource, tileIndex } from './world/grid';
import { parcelAt } from './world/land';

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
  return sim;
}

/** The wind factor ‰ the compiled grid gives a turbine (wired). */
const windOf = (sim: Sim, id: number): number | undefined => {
  sim.ensureCompiled();
  for (const n of sim.graph.nets) for (const p of n.producers) if (p.ent === id) return p.local;
  return undefined;
};

describe('the mountains (D44)', () => {
  it('a turbine, a pole, a pylon or a beacon stands on rock; never astride a cliff; a drill never; a turbine on the claim\'s land', () => {
    const sim = mountainSim();
    for (const def of ['wind_flower', 'mast', 'pylon', 'beacon']) expect(sim.canPlace(def, 534, 505, 0).reason, def).toBe('ok');
    expect(sim.canPlace('wind_flower', 533, 505, 0).reason).toBe('uneven'); // half on the floor: not level ground (D45)
    expect(sim.canPlace('drill', 534, 505, 0).reason).toBe('terrain');
    expect(sim.canPlace('kiln', 534, 505, 0).reason).toBe('terrain');
    // Past the starting square the mountain is CrierBelt's: poles and beacons go up, a turbine waits for the parcel.
    sim.explored.push([562, 507, 6]); // surveyed
    expect(sim.canPlace('wind_flower', 560, 505, 0).reason).toBe('outside_zone');
    for (const def of ['mast', 'beacon']) expect(sim.canPlace(def, 560, 505, 0).reason, def).toBe('ok');
    sim.grantCredits(sim.landPrice(parcelAt(560, 505)));
    expect(sim.buyLand(parcelAt(560, 505))).toBe(null);
    expect(sim.canPlace('wind_flower', 560, 505, 0).reason).toBe('ok');
  });

  it('the Sough: a turbine on the Crown gives several times what one down on the cirque floor does, more on harder rock', () => {
    const sim = mountainSim();
    const floor = sim.place('wind_flower', 516, 518, 0), soft = sim.place('wind_flower', 534, 505, 0), hard = sim.place('wind_flower', 540, 505, 0);
    for (const r of [floor, soft, hard]) expect(r.ok, r.reason).toBe(true);
    for (const r of [floor, soft, hard]) { powerLine(sim, r.id!); expect(sim.linksOf(r.id!).length).toBeGreaterThan(0); }
    sim.run(1200); // what stands out of the zone comes by kite
    expect(windOf(sim, floor.id!)).toBe(BAL.windCirque);
    expect(windOf(sim, soft.id!)).toBe(BAL.windRock[0]);
    expect(windOf(sim, hard.id!)).toBe(BAL.windRock[2]);
    expect(BAL.windRock[0]! / BAL.windCirque).toBeGreaterThanOrEqual(5);
  });

  it('rock with a building on it is never marked for digging', () => {
    const sim = mountainSim();
    expect(sim.place('mast', 536, 507, 0).ok).toBe(true);
    expect(sim.designate([tileIndex(536, 507), tileIndex(537, 507)])).toBe(1);
    expect(sim.designated.has(tileIndex(536, 507))).toBe(false);
  });
});
