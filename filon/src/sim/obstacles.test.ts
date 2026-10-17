// obstacles.test.ts — map 4's gaps in play (D94): nothing stands in a chasm or a river, and the
// refusal names it; a ribbon drag leaps a gap a skybridge pair can span, and leaves one too wide
// refused; a wire passes over both; a pump on a river's bank draws from it; neither is marked for
// filling; a parcel's price follows its usable floor (a 2 × 2 machine on level ground), a gap and a
// sliver paying little.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { WORLD_EPOCH0 } from './constants';
import { Sim } from './state';
import { landContent } from './systems/land';
import { learnPlans, line } from './testkit';
import { T, type Rot } from './types';
import { parcelFloor, usableFloor } from './world/floor';
import { FlatSource, tileIndex } from './world/grid';
import { parcelAt, parcelRect } from './world/land';

/** A base on flat sand with rectangles of other ground (level 0 unless said), every plan learnt, materials for the pieces. */
function groundSim(rocks: ConstructorParameters<typeof FlatSource>[1]): Sim {
  const sim = new Sim({ worldSeed: 7, playerSeed: 11, foundingEpoch: WORLD_EPOCH0 + 24, source: new FlatSource([], rocks) });
  learnPlans(sim);
  for (const [it, n] of [['iron_plate', 200], ['copper_wire', 100], ['glass', 40], ['stone', 50]] as const) sim.grant(it, n);
  return sim;
}

/** The plan tile by tile: what it lays, 'leapt' under a bridge pair, or why a tile is refused. */
const plan = (sim: Sim, path: Array<[number, number, Rot]>): string[] =>
  sim.planBelts('ribbon', path).map((s) => (s.leapt ? 'leapt' : s.ok ? s.def : s.reason));

/** A chasm three tiles across (x 525–527) and a river two across (x 535–536), running north–south past the Heart. */
const GAPS = [
  { x: 525, y: 500, w: 3, h: 40, t: T.Chasm, level: 0 },
  { x: 535, y: 500, w: 2, h: 40, t: T.River, level: 0 },
];

describe('chasms and rivers in play (D94)', () => {
  it('nothing stands in a chasm or a river, and the refusal says which', () => {
    const sim = groundSim(GAPS);
    expect(sim.canPlace('kiln', 524, 528, 0).reason).toBe('chasm'); // a 2×2 with a tile in the chasm
    expect(sim.canPlace('mast', 526, 528, 0).reason).toBe('chasm');
    expect(sim.canPlace('ribbon', 535, 528, 1).reason).toBe('river');
    expect(sim.canPlace('mast', 531, 528, 0).ok).toBe(true);
  });

  it('a ribbon drag leaps a chasm or a river with a skybridge pair; a gap too wide for one stays refused', () => {
    const sim = groundSim(GAPS);
    // East across the chasm (525–527): bridges on 524 and 528, four tiles apart.
    expect(plan(sim, line(521, 528, 1, 10))).toEqual(['ribbon', 'ribbon', 'ribbon', 'skybridge', 'leapt', 'leapt', 'leapt', 'skybridge', 'ribbon', 'ribbon']);
    // East across the river (535–536).
    expect(plan(sim, line(532, 530, 1, 8))).toEqual(['ribbon', 'ribbon', 'skybridge', 'leapt', 'leapt', 'skybridge', 'ribbon', 'ribbon']);
    expect(sim.placeBelts('ribbon', line(521, 528, 1, 10))).toBe(7);
    sim.ensureCompiled();
    expect(sim.graph!.jumps.get(tileIndex(524, 528))).toBe(tileIndex(528, 528));
    // A chasm four across: the pair would stand five apart, past a plain skybridge's reach.
    const wide = groundSim([{ x: 525, y: 500, w: 4, h: 40, t: T.Chasm, level: 0 }]);
    expect(plan(wide, line(521, 528, 1, 10))).toContain('chasm');
  });

  it('a wire passes over a chasm: two poles either side of it link', () => {
    const sim = groundSim(GAPS);
    const a = sim.place('mast', 523, 532, 0), b = sim.place('mast', 529, 532, 0);
    expect(a.ok && b.ok).toBe(true);
    // The second pole wired itself to the first as it was placed: across the chasm.
    expect(sim.linksOf(b.id!)).toContain(a.id!);
  });

  it('a pump on a river\'s bank draws from it; a chasm, a river are never marked for filling', () => {
    const sim = groundSim(GAPS);
    sim.done.add('tr3'); // pumps
    sim.rebuildDerived();
    expect(sim.canPlace('pump', 534, 520, 0).ok).toBe(true); // beside the river (535)
    expect(sim.canPlace('pump', 530, 520, 0).reason).toBe('needs_water');
    // Placed, it draws its water a minute (graph/compile.ts: a pump by water, a river's too).
    const pump = sim.place('pump', 534, 520, 0);
    expect(pump.ok).toBe(true);
    sim.ensureCompiled();
    const node = sim.graph.nodeByEnt.get(pump.id!) as unknown as { rateEp: number };
    expect(node.rateEp).toBeGreaterThan(0);
    expect(sim.designate([tileIndex(526, 520), tileIndex(535, 520)])).toBe(0);
  });

  it('a parcel\'s price follows its usable floor: a chasm and a river pay little, a sliver of floor pays as rock', () => {
    const p = parcelAt(560, 512), q = parcelRect(p);
    const bare = groundSim([]), cut = groundSim([{ x: q.x0 + 4, y: q.y0, w: 3, h: q.y1 - q.y0, t: T.Chasm, level: 0 }]);
    const L = BAL.land.tile;
    expect(parcelFloor(bare.grid, p).permille).toBe(1000);
    const n = 3 * (q.y1 - q.y0);
    expect(landContent(bare, p) - landContent(cut, p)).toBe(n * (L.floor! - L.chasm!));
    expect(parcelFloor(cut.grid, p).usable).toBe((q.x1 - q.x0) * (q.y1 - q.y0) - n);
    // A one-tile strip of floor between two chasms takes no 2 × 2 machine: a sliver.
    const sliver = groundSim([
      { x: q.x0 + 4, y: q.y0, w: 2, h: q.y1 - q.y0, t: T.Chasm, level: 0 },
      { x: q.x0 + 7, y: q.y0, w: 2, h: q.y1 - q.y0, t: T.River, level: 0 },
    ]);
    expect(usableFloor(sliver.grid, q.x0 + 6, q.y0 + 5)).toBe(false);
    expect(usableFloor(sliver.grid, q.x0 + 3, q.y0 + 5)).toBe(true);
    const h = q.y1 - q.y0;
    expect(landContent(bare, p) - landContent(sliver, p)).toBe(2 * h * (L.floor! - L.chasm!) + 2 * h * (L.floor! - L.river!) + h * (L.floor! - L.sliver!));
  });
});
