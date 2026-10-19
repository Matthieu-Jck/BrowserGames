// beacons-d117.test.ts — save 16 → 17 (D117): no survey beacon, no unloader. A save of version 16 may
// hold survey beacons and unloaders (retired ids: the remap takes them down, refunds them at
// `RETIRED_COSTS` and hands an unloader's held item to the Heart), their plans (the step drops them
// from `done` and hands their cost back, `PLANS_RETIRED[17]`) and the fog the beacons lifted — which
// the chain now drops whole on its way to today's version (D148, step 22 → 23: no fog of war), so an
// old save's reveal data loads as nothing. Played on forged saves: a small base, and the debug bases on maps 3 and 4 (the owner's base stands
// on one of them), each made a version-16 save holding beacons out past the Crown, unloaders against
// a silo and both plans. The check that nothing but those is lost: the loaded base, with the refunds
// taken back out of the Heart, has the very hash of the same base saved without them.
import { describe, it, expect } from 'vitest';
import { ITEM_IDS, itemIdx } from '@/content/registry';
import { PLAN_IDS } from '@/content/research';
import { PLANS_RETIRED, RETIRED_COSTS } from '@/content/retired';
import { CENTER, WORLD_EPOCH0 } from '@/sim/constants';
import { remapSave } from '@/sim/save-remap';
import { foundScenario } from '@/sim/scenarios';
import { deserialize, serialize, SAVE_VERSION, type SaveData } from '@/sim/serialize';
import type { Sim } from '@/sim/state';
import { testSim } from '@/sim/testkit';
import { beaconsRetired, migrate } from './migrate';

/** A retired building to forge into a save: its id, where it stood, and (an unloader) the item it held. */
type Old = { def: 'beacon' | 'unloader'; x: number; y: number; held?: [string, number] };

/**
 * A version-16 save of `sim` that also holds `olds`, both plans, the fog it had lifted as a save of
 * then did (`explored`: the founding's disc and one of 40 round each beacon) and the Core at `level`.
 * Returns the save and what its load must hand the Heart (milli-items by item index).
 */
function forge(sim: Sim, olds: Old[], level = sim.hearthLevel): { data: Record<string, unknown>; owed: Map<number, number> } {
  const d = JSON.parse(JSON.stringify(serialize(sim))) as SaveData & Record<string, unknown>;
  const content = d.content!;
  const owed = new Map<number, number>();
  const owe = (it: string, mu: number): void => { const i = itemIdx(it); owed.set(i, (owed.get(i) ?? 0) + mu); };
  const explored: Array<[number, number, number]> = [[CENTER, CENTER, 44]];
  for (const o of olds) {
    let def = content.buildings.indexOf(o.def);
    if (def < 0) { def = content.buildings.length; content.buildings.push(o.def); }
    const id = d.nextId++;
    d.ents.push(id, def, o.x, o.y, 0, o.held ? itemIdx(o.held[0]) + 1 : 0, 0);
    for (const [it, n] of RETIRED_COSTS[o.def]!) owe(it, n * 1000);
    if (o.held) { d.nodes.push([id, { item: itemIdx(o.held[0]), mu: o.held[1], turn: 1 }]); owe(o.held[0], o.held[1]); }
    if (o.def === 'beacon') explored.push([o.x, o.y, 40]);
  }
  for (const [, cost] of Object.entries(PLANS_RETIRED[17]!)) for (const [it, n] of cost) owe(it, n * 1000);
  return { data: { ...d, v: 16, hearthLevel: level, done: [...d.done, 'beacon', 'unloader'].sort(), explored }, owed };
}

/** The forged save through the chain, the remap and the load, as `rebuild` opens it (persist/colony.ts). */
function open(data: Record<string, unknown>, sim: Sim): { back: Sim; note: ReturnType<typeof remapSave>['note'] } {
  const m = migrate(data as unknown as { v: number });
  expect(m.from).toBe(16);
  expect(m.data.v).toBe(SAVE_VERSION);
  expect('explored' in m.data, 'the fog dropped on the way (D148)').toBe(false);
  const r = remapSave(m.data);
  return { back: deserialize(r.data, sim.grid.source), note: r.note };
}

