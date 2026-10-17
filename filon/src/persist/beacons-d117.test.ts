// beacons-d117.test.ts — save 16 → 17 (D117): no survey beacon, no unloader. A save of version 16 may
// hold survey beacons and unloaders (retired ids: the remap takes them down, refunds them at
// `RETIRED_COSTS` and hands an unloader's held item to the Heart), their plans (the step drops them
// from `done` and hands their cost back, `PLANS_RETIRED[17]`), the fog the beacons lifted (kept whole)
// and a Core above level 1 (the step lifts the fog as far as its level does now, `CORE_REVEAL_V17`).
// Played on forged saves: a small base, and the debug bases on maps 3 and 4 (the owner's base stands
// on one of them), each made a version-16 save holding beacons out past the Crown, unloaders against
// a silo and both plans. The check that nothing but those is lost: the loaded base, with the refunds
// taken back out of the Heart and the fog it was owed taken back off, has the very hash of the same
// base saved without them.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { ITEM_IDS, itemIdx } from '@/content/registry';
import { PLAN_IDS } from '@/content/research';
import { CORE_REVEAL_V17, PLANS_RETIRED, RETIRED_COSTS } from '@/content/retired';
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
 * A version-16 save of `sim` that also holds `olds`, both plans, a fog disc of 40 round each beacon
 * (what it lifted) and the Core at `level`. Returns the save, what its load must hand the Heart
 * (milli-items by item index) and the fog discs it must hold beyond the base's own.
 */
function forge(sim: Sim, olds: Old[], level = sim.hearthLevel): { data: Record<string, unknown>; owed: Map<number, number>; fog: Array<[number, number, number]> } {
  const d = JSON.parse(JSON.stringify(serialize(sim))) as SaveData & Record<string, unknown>;
  const content = d.content!;
  const owed = new Map<number, number>();
  const owe = (it: string, mu: number): void => { const i = itemIdx(it); owed.set(i, (owed.get(i) ?? 0) + mu); };
  const fog: Array<[number, number, number]> = [];
  for (const o of olds) {
    let def = content.buildings.indexOf(o.def);
    if (def < 0) { def = content.buildings.length; content.buildings.push(o.def); }
    const id = d.nextId++;
    d.ents.push(id, def, o.x, o.y, 0, o.held ? itemIdx(o.held[0]) + 1 : 0, 0);
    for (const [it, n] of RETIRED_COSTS[o.def]!) owe(it, n * 1000);
    if (o.held) { d.nodes.push([id, { item: itemIdx(o.held[0]), mu: o.held[1], turn: 1 }]); owe(o.held[0], o.held[1]); }
    if (o.def === 'beacon') { d.explored.push([o.x, o.y, 40]); fog.push([o.x, o.y, 40]); }
  }
  for (const [, cost] of Object.entries(PLANS_RETIRED[17]!)) for (const [it, n] of cost) owe(it, n * 1000);
  // A save 16 never held a Core above level 4 (level 5 came with D118); the step reads it as 4.
  if (level > 1) fog.push([CENTER, CENTER, CORE_REVEAL_V17[Math.min(CORE_REVEAL_V17.length, level) - 1]!]);
  return { data: { ...d, v: 16, hearthLevel: level, done: [...d.done, 'beacon', 'unloader'].sort() }, owed, fog };
}

/** The forged save through the chain, the remap and the load, as `rebuild` opens it (persist/colony.ts). */
function open(data: Record<string, unknown>, sim: Sim): { back: Sim; note: ReturnType<typeof remapSave>['note'] } {
  const m = migrate(data as unknown as { v: number });
  expect(m.from).toBe(16);
  expect(m.data.v).toBe(SAVE_VERSION);
  const r = remapSave(m.data);
  return { back: deserialize(r.data, sim.grid.source), note: r.note };
}

