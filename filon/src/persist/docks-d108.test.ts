// docks-d108.test.ts — save 14 → 15 (D108): no skydocks. A save of version 14 may hold skydocks and
// Great Skydocks (retired ids: the remap takes them down, refunds them at `RETIRED_COSTS` and hands
// what they held docked to the Heart), drifters (the step refunds each at `RETIRED_DRIFTER`), freight
// routes (dropped: a route's carry was never taken from a dock) and the Great Skydock's node (forgotten,
// a project of it cancelled, its paid data back to the Heart — banked as tokens since D122, the data
// gone from the content). Played on forged saves: a small base and
// the debug bases on maps 3 and 4 (the owner's base stands on one of them), each made a version-14 save
// holding docks, drifters and a route the way the late base held them. The check that nothing but the
// docks is lost: the loaded base, with the refunds taken back out of the Heart, has the very hash of the
// same base saved at version 14 without the docks and opened through the same chain — so the steps
// after this one (v16 the steam plan, D114; v17 the Core's fog, D117) act on both alike.
import { describe, it, expect } from 'vitest';
import { ITEM_IDS, itemIdx } from '@/content/registry';
import { RESEARCH_RETIRED, RETIRED_COSTS, RETIRED_DRIFTER } from '@/content/retired';
import { WORLD_EPOCH0 } from '@/sim/constants';
import { remapSave } from '@/sim/save-remap';
import { foundScenario } from '@/sim/scenarios';
import { deserialize, serialize, SAVE_VERSION, type SaveData } from '@/sim/serialize';
import type { Sim } from '@/sim/state';
import { testSim } from '@/sim/testkit';
import { docksRetired, migrate } from './migrate';

/** A dock to forge into a save: its building id, where it stood, what it held docked, its outlets' items, its drifters. */
type Dock = { def: 'skydock' | 'big_dock'; x: number; y: number; held: Array<[string, number]>; outlets: Array<string | null>; ships: number };

/**
 * A version-14 save of `sim` that also holds `docks` (wired to the Heart), a route between the first
 * two carrying `routeItem` (when there are two), and, when `lab` is given, the Great Skydock's node
 * learnt there before and a project of it under way with data paid. Returns the save and what its
 * load must hand the Heart (milli-items by item index). With no docks: the same base saved at 14.
 */
function forge(sim: Sim, docks: Dock[], routeItem = 'iron_plate', lab?: number): { data: Record<string, unknown>; owed: Map<number, number> } {
  const d = JSON.parse(JSON.stringify(serialize(sim))) as SaveData & Record<string, unknown>;
  const content = d.content!;
  const ids: number[] = [];
  const owed = new Map<number, number>();
  const owe = (it: string, mu: number): void => { const i = itemIdx(it); owed.set(i, (owed.get(i) ?? 0) + mu); };
  const fleet: Array<[number, number]> = [];
  for (const k of docks) {
    let def = content.buildings.indexOf(k.def);
    if (def < 0) { def = content.buildings.length; content.buildings.push(k.def); }
    const id = d.nextId++;
    ids.push(id);
    d.ents.push(id, def, k.x, k.y, 0, 0, 0);
    const st = new Array<number>(content.items.length).fill(0);
    for (const [it, mu] of k.held) { st[itemIdx(it)] = mu; owe(it, mu); }
    d.stores.push([id, st]);
    d.portItems.push([id, [-1, -1, ...k.outlets.map((it) => (it ? itemIdx(it) : -1))]]);
    d.links = [...(d.links ?? []), d.hearthId, id];
    for (const [it, n] of RETIRED_COSTS[k.def]!) owe(it, n * 1000);
    if (k.ships) { fleet.push([id, k.ships]); for (const [it, n] of RETIRED_DRIFTER) owe(it, k.ships * n * 1000); }
  }
  const forged: Record<string, unknown> = {
    ...d,
    v: 14,
    fleet,
    routes: ids.length >= 2 ? [{ id: 1, from: ids[0]!, to: ids[1]!, item: itemIdx(routeItem), ships: Math.min(2, docks[0]!.ships), carry: 0.375 }] : [],
    nextRouteId: ids.length >= 2 ? 2 : 1,
  };
  if (lab !== undefined) {
    // Survey Data, gone from today's content (D122): the forged save's own table names it.
    const J = content.items.length;
    content.items.push('journal_1');
    forged.done = [...d.done, 'xp_bigdock'].sort();
    forged.projects = [...(d.projects ?? []), { id: 'xp_bigdock', lab, cost: [J, 90_000], paid: [33_000], dur: 6000, el: 1200, tokens: 9000, tokUsed: 1800 }];
  }
  return { data: forged, owed };
}

