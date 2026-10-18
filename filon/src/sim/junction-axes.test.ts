// junction-axes.test.ts — a junction works whichever axis the new line is on, by drag and by hand.
import { describe, it, expect } from 'vitest';
import { learnPlans, line, testSim } from './testkit';
import type { Rot } from './types';

describe('junction on both axes', () => {
  for (const tier of ['ribbon', 'swift_ribbon', 'express_ribbon']) {
    for (const rot of [0, 1, 2, 3] as Rot[]) {
      it(`${tier}: a drag crosses a line running rot ${rot} perpendicular, and a junction can be placed on it`, () => {
        const sim = testSim();
        learnPlans(sim); sim.done.add('xp_swift'); sim.done.add('xp_express');
        sim.grant('iron_plate', 200); sim.grant('gear', 100); sim.grant('copper_wire', 100); sim.grant('circuit', 100);
        const vertical = rot === 0 || rot === 2;
        // The standing line runs along `rot`; the drag runs across it.
        const stand = vertical ? line(528, rot === 0 ? 532 : 520, rot, 9) : line(rot === 3 ? 532 : 520, 528, rot, 9);
        const first = sim.planBelts(tier, stand).find((st) => !st.ok);
        expect(first?.reason).toBeUndefined();
        expect(sim.placeBelts(tier, stand)).toBe(9);
        const across = vertical ? line(522, 524, 1, 11) : line(524, 522, 2, 11);
        const p = sim.planBelts(tier, across).map((s) => (s.ok ? s.def : s.reason));
        expect(p.filter((d) => d === 'crossing').length).toBe(1);
        // By hand: a junction on a ribbon tile of the line.
        const [hx, hy] = vertical ? [528, 526] : [526, 528];
        expect(sim.canPlace('crossing', hx, hy, 0).ok).toBe(true);
        expect(sim.canPlace('crossing', hx, hy, 1).ok).toBe(true);
      });
    }
  }

  it('a drag takes a junction whichever way it runs across a line, and whichever way the line runs', () => {
    for (const standing of [0, 1, 2, 3] as Rot[]) {
      for (const drag of [0, 1, 2, 3] as Rot[]) {
        if (((standing - drag) & 1) === 0) continue;
        const sim = testSim();
        sim.grant('iron_plate', 200);
        const sv = standing === 0 || standing === 2;
        // The standing line crosses the tile (528, 528); the drag passes through it too.
        const stand = sv ? line(528, standing === 0 ? 533 : 523, standing, 11) : line(standing === 3 ? 533 : 523, 528, standing, 11);
        expect(sim.placeBelts('ribbon', stand)).toBe(11);
        const dv = drag === 0 || drag === 2;
        const across = dv ? line(528, drag === 0 ? 533 : 523, drag, 11) : line(drag === 3 ? 533 : 523, 528, drag, 11);
        const p = sim.planBelts('ribbon', across).map((st) => (st.ok ? st.def : st.reason));
        expect(p, `line ${standing}, drag ${drag}`).toContain('crossing');
        expect(sim.placeBelts('ribbon', across)).toBeGreaterThan(8);
        expect(sim.entityAt(528, 528) && sim.entityAt(528, 528)!.def).toBeDefined();
      }
    }
  });

  it('mixed tiers and a line already holding a junction: both axes still take one', () => {
    for (const [a, b] of [['ribbon', 'swift_ribbon'], ['swift_ribbon', 'ribbon']] as const) {
      for (const verticalStand of [true, false]) {
        const sim = testSim();
        learnPlans(sim); sim.done.add('xp_swift');
        sim.grant('iron_plate', 300); sim.grant('gear', 100);
        const stand = verticalStand ? line(528, 523, 2, 11) : line(523, 528, 1, 11);
        const across = verticalStand ? line(523, 528, 1, 11) : line(528, 523, 2, 11);
        expect(sim.placeBelts(a, stand)).toBe(11);
        expect(sim.planBelts(b, across).map((st) => st.def)).toContain('crossing');
        expect(sim.placeBelts(b, across)).toBeGreaterThan(8);
        sim.run(300); // and the graph compiles and runs with it
      }
    }
  });
});
