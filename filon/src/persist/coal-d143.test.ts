// coal-d143.test.ts — save 21 → 22 (D143; owner, 2026-10-19: « coal incinerator, delete it »): no
// coal generator. A save of version 21 may hold coal generators (`brazier`: a retired id, so the remap
// takes them down, refunds them at `RETIRED_COSTS`, hands the coal in their box to the Heart through
// `RETIRED_FUEL` and drops their wires), a ribbon that fed one (it keeps its coal and backs up, as a
// line ending nowhere does), and the generator's plan (the step drops it from `done` and hands its
// cost back, `PLANS_RETIRED[22]`). Played on forged saves: a small base whose generator was fed from a
// silo and wired to the Core, and the tutorial debug base with one standing wired. The check that
// nothing but those is lost: the loaded base, with the refunds taken back out of the Heart, has the
// very hash of the same base saved without them.
import { describe, it, expect } from 'vitest';
import { ITEM_IDS, itemIdx } from '@/content/registry';
import { PLAN_IDS, treePrereq } from '@/content/research';
import { PLANS_RETIRED, RETIRED_COSTS, RETIRED_FUEL, RETIRED_NAMES } from '@/content/retired';
import { WORLD_EPOCH0 } from '@/sim/constants';
import { remapSave } from '@/sim/save-remap';
import { foundScenario } from '@/sim/scenarios';
import { deserialize, serialize, SAVE_VERSION, type SaveData } from '@/sim/serialize';
import type { Sim } from '@/sim/state';
import { stockedSilo, testSim, uprightJunctions } from '@/sim/testkit';
import { coalRetired, migrate, MIGRATIONS } from './migrate';

/** A coal generator to forge into a save: where it stood, the coal in its box (mu), and what it was wired to. */
type Old = { x: number; y: number; fuel: number; wiredTo: number };

/**
 * A version-21 save of `sim` that also holds `olds` (each a coal generator standing, built, its box
 * holding `fuel`, a wire to `wiredTo`) and the generator's plan. Returns the save and what its load
 * must hand the Heart (milli-items by item index).
 */
function forge(sim: Sim, olds: Old[]): { data: Record<string, unknown>; owed: Map<number, number>; ids: number[] } {
  const d = JSON.parse(JSON.stringify(serialize(sim))) as SaveData & Record<string, unknown>;
  const content = d.content!;
  const owed = new Map<number, number>();
  const owe = (it: string, mu: number): void => { const i = itemIdx(it); owed.set(i, (owed.get(i) ?? 0) + mu); };
  const ids: number[] = [];
  for (const o of olds) {
    let def = content.buildings.indexOf('brazier');
    if (def < 0) { def = content.buildings.length; content.buildings.push('brazier'); }
    const id = d.nextId++;
    ids.push(id);
    d.ents.push(id, def, o.x, o.y, 0, 0, 0);
    // A generator node's state as v21 wrote it (sim/flow/nodes.ts `GeneratorNode.snapshot`).
    d.nodes.push([id, { fuel: o.fuel, carry: 123_456, status: 0 }]);
    d.links = [...(d.links ?? []), o.wiredTo, id];
    for (const [it, n] of RETIRED_COSTS.brazier!) owe(it, n * 1000);
    owe(RETIRED_FUEL.brazier!, o.fuel);
  }
  for (const [it, n] of PLANS_RETIRED[22]!.brazier!) owe(it, n * 1000);
  return { data: { ...d, v: 21, done: [...d.done, 'brazier'].sort() }, owed, ids };
}

/** The forged save through the chain, the remap and the load, as `rebuild` opens it (persist/colony.ts). */
function open(data: Record<string, unknown>, sim: Sim): { back: Sim; note: ReturnType<typeof remapSave>['note'] } {
  const m = migrate(data as unknown as { v: number });
  expect(m.from).toBe(21);
  expect(m.data.v).toBe(SAVE_VERSION);
  const r = remapSave(m.data);
  return { back: deserialize(r.data, sim.grid.source), note: r.note };
}