/** The loaded base with its refunds taken back out of the Heart and its owed fog off: it must be the base saved without the retired buildings. */
function sameButRetired(back: Sim, clean: Sim, owed: Map<number, number>, fog: Array<[number, number, number]>): void {
  for (let i = 0; i < clean.stock.length; i++) {
    expect(back.stock[i]! - clean.stock[i]!, `${ITEM_IDS[i]} handed to the Heart`).toBe(owed.get(i) ?? 0);
    back.stock[i] = clean.stock[i]!;
  }
  // The fog the beacons lifted stays lifted, the Core's level lifts its own: kept after the base's own.
  expect(back.explored.slice(0, clean.explored.length)).toEqual(clean.explored);
  expect(back.explored.slice(clean.explored.length)).toEqual(fog);
  for (const [x, y, r] of fog) expect(back.revealed(x + r - 1, y), `${x},${y} r ${r} lifted`).toBe(true);
  back.explored.length = clean.explored.length;
  expect([...back.done].some((id) => id === 'beacon' || id === 'unloader')).toBe(false);
  expect(back.ents.size).toBe(clean.ents.size);
  expect(back.hash(), 'the rest of the base as it was').toBe(clean.hash());
}

describe('save 16 → 17 (D117): no survey beacon, no unloader', () => {
  it('the step drops both plans and hands their cost back, and lifts the fog round a raised Core', () => {
    const items = ['iron_plate', 'glass', 'copper_wire'];
    const run = beaconsRetired({
      v: 16, content: { items, buildings: [], recipes: [], recipeSigs: [] }, stock: [5000, 0, 1000],
      done: ['beacon', 'ex_quartz', 'kiln', 'unloader'], hearthLevel: 3, explored: [[512, 512, 44], [600, 480, 40]],
    });
    // 8 + 6 plates, 2 glass, 2 copper wire; the Core at level 3 lifts 68 tiles round it.
    expect(run.stock).toEqual([19_000, 2000, 3000]);
    expect(run.done).toEqual(['ex_quartz', 'kiln']);
    expect(run.explored).toEqual([[512, 512, 44], [600, 480, 40], [CENTER, CENTER, 68]]);
    expect(BAL.coreReveal.slice(0, CORE_REVEAL_V17.length)).toEqual(CORE_REVEAL_V17); // level 5 since D118
    // A claim that never had either, at level 1, loses and gains nothing.
    const young = beaconsRetired({ v: 16, stock: [1, 2], done: ['kiln'], hearthLevel: 1, explored: [[512, 512, 44]] });
    expect(young).toEqual({ v: 16, stock: [1, 2], done: ['kiln'], hearthLevel: 1, explored: [[512, 512, 44]] });
    // The tree holds neither plan any more, nor a survey path.
    expect(PLAN_IDS.some((id) => id === ('beacon' as string) || id === ('unloader' as string))).toBe(false);
  });

  it('a small base: its beacons and unloaders come down refunded, an unloader’s item in the Heart, the fog they lifted kept, nothing else changed', () => {
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
    const { data, owed, fog } = forge(sim, olds, 2);
    const { back, note } = open(data, sim);
    // The player is told: two beacons and two unloaders came down, refunded; no item lost.
    expect(note?.removed).toEqual([{ id: 'beacon', n: 2, refunded: true }, { id: 'unloader', n: 2, refunded: true }]);
    expect(note?.lost).toEqual([]);
    const clean = deserialize(JSON.parse(JSON.stringify(serialize(sim))) as SaveData, sim.grid.source);
    expect(back.hearthLevel).toBe(2);
    back.hearthLevel = clean.hearthLevel;
    sameButRetired(back, clean, owed, fog);
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
    const { data, owed, fog } = forge(sim, olds);
    const { back, note } = open(data, sim);
    expect(note?.removed).toEqual([{ id: 'beacon', n: 2, refunded: true }, { id: 'unloader', n: 1, refunded: true }]);
    expect(note?.lost).toEqual([]);
    const clean = deserialize(JSON.parse(JSON.stringify(serialize(sim))) as SaveData, sim.grid.source);
    sameButRetired(back, clean, owed, fog);
    // It runs on as the base saved without them does (their refunds taken out above).
    back.run(3000);
    clean.run(3000);
    expect(back.hash()).toBe(clean.hash());
  }, 30_000);
});
