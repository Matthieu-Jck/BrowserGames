// belt-plan.test.ts — a ribbon drag planned as a whole (D73): junctions never chain; a drag across
// two lines side by side leaps them with a bridge pair, and so it does water or a building in its
// way; a step takes a traction ribbon, never two in a row; what no bridge reaches stays refused.
import { describe, it, expect } from 'vitest';
import { BUILDING_FLAT, BUILDING_IDS, buildingIdx } from '@/content/registry';
import { deserialize, serialize } from './serialize';
import { WORLD_EPOCH0 } from './constants';
import { Sim } from './state';
import { learnPlans, line, testSim, testSource } from './testkit';
import { T, type Rot } from './types';
import { FlatSource, tileIndex } from './world/grid';

const defAt = (sim: Sim, x: number, y: number): string | undefined => {
  const e = sim.entityAt(x, y);
  return e ? BUILDING_IDS[e.def] : undefined;
};

/** The plan tile by tile: what it lays, 'leapt' under a bridge pair, or why a tile is refused. */
const plan = (sim: Sim, def: string, path: Array<[number, number, Rot]>): string[] =>
  sim.planBelts(def, path).map((s) => (s.leapt ? 'leapt' : s.ok ? s.def : s.reason));

/** A base on custom ground (rectangles of terrain), every plan learnt, plates for the pieces. */
function groundSim(rocks: ConstructorParameters<typeof FlatSource>[1]): Sim {
  const sim = new Sim({ worldSeed: 7, playerSeed: 11, foundingEpoch: WORLD_EPOCH0 + 24, source: new FlatSource([], rocks) });
  learnPlans(sim);
  sim.grant('iron_plate', 100);
  sim.grant('copper_wire', 50);
  return sim;
}

/** Two ribbon lines side by side running south (x 525 and 526, y 524–532). */
function twoLines(): Sim {
  const sim = testSim();
  sim.grant('iron_plate', 20);
  for (const x of [525, 526]) expect(sim.placeBelts('ribbon', line(x, 524, 2, 9))).toBe(9);
  return sim;
}

const EAST = line(520, 528, 1, 11); // x 520–530 along y 528