/** The loaded base with its refunds taken back out of the Heart: it must be the base saved without the retired buildings. */
function sameButRetired(back: Sim, clean: Sim, owed: Map<number, number>): void {
  for (let i = 0; i < clean.stock.length; i++) {
    expect(back.stock[i]! - clean.stock[i]!, `${ITEM_IDS[i]} handed to the Heart`).toBe(owed.get(i) ?? 0);
    back.stock[i] = clean.stock[i]!;
  }
  expect([...back.done].some((id) => id === 'beacon' || id === 'unloader')).toBe(false);
  // Save 20 (D128): a claim holding the Face Cutter's plan holds the quartz workshop's own node too.
  if (clean.done.has('ex_quartz') && !clean.done.has('dn_quartzshop')) {
    expect(back.done.has('dn_quartzshop')).toBe(true);
    back.done.delete('dn_quartzshop');
    back.rebuildDerived();
  }
  expect(back.ents.size).toBe(clean.ents.size);
  expect(back.hash(), 'the rest of the base as it was').toBe(clean.hash());
}

describe('save 16 → 17 (D117): no survey beacon, no unloader', () => {
  it('the step drops both plans and hands their cost back (the fog it once lifted round a raised Core went with D148)', () => {
    const items = ['iron_plate', 'glass', 'copper_wire'];
    const run = beaconsRetired({
      v: 16, content: { items, buildings: [], recipes: [], recipeSigs: [] }, stock: [5000, 0, 1000],
      done: ['beacon', 'ex_quartz', 'kiln', 'unloader'], hearthLevel: 3, explored: [[512, 512, 44], [600, 480, 40]],
    });
    // 8 + 6 plates, 2 glass, 2 copper wire; the explored discs passed on as they were (step 22 drops them).
    expect(run.stock).toEqual([19_000, 2000, 3000]);
    expect(run.done).toEqual(['ex_quartz', 'kiln']);
    expect(run.explored).toEqual([[512, 512, 44], [600, 480, 40]]);
    // A claim that never had either, at level 1, loses and gains nothing.
    const young = beaconsRetired({ v: 16, stock: [1, 2], done: ['kiln'], hearthLevel: 1, explored: [[512, 512, 44]] });
    expect(young).toEqual({ v: 16, stock: [1, 2], done: ['kiln'], hearthLevel: 1, explored: [[512, 512, 44]] });
    // The tree holds neither plan any more, nor a survey path.
    expect(PLAN_IDS.some((id) => id === ('beacon' as string) || id === ('unloader' as string))).toBe(false);
  });

  it('a small base: its beacons and unloaders come down refunded, an unloader’s item in the Heart, the fog they lifted dropped, nothing else changed', () => {
    const sim = testSim();
    const silo = sim.place('silo', 520, 504, 0);
    expect(silo.ok, silo.reason).toBe(true);
    sim.run(50);
    const olds: Old[] = [
      { def: 'beacon', x: 560, y: 470 },
      { def: 'beacon', x: 470, y: 560 },
      { def: 'unloader', x: 522, y: 504, held: ['glass', 1000] },
      { def: 'unloader', x: 519, y: 504 },
    ];
    const { data, owed } = forge(sim, olds, 2);
    const { back, note } = open(data, sim);
    // The player is told: two beacons and two unloaders came down, refunded; no item lost.
    expect(note?.removed).toEqual([{ id: 'beacon', n: 2, refunded: true }, { id: 'unloader', n: 2, refunded: true }]);
    expect(note?.lost).toEqual([]);
    const clean = deserialize(JSON.parse(JSON.stringify(serialize(sim))) as SaveData, sim.grid.source);
    expect(back.hearthLevel).toBe(2);
    back.hearthLevel = clean.hearthLevel;
    sameButRetired(back, clean, owed);
    // It saves at today's version and loads again unchanged.
    const again = deserialize(JSON.parse(JSON.stringify(serialize(back))) as SaveData, sim.grid.source);
    expect(again.hash()).toBe(back.hash());
  });

  it.each([3, 4])('a debug base on map %i, saved with beacons past the Crown and unloaders, loads with nothing lost but those and runs on', (mapV) => {
    const { sim } = foundScenario(mapV === 4 ? 'late' : 'grown', { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai', mapV });
    const olds: Old[] = [
      { def: 'beacon', x: CENTER + 50, y: CENTER - 10 },
      { def: 'beacon', x: CENTER - 70, y: CENTER + 40 },
      { def: 'unloader', x: 300, y: 300, held: ['iron_plate', 1000] },
    ];
    const { data, owed } = forge(sim, olds);
    const { back, note } = open(data, sim);
    expect(note?.removed).toEqual([{ id: 'beacon', n: 2, refunded: true }, { id: 'unloader', n: 1, refunded: true }]);
    expect(note?.lost).toEqual([]);
    const clean = deserialize(JSON.parse(JSON.stringify(serialize(sim))) as SaveData, sim.grid.source);
    sameButRetired(back, clean, owed);
    // It runs on as the base saved without them does (their refunds taken out above).
    back.run(3000);
    clean.run(3000);
    expect(back.hash()).toBe(clean.hash());
  }, 30_000);
});
