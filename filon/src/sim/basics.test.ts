// basics.test.ts — more to make of the basic resources (D123): copper plates at the smelter (copper
// ore and coal) and on power (copper ore alone), steel at the steel mill (two plates and a coal, one
// smelter's output feeding one mill), bricks at the brickworks (sand off a collector, water from a
// pump by conduit), pipes at the press (steel), cable at the wire mill (copper wire) — each at the
// pace its comment in content/recipes.ts promises; online and offline agree on a steel line; and a
// building put up before D123's prices refunds what it was paid (`costFloor`, sim/refund.ts),
// through a save too.
import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '@/content/buildings';
import { ITEMS } from '@/content/items';
import { COSTS_BEFORE_D123 } from '@/content/past-costs';
import { RECIPES } from '@/content/recipes';
import { RESEARCH, treePrereq } from '@/content/research';
import { nodeUnusable } from '@/content/usable';
import { itemIdx } from '@/content/registry';
import { WORLD_EPOCH0 } from './constants';
import { catchUp } from './offline/catchup';
import { refundCost } from './refund';
import { deserialize, serialize } from './serialize';
import { Sim } from './state';
import { learnPlans, steadyPower, stockedSilo, testSource, wire } from './testkit';
import { T } from './types';
import { FlatSource } from './world/grid';

/** D123's recipes and buildings. */
const D123_RECIPES = ['copper_plate', 'arc_copper', 'steel', 'brick', 'pipe', 'cable'] as const;
const D123_WORKS = ['steel_mill', 'brickworks'] as const;

/** A pond east of the Hearth (shallow water on the floor), as the steam boiler's test: where a pump stands. */
const POND = { x: 522, y: 502, w: 4, h: 6, t: T.Shallow } as const;

/** The testkit's world with the pond; every plan learnt, and the tree nodes D123's recipes and works hang from. */
function d123Sim(): Sim {
  const base = testSource();
  const sim = new Sim({ worldSeed: 7, playerSeed: 11, source: new FlatSource(base.deposits, [...base.rocks, POND]), foundingEpoch: WORLD_EPOCH0 + 24 });
  learnPlans(sim);
  for (const r of D123_RECIPES) sim.done.add(RECIPES[r].unlock);
  for (const b of [...D123_WORKS, 'press', 'electric_smelter'] as const) sim.done.add(BUILDINGS[b].unlock); // the press is Mechanics'
  sim.rebuildDerived();
  return sim;
}

/** Grant a building's price and place it; throws with the refusal. */
function put(sim: Sim, def: string, x: number, y: number, rot: 0 | 1 | 2 | 3 = 0): number {
  for (const [it, q] of (BUILDINGS as Record<string, { cost: ReadonlyArray<readonly [string, number]> }>)[def]!.cost) sim.grant(it, q);
  const r = sim.place(def, x, y, rot);
  if (!r.ok) throw new Error(`${def}: ${r.reason}`);
  return r.id!;
}

/**
 * A machine at (512, 503) whose output falls into an incinerator ahead of it (what it makes is
 * counted as made, then burnt), its one intake (512, 504) fed by a silo of `item` set against it.
 */
function oneFed(sim: Sim, def: string, recipe: string, item: string): number {
  const id = put(sim, def, 512, 503);
  expect(sim.setRecipe(id, recipe)).toBe(true);
  put(sim, 'incinerator', 512, 502);
  stockedSilo(sim, 512, 505, 0, item, 3000);
  return id;
}

/** A 2×2 machine at (512, 503) with two intakes at its back: `a` by ribbon from a silo to the west, `b` from one to the east. */
function twoFed(sim: Sim, def: string, recipe: string, a: string, b: string): number {
  const id = put(sim, def, 512, 503);
  expect(sim.setRecipe(id, recipe)).toBe(true);
  put(sim, 'incinerator', 512, 502);
  stockedSilo(sim, 510, 507, 0, a, 3000);
  stockedSilo(sim, 514, 507, 0, b, 3000);
  expect(sim.placeBelts('ribbon', [[511, 506, 1], [512, 506, 0], [512, 505, 0]])).toBe(3);
  expect(sim.placeBelts('ribbon', [[514, 506, 3], [513, 506, 0], [513, 505, 0]])).toBe(3);
  return id;
}

/** `item` made a minute over `min` minutes, after a 2-minute start. */
function perMin(sim: Sim, item: string, min: number): number {
  sim.run(1200);
  const it = itemIdx(item), p0 = sim.produced[it]!;
  sim.run(600 * min);
  return (sim.produced[it]! - p0) / 1000 / min;
}