describe('a ribbon drag planned as a whole (D73)', () => {
  it('junctions never chain: a ribbon runs between two of them (a diagonal is fine)', () => {
    const sim = testSim();
    sim.grant('iron_plate', 20);
    expect(sim.place('crossing', 525, 528, 0).ok).toBe(true);
    for (const [x, y] of [[526, 528], [524, 528], [525, 527], [525, 529]] as const) expect(sim.canPlace('crossing', x, y, 0).reason).toBe('junction_chain');
    expect(sim.canPlace('crossing', 526, 529, 0).ok).toBe(true);
    expect(sim.canPlace('crossing', 527, 528, 0).ok).toBe(true);
  });

  it('a drag across two lines side by side leaps them with a bridge pair; the lines run on underneath', () => {
    const sim = twoLines();
    expect(plan(sim, 'ribbon', EAST)).toEqual(['ribbon', 'ribbon', 'ribbon', 'ribbon', 'skybridge', 'leapt', 'leapt', 'skybridge', 'ribbon', 'ribbon', 'ribbon']);
    expect(sim.placeBelts('ribbon', EAST)).toBe(9);
    expect([524, 525, 526, 527].map((x) => defAt(sim, x, 528))).toEqual(['skybridge', 'ribbon', 'ribbon', 'skybridge']);
    expect([sim.entityAt(525, 528)!.rot, sim.entityAt(526, 528)!.rot]).toEqual([2, 2]); // the crossed lines, untouched
    sim.ensureCompiled();
    expect(sim.graph!.jumps.get(tileIndex(524, 528))).toBe(tileIndex(527, 528));
  });

  it('one line crossed still takes a junction', () => {
    const sim = testSim();
    expect(sim.placeBelts('ribbon', line(525, 524, 2, 9))).toBe(9);
    expect(plan(sim, 'ribbon', EAST)[5]).toBe('crossing');
  });

  it('before bridges are learnt, the chain stays refused and the drag is laid in part', () => {
    const sim = twoLines();
    sim.done.delete('bridge');
    sim.rebuildDerived();
    expect(plan(sim, 'ribbon', EAST).slice(4, 8)).toEqual(['ribbon', 'junction_chain', 'junction_chain', 'ribbon']);
    expect(sim.placeBelts('ribbon', EAST)).toBe(9);
    expect([525, 526].map((x) => sim.entityAt(x, 528)!.rot)).toEqual([2, 2]);
  });

  it('water within the bridges’ reach is leapt; wider water stays refused, until Long Bridges', () => {
    const pond = (w: number): Sim => groundSim([{ x: 524, y: 526, w, h: 5, t: T.Shallow }]);
    expect(plan(pond(3), 'ribbon', EAST)).toEqual(['ribbon', 'ribbon', 'ribbon', 'skybridge', 'leapt', 'leapt', 'leapt', 'skybridge', 'ribbon', 'ribbon', 'ribbon']);
    const wide = pond(5); // x 524–528: the pair would stand 6 apart, past the reach of 4
    expect(plan(wide, 'ribbon', EAST).slice(3, 10)).toEqual(['ribbon', 'terrain', 'terrain', 'terrain', 'terrain', 'terrain', 'ribbon']);
    expect(wide.placeBelts('ribbon', EAST)).toBe(6);
    const long = pond(5);
    long.done.add('xp_bridges'); // Long Bridges: a reach of 8 (a research, granted outside the commands)
    long.rebuildDerived();
    expect(plan(long, 'ribbon', EAST).slice(3, 10)).toEqual(['skybridge', 'leapt', 'leapt', 'leapt', 'leapt', 'leapt', 'skybridge']);
  });

  it('a flat building in the way is leapt too; a bridge is never fed from its side at the drag’s corner', () => {
    const sim = testSim();
    sim.grant('iron_plate', 20);
    sim.done.add('xp_guard'); // the fence: flat, a bridge may pass over it (D124)
    expect(sim.place('fence', 525, 528, 0).ok).toBe(true);
    expect(plan(sim, 'ribbon', EAST).slice(3, 8)).toEqual(['ribbon', 'skybridge', 'leapt', 'skybridge', 'ribbon']);
    // Down x 524 then east along y 528: the tile before the mast is the corner, entered from the north.
    const corner: Array<[number, number, Rot]> = [[524, 525, 2], [524, 526, 2], [524, 527, 2], [524, 528, 1], [525, 528, 1], [526, 528, 1], [527, 528, 1]];
    expect(plan(sim, 'ribbon', corner).slice(3)).toEqual(['ribbon', 'occupied', 'ribbon', 'ribbon']);
  });

  it('a step takes a traction ribbon by itself; two steps in a row leave the second refused (D65)', () => {
    const sim = groundSim([{ x: 525, y: 527, w: 1, h: 3, t: T.Rock1, level: 1 }, { x: 526, y: 527, w: 5, h: 3, t: T.Rock2, level: 2 }]);
    expect(plan(sim, 'ribbon', EAST).slice(3, 7)).toEqual(['ribbon', 'traction_ribbon', 'lift_room', 'ribbon']);
  });

  it('a tall building is never leapt (D124): the drag stops at it, the tile says why; a bridge pair and a machine refuse each other both ways', () => {
    const sim = testSim();
    sim.grant('iron_plate', 20);
    expect(sim.place('mast', 525, 528, 0).ok).toBe(true);
    expect(plan(sim, 'ribbon', EAST).slice(3, 8)).toEqual(['ribbon', 'ribbon', 'bridge_over_tall', 'ribbon', 'ribbon']);
    // A bridge pair over open ground, then a tall building under its span, and the reverse.
    const two = testSim();
    two.grant('iron_plate', 20);
    expect(two.place('skybridge', 522, 530, 1).ok).toBe(true);
    expect(two.place('mast', 524, 530, 0).reason).toBe('ok'); // no partner yet: nothing to cross
    const fresh = testSim();
    fresh.grant('iron_plate', 20);
    expect(fresh.place('skybridge', 522, 530, 1).ok).toBe(true);
    expect(fresh.place('skybridge', 526, 530, 1).ok).toBe(true);
    expect(fresh.canPlace('mast', 524, 530, 0).reason).toBe('bridge_over_tall');
    expect(fresh.canPlace('ribbon', 524, 530, 1).ok).toBe(true); // flat: fine
    const under = testSim();
    under.grant('iron_plate', 20);
    expect(under.place('mast', 524, 530, 0).ok).toBe(true);
    expect(under.place('skybridge', 522, 530, 1).ok).toBe(true);
    expect(under.canPlace('skybridge', 526, 530, 1).reason).toBe('bridge_over_tall');
    expect(under.canPlace('skybridge', 526, 531, 1).ok).toBe(true);
  });

  it('a pair standing over a machine from before the rule loads unchanged, and keeps its leap', () => {
    const sim = testSim();
    sim.grant('iron_plate', 20);
    // An old save's layout: no command can build it now, so the mast is flat for the placing only.
    const mast = buildingIdx('mast');
    const was = BUILDING_FLAT[mast]!;
    (BUILDING_FLAT as boolean[])[mast] = true;
    expect(sim.place('mast', 524, 530, 0).ok).toBe(true);
    expect(sim.place('skybridge', 522, 530, 1).ok).toBe(true);
    expect(sim.place('skybridge', 526, 530, 1).ok).toBe(true);
    (BUILDING_FLAT as boolean[])[mast] = was;
    const back = deserialize(JSON.parse(JSON.stringify(serialize(sim))), testSource());
    expect([522, 524, 526].map((x) => defAt(back, x, 530))).toEqual(['skybridge', 'mast', 'skybridge']);
    expect(back.canPlace('mast', 524, 531, 0).ok).toBe(true); // elsewhere, as before
  });
});
