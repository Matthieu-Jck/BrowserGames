// data-d122.test.ts — save 18 → 19 (D122; owner, 2026-10-17: « on va enlever le principe de la
// data »): research on AI tokens at every tier and resources paid at launch. A save 18 may hold data
// anywhere — in the Core, a lab, a store, on a ribbon, in a test bench's buffers —, data collectors,
// relays and test benches, the Data Relay node, projects that paid data. The step (`dataRetired`)
// turns a project's paid data into tokens delivered (a Tier 1 one needs Tier 1's tokens now; what its
// data passes goes to the bank) and forgets the Data Relay; the remap takes the retired buildings
// down, refunded, and banks the data held anywhere (`RETIRED_ITEM_TOKENS`, `tokens.bank`); the load
// opens on research that runs on. Played on forged saves: the tutorial base at Tier 1, the late base at Tier 2+.
import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { RETIRED_COSTS, RETIRED_ITEM_TOKENS, TIER1_TOKENS_V19 } from '@/content/retired';
import { EPOCH, WORLD_EPOCH0 } from '@/sim/constants';
import { withRecipe } from '@/sim/cfg';
import { remapSave } from '@/sim/save-remap';
import { foundScenario } from '@/sim/scenarios';
import { deserialize, serialize, SAVE_VERSION, type SaveData } from '@/sim/serialize';
import type { Sim } from '@/sim/state';
import { dataRetired, migrate } from './migrate';

/** A save 18 of `sim` whose content table names the data items and buildings again (gone from today's), and their indices. */
function save18(sim: Sim): { d: SaveData & Record<string, unknown>; J1: number; J2: number; building: (id: string) => number } {
  const d = JSON.parse(JSON.stringify(serialize(sim))) as SaveData & Record<string, unknown>;
  const c = d.content!;
  const J1 = c.items.length, J2 = J1 + 1;
  c.items.push('journal_1', 'journal_2');
  const building = (id: string): number => { c.buildings.push(id); return c.buildings.length - 1; };
  d.v = 18;
  return { d, J1, J2, building };
}

/** The save through the chain, the remap and the load, as `rebuild` opens it (persist/colony.ts). */
function open(d: SaveData, sim: Sim): { back: Sim; note: ReturnType<typeof remapSave>['note'] } {
  const m = migrate(d as unknown as { v: number });
  expect([m.from, m.data.v]).toEqual([18, SAVE_VERSION]);
  const r = remapSave(m.data);
  return { back: deserialize(r.data, sim.grid.source), note: r.note };
}