describe('more to make of the basic resources (D123)', () => {
  it('the smelter casts 10 copper plates a minute from copper ore and coal, off the grid', () => {
    const sim = d123Sim();
    twoFed(sim, 'kiln', 'copper_plate', 'copper_ore', 'coal');
    expect(perMin(sim, 'copper_plate', 10)).toBeCloseTo(10, 1);
  });

  it('the electric smelter casts them from copper ore alone, on power', () => {
    const sim = d123Sim();
    steadyPower(sim);
    const id = oneFed(sim, 'electric_smelter', 'arc_copper', 'copper_ore');
    wire(sim, id);
    expect(perMin(sim, 'copper_plate', 10)).toBeCloseTo(10, 1);
    expect(sim.consumed[itemIdx('coal')]).toBe(0);
  });

  it('the steel mill blows 5 steel a minute out of one smelter’s 10 plates and 5 coal, on power', () => {
    const sim = d123Sim();
    steadyPower(sim);
    const id = twoFed(sim, 'steel_mill', 'steel', 'iron_plate', 'coal');
    wire(sim, id);
    const c0 = sim.consumed[itemIdx('iron_plate')]!;
    expect(perMin(sim, 'steel', 10)).toBeCloseTo(5, 1);
    expect((sim.consumed[itemIdx('iron_plate')]! - c0) / 1000 / 12).toBeCloseTo(10, 0);
    // Unwired, it stands.
    const s2 = d123Sim();
    twoFed(s2, 'steel_mill', 'steel', 'iron_plate', 'coal');
    expect(perMin(s2, 'steel', 3)).toBe(0);
  });

  it('the brickworks presses 15 bricks a minute from a collector’s 15 sand and 30 water by conduit', () => {
    const sim = d123Sim();
    steadyPower(sim);
    const id = put(sim, 'brickworks', 516, 505); // 516–517 × 505–506: sand in at (516,506) S, water at (517,506) S
    sim.setRecipe(id, 'brick'); // its one recipe since D151 (slag bricks gone): it starts on it (D83), set anyway
    put(sim, 'incinerator', 516, 504);
    stockedSilo(sim, 514, 508, 0, 'sand', 3000);
    expect(sim.placeBelts('ribbon', [[515, 507, 1], [516, 507, 0]])).toBe(2);
    const pump = put(sim, 'pump', 521, 507, 3);
    expect(sim.placeBelts('conduit', [[520, 507, 3], [519, 507, 3], [518, 507, 3], [517, 507, 0]])).toBe(4);
    wire(sim, [id, pump]);
    const s0 = sim.consumed[itemIdx('sand')]!, w0 = sim.consumed[itemIdx('water')]!;
    expect(perMin(sim, 'brick', 10)).toBeCloseTo(15, 1);
    expect((sim.consumed[itemIdx('sand')]! - s0) / 1000 / 12).toBeCloseTo(15, 0);
    expect((sim.consumed[itemIdx('water')]! - w0) / 1000 / 12).toBeCloseTo(30, 0);
  });

  it('the press rolls 10 pipes a minute out of 5 steel; the wire mill twists 10 cables out of 30 wires', () => {
    const a = d123Sim();
    steadyPower(a);
    wire(a, oneFed(a, 'press', 'pipe', 'steel'));
    expect(perMin(a, 'pipe', 10)).toBeCloseTo(10, 1);
    const b = d123Sim();
    steadyPower(b);
    wire(b, oneFed(b, 'wire_mill', 'cable', 'copper_wire'));
    const w0 = b.consumed[itemIdx('copper_wire')]!;
    expect(perMin(b, 'cable', 10)).toBeCloseTo(10, 1);
    expect((b.consumed[itemIdx('copper_wire')]! - w0) / 1000 / 12).toBeCloseTo(30, 0);
  });

  it('the tree: copper smelting opens the Foundry, the brickworks follows the Fast Drill, the steel mill needs both and the press; all before the Synthesis (D128)', () => {
    expect(RESEARCH.dn_copper.prereq).toEqual(['observatory']);
    expect(RESEARCH.dn3.prereq).toContain('dn_copper');
    expect(RESEARCH.ex_brick.prereq).toContain('ex_fastdrill');
    for (const p of ['dn3', 'tr1', 'ex_brick']) expect(RESEARCH.dn_steel.prereq).toContain(p);
    expect(RESEARCH.dn_esmelt.prereq).toContain('dn_steel');
    // The Synthesis needs them (D128: through the Workshop's twin wire mill, which the Steelworks' steel feeds).
    const before = new Set<string>();
    const walk = (id: string): void => { for (const p of treePrereq(id)) if (!before.has(p)) { before.add(p); walk(p); } };
    walk('tr_synth');
    for (const id of ['dn_copper', 'ex_brick', 'dn_steel']) {
      expect(RESEARCH[id as 'dn_copper'].tier).toBe(1);
      expect(before.has(id), id).toBe(true);
    }
    expect([RECIPES.copper_plate.unlock, RECIPES.steel.unlock, RECIPES.pipe.unlock, RECIPES.brick.unlock, RECIPES.arc_copper.unlock, RECIPES.cable.unlock])
      .toEqual(['dn_copper', 'dn_steel', 'dn_steel', 'ex_brick', 'dn_esmelt', 'dn_wiremill']);
    expect([BUILDINGS.steel_mill.unlock, BUILDINGS.brickworks.unlock]).toEqual(['dn_steel', 'ex_brick']);
    // What they unlock can be paid for, fed and run by then (D107), their resources had before them (D122).
    for (const id of ['dn_copper', 'ex_brick', 'dn_steel', 'dn_esmelt', 'dn_wiremill']) expect(nodeUnusable(id), id).toEqual([]);
  });

  it('online and offline agree on a steel line', () => {
    const make = (): Sim => {
      const sim = d123Sim();
      steadyPower(sim);
      wire(sim, twoFed(sim, 'steel_mill', 'steel', 'iron_plate', 'coal'));
      sim.run(600);
      return sim;
    };
    const on = make(), off = make();
    on.run(600 * 30);
    catchUp(off, 600 * 30);
    const steel = itemIdx('steel');
    expect(Math.abs(off.produced[steel]! - on.produced[steel]!)).toBeLessThanOrEqual(1000);
    expect(off.produced[steel]!).toBeGreaterThan(100_000);
  });
});