/** The forged save through the chain, the remap and the load, as `rebuild` opens it (persist/colony.ts). */
function open(data: Record<string, unknown>, sim: Sim): { back: Sim; note: ReturnType<typeof remapSave>['note'] } {
  const m = migrate(data as unknown as { v: number });
  expect(m.from).toBe(14);
  expect(m.data.v).toBe(SAVE_VERSION);
  const r = remapSave(m.data);
  return { back: deserialize(r.data, sim.grid.source), note: r.note };
}

/** The same base saved at version 14 without any dock, opened through the same chain: what the docked one must come back to. */
const cleanOf = (sim: Sim): Sim => open(forge(sim, []).data, sim).back;

/** The loaded base with what it was owed taken back out of the Heart: it must be the base saved without the docks. */
function sameButDocks(back: Sim, clean: Sim, owed: Map<number, number>): void {
  for (let i = 0; i < clean.stock.length; i++) {
    expect(back.stock[i]! - clean.stock[i]!, `${ITEM_IDS[i]} handed to the Heart`).toBe(owed.get(i) ?? 0);
    back.stock[i] = clean.stock[i]!;
  }
  expect(back.ents.size).toBe(clean.ents.size);
  expect(back.hash(), 'the rest of the base as it was').toBe(clean.hash());
}