/** The loaded base with its refunds taken back out of the Heart: it must be the base saved without the generators. */
function sameButRetired(back: Sim, clean: Sim, owed: Map<number, number>, ids: number[]): void {
  for (let i = 0; i < clean.stock.length; i++) {
    expect(back.stock[i]! - clean.stock[i]!, `${ITEM_IDS[i]} handed to the Heart`).toBe(owed.get(i) ?? 0);
    back.stock[i] = clean.stock[i]!;
  }
  expect(back.done.has('brazier')).toBe(false);
  for (const id of ids) {
    expect(back.ents.get(id), `generator ${id} came down`).toBeUndefined();
    expect(back.links.pairs().some(([a, b]) => a === id || b === id), `generator ${id}'s wires`).toBe(false);
  }
  expect(back.links.pairs()).toEqual(clean.links.pairs());
  expect(back.ents.size).toBe(clean.ents.size);
  expect(back.hash(), 'the rest of the base as it was').toBe(clean.hash());
}

describe('save 21 → 22 (D143): no coal generator', () => {
  it('the step drops its plan and hands its cost back; a claim without it is left alone', () => {
    expect(MIGRATIONS[21]).toBe(coalRetired);
    const items = ['iron_plate', 'glass', 'copper_wire'];
    const run = coalRetired({
      v: 21, content: { items, buildings: [], recipes: [], recipeSigs: [] }, stock: [5000, 0, 1000],
      done: ['brazier', 'kiln', 'steam', 'wind_flower'],
    });
    // 15 plates and 2 copper wire, by the save's own item table.
    expect(run.stock).toEqual([20_000, 0, 3000]);
    expect(run.done).toEqual(['kiln', 'steam', 'wind_flower']);
    const young = { v: 21, stock: [1, 2], done: ['kiln', 'wind_flower'] };
    expect(coalRetired(young)).toBe(young);
    // The tree holds no coal generator; Steam Power hangs from the turbine's plan, which every claim that had the generator's holds.
    expect(PLAN_IDS.some((id) => id === ('brazier' as string))).toBe(false);
    expect(treePrereq('steam')).toEqual(['wind_flower']);
    // The absence report names it.
    expect(RETIRED_NAMES.brazier).toEqual({ fr: 'Générateur à charbon', en: 'Coal Generator' });
  });

  it('a small base: its generator, fed from a silo and wired to the Core, comes down refunded with its coal; the ribbon keeps its coal; nothing else changed', () => {
    const sim = testSim();
    // Coal from a silo below where the generator stood (as power/links.test.ts fed it until D143):
    // out (507,520) → one ribbon square up into its inlet at (507,518).
    stockedSilo(sim, 507, 520, 0, 'coal', 40);
    expect(sim.placeBelts('ribbon', [[507, 519, 0]])).toBe(1);
    sim.run(50);
    const { data, owed, ids } = forge(sim, [{ x: 507, y: 517, fuel: 4_250, wiredTo: sim.hearthId }]);
    const { back, note } = open(data, sim);
    // The player is told: one coal generator came down, refunded; no item lost.
    expect(note?.removed).toEqual([{ id: 'brazier', n: 1, refunded: true }]);
    expect(note?.lost).toEqual([]);
    const clean = deserialize(JSON.parse(JSON.stringify(serialize(sim))) as SaveData, sim.grid.source);
    sameButRetired(back, clean, owed, ids);
    // The line that fed it backs up, its coal kept, as in the base saved without it.
    back.run(600);
    clean.run(600);
    expect(back.hash()).toBe(clean.hash());
    // It saves at today's version and loads again unchanged.
    const again = deserialize(JSON.parse(JSON.stringify(serialize(back))) as SaveData, sim.grid.source);
    expect(again.hash()).toBe(back.hash());
  });

  it('the tutorial debug base, saved with two coal generators standing wired, loads with nothing lost but those and runs on', () => {
    // Its junctions upright: the chain's step 23 → 24 sets them so (D158), and the hash checks compare.
    const sim = uprightJunctions(foundScenario('tutorial', { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai' }).sim);
    const { data, owed, ids } = forge(sim, [
      { x: 300, y: 300, fuel: 5_000, wiredTo: sim.hearthId },
      { x: 302, y: 300, fuel: 0, wiredTo: sim.hearthId },
    ]);
    const { back, note } = open(data, sim);
    expect(note?.removed).toEqual([{ id: 'brazier', n: 2, refunded: true }]);
    expect(note?.lost).toEqual([]);
    const clean = deserialize(JSON.parse(JSON.stringify(serialize(sim))) as SaveData, sim.grid.source);
    sameButRetired(back, clean, owed, ids);
    back.run(3000);
    clean.run(3000);
    expect(back.hash()).toBe(clean.hash());
  }, 30_000);
});