const found = (id: 'tutorial' | 'late'): Sim => foundScenario(id, { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai' }).sim;

describe('save 18 → 19 (D122): no data — tokens at every tier, resources at launch', () => {
  it('the step: paid data counted as tokens delivered, a Tier 1 project given its tokens, the rest banked; the Data Relay forgotten; the data makers’ fractions dropped', () => {
    const run = dataRetired({
      v: 18, content: { items: ['iron_plate', 'journal_1', 'journal_2', 'gear'], buildings: [], recipes: [], recipeSigs: [] },
      stock: [5000, 0, 0, 0],
      done: ['an_data', 'an_relay', 'tr1'],
      projects: [
        { id: 'en_pitch', lab: 5, cost: [1, 6000], paid: [3000], dur: 0, el: 0, tokens: 0, tokIn: 0 }, // Tier 1: data alone in save 18
        { id: 'tr2', lab: 6, cost: [1, 60_000, 2, 20_000], paid: [30_000, 6000], dur: 0, el: 0, tokens: 15_000, tokIn: 3750, buy: 500 },
        { id: 'an_relay', lab: 7, cost: [1, 20_000], paid: [6000], dur: 0, el: 0, tokens: 0, tokIn: 0 },
        { id: 'respec:en', lab: 0, cost: [], paid: [], dur: 600, el: 1000, notes: 50 },
      ],
      labQueue: [[7, 'an_relay'], [8, 'tr3']],
      dataAcc: [[1, 12_345]],
      tokens: { serverAcc: 77, held: false, plan: false },
    });
    expect(run.projects).toEqual([
      { id: 'en_pitch', lab: 5, cost: [], paid: [], dur: 0, el: 0, tokens: 2000, tokIn: 2000 }, // 3 Survey Data: 3 300 tokens for its 2 000
      { id: 'tr2', lab: 6, cost: [], paid: [], dur: 0, el: 0, tokens: 15_000, tokIn: 15_000, buy: 500 }, // 3 750 + 33 000 + 35 400
      { id: 'respec:en', lab: 0, cost: [], paid: [], dur: 600, el: 1000, notes: 50 },
    ]);
    expect(run.done).toEqual(['an_data', 'tr1']);
    expect(run.labQueue).toEqual([[8, 'tr3']]);
    expect('dataAcc' in run).toBe(false);
    expect(run.tokens).toEqual({ serverAcc: 77, held: false, plan: false, bank: 1300 + (3750 + 33_000 + 35_400 - 15_000) + 6600 });
    expect(TIER1_TOKENS_V19.en_pitch).toBe(2000);
    expect(RETIRED_ITEM_TOKENS).toEqual({ journal_1: 1100, journal_2: 5900, atlas: 18_800, codex: 101_400 });
    // A claim that never held data loses nothing, and its projects in today's shape stay as they are.
    const young = { v: 18, done: ['kiln'], projects: [{ id: 'tr1', lab: 3, cost: [0, 30_000], paid: [30_000], dur: 0, el: 0, tokens: 2000, tokIn: 500 }] };
    expect(dataRetired(young)).toEqual({ ...young, stock: [] });
  });

  it('a Tier 1 base: its Core’s Survey Data, a ribbon of it, a data collector and its lab’s project come to tokens, the collector refunded; its research runs on', () => {
    const sim = found('tutorial');
    const lab = sim.projects[0]!.lab;
    const { d, J1, building } = save18(sim);
    d.stock[J1] = 150_000; // the Core at its data cap of D118… less 50
    const chain = d.chains.find((c) => c.cells && c.cells.length >= 4 && c.cells.slice(0, 3).every((v) => v === 0))!;
    expect(chain, 'an empty stretch of ribbon to hold data').toBeTruthy();
    chain.cells!.splice(0, 3, J1 + 1, J1 + 1, J1 + 1);
    const col = d.nextId++;
    d.ents.push(col, building('data_collector'), 360, 360, 0, 0, 0);
    d.dataAcc = [[d.hearthId, 5000]];
    d.projects = [{ id: 'en_pitch', lab, cost: [J1, 6000], paid: [2000], dur: 0, el: 0, tokens: 0, tokIn: 0 }];
    d.done = d.done.filter((id) => id !== 'en_pitch');
    const plates0 = sim.stock[itemIdx('iron_plate')]!;
    const { back, note } = open(d, sim);
    expect(note?.removed).toEqual([{ id: 'data_collector', n: 1, refunded: true }]);
    expect(note?.converted).toEqual([{ id: 'journal_1', mu: 153_000, tokens: 168_300 }]);
    expect(note?.lost).toEqual([]);
    expect(back.ents.get(col)).toBeUndefined();
    expect(back.stock[itemIdx('iron_plate')]! - plates0).toBe(RETIRED_COSTS.data_collector![0]![1] * 1000);
    expect(back.projects.map((p) => [p.id, p.tokens, p.tokIn])).toEqual([['en_pitch', 2000, 2000]]); // its 2 files: 2 200 tokens, 200 banked
    expect(back.tokenBank).toBe(168_300 + 200);
    back.run(1);
    expect(back.done.has('en_pitch')).toBe(true);
    // It saves at today's version and loads again unchanged.
    const again = deserialize(JSON.parse(JSON.stringify(serialize(back))) as SaveData, sim.grid.source);
    expect(again.hash()).toBe(back.hash());
  }, 60_000);

  it('a Tier 2 base: Mechanics Data in the Core, a test bench mid-test, a relay, the Data Relay learnt and a Tier 2 project mid-way — all to tokens or refunds; its project ends on its flows', () => {
    const sim = found('late');
    const p0 = sim.projects.find((p) => p.id === 'an_queue')!;
    const { d, J1, J2, building } = save18(sim);
    d.stock[J2] = 80_000;
    // A test bench on Mechanics Data (its recipe named again in the save's table), its buffers half full.
    const c = d.content!;
    c.recipes.push('journal_2');
    c.recipeSigs.push('gear,circuit,oscillator>journal_2');
    const bench = d.nextId++, relay = d.nextId++;
    d.ents.push(bench, building('test_bench'), 360, 360, 0, withRecipe(0, c.recipes.length), 0);
    d.nodes.push([bench, { inBuf: [4000, 2000, 1000], outBuf: [2000], el: 0 }]);
    d.ents.push(relay, building('data_relay'), 370, 360, 0, 0, 0);
    d.done = [...d.done, 'an_relay'].sort();
    d.projects = d.projects!.map((p) => (p.id === 'an_queue' ? { ...p, cost: [J1, 90_000, J2, 30_000], paid: [90_000, 10_000], tokens: 300_000, tokIn: 50_000 } : p));
    const gear0 = sim.stock[itemIdx('gear')]!;
    const { back, note } = open(d, sim);
    expect(note?.removed).toEqual([{ id: 'data_relay', n: 1, refunded: true }, { id: 'test_bench', n: 1, refunded: true }]);
    expect(note?.converted).toEqual([{ id: 'journal_2', mu: 82_000, tokens: 483_800 }]); // the Core's 80 and the bench's 2 made
    expect(back.done.has('an_relay')).toBe(false);
    expect(back.stock[itemIdx('gear')]! - gear0).toBe(4000); // the bench's gears in its buffer, back in the Heart
    const p = back.projects.find((q) => q.id === 'an_queue')!;
    expect([p.tokens, p.tokIn, p.cost.length, p.buy]).toEqual([300_000, 50_000 + 99_000 + 59_000, 0, p0.buy]);
    expect(back.tokenBank).toBe(483_800);
    // The bank tops it up at the next boundary, the oldest project first: done there; the Fabrique's
    // project after it takes what is left.
    back.run(EPOCH);
    expect(back.done.has('an_queue')).toBe(true);
    expect(back.tokenBank).toBeLessThanOrEqual(483_800 - (300_000 - 208_000));
  }, 60_000);
});
