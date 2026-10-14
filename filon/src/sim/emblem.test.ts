// emblem.test.ts — the claim's emblem (owner, 2026-10-13: designed at the start, flown by the
// Heart): only known parts with a symbol that shows on its field are taken; it is logged (a replay
// gives it back), saved and loaded; a claim without one has a default from its seed.
import { describe, it, expect } from 'vitest';
import { defaultEmblem, isEmblem, type Emblem } from '@/content/emblem';
import { replay } from './commands';
import { deserialize, serialize } from './serialize';
import { testSim, testSource } from './testkit';

describe('the claim’s emblem', () => {
  it('known parts only, a symbol that shows on its field; logged, replayed, saved and loaded', () => {
    const sim = testSim();
    expect(sim.emblem).toBeNull();
    expect(sim.setEmblem({ shape: 'round', symbol: 'eye', field: 'coral', ink: 'coral' })).toBe(false); // nothing would show
    expect(sim.setEmblem({ shape: 'hexagon', symbol: 'eye', field: 'coral', ink: 'paper' } as unknown as Emblem)).toBe(false);
    const e: Emblem = { shape: 'round', symbol: 'eye', field: 'coral', ink: 'paper' };
    expect(sim.setEmblem(e)).toBe(true);
    expect(sim.emblem).toEqual(e);
    const b = testSim();
    replay(b, sim.log, sim.tick);
    expect(b.emblem).toEqual(e);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(sim))), testSource());
    expect(back.emblem).toEqual(e);
    expect(back.hash()).toBe(sim.hash());
  });

  it('a claim without one flies a valid default, the same for the same seed', () => {
    for (let seed = 1; seed < 200; seed++) {
      const d = defaultEmblem(seed);
      expect(isEmblem(d)).toBe(true);
      expect(defaultEmblem(seed)).toEqual(d);
    }
    const kinds = new Set(Array.from({ length: 200 }, (_, s) => JSON.stringify(defaultEmblem(s))));
    expect(kinds.size).toBeGreaterThan(50);
  });
});
