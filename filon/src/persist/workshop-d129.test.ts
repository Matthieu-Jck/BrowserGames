// workshop-d129.test.ts — save 20 → 21 (D129): the electronics workshop is a Tier 2 research node of
// its old plan's id (`workshop`), the assembly bench a plan of the Production path in its place
// (`assemblyBench`). A claim that took the workshop's plan holds the node: its workshops stand, keep
// their recipe and stay buildable. A claim holding the research lab's plan — the gate that needs
// every plan — holds the bench's plan too. And the buildings whose price D129 changed refund what
// they were paid when they come down (`costFloorD129`, content/past-costs.ts `COSTS_BEFORE_D129`):
// an old workshop gives back its plates, glass and wire, never steel, cable or oscillators.
import { describe, it, expect } from 'vitest';
import { COSTS_BEFORE_D129 } from '@/content/past-costs';
import { BUILDINGS } from '@/content/buildings';
import { itemIdx, recipeIdx } from '@/content/registry';
import { remapSave } from '@/sim/save-remap';
import { refundCost } from '@/sim/refund';
import { deserialize, serialize, SAVE_VERSION, type SaveData } from '@/sim/serialize';
import type { Sim } from '@/sim/state';
import { grantCost, testSim } from '@/sim/testkit';
import { recipeOf } from '@/sim/cfg';
import { assemblyBench, migrate } from './migrate';

/** A save 20 of `sim`: before D129 — no bench plan, no second price floor. */
function save20(sim: Sim): SaveData {
  const d = JSON.parse(JSON.stringify(serialize(sim))) as SaveData;
  d.v = 20;
  d.done = d.done.filter((id) => id !== 'assembly_bench');
  delete d.costFloorD129;
  return d;
}

/** The save through the chain, the remap and the load. */
function open(d: SaveData, sim: Sim): Sim {
  const m = migrate(d as unknown as { v: number });
  expect([m.from, m.data.v]).toEqual([20, SAVE_VERSION]);
  return deserialize(remapSave(m.data).data, sim.grid.source);
}

/** A claim of before D129: every plan of then (the workshop's among them, the lab's), a workshop standing on circuits. */
function oldClaim(): { sim: Sim; shop: number } {
  const sim = testSim(); // every plan of today's tree…
  sim.done.add('workshop'); // …and the workshop's plan of then, whose id the Tier 2 node keeps
  sim.rebuildDerived();
  grantCost(sim, 'workshop');
  const r = sim.place('workshop', 520, 520, 0);
  expect(r.ok, r.reason).toBe(true);
  expect(sim.setRecipe(r.id!, 'circuit')).toBe(true);
  return { sim, shop: r.id! };
}

describe('save 20 → 21 (D129): the electronics workshop at Tier 2, the assembly bench in its place', () => {
  it('the step: a claim holding the lab’s plan holds the bench’s; a younger one is left alone', () => {
    expect(assemblyBench({ v: 20, done: ['observatory', 'workshop'] }).done).toEqual(['assembly_bench', 'observatory', 'workshop']);
    const young = { v: 20, done: ['kiln', 'wire_mill', 'workshop'] };
    expect(assemblyBench(young)).toBe(young);
    const already = { v: 20, done: ['assembly_bench', 'observatory'] };
    expect(assemblyBench(already)).toBe(already);
  });

  it('a claim that took the workshop’s plan: the node held, its workshop standing on its recipe, buildable still; the bench’s plan given', () => {
    const { sim, shop } = oldClaim();
    const back = open(save20(sim), sim);
    expect(back.done.has('workshop')).toBe(true);
    expect(back.unlocked('workshop')).toBe(true);
    expect(back.done.has('assembly_bench')).toBe(true); // it holds the lab's plan
    expect(recipeOf(back.ents.get(shop)!.cfg)).toBe(recipeIdx('circuit') + 1);
    grantCost(back, 'workshop');
    expect(back.place('workshop', 524, 520, 0).ok).toBe(true);
    // It runs on today's circuit: a copper plate, two wires, a glass.
    back.ensureCompiled();
    const node = back.graph.nodeByEnt.get(shop) as unknown as { inBuf: number[] };
    node.inBuf[0] = 1000; node.inBuf[1] = 2000; node.inBuf[2] = 1000; // a craft's worth (sandbox write)
    const c0 = back.produced[itemIdx('circuit')]!;
    for (const id of [shop]) back.link(back.hearthId, id);
    back.run(120);
    expect(back.produced[itemIdx('circuit')]! - c0).toBe(1000);
  });

  it('a workshop built before D129 refunds what it cost then; one built after, today’s price', () => {
    const { sim, shop } = oldClaim();
    const back = open(save20(sim), sim);
    expect(back.costFloorD129).toBe(sim.ents.nextId); // a save from before: everything it holds paid the old prices
    expect(refundCost(back, back.ents.get(shop)!)).toEqual(COSTS_BEFORE_D129.workshop!.map(([it, q]) => ({ item: itemIdx(it), mu: q * 1000 })));
    const steel = itemIdx('steel'), plate = itemIdx('iron_plate'), osc = itemIdx('oscillator');
    const [s0, p0, o0] = [back.stock[steel]!, back.stock[plate]!, back.stock[osc]!];
    const e = back.ents.get(shop)!;
    expect(back.remove(e.x, e.y)).toBe(true);
    expect(back.stock[plate]! - p0).toBe(20_000); // its 20 plates of then
    expect([back.stock[steel]! - s0, back.stock[osc]! - o0]).toEqual([0, 0]);
    // Built today: today's price comes back.
    grantCost(back, 'workshop');
    const now = back.place('workshop', 524, 520, 0);
    expect(now.ok, now.reason).toBe(true);
    const s1 = back.stock[steel]!;
    const n = back.ents.get(now.id!)!;
    expect(back.remove(n.x, n.y)).toBe(true);
    expect(back.stock[steel]! - s1).toBe((BUILDINGS.workshop.cost.find(([it]) => it === 'steel')![1]) * 1000);
  });

  it('the floor round-trips; a new base has none', () => {
    const { sim } = oldClaim();
    sim.costFloorD129 = 3;
    const back = deserialize(JSON.parse(JSON.stringify(serialize(sim))), sim.grid.source);
    expect(back.costFloorD129).toBe(3);
    expect(back.hash()).toBe(sim.hash());
    expect(testSim().costFloorD129).toBe(0);
  });

  it('a claim before the lab keeps the workshop it had and takes the bench’s plan as any other', () => {
    const sim = testSim(undefined, { plans: false });
    for (const id of ['kiln', 'sand_collector', 'wire_mill', 'workshop']) sim.done.add(id);
    sim.rebuildDerived();
    const back = open(save20(sim), sim);
    expect(back.done.has('workshop')).toBe(true);
    expect(back.done.has('assembly_bench')).toBe(false);
    back.grant('iron_plate', 40); back.grant('copper_wire', 10);
    expect(back.unlockPlan('assembly_bench').ok).toBe(true);
  });
});
