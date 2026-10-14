import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { testSim, line, stockedSilo } from './testkit';
import { catchUp } from './offline/catchup';
import type { Sim } from './state';

/**
 * A silo of sand handing out north into a swift ribbon (120/min) that ends in an incinerator at
 * (500, 510); `bridged`: the middle of the line is a pair of bridges leaping two tiles.
 */
function swiftLine(bridged: boolean): Sim {
  const sim = testSim();
  sim.done.add('xp_swift'); // swift ribbons (a research): granted outside the commands, as steadyPower's
  sim.rebuildDerived();
  sim.grant('gear', 50); // their cost
  stockedSilo(sim, 500, 520, 0, 'sand', 1000);
  if (bridged) {
    expect(sim.placeBelts('swift_ribbon', line(500, 519, 0, 3))).toBe(3);
    expect(sim.place('skybridge', 500, 516, 0).ok).toBe(true);
    expect(sim.place('skybridge', 500, 513, 0).ok).toBe(true);
    expect(sim.placeBelts('swift_ribbon', line(500, 512, 0, 2))).toBe(2);
  } else {
    expect(sim.placeBelts('swift_ribbon', line(500, 519, 0, 9))).toBe(9);
  }
  expect(sim.place('incinerator', 500, 510, 0).ok).toBe(true);
  return sim;
}

const burnt = (sim: Sim): number => sim.consumed[itemIdx('sand')]! / 1000;

describe('bridges go at the pace of their line (owner, 2026-10-13)', () => {
  it('a swift line through a pair of bridges carries as much as a plain swift line', () => {
    const plain = swiftLine(false), bridged = swiftLine(true);
    for (const sim of [plain, bridged]) sim.run(600); // the line fills
    const p0 = burnt(plain), b0 = burnt(bridged);
    plain.run(3000); bridged.run(3000); // five minutes: 600 items at 120/min
    const p = burnt(plain) - p0, b = burnt(bridged) - b0;
    expect(p).toBeGreaterThanOrEqual(590);
    expect(Math.abs(b - p)).toBeLessThanOrEqual(2);
  });

  it('the bridges ride in the swift line itself, at its speed', () => {
    const sim = swiftLine(true);
    sim.ensureCompiled();
    const c = sim.chainAt(500, 516);
    expect(c).toBe(sim.chainAt(500, 519));
    expect(c?.ticksPerTile).toBe(4); // the swift ribbon's, not a basic ribbon's 6
  });

  it('offline as online', () => {
    const a = swiftLine(true), b = swiftLine(true);
    for (const sim of [a, b]) sim.run(600);
    a.run(6000);
    catchUp(b, 6000, { noDirect: true });
    expect(burnt(b)).toBe(burnt(a));
    expect(b.hash()).toBe(a.hash());
  });

  it('a bridge is entered from straight behind only: a line at its side stops there (owner, 2026-10-13)', () => {
    const run = (side: boolean): number => {
      const sim = testSim();
      stockedSilo(sim, 500, 520, 0, 'sand', 200);
      // The bridges face north; the feed comes up from behind, or turns in from the west side.
      if (side) {
        expect(sim.placeBelts('ribbon', [[500, 519, 0], [500, 518, 3], [499, 518, 0], [499, 517, 1]])).toBe(4);
        expect(sim.place('skybridge', 500, 517, 0).ok).toBe(true);
      } else {
        expect(sim.placeBelts('ribbon', line(500, 519, 0, 2))).toBe(2);
        expect(sim.place('skybridge', 500, 517, 0).ok).toBe(true);
      }
      expect(sim.place('skybridge', 500, 514, 0).ok).toBe(true);
      expect(sim.place('incinerator', 500, 513, 0).ok).toBe(true);
      sim.run(3000);
      return burnt(sim);
    };
    expect(run(false)).toBeGreaterThan(20);
    expect(run(true)).toBe(0);
  });
});