describe('what a building put up before D123 refunds (costFloor)', () => {
  it('the table names buildings whose price D123 changed, in items that exist', () => {
    for (const [id, old] of Object.entries(COSTS_BEFORE_D123)) {
      const b = (BUILDINGS as Record<string, { cost: ReadonlyArray<readonly [string, number]> } | undefined>)[id];
      expect(b, id).toBeDefined();
      for (const [it] of old!) expect(ITEMS, `${id}: ${it}`).toHaveProperty(it);
      expect(JSON.stringify(old)).not.toBe(JSON.stringify(b!.cost));
    }
  });

  it('below the floor its old price comes back, above it today’s', () => {
    const sim = d123Sim();
    sim.done.add('ex_sifter');
    sim.rebuildDerived();
    const old = put(sim, 'sifter', 500, 520);
    sim.costFloor = sim.ents.nextId; // as a save from before D123 would set it
    const now = put(sim, 'sifter', 504, 520);
    const plate = itemIdx('iron_plate'), steel = itemIdx('steel');
    expect(refundCost(sim, sim.ents.get(old)!)).toEqual(COSTS_BEFORE_D123.sifter!.map(([it, q]) => ({ item: itemIdx(it), mu: q * 1000 })));
    const p0 = sim.stock[plate]!, s0 = sim.stock[steel]!;
    expect(sim.remove(500, 520)).toBe(true);
    expect(sim.stock[plate]! - p0).toBe(20_000); // the 20 plates it was built for
    expect(sim.stock[steel]! - s0).toBe(0);
    const p1 = sim.stock[plate]!, s1 = sim.stock[steel]!;
    expect(sim.remove(504, 520)).toBe(true);
    expect(sim.stock[steel]! - s1).toBe(6_000); // today's: steel and fewer plates
    expect(sim.stock[plate]! - p1).toBe(10_000);
    expect(now).toBeGreaterThan(old);
  });

  it('a save keeps its floor; one from before D123 (no floor) puts it at its next id', () => {
    const sim = d123Sim();
    put(sim, 'brickworks', 516, 505);
    sim.costFloor = 2;
    const back = deserialize(JSON.parse(JSON.stringify(serialize(sim))), sim.grid.source as never);
    expect(back.costFloor).toBe(2);
    expect(back.hash()).toBe(sim.hash());
    const old = JSON.parse(JSON.stringify(serialize(sim)));
    delete old.costFloor;
    expect(deserialize(old, sim.grid.source as never).costFloor).toBe(old.nextId);
    // A new base has no floor: everything it builds refunds today's prices.
    expect(d123Sim().costFloor).toBe(0);
  });
});
