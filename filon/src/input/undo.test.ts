// undo.test.ts — Ctrl/⌘+Z (D154): each gesture of the build tools is one step, taken back through
// the player's commands — what it put up comes down refunded in full, what it took down goes back
// with its rotation, settings and wires; a paste and an upgrade come back whole; `DEPTH` steps; a
// step of another colony means nothing; and the undo replays like any other commands.
import { describe, it, expect } from 'vitest';
import { buildingIdx, itemIdx } from '@/content/registry';
import { filterOf } from '@/sim/cfg';
import { replay } from '@/sim/commands';
import { grantCost, line, testSim } from '@/sim/testkit';
import type { Sim } from '@/sim/state';
import { Tools } from './tools';
import { DEPTH } from './undo';

const toolsOn = (sim: Sim): Tools => new Tools(() => sim);
const stock = (sim: Sim): number[] => Array.from(sim.stock);

describe('undo (D154)', () => {
  it('a building placed comes down refunded in full; one placed over a ribbon gives the ribbon back', () => {
    const sim = testSim();
    const t = toolsOn(sim);
    grantCost(sim, 'silo');
    const s0 = stock(sim);
    t.select('silo', 0);
    expect(t.down(530, 500, 0)).toEqual({ placed: 1 });
    expect(sim.entityAt(530, 500)?.def).toBe(buildingIdx('silo'));
    expect(t.undoLast()).toEqual({ removed: 1, restored: 0, failed: 0 });
    expect(sim.entityAt(530, 500)).toBeUndefined();
    expect(stock(sim)).toEqual(s0);
    // A router dropped on a ribbon replaces it; undone, the ribbon is back the way it ran.
    expect(sim.placeBelts('ribbon', line(530, 505, 1, 3))).toBe(3);
    grantCost(sim, 'router');
    const s1 = stock(sim);
    t.select('router', 0);
    expect(t.down(531, 505, 0)).toEqual({ placed: 1 });
    expect(sim.entityAt(531, 505)?.def).toBe(buildingIdx('router'));
    expect(t.undoLast()).toEqual({ removed: 1, restored: 1, failed: 0 });
    expect(sim.entityAt(531, 505)).toMatchObject({ def: buildingIdx('ribbon'), rot: 1 });
    expect(stock(sim)).toEqual(s1);
    expect(t.undoLast()).toBeNull(); // the ribbon drag was the sim's own call, not a gesture
  });

  it('a demolition box comes back with each building\'s rotation, settings and wires; the step after it points at the new ids', () => {
    const sim = testSim();
    const t = toolsOn(sim);
    grantCost(sim, 'router'); grantCost(sim, 'mast'); grantCost(sim, 'wire_mill');
    const r = sim.place('router', 530, 500, 2)!;
    sim.setForkFilter(r.id!, 1, 'coal');
    const pole = sim.place('mast', 532, 500, 0); // wires itself to the Core's grid
    const silo = sim.place('wire_mill', 533, 501, 1); // a 1 × 2 turned on its side
    expect(sim.link(pole.id!, silo.id!).ok).toBe(true);
    const wires = sim.linksOf(pole.id!).length;
    t.demolish();
    t.down(530, 500, 0);
    expect(t.up(534, 502, 0)).toEqual({ removed: 3 });
    expect(sim.ents.get(r.id!)).toBeUndefined();
    expect(t.undoLast()).toEqual({ removed: 0, restored: 3, failed: 0 });
    const r2 = sim.entityAt(530, 500)!, p2 = sim.entityAt(532, 500)!, s2 = sim.entityAt(533, 501)!;
    expect(r2.rot).toBe(2);
    expect(s2).toMatchObject({ def: buildingIdx('wire_mill'), x: 533, y: 501, rot: 1 });
    expect(filterOf(r2.cfg, 1)).toBe(itemIdx('coal'));
    expect(sim.linksOf(p2.id)).toContain(s2.id);
    expect(sim.linksOf(p2.id).length).toBe(wires);
    // A building placed by the tool, demolished, then both steps undone: the second undo finds the
    // building put back under its new id and takes it down.
    grantCost(sim, 'silo');
    t.select('silo', 0);
    expect(t.down(540, 500, 0)).toEqual({ placed: 1 });
    t.demolish();
    t.down(540, 500, 0);
    expect(t.up(540, 500, 0)).toEqual({ removed: 1 });
    expect(t.undoLast()).toMatchObject({ restored: 1 });
    expect(sim.entityAt(540, 500)?.def).toBe(buildingIdx('silo'));
    expect(t.undoLast()).toMatchObject({ removed: 1 });
    expect(sim.entityAt(540, 500)).toBeUndefined();
  });

  it('a paste comes back whole: every piece down, the Core paid back to the milli-item', () => {
    const sim = testSim();
    const t = toolsOn(sim);
    grantCost(sim, 'silo', 2); grantCost(sim, 'router', 2);
    expect(sim.place('silo', 530, 500, 1).ok).toBe(true);
    expect(sim.placeBelts('ribbon', line(532, 500, 1, 3))).toBe(3);
    expect(sim.place('router', 535, 500, 1).ok).toBe(true);
    t.copy();
    t.down(530, 500, 0);
    expect(t.up(535, 501, 0)).toEqual({ copied: 5 });
    expect(t.state?.k).toBe('paste'); // in hand at once
    const n = sim.ents.map.size, s0 = stock(sim);
    t.move(532, 510);
    expect(t.preview().plan).toMatchObject({ n: 5, skipped: 0, short: false });
    expect(t.down(532, 510, 0)).toEqual({ placed: 5 });
    expect(sim.ents.map.size).toBe(n + 5);
    expect(t.undoLast()).toEqual({ removed: 5, restored: 0, failed: 0 });
    expect(sim.ents.map.size).toBe(n);
    expect(stock(sim)).toEqual(s0);
  });

  it('an upgrade comes back as the ribbons it replaced, and the swift ones are refunded', () => {
    const sim = testSim();
    sim.done.add('xp_swift'); sim.rebuildDerived();
    const t = toolsOn(sim);
    expect(sim.placeBelts('ribbon', line(530, 500, 1, 4))).toBe(4);
    grantCost(sim, 'swift_ribbon', 4);
    const s0 = stock(sim);
    t.upgrade();
    t.down(530, 500, 0);
    expect(t.up(533, 500, 0)).toEqual({ upgraded: 4 });
    expect(sim.entityAt(531, 500)?.def).toBe(buildingIdx('swift_ribbon'));
    expect(t.undoLast()).toEqual({ removed: 4, restored: 4, failed: 0 });
    for (let x = 530; x < 534; x++) expect(sim.entityAt(x, 500)).toMatchObject({ def: buildingIdx('ribbon'), rot: 1 });
    expect(stock(sim)).toEqual(s0);
  });

  it(`keeps ${DEPTH} steps, forgets those of another colony, and replays like any other commands`, () => {
    const sim = testSim();
    const t = toolsOn(sim);
    grantCost(sim, 'mast', DEPTH + 5);
    t.select('mast', 0);
    for (let i = 0; i < DEPTH + 5; i++) expect(t.down(520 + i, 530, 0)).toEqual({ placed: 1 });
    expect(t.undo.size).toBe(DEPTH);
    let n = 0;
    while (t.undoLast()) n++;
    expect(n).toBe(DEPTH);
    expect(sim.entityAt(520, 530)).toBeDefined(); // older than the stack: stays
    expect(sim.entityAt(520 + DEPTH + 4, 530)).toBeUndefined();
    // A colony swapped in (a debug base): the steps of the one before mean nothing.
    t.down(600, 600, 0);
    const other = testSim();
    const t2 = new Tools(() => other);
    expect(t2.undoLast()).toBeNull();
    // Replay: the undos are `remove`s and `place`s in the log.
    const b = testSim();
    replay(b, sim.log, sim.tick);
    expect(b.hash()).toBe(sim.hash());
  });
});
