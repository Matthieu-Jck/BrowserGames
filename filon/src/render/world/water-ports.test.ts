// water-ports.test.ts — where the water meets the buildings, as the views read it (D142): the
// entrance a water drinker's pipework is drawn on follows the conduit that really waters it (the
// engine lets either entrance drink, D114), and a conduit couples to the ports it meets, at the
// pump's outlet and at the drinker's entrance, not elsewhere.
import { describe, it, expect } from 'vitest';
import { WORLD_EPOCH0 } from '@/sim/constants';
import { Sim } from '@/sim/state';
import { learnPlans, stockedSilo, testSource } from '@/sim/testkit';
import { T, type Rot } from '@/sim/types';
import { FlatSource, tileIndex } from '@/sim/world/grid';
import { couplingSides, wetEntranceOf } from './water-ports';

/** A pond east of the Heart (the steam boiler test's): where the pump stands. */
const POND = { x: 522, y: 502, w: 4, h: 6, t: T.Shallow } as const;

/**
 * A steam boiler at (516, 505) turned 0 — its coal intake (entrance 0) at (516, 506), its own water
 * intake (entrance 1) at (518, 506), both facing south — and a pump on the pond's shore at (521, 507),
 * its outlet west; `line`: the conduit from the pump, `dry`: a silo of coal set against an entrance.
 */
function base(line: ReadonlyArray<readonly [number, number, Rot]>, dry?: 0 | 1): { sim: Sim; boiler: number; pump: number } {
  const src = testSource();
  const sim = new Sim({ worldSeed: 7, playerSeed: 11, source: new FlatSource(src.deposits, [...src.rocks, POND]), foundingEpoch: WORLD_EPOCH0 + 24 });
  learnPlans(sim);
  sim.grant('iron_plate', 200); sim.grant('glass', 40); sim.grant('copper_wire', 40);
  const b = sim.place('steam_boiler', 516, 505, 0);
  const p = sim.place('pump', 521, 507, 3);
  if (!b.ok || !p.ok) throw new Error(`${b.reason} ${p.reason}`);
  if (line.length && sim.placeBelts('conduit', line.map(([x, y, r]) => [x, y, r])) !== line.length) throw new Error('conduit');
  if (dry !== undefined) stockedSilo(sim, dry ? 518 : 516, 507, 0, 'coal', 100); // its outlet north, into the entrance
  sim.ensureCompiled();
  return { sim, boiler: b.id!, pump: p.id! };
}

const ent = (sim: Sim, x: number, y: number) => sim.ents.get(sim.grid.occ[tileIndex(x, y)]!)!;

describe('water ports in the world (D142)', () => {
  it('a drinker watered by its own entrance wears its own look; by its other one, that variant', () => {
    // As meant: the conduit into its water intake, the coal into the other.
    const own = base([[520, 507, 3], [519, 507, 3], [518, 507, 0]], 0);
    expect(wetEntranceOf(own.sim, own.sim.ents.get(own.boiler)!)).toBe(-1);
    // Swapped: the water by the coal's intake (D114 lets it drink there), the coal by the water's.
    const swapped = base([[520, 507, 3], [519, 507, 3], [518, 507, 3], [517, 507, 3], [516, 507, 0]]);
    expect(wetEntranceOf(swapped.sim, swapped.sim.ents.get(swapped.boiler)!)).toBe(0);
    // Nothing joined yet: its own; the coal by its own water intake: the pipework moves to the free one.
    const bare = base([]);
    expect(wetEntranceOf(bare.sim, bare.sim.ents.get(bare.boiler)!)).toBe(-1);
    const coalWet = base([], 1);
    expect(wetEntranceOf(coalWet.sim, coalWet.sim.ents.get(coalWet.boiler)!)).toBe(0);
    // A building that drinks no water never wears a variant.
    expect(wetEntranceOf(own.sim, own.sim.ents.get(own.pump)!)).toBe(-1);
  });

  it('a conduit couples to the ports it meets: the pump’s outlet behind it, the intake it runs into; nowhere else', () => {
    const { sim } = base([[520, 507, 3], [519, 507, 3], [518, 507, 0]], 0);
    expect(couplingSides(sim, ent(sim, 520, 507))).toBe(1 << 1); // fed by the pump's outlet, east of it
    expect(couplingSides(sim, ent(sim, 519, 507))).toBe(0); // a plain length
    expect(couplingSides(sim, ent(sim, 518, 507))).toBe(1 << 0); // into the boiler's water intake, north of it
    // A conduit beside an intake it does not run into: no coupling (it passes by).
    const by = base([[520, 507, 3], [519, 507, 3], [518, 507, 3], [517, 507, 3]]);
    expect(couplingSides(by.sim, ent(by.sim, 518, 507))).toBe(0);
    expect(couplingSides(by.sim, ent(by.sim, 517, 507))).toBe(0);
  });
});
