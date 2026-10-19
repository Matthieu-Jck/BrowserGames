// water-ports.test.ts — where the water meets the buildings, as the views read it (D142): the
// entrance a water drinker's pipework is drawn on follows the conduit that really waters it (the
// engine lets either entrance drink, D114), and a conduit couples to the ports it meets, at the
// pump's outlet and at the drinker's entrance, not elsewhere. The pipe a conduit tile shows in iso
// (D145, `pipeOf`): its ends on to the edge where a tube meets it, at a stub's mouth where it couples
// to a port or the line ends open; a side inlet a tee's branch; the marks of a run's plain straights.
import { describe, it, expect } from 'vitest';
import { WORLD_EPOCH0 } from '@/sim/constants';
import { Sim } from '@/sim/state';
import { learnPlans, stockedSilo, testSource } from '@/sim/testkit';
import { T, type Rot } from '@/sim/types';
import { FlatSource, tileIndex } from '@/sim/world/grid';
import { JOINT_EVERY, couplingSides, pipeOf, wetEntranceOf } from './water-ports';
import { beltPiece } from './buildings-view';

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

  it('a conduit’s pipe (D145): on to the edge where a tube meets it, to a stub’s mouth at a port or an open end; a side inlet a branch', () => {
    const pipe = (sim: Sim, x: number, y: number) => { const e = ent(sim, x, y), p = beltPiece(sim, e); return pipeOf(sim, e, p.corner, p.rot); };
    const { sim } = base([[520, 507, 3], [519, 507, 3], [518, 507, 0]], 0);
    // N E S W: out of the pump (its east end at the outlet's mouth) on to the next tile (west).
    expect(pipe(sim, 520, 507)).toEqual({ arms: '0201', mark: '', branches: [] });
    // A plain length: on to both edges; 519 is a multiple of JOINT_EVERY along x — a joint.
    expect(519 % JOINT_EVERY).toBe(0);
    expect(pipe(sim, 519, 507)).toEqual({ arms: '0101', mark: 'j', branches: [] });
    // The bend into the boiler: in from the east edge, out north at the intake's mouth.
    expect(pipe(sim, 518, 507)).toEqual({ arms: '2100', mark: '', branches: [] });
    // A line that ends on nothing: its last end stops at the mouth, capped.
    const open = base([[520, 507, 3], [519, 507, 3]]);
    expect(pipe(open.sim, 519, 507).arms).toBe('0102');
    // A second line joining from the south: the tile it joins shows a branch on that side, to the edge.
    const tee = base([[520, 507, 3], [519, 507, 3], [518, 507, 0]], 0);
    expect(tee.sim.placeBelts('conduit', [[519, 509, 0], [519, 508, 0]])).toBe(2);
    tee.sim.ensureCompiled();
    const t = pipe(tee.sim, 519, 507);
    expect(t.branches).toEqual([{ side: 2, full: true }]);
    expect(t.mark).toBe(''); // no mark on a tee
  });
});

