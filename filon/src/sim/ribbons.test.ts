// ribbons.test.ts — the tile-by-tile ribbons (D57; owner, 2026-10-13: "a case-by-case calculation,
// where each tick of ribbons forwards the item by 1 case, and the tick depends on the ribbon type
// speed. And if the ribbons are following each other, you can advance the things non stop"; "the
// ribbon that doesn't turn would have the priority at an intersection"): one item per tile, one tile
// a step on the tier's beat, a full line moving as one block across its joins, the straight line
// first where lines meet, offline as online.
import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { stepAt, stepPeriod } from './flow/chain';
import { catchUp } from './offline/catchup';
import { line, stockedSilo, testSim } from './testkit';
import type { Sim } from './state';

const burnt = (sim: Sim, item: string): number => sim.consumed[itemIdx(item)]! / 1000;

describe('ribbons, tile by tile (D57)', () => {
  it('a tier steps perMin times a minute on the world’s clock, in a short repeating pattern', () => {
    for (const perMin of [30, 60, 120, 240]) {
      let n = 0;
      for (let t = 0; t < 600; t++) if (stepAt(perMin, t)) n++;
      expect(n).toBe(perMin);
      const p = stepPeriod(perMin);
      for (let t = 0; t < 600; t++) expect(stepAt(perMin, t + p)).toBe(stepAt(perMin, t));
    }
    expect(stepPeriod(60)).toBe(10);
    expect(stepPeriod(240)).toBe(5); // 2 then 3 ticks
  });

  it('one item per tile, each moving one tile a step: a full line is packed and carries 60/min', () => {
    const sim = testSim();
    stockedSilo(sim, 500, 520, 0, 'sand', 400); // its outlet: 120/min, more than a ribbon takes
    expect(sim.placeBelts('ribbon', line(500, 519, 0, 10))).toBe(10);
    expect(sim.place('incinerator', 500, 509, 0).ok).toBe(true);
    sim.run(200);
    const c = sim.chainAt(500, 515)!;
    // Packed: every tile holds one item.
    for (let i = 0; i < c.length; i++) expect(c.itemAt(i)).toBe(itemIdx('sand'));
    // Watch the cells over a few steps: between two steps nothing moves; on a step every item moves one tile on.
    for (let t = 0; t < 40; t++) {
      const before = Array.from(c.cells);
      const step = c.steps(sim.tick);
      sim.step();
      if (!step) expect(Array.from(c.cells)).toEqual(before);
    }
    const b0 = burnt(sim, 'sand');
    sim.run(3000);
    expect(burnt(sim, 'sand') - b0).toBeGreaterThanOrEqual(299);
    expect(burnt(sim, 'sand') - b0).toBeLessThanOrEqual(301);
  });

  it('a line cut by a join (a side ribbon meeting it) still moves as one block: no gap at the join', () => {
    const run = (join: boolean): number => {
      const sim = testSim();
      stockedSilo(sim, 500, 520, 0, 'sand', 600);
      expect(sim.placeBelts('ribbon', line(500, 519, 0, 10))).toBe(10);
      // An idle ribbon turning in from the west at (500,514): that tile now starts a chain of its own.
      if (join) expect(sim.placeBelts('ribbon', [[498, 514, 1], [499, 514, 1]])).toBe(2);
      expect(sim.place('incinerator', 500, 509, 0).ok).toBe(true);
      sim.ensureCompiled();
      if (join) expect(sim.chainAt(500, 515)).not.toBe(sim.chainAt(500, 514));
      sim.run(300);
      const b0 = burnt(sim, 'sand');
      sim.run(3000);
      return burnt(sim, 'sand') - b0;
    };
    expect(run(true)).toBeGreaterThanOrEqual(299);
    expect(Math.abs(run(true) - run(false))).toBeLessThanOrEqual(1);
  });

  it('where two lines meet, the straight one has the tile first; the side line goes in its gaps', () => {
    const run = (straightFull: boolean): { sand: number; ore: number } => {
      const sim = testSim();
      // Straight: sand from the south; side: iron ore from the west, turning in at (500,514).
      stockedSilo(sim, 500, 520, 0, 'sand', straightFull ? 600 : 0);
      expect(sim.placeBelts('ribbon', line(500, 519, 0, 10))).toBe(10);
      stockedSilo(sim, 496, 514, 1, 'iron_ore', 600); // facing east: out at (497,514)
      expect(sim.placeBelts('ribbon', line(498, 514, 1, 2))).toBe(2);
      expect(sim.place('incinerator', 500, 509, 0).ok).toBe(true);
      sim.run(1200); // the lines fill (a few ore items get in before the sand reaches the join)
      const s0 = burnt(sim, 'sand'), o0 = burnt(sim, 'iron_ore');
      sim.run(3000);
      return { sand: burnt(sim, 'sand') - s0, ore: burnt(sim, 'iron_ore') - o0 };
    };
    const both = run(true);
    expect(both.sand).toBeGreaterThanOrEqual(299);
    expect(both.ore).toBe(0); // a full straight line leaves no gap
    const sideOnly = run(false);
    expect(sideOnly.ore).toBeGreaterThanOrEqual(299);
  });

  it('offline as online', () => {
    const build = (): Sim => {
      const sim = testSim();
      stockedSilo(sim, 500, 520, 0, 'sand', 600);
      sim.placeBelts('ribbon', line(500, 519, 0, 10));
      stockedSilo(sim, 496, 514, 1, 'iron_ore', 600);
      sim.placeBelts('ribbon', line(498, 514, 1, 2));
      sim.place('incinerator', 500, 509, 0);
      sim.run(137);
      return sim;
    };
    const a = build(), b = build();
    a.run(9000);
    catchUp(b, 9000, { noDirect: true });
    expect(burnt(b, 'sand')).toBe(burnt(a, 'sand'));
    expect(burnt(b, 'iron_ore')).toBe(burnt(a, 'iron_ore'));
    expect(b.hash()).toBe(a.hash());
  });
});
