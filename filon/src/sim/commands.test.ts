import { describe, it, expect } from 'vitest';
import { WORLD_SEED } from '@/content/world';
import { exec, replay, type Command } from './commands';
import { WORLD_EPOCH0, CENTER } from './constants';
import { buildDemo } from './dev';
import { Sim } from './state';
import { MapGen } from './world/mapgen';
import { tileIndex } from './world/grid';

const found = (): Sim => new Sim({ worldSeed: WORLD_SEED, playerSeed: 1, source: new MapGen(WORLD_SEED, 1), foundingEpoch: WORLD_EPOCH0 + 24 });

describe('commands', () => {
  it('replaying a colony\'s command log on a fresh colony reproduces its state hash', () => {
    const a = found();
    const ids = buildDemo(a);
    a.run(900);
    // Trade: a stream, a standing order, a spot sale (the market's state is part of the hash).
    expect(a.setExport(ids.trade!, 0, 'glass')).toBeNull();
    expect(typeof a.addImport(ids.trade!, 'copper_ore', 2, 100_000)).toBe('number');
    expect('cents' in a.spotTrade('iron_plate', 'sell', 5)).toBe(true);
    // A few more commands mid-game: a recipe change, marks, a removal, a grant.
    const machine = a.ents.sorted().find((e) => a.graph.nodeByEnt.get(e.id)?.kind === 'machine');
    expect(machine).toBeDefined();
    a.setRecipe(machine!.id, null);
    a.run(300);
    a.designate([tileIndex(CENTER + 44, CENTER), tileIndex(CENTER + 45, CENTER)]);
    a.grant('iron_plate', 50);
    const ribbon = [...a.ents.sorted()].reverse().find((e) => a.chainAt(e.x, e.y));
    expect(a.remove(ribbon!.x, ribbon!.y)).toBe(true);
    a.run(1200);
    expect(a.log.length).toBeGreaterThan(20);

    const b = found();
    replay(b, a.log, a.tick);
    expect(b.tick).toBe(a.tick);
    expect(b.hash()).toBe(a.hash());
    expect(b.log.length).toBe(a.log.length);
  });

  it('exec refuses what the colony refuses (and logs only what it accepts)', () => {
    const s = found();
    const n = s.log.length;
    const bad: Command[] = [
      { k: 'place', def: 'kiln', x: 0, y: 0, rot: 0 }, // fog / outside the zone
      { k: 'remove', x: CENTER, y: CENTER },           // the Hearth stays
      { k: 'recipe', id: 999, recipe: null },
      { k: 'unroute', id: 1 },
      { k: 'research', id: 'tr2', lab: 0 },            // prerequisites missing
      { k: 'unlockPlan', id: 'bridge' },               // the junction's plan first (D33)
      { k: 'unlockPlan', id: 'tr1' },                  // research is not a plan
    ];
    for (const c of bad) expect(exec(s, c), c.k).toBe(false);
    expect(s.log.length).toBe(n);
  });
});
