import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { testSim, line, stockedSilo } from './testkit';
import { catchUp } from './offline/catchup';
import type { Sim } from './state';

/** A silo of 200 sand handing out north into a six-tile ribbon whose head faces (500, 513). */
function sandLine(): { sim: Sim; silo: number } {
  const sim = testSim();
  const silo = stockedSilo(sim, 500, 520, 0, 'sand', 200);
  expect(sim.placeBelts('ribbon', line(500, 519, 0, 6))).toBe(6);
  return { sim, silo };
}

const sandIn = (sim: Sim, silo: number): number => (sim.stores.get(silo)?.[itemIdx('sand')] ?? 0) / 1000;

describe('the incinerator (D51)', () => {
  it('a ribbon into nothing backs up: the silo keeps what the line cannot take', () => {
    const { sim, silo } = sandLine();
    sim.run(3000);
    expect(sandIn(sim, silo)).toBeGreaterThan(180); // six squares of ribbon hold six items
  });

  it('at the head of the line it takes everything, as fast as the ribbon brings it, and destroys it', () => {
    const { sim, silo } = sandLine();
    const placed = sim.place('incinerator', 500, 513, 0);
    expect(placed.ok).toBe(true);
    const before = sim.consumed[itemIdx('sand')]!;
    sim.run(6000);
    expect(sandIn(sim, silo)).toBe(0);
    expect((sim.consumed[itemIdx('sand')]! - before) / 1000).toBe(200);
    expect(sim.stock[itemIdx('sand')]).toBe(0); // nothing reaches the Heart, nothing is refunded
  });

  it('dropped on a ribbon, it replaces that square (refunded) and eats the line', () => {
    const { sim } = sandLine();
    const r = sim.place('incinerator', 500, 515, 0);
    expect(r.ok).toBe(true);
    sim.run(6000);
    expect(sim.consumed[itemIdx('sand')]! / 1000).toBe(200);
  });

  it('offline as online: the catch-up destroys the same items to the same state', () => {
    // Two identical bases (the test silo's lock is not saved: build twice rather than copy).
    const a = sandLine().sim, b = sandLine().sim;
    for (const sim of [a, b]) { sim.place('incinerator', 500, 513, 0); sim.run(50); }
    a.run(6000);
    catchUp(b, 6000, { noDirect: true });
    expect(b.consumed[itemIdx('sand')]).toBe(a.consumed[itemIdx('sand')]);
    expect(b.hash()).toBe(a.hash());
  });
});
