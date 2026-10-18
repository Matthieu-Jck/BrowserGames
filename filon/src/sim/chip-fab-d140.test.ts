// chip-fab-d140.test.ts — one entrance a kind of input (D140; owner, 2026-10-18: « if a machine
// require 3 ressources, you need to put 3 entrances to it. like the electronical stuff »). The chip
// fab had two entrances for the circuit's three inputs; it has a third at the back-left, listed last
// so the ports before it keep their index. Here: three lines, one an entrance, make circuits; and a
// fab already standing — its save holds no port at all (entities, ribbons by their tiles, machines by
// their entity), so a save from before D140 is a save of today's shape — loads and runs, a ribbon
// passing right under its new entrance carrying on past it, nothing taken, nothing lost.
import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '@/content/buildings';
import { itemIdx } from '@/content/registry';
import { connect } from './dev';
import { worldPorts } from './entities';
import { deserialize, serialize } from './serialize';
import type { Sim } from './state';
import { grantCost, steadyPower, stockedSilo, testSim, wire } from './testkit';

/** Its research learnt (the circuit's node, the servomotor's, the fab's), outside commands. */
function learn(sim: Sim): void {
  for (const id of ['workshop', 'dn4', 'dn7', 'dn_chipfab']) sim.done.add(id);
  sim.rebuildDerived();
}

/** A chip fab at (520, 504), its back to the south, on `recipe`, powered. Returns its id. */
function fab(sim: Sim, recipe: string): number {
  grantCost(sim, 'chip_fab');
  const r = sim.place('chip_fab', 520, 504, 0);
  if (!r.ok) throw new Error(`chip fab: ${r.reason}`);
  expect(sim.setRecipe(r.id!, recipe)).toBe(true);
  wire(sim, r.id!);
  return r.id!;
}

/** The ports of the fab's node the graph feeds (each edge in: its port index), sorted. */
function fedPorts(sim: Sim, id: number): number[] {
  sim.ensureCompiled();
  const g = sim.graph, n = g.nodeByEnt.get(id)!;
  return n.inE.map((e) => g.eDstPort[e]!).sort((a, b) => a - b);
}