describe('save 14 → 15 (D108): no skydocks, no drifters', () => {
  it('the step refunds every drifter, drops the routes and forgets the Great Skydock’s node', () => {
    const items = ['iron_plate', 'gear', 'circuit', 'resin_canvas', 'journal_1'];
    const run = docksRetired({
      v: 14, content: { items, buildings: [], recipes: [], recipeSigs: [] }, stock: [5000, 0, 1000, 0, 2000],
      fleet: [[40, 3], [41, 1]], routes: [{ id: 1, from: 40, to: 41, item: 0, ships: 2, carry: 0.5 }], nextRouteId: 2,
      done: ['tr6', 'xp_bigdock', 'xp_express'],
      projects: [{ id: 'xp_bigdock', lab: 9, cost: [4, 90_000], paid: [12_000] }, { id: 'tr7', lab: 9, cost: [4, 40_000], paid: [1000] }],
      labQueue: [[9, 'xp_bigdock'], [10, 'tr8']],
    });
    // Four drifters: 80 resin canvas, 40 gears, 20 circuits; the node's 12 data paid.
    expect(run.stock).toEqual([5000, 40_000, 21_000, 80_000, 14_000]);
    expect('fleet' in run || 'routes' in run || 'nextRouteId' in run).toBe(false);
    expect(run.done).toEqual(['tr6', 'xp_express']);
    expect(run.projects).toEqual([{ id: 'tr7', lab: 9, cost: [4, 40_000], paid: [1000] }]);
    expect(run.labQueue).toEqual([[10, 'tr8']]);
    expect(RESEARCH_RETIRED[15]).toEqual(['xp_bigdock']);
    // A claim that never had a dock loses nothing.
    const young = docksRetired({ v: 14, stock: [1, 2], done: ['kiln'], fleet: [], routes: [], nextRouteId: 1 });
    expect(young).toEqual({ v: 14, stock: [1, 2], done: ['kiln'] });
  });

  it('a small base: its skydocks and Great Skydock come down refunded, their docked goods and drifters in the Heart, nothing else changed', () => {
    const sim = testSim();
    for (const id of ['tr1', 'tr2', 'tr3']) sim.done.add(id);
    sim.rebuildDerived();
    const lab = sim.place('observatory', 503, 512, 0);
    expect(lab.ok, lab.reason).toBe(true);
    sim.run(50);
    const docks: Dock[] = [
      { def: 'skydock', x: 520, y: 500, held: [['iron_plate', 412_000], ['ceramic', 37_500]], outlets: ['iron_plate', null], ships: 3 },
      { def: 'skydock', x: 480, y: 520, held: [['iron_plate', 1_960_000]], outlets: [null, null], ships: 0 },
      { def: 'big_dock', x: 470, y: 470, held: [['embersalt', 88_000], ['copper_ore', 4000]], outlets: ['embersalt', 'copper_ore'], ships: 2 },
    ];
    const { data, owed } = forge(sim, docks, 'iron_plate', lab.id!);
    const { back, note } = open(data, sim);
    // The player is told: two skydocks and a Great Skydock came down, refunded; no item lost.
    expect(note?.removed).toEqual([{ id: 'big_dock', n: 1, refunded: true }, { id: 'skydock', n: 2, refunded: true }]);
    expect(note?.lost).toEqual([]);
    expect(back.done.has('xp_bigdock')).toBe(false);
    expect(back.projects.some((p) => p.id === 'xp_bigdock')).toBe(false);
    for (const [id] of (data.fleet as Array<[number, number]>)) expect(back.ents.get(id)).toBeUndefined();
    // Its 33 Survey Data handed back by the step, then banked as tokens by the remap (D122: 1 100 each).
    expect(note?.converted).toEqual([{ id: 'journal_1', mu: 33_000, tokens: 36_300 }]);
    expect(back.tokenBank).toBe(36_300);
    back.tokenBank = 0;
    sameButDocks(back, cleanOf(sim), owed);
    // It saves at today's version and loads again unchanged.
    const again = deserialize(JSON.parse(JSON.stringify(serialize(back))) as SaveData, sim.grid.source);
    expect(again.hash()).toBe(back.hash());
  });

  it.each([3, 4])('a debug base on map %i, saved with the late base’s docks of before, loads with nothing lost but the docks and runs on', (mapV) => {
    const { sim } = foundScenario(mapV === 4 ? 'late' : 'grown', { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai', mapV });
    // The potteries' dock (ceramic docked), the Fabrique's (ceramic and embersalt out of its two
    // outlets), the coal pit's: a drifter each, two routes' worth (one forged), as D66's late base held them.
    const docks: Dock[] = [
      { def: 'skydock', x: 300, y: 300, held: [['ceramic', 640_000]], outlets: [null, null], ships: 1 },
      { def: 'skydock', x: 306, y: 300, held: [['ceramic', 120_000], ['embersalt', 45_250]], outlets: ['ceramic', 'embersalt'], ships: 1 },
      { def: 'skydock', x: 312, y: 300, held: [['coal', 2_000_000]], outlets: [null, 'coal'], ships: 1 },
    ];
    const { data, owed } = forge(sim, docks, 'ceramic');
    const { back, note } = open(data, sim);
    expect(note?.removed).toEqual([{ id: 'skydock', n: 3, refunded: true }]);
    expect(note?.lost).toEqual([]);
    const clean = cleanOf(sim);
    sameButDocks(back, clean, owed);
    // It runs on as the base saved without the docks does (their refunds taken out above).
    back.run(3000);
    clean.run(3000);
    expect(back.hash()).toBe(clean.hash());
  }, 30_000);
});