describe('the chip fab’s three entrances (D140)', () => {
  it('has an entrance for each of the circuit’s three inputs, the third last so the first ones keep their index', () => {
    const ports = BUILDINGS.chip_fab.ports;
    expect(ports.filter((p) => p.io === 'in')).toHaveLength(3);
    // Ports 0, 1 and the outlet (2) as they were; the new one is port 3, at the back-left.
    expect(ports.slice(0, 3)).toEqual([{ x: 1, y: 3, side: 'S', io: 'in' }, { x: 2, y: 3, side: 'S', io: 'in' }, { x: 1, y: 0, side: 'N', io: 'out' }]);
    expect(ports[3]).toEqual({ x: 0, y: 3, side: 'S', io: 'in' });
  });

  it('fed by three lines, one an entrance — copper plates, copper wire, glass —, it makes circuits for the Core', () => {
    const sim = testSim();
    learn(sim);
    steadyPower(sim);
    const id = fab(sim, 'circuit');
    const plate = stockedSilo(sim, 517, 512, 0, 'copper_plate', 500);
    const wireS = stockedSilo(sim, 521, 512, 0, 'copper_wire', 500);
    const glass = stockedSilo(sim, 525, 512, 0, 'glass', 500);
    // Each silo to its own entrance (`connect`'s index among the inlets: 2 is the new one, at x 520).
    expect(connect(sim, plate, id, 0, 2)).toBeGreaterThan(0);
    expect(connect(sim, wireS, id, 0, 0)).toBeGreaterThan(0);
    expect(connect(sim, glass, id, 0, 1)).toBeGreaterThan(0);
    expect(connect(sim, id, sim.hearthId)).toBeGreaterThan(0);
    expect(fedPorts(sim, id)).toEqual([0, 1, 3]);
    const c = itemIdx('circuit'), s0 = sim.stock[c]!;
    sim.run(600 * 5);
    expect(sim.produced[c]!).toBeGreaterThan(20_000); // dozens in five minutes (its wire line, 60 a minute, gives 30 a minute)
    expect(sim.stock[c]! - s0).toBeGreaterThan(10_000); // and down its line into the Core
    // Every input came in: none of the three silos is still full.
    for (const [s, it] of [[plate, 'copper_plate'], [wireS, 'copper_wire'], [glass, 'glass']] as const) expect(sim.stores.get(s)![itemIdx(it)]!, it).toBeLessThan(500_000);
  });

  it('a fab already standing loads and runs: a ribbon passing under its new entrance carries on, nothing taken, nothing lost', () => {
    const sim = testSim();
    learn(sim);
    steadyPower(sim);
    // An older base's fab on servomotors (two inputs, two entrances), its new entrance's tile
    // (520, 508) taken by a line of iron plates that comes up beside it and turns west to the Core.
    const id = fab(sim, 'pace_bell');
    const iron = stockedSilo(sim, 519, 510, 0, 'iron_plate', 60);
    expect(sim.placeBelts('ribbon', [[520, 509, 0], [520, 508, 3], [519, 508, 3], [518, 508, 3], [517, 508, 3], [516, 508, 3], [515, 508, 2], [515, 509, 2], [515, 510, 2], [515, 511, 3]])).toBe(10);
    const new3 = worldPorts(sim.ents.get(id)!)[3]!;
    expect([new3.io, new3.fx, new3.fy]).toEqual(['in', 520, 508]); // the ribbon's tile, which points west, not into it
    const motor = stockedSilo(sim, 521, 512, 0, 'motor', 200);
    const circ = stockedSilo(sim, 524, 512, 0, 'circuit', 400);
    expect(connect(sim, motor, id, 0, 0)).toBeGreaterThan(0);
    expect(connect(sim, circ, id, 0, 1)).toBeGreaterThan(0);
    expect(connect(sim, id, sim.hearthId)).toBeGreaterThan(0);
    const ir = itemIdx('iron_plate'), bell = itemIdx('pace_bell');
    const ironAtCore = sim.stock[ir]!; // everything paid for: from here only the line brings plates
    sim.run(600);

    // The save holds no port of the fab: nothing in it would read differently before D140.
    const d = serialize(sim);
    expect(d.portItems.some(([e]) => e === id)).toBe(false);
    expect(JSON.stringify(d.ents)).not.toMatch(/port/);
    const back = deserialize(JSON.parse(JSON.stringify(d)), sim.grid.source);
    expect(back.hash()).toBe(sim.hash());
    // Its new entrance has nothing connected; the two lines still come in where they did.
    expect(fedPorts(back, id)).toEqual([0, 1]);

    const made0 = back.produced[bell]!;
    back.run(600 * 4);
    // The 60 plates all reach the Core past the fab, none taken; the servomotors go on being made.
    expect(back.stores.get(iron)![ir]).toBe(0);
    expect(back.stock[ir]! - ironAtCore).toBe(60_000);
    expect(back.produced[bell]! - made0).toBeGreaterThan(0);
    // And the loaded base runs as the one that never saved.
    sim.run(600 * 4);
    expect(back.hash()).toBe(sim.hash());
  });

  it('a store already set with its outlet against the new entrance hands in what the fab takes, as at any entrance, and keeps the rest', () => {
    // Before D140 its outlet faced the fab's wall and stood still. Now it faces an entrance: the
    // direct insertion of an outlet set against an inlet (owner, 2026-10-12) — only what a recipe
    // of the fab takes goes in, into its buffer; a kind it does not take stays in the store.
    for (const [item, takes] of [['glass', true], ['iron_plate', false]] as const) {
      const sim = testSim();
      learn(sim);
      steadyPower(sim);
      const id = fab(sim, 'circuit');
      const s = stockedSilo(sim, 519, 508, 0, item, 50); // its outlet at (520, 508) faces the new entrance
      expect(fedPorts(sim, id), item).toEqual([3]);
      sim.run(600);
      const it = itemIdx(item), left = sim.stores.get(s)![it]!;
      const node = sim.graph.nodeByEnt.get(id) as unknown as { inBuf: Float64Array; slotOf(i: number): number };
      const held = takes ? node.inBuf[node.slotOf(it)]! : 0;
      expect(left + held, item).toBe(50_000); // nothing lost
      if (takes) expect(held, item).toBeGreaterThan(0);
      else expect(left, item).toBe(50_000);
    }
  });
});
